import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  CheckCircle2,
  RotateCcw,
  Loader2,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  Volume2,
  VolumeX,
  Scan,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as faceapi from 'face-api.js';
import { loadRegistrationModels } from '@/services/face-recognition/OptimizedRegistrationService';

interface Scan3DCaptureProps {
  onComplete: (
    averagedDescriptor: Float32Array,
    primaryImage: string,
    allDescriptors: Float32Array[],
    rawImages?: string[]
  ) => void;
  isModelLoading: boolean;
}

type PoseSector = 'front' | 'left' | 'right' | 'up' | 'down';
type CaptureStage = 'aligning' | 'capturing_profile' | 'rotating_angles' | 'complete';

const TOTAL_TICKS = 36;
const TARGET_SAMPLES_PER_SECTOR: Record<PoseSector, number> = {
  front: 2,
  left: 2,
  right: 2,
  up: 2,
  down: 2,
};
const TOTAL_REQUIRED_SAMPLES = 10;
const MAX_SAMPLES = 24;

// Head-pose tuning. Values are RELATIVE to the user's own neutral pose
// (calibrated when the profile photo is taken), so camera height / face
// shape no longer decides whether a turn is detected.
const YAW_THRESHOLD = 0.08; // jaw-based yaw delta that counts as a left/right turn
const PITCH_THRESHOLD = 0.025; // nose-height delta that counts as an up/down tilt
const POSE_SMOOTHING = 0.5; // EMA factor (higher = more responsive)
const PROFILE_FRONT_YAW = 0.18; // max |yaw| accepted for the frontal profile photo
const PROFILE_HOLD_MS = 500; // how long the face must be still & frontal
const PROFILE_FALLBACK_MS = 3500; // auto-take profile if face is roughly frontal this long
const SAMPLE_INTERVAL_MS = 180;
const ROTATION_TIMEOUT_MS = 30000;

// Web Audio API sound engine for Apple Face ID cues
class AppleStyleSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) this.ctx = new AudioContextClass();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
  }

  playShutter() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      this.tone(800, now, 0.09, 0.25, 'triangle', 120);
      this.tone(1400, now + 0.07, 0.07, 0.18, 'sine', 400);
    } catch {}
  }

  playTickPop(frequency = 750) {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      this.tone(frequency, ctx.currentTime, 0.05, 0.14, 'sine', frequency + 260);
    } catch {}
  }

  playSectorComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [659.25, 880].forEach((f, i) => this.tone(f, ctx.currentTime + i * 0.06, 0.14, 0.15));
    } catch {}
  }

  playScanStart() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [523.25, 659.25].forEach((f, i) => this.tone(f, ctx.currentTime + i * 0.08, 0.18, 0.12));
    } catch {}
  }

  playComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [587.33, 880, 1174.66].forEach((f, i) => this.tone(f, ctx.currentTime + i * 0.11, 0.45, 0.22));
    } catch {}
  }

  playFail() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      this.tone(260, ctx.currentTime, 0.25, 0.08, 'sawtooth', 140);
    } catch {}
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface PoseMeasure {
  yaw: number;
  pitch: number;
}

/**
 * Robust head pose from 68 landmarks.
 * yaw   : nose position between the two jaw edges, -1..1.
 *         Positive = nose toward image-right = the user turned to THEIR left.
 * pitch : nose height between eye line and chin, ~0.3..0.6.
 *         Smaller = chin up, larger = chin down.
 */
const measurePose = (pts: faceapi.Point[]): PoseMeasure => {
  const jawL = pts[0];
  const jawR = pts[16];
  const nose = pts[30];
  const chin = pts[8];
  const width = Math.max(1, jawR.x - jawL.x);
  const yaw = ((nose.x - jawL.x) - (jawR.x - nose.x)) / width;

  let eyeY = 0;
  for (let i = 36; i <= 47; i++) eyeY += pts[i].y;
  eyeY /= 12;
  const pitch = (nose.y - eyeY) / Math.max(1, chin.y - eyeY);
  return { yaw, pitch };
};

const Scan3DCapture: React.FC<Scan3DCaptureProps> = ({ onComplete, isModelLoading }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState<CaptureStage>('aligning');
  const [progress, setProgress] = useState(0);
  const [scanComplete, setScanComplete] = useState(false);
  const [primaryImage, setPrimaryImage] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [statusText, setStatusText] = useState('Position your face inside the circle');
  const [activeSector, setActiveSector] = useState<PoseSector>('front');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [flashActive, setFlashActive] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [sectorCounts, setSectorCounts] = useState<Record<PoseSector, number>>({
    front: 0,
    left: 0,
    right: 0,
    up: 0,
    down: 0,
  });

  const descriptorsRef = useRef<Float32Array[]>([]);
  const sampleImagesRef = useRef<string[]>([]);
  const soundRef = useRef(new AppleStyleSoundEngine());
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const activeTicksRef = useRef<Set<number>>(new Set());
  const liveCursorAngleRef = useRef<number | null>(null);
  const liveLandmarksRef = useRef<faceapi.Point[] | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const frontStableSinceRef = useRef<number>(0);
  const profileStageSinceRef = useRef<number>(0);
  const rotationSinceRef = useRef<number>(0);
  const primaryImageRef = useRef<string | null>(null);
  const smoothPoseRef = useRef<PoseMeasure | null>(null);
  const basePoseRef = useRef<PoseMeasure | null>(null);
  const manualProfileRequestRef = useRef(false); const manualSampleRequestRef = useRef(false);
  const finishingRef = useRef(false);

  const scanningRef = useRef(false);
  const scanCompleteRef = useRef(false);
  const faceDetectedRef = useRef(false);
  const sectorCountsRef = useRef(sectorCounts);
  const stageRef = useRef<CaptureStage>('aligning');

  // Keep latest onComplete without restarting the detection loop on every parent render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const streamRef = useRef<MediaStream | null>(null);

  const goStage = (next: CaptureStage) => {
    stageRef.current = next;
    setStage(next);
  };

  const toggleSound = () => {
    soundRef.current.enabled = !soundRef.current.enabled;
    setSoundEnabled(soundRef.current.enabled);
  };

  // Start Camera
  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        if (!mounted) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            console.warn('Auto-play blocked, waiting for user gesture:', playErr);
          }
          setCameraReady(true);
        }
      } catch (err) {
        console.error('Camera access failed:', err);
        setCameraError('Camera permission required. Please allow camera access and reload.');
        setStatusText('Camera permission required. Please allow camera access.');
      }
    };

    startCamera();
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadRegistrationModels().catch((e) => console.error('Model load error:', e));
  }, []);

  const nextNeededSector = (counts: Record<PoseSector, number>): PoseSector | null => {
    const order: PoseSector[] = ['left', 'right', 'up', 'down', 'front'];
    return order.find((s) => counts[s] < TARGET_SAMPLES_PER_SECTOR[s]) ?? null;
  };

  const promptFor = (sector: PoseSector | null) => {
    switch (sector) {
      case 'left': return 'Slowly turn your head left ⬅️';
      case 'right': return 'Slowly turn your head right ➡️';
      case 'up': return 'Tilt your chin up ⬆️';
      case 'down': return 'Tilt your chin down ⬇️';
      case 'front': return 'Look straight at the camera';
      default: return 'Keep moving your head in a slow circle 🔄';
    }
  };

  const triggerParticleBurst = (count = 28) => {
    const c = overlayCanvasRef.current;
    if (!c) return;
    const cx = c.width / 2;
    const cy = c.height / 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5.5;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3.5,
        hue: 142 + (Math.random() * 26 - 13),
        alpha: 1,
        life: 0,
        maxLife: 35 + Math.random() * 25,
      });
    }
  };

  /** Grab the current video frame into the hidden canvas. */
  const grabFrame = (): HTMLCanvasElement | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas;
  };

  /** Square, padded portrait crop from the detection box we already have (no second detection pass). */
  const cropProfile = (frame: HTMLCanvasElement, box: faceapi.Box | null): string => {
    if (!box) return frame.toDataURL('image/jpeg', 0.92);
    const side = Math.max(box.width, box.height) * 1.7;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2 - box.height * 0.05;
    let sx = Math.round(cx - side / 2);
    let sy = Math.round(cy - side / 2);
    let size = Math.round(side);
    size = Math.min(size, frame.width, frame.height);
    sx = Math.max(0, Math.min(sx, frame.width - size));
    sy = Math.max(0, Math.min(sy, frame.height - size));
    const out = document.createElement('canvas');
    out.width = 400;
    out.height = 400;
    const ctx = out.getContext('2d');
    if (!ctx) return frame.toDataURL('image/jpeg', 0.92);
    ctx.drawImage(frame, sx, sy, size, size, 0, 0, 400, 400);
    return out.toDataURL('image/jpeg', 0.94);
  };

  // Finish scan, fuse descriptors, L2 normalize
  const finishScan = useCallback(() => {
    if (finishingRef.current) return;
    const descriptors = descriptorsRef.current;
    const profile = primaryImageRef.current;

    if (descriptors.length < 3 || !profile) {
      soundRef.current.playFail();
      setStatusText(!profile ? 'Profile photo missing. Please rescan.' : 'Not enough angles captured. Please rescan.');
      setScanning(false);
      scanningRef.current = false;
      goStage('aligning');
      setProgress(0);
      return;
    }

    finishingRef.current = true;
    setScanning(false);
    scanningRef.current = false;

    const dim = descriptors[0].length;
    const averaged = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      averaged[i] = descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += averaged[i] * averaged[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i++) averaged[i] /= norm;

    soundRef.current.playComplete();
    setScanComplete(true);
    scanCompleteRef.current = true;
    goStage('complete');
    setProgress(100);
    setStatusText(`Face ID complete! ${descriptors.length} angles calibrated.`);
    triggerParticleBurst(45);
    if ('vibrate' in navigator) {
      try { navigator.vibrate([60, 40, 80, 50, 100]); } catch {}
    }

    onCompleteRef.current(averaged, profile, descriptors.slice(), sampleImagesRef.current.slice());
  }, []);

  const startScan = useCallback(() => {
    if (!cameraReady || isModelLoading || !faceDetectedRef.current) return;

    finishingRef.current = false;
    setScanning(true);
    scanningRef.current = true;
    setScanComplete(false);
    scanCompleteRef.current = false;
    setProgress(0);
    setSampleCount(0);
    descriptorsRef.current = [];
    sampleImagesRef.current = [];
    activeTicksRef.current.clear();
    particlesRef.current = [];
    lastCaptureTimeRef.current = 0;
    frontStableSinceRef.current = 0;
    profileStageSinceRef.current = Date.now();
    basePoseRef.current = null;
    manualProfileRequestRef.current = false;
    primaryImageRef.current = null;
    setPrimaryImage(null);

    const initialCounts: Record<PoseSector, number> = { front: 0, left: 0, right: 0, up: 0, down: 0 };
    setSectorCounts(initialCounts);
    sectorCountsRef.current = initialCounts;

    goStage('capturing_profile');
    setStatusText('Look straight at the camera for your profile photo 📸');
    soundRef.current.playScanStart();
  }, [cameraReady, isModelLoading]);

  // ── Detection loop: runs continuously, never restarted by parent re-renders ──
  useEffect(() => {
    if (!cameraReady || isModelLoading || scanComplete) return;
    let cancelled = false;
    let busy = false;
    let missedFrames = 0;

    const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 });
    const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });

    const addSample = (descriptor: Float32Array, sector: PoseSector, frame: HTMLCanvasElement | null) => {
      descriptorsRef.current.push(descriptor);
      if (frame) sampleImagesRef.current.push(frame.toDataURL('image/jpeg', 0.85));
      const counts = { ...sectorCountsRef.current, [sector]: sectorCountsRef.current[sector] + 1 };
      sectorCountsRef.current = counts;
      setSectorCounts(counts);
      setSampleCount(descriptorsRef.current.length);
      lastCaptureTimeRef.current = Date.now();
      return counts;
    };

    const step = async () => {
      if (cancelled || busy) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      try {
        let detection = await faceapi
          .detectSingleFace(video, tinyOpts)
          .withFaceLandmarks()
          .withFaceDescriptor();

        // SSD is slower but much better at strongly turned faces.
        if (!detection && stageRef.current === 'rotating_angles') {
          detection = await faceapi.detectSingleFace(video, ssdOpts).withFaceLandmarks().withFaceDescriptor();
        }
        if (cancelled) return;

        if (!detection) {
          missedFrames++;
          // Tolerate brief misses (common at extreme angles) before reporting "no face".
          if (missedFrames > 4) {
            if (faceDetectedRef.current) setFaceDetected(false);
            faceDetectedRef.current = false;
            liveLandmarksRef.current = null;
            liveCursorAngleRef.current = null;
            frontStableSinceRef.current = 0;
            if (scanningRef.current) setStatusText('Face lost — move back into the circle');
          }
          return;
        }

        missedFrames = 0;
        if (!faceDetectedRef.current) setFaceDetected(true);
        faceDetectedRef.current = true;
        liveLandmarksRef.current = detection.landmarks.positions;

        // Smoothed pose
        const raw = measurePose(detection.landmarks.positions);
        const prev = smoothPoseRef.current;
        const pose = prev
          ? {
              yaw: prev.yaw + (raw.yaw - prev.yaw) * POSE_SMOOTHING,
              pitch: prev.pitch + (raw.pitch - prev.pitch) * POSE_SMOOTHING,
            }
          : raw;
        const poseDelta = prev ? Math.abs(pose.yaw - prev.yaw) + Math.abs(pose.pitch - prev.pitch) : 0;
        smoothPoseRef.current = pose;

        if (!scanningRef.current) {
          liveCursorAngleRef.current = null;
          return;
        }

        const now = Date.now();

        // ── STAGE 1: profile photo first ──
        if (stageRef.current === 'capturing_profile') {
          const box = detection.detection.box;
          const bigEnough = box.width >= video.videoWidth * 0.18;
          const frontal = Math.abs(pose.yaw) < PROFILE_FRONT_YAW;
          const still = poseDelta < 0.04;

          if (!bigEnough) {
            frontStableSinceRef.current = 0;
            setStatusText('Move a little closer to the camera');
            return;
          }

          if (frontal && still) {
            if (!frontStableSinceRef.current) frontStableSinceRef.current = now;
          } else if (!frontal) {
            frontStableSinceRef.current = 0;
          }

          const heldLongEnough = frontStableSinceRef.current > 0 && now - frontStableSinceRef.current >= PROFILE_HOLD_MS;
          const fallback = now - profileStageSinceRef.current >= PROFILE_FALLBACK_MS && Math.abs(pose.yaw) < 0.22;
          const manual = manualProfileRequestRef.current;

          if (!(heldLongEnough || fallback || manual)) {
            setStatusText(frontal ? 'Hold still… 📸' : 'Look straight at the camera for your profile photo 📸');
            return;
          }

          manualProfileRequestRef.current = false;
          const frame = grabFrame();
          if (!frame) return;

          const profileImg = cropProfile(frame, box);
          primaryImageRef.current = profileImg;
          setPrimaryImage(profileImg);

          // Calibrate neutral pose from THIS user's frontal frame.
          basePoseRef.current = { ...pose };

          soundRef.current.playShutter();
          setFlashActive(true);
          window.setTimeout(() => setFlashActive(false), 220);
          if ('vibrate' in navigator) {
            try { navigator.vibrate(40); } catch {}
          }

          descriptorsRef.current.push(detection.descriptor);
          sampleImagesRef.current.push(profileImg);
          const counts = { ...sectorCountsRef.current, front: 1 };
          sectorCountsRef.current = counts;
          setSectorCounts(counts);
          setSampleCount(1);
          lastCaptureTimeRef.current = now;

          rotationSinceRef.current = now;
          goStage('rotating_angles');
          const next = nextNeededSector(counts);
          setActiveSector(next ?? 'front');
          setStatusText('Photo saved! Now ' + promptFor(next).charAt(0).toLowerCase() + promptFor(next).slice(1));
          return;
        }

        // ── STAGE 2: 360° rotation ──
        if (stageRef.current !== 'rotating_angles' || scanCompleteRef.current) return;

        const base = basePoseRef.current ?? { yaw: 0, pitch: pose.pitch };
        const dYaw = pose.yaw - base.yaw;
        const dPitch = pose.pitch - base.pitch;
        const nx = dYaw / YAW_THRESHOLD; // >0 = user's left
        const ny = dPitch / PITCH_THRESHOLD; // >0 = chin down

        let sector: PoseSector = 'front';
        if (Math.abs(nx) >= 1 || Math.abs(ny) >= 1) {
          if (Math.abs(nx) >= Math.abs(ny)) sector = nx > 0 ? 'left' : 'right';
          else sector = ny < 0 ? 'up' : 'down';
        }

        // Ring position as seen on the MIRRORED preview:
        // turning to your left moves you toward the left of the screen.
        const dispX = -nx;
        const dispY = ny;
        const mag = Math.hypot(dispX, dispY);
        let newTick = false;
        if (mag > 0.35) {
          const angle = Math.atan2(dispY, dispX);
          liveCursorAngleRef.current = angle;
          if (mag >= 0.9) {
            // Canvas ticks are drawn at (i / T) * 2π - π/2  → invert that mapping.
            let norm = (angle + Math.PI / 2) / (Math.PI * 2);
            norm = ((norm % 1) + 1) % 1;
            const idx = Math.round(norm * TOTAL_TICKS) % TOTAL_TICKS;
            const before = activeTicksRef.current.size;
            for (let d = -1; d <= 1; d++) activeTicksRef.current.add((idx + d + TOTAL_TICKS) % TOTAL_TICKS);
            newTick = activeTicksRef.current.size > before;
            if (newTick) {
              soundRef.current.playTickPop(700 + activeTicksRef.current.size * 14);
              if ('vibrate' in navigator) {
                try { navigator.vibrate(15); } catch {}
              }
            }
          }
        } else {
          liveCursorAngleRef.current = null;
        }

        const counts = sectorCountsRef.current;
        const targetSector = nextNeededSector(counts) ?? 'front';
        const sectorNeedsMore = counts[sector] < TARGET_SAMPLES_PER_SECTOR[sector];
        
        const manualSample = manualSampleRequestRef.current;
        if (manualSample) manualSampleRequestRef.current = false;

        const canSample =
          manualSample ||
          (now - lastCaptureTimeRef.current >= SAMPLE_INTERVAL_MS &&
          descriptorsRef.current.length < MAX_SAMPLES &&
          (sectorNeedsMore || (newTick && sector !== 'front')));

        let latest = counts;
        if (canSample) {
          const captureSector = manualSample ? targetSector : sector;
          latest = addSample(detection.descriptor, captureSector, grabFrame());
          if (latest[captureSector] === TARGET_SAMPLES_PER_SECTOR[captureSector]) {
            soundRef.current.playSectorComplete();
            triggerParticleBurst(22);
          }
        }

        const next = nextNeededSector(latest);
        setActiveSector(next ?? 'front');
        setStatusText(promptFor(next));

        const completedSectors = (Object.keys(latest) as PoseSector[]).filter(
          (k) => latest[k] >= TARGET_SAMPLES_PER_SECTOR[k]
        ).length;
        const tickRatio = activeTicksRef.current.size / TOTAL_TICKS;
        const sampleRatio = Math.min(descriptorsRef.current.length / TOTAL_REQUIRED_SAMPLES, 1);
        setProgress(Math.min(100, (completedSectors / 5) * 55 + tickRatio * 25 + sampleRatio * 20));

        const total = descriptorsRef.current.length;
        const timedOut = now - rotationSinceRef.current > ROTATION_TIMEOUT_MS && total >= 6;
        if (completedSectors >= 5 || (tickRatio >= 0.7 && total >= 8) || timedOut) {
          finishScan();
        }
      } catch (err) {
        console.error('Face ID detection error:', err);
      } finally {
        busy = false;
      }
    };

    const interval = window.setInterval(step, 90);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [cameraReady, isModelLoading, scanComplete, finishScan]);

  // ── Overlay render loop ──
  useEffect(() => {
    if (!overlayCanvasRef.current || !cameraReady) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let running = true;

    const render = () => {
      if (!running) return;
      const w = (canvas.width = canvas.clientWidth * 2);
      const h = (canvas.height = canvas.clientHeight * 2);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.38;
      const isScan = scanningRef.current;
      const isFace = faceDetectedRef.current;
      const isDone = scanCompleteRef.current;
      const activeTicks = activeTicksRef.current;
      const cursorAngle = liveCursorAngleRef.current;
      const t = Date.now() / 1000;

      // Landmarks mapped through object-cover + mirror
      const landmarks = liveLandmarksRef.current;
      const v = videoRef.current;
      if (landmarks && landmarks.length >= 68 && v && v.videoWidth) {
        const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
        const offX = (w - v.videoWidth * scale) / 2;
        const offY = (h - v.videoHeight * scale) / 2;
        const mapPoint = (p: faceapi.Point) => ({
          x: w - (p.x * scale + offX),
          y: p.y * scale + offY,
        });

        ctx.save();
        ctx.strokeStyle = isDone ? 'hsla(142, 85%, 55%, 0.6)' : isScan ? 'hsla(142, 85%, 55%, 0.45)' : 'hsla(185, 80%, 55%, 0.35)';
        ctx.lineWidth = 1.4;
        const path = (from: number, to: number, close = false) => {
          ctx.beginPath();
          for (let i = from; i <= to; i++) {
            const pt = mapPoint(landmarks[i]);
            if (i === from) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          if (close) ctx.closePath();
          ctx.stroke();
        };
        path(0, 16);
        path(27, 35);
        path(36, 41, true);
        path(42, 47, true);
        ctx.restore();
      }

      // Guide ring
      ctx.save();
      ctx.strokeStyle = isDone
        ? 'hsla(142, 85%, 50%, 0.95)'
        : isScan
        ? 'hsla(142, 80%, 50%, 0.65)'
        : isFace
        ? 'hsla(185, 75%, 50%, 0.6)'
        : 'hsla(220, 20%, 65%, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Radial ticks
      for (let i = 0; i < TOTAL_TICKS; i++) {
        const a = (i / TOTAL_TICKS) * Math.PI * 2 - Math.PI / 2;
        const on = activeTicks.has(i) || isDone;
        const innerR = on ? radius + 8 : radius + 10;
        const outerR = on ? radius + 25 : radius + 19;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
        ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
        if (on) {
          ctx.shadowColor = 'hsla(142, 85%, 50%, 0.85)';
          ctx.shadowBlur = 12;
          ctx.strokeStyle = 'hsla(142, 85%, 52%, 0.98)';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
        } else {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'hsla(0, 0%, 100%, 0.28)';
          ctx.lineWidth = 2;
          ctx.lineCap = 'butt';
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Direction cursor
      if (isScan && stageRef.current === 'rotating_angles' && cursorAngle !== null) {
        const r = radius + 17;
        const bx = cx + Math.cos(cursorAngle) * r;
        const by = cy + Math.sin(cursorAngle) * r;
        ctx.save();
        ctx.shadowColor = 'hsla(185, 95%, 60%, 0.95)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = 'hsla(185, 95%, 65%, 1)';
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'hsla(185, 95%, 70%, 0.6)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(bx, by, 9.5 + Math.sin(t * 8) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Particles
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life++;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = (1 - p.life / p.maxLife) * p.alpha;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, ${alpha})`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `hsla(${p.hue}, 85%, 60%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraReady]);

  const resetScan = () => {
    finishingRef.current = false;
    setScanComplete(false);
    scanCompleteRef.current = false;
    setScanning(false);
    scanningRef.current = false;
    goStage('aligning');
    setProgress(0);
    setSampleCount(0);
    descriptorsRef.current = [];
    sampleImagesRef.current = [];
    activeTicksRef.current.clear();
    primaryImageRef.current = null;
    setPrimaryImage(null);
    basePoseRef.current = null;
    frontStableSinceRef.current = 0;
    setStatusText('Position your face inside the circle');
    const initialCounts: Record<PoseSector, number> = { front: 0, left: 0, right: 0, up: 0, down: 0 };
    setSectorCounts(initialCounts);
    sectorCountsRef.current = initialCounts;
  };

  const getSectorIcon = (sec: PoseSector) => {
    switch (sec) {
      case 'left': return <ArrowLeft className="w-3.5 h-3.5" />;
      case 'right': return <ArrowRight className="w-3.5 h-3.5" />;
      case 'up': return <ArrowUp className="w-3.5 h-3.5" />;
      case 'down': return <ArrowDown className="w-3.5 h-3.5" />;
      default: return <CheckCircle2 className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="relative rounded-3xl overflow-hidden bg-black aspect-square w-full max-w-[420px] max-h-[54vh] shadow-2xl border border-white/10 mx-auto">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1) translateZ(0)' }}
        />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        <AnimatePresence>
          {flashActive && (
            <motion.div
              initial={{ opacity: 0.95 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-0 bg-white pointer-events-none z-30"
            />
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={toggleSound}
          className="absolute top-3 left-3 p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition-all z-20"
          title={soundEnabled ? 'Mute Face ID audio' : 'Unmute Face ID audio'}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
        </button>

        {primaryImage && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute top-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/50 backdrop-blur-md shadow-lg z-20"
          >
            <div className="relative w-6 h-6 rounded-full overflow-hidden border border-emerald-400">
              <img src={primaryImage} alt="Profile" className="w-full h-full object-cover" />
            </div>
            <span className="text-[11px] font-bold text-emerald-300">Profile Photo ✓</span>
          </motion.div>
        )}

        {scanning && stage === 'rotating_angles' && (
          <div className="absolute top-12 inset-x-3 flex items-center justify-between gap-1 z-10">
            {(['front', 'left', 'right', 'up', 'down'] as PoseSector[]).map((sec) => {
              const done = sectorCounts[sec] >= TARGET_SAMPLES_PER_SECTOR[sec];
              const current = activeSector === sec;
              return (
                <div
                  key={sec}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg text-[10px] font-bold uppercase transition-all backdrop-blur-md ${
                    done
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                      : current
                      ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400 animate-pulse'
                      : 'bg-black/50 text-white/50 border border-white/10'
                  }`}
                >
                  {done ? <Check className="w-3 h-3 text-emerald-400" /> : getSectorIcon(sec)}
                  <span className="hidden sm:inline">{sec}</span>
                </div>
              );
            })}
          </div>
        )}

        {!scanning && !scanComplete && cameraReady && !primaryImage && (
          <div
            className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur-md transition-all z-20 ${
              faceDetected
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
            {faceDetected ? 'Face in Position' : 'Align face in circle'}
          </div>
        )}

        {(isModelLoading || (!cameraReady && !cameraError)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-30">
            <div className="text-center text-white space-y-2">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-400" />
              <p className="text-sm font-semibold">{isModelLoading ? 'Loading Face ID models…' : 'Starting camera…'}</p>
            </div>
          </div>
        )}

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 sm:p-4 pt-10 z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={statusText}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="flex items-center justify-center gap-2"
            >
              {scanning && stage === 'rotating_angles' && getSectorIcon(activeSector)}
              <p className="text-center text-white font-semibold text-xs sm:text-sm tracking-wide drop-shadow">{statusText}</p>
            </motion.div>
          </AnimatePresence>

          {scanning && stage === 'rotating_angles' && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden p-0.5 backdrop-blur-sm">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, hsl(185, 95%, 50%), hsl(142, 85%, 50%))',
                    boxShadow: '0 0 10px hsla(142, 85%, 50%, 0.7)',
                  }}
                  transition={{ ease: 'easeOut', duration: 0.15 }}
                />
              </div>
              <span className="text-[11px] sm:text-xs font-mono font-bold text-white/80 tabular-nums">
                {sampleCount}/{TOTAL_REQUIRED_SAMPLES} pts
              </span>
            </div>
          )}
        </div>

        {scanComplete && primaryImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-20"
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 18 }}
              className="text-center p-4"
            >
              <div className="relative inline-block mb-3">
                <img
                  src={primaryImage}
                  alt="Scanned Face"
                  className="w-28 h-28 sm:w-36 sm:h-36 rounded-full object-cover border-4 shadow-2xl"
                  style={{ borderColor: 'hsl(142, 80%, 50%)', boxShadow: '0 0 32px hsla(142, 80%, 50%, 0.5)' }}
                />
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="absolute -bottom-1 -right-1 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shadow-lg"
                  style={{ background: 'hsl(142, 80%, 45%)' }}
                >
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </motion.div>
              </div>
              <h4 className="font-extrabold text-base sm:text-lg text-emerald-400">Face ID Enrollment Complete</h4>
              <p className="text-white/70 text-xs mt-0.5">Profile photo saved · {sampleCount} angles calibrated</p>
            </motion.div>
          </motion.div>
        )}
      </div>

      {cameraError && <p className="text-center text-sm text-rose-500">{cameraError}</p>}

      {!scanComplete ? (
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <Button
            type="button"
            onClick={startScan}
            disabled={!cameraReady || isModelLoading || scanning || !faceDetected}
            className="w-full h-12 text-sm sm:text-base font-bold shadow-xl active:scale-[0.98] transition-all touch-manipulation rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white"
          >
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {stage === 'capturing_profile' ? 'Taking profile photo…' : `Calibrating angles (${Math.round(progress)}%)`}
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-2" />
                {faceDetected ? 'Start Face ID Scan' : 'Position face inside circle'}
              </>
            )}
          </Button>

          {scanning && stage === 'capturing_profile' && (
            <Button
              type="button"
              onClick={() => { manualProfileRequestRef.current = true; }}
              variant="outline"
              className="w-full sm:w-auto h-12 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 text-xs font-bold rounded-xl"
            >
              <Camera className="h-4 w-4 mr-1.5" /> Take photo now
            </Button>
          )}

          {scanning && stage === 'rotating_angles' && (
            <Button
              type="button"
              onClick={() => { manualSampleRequestRef.current = true; }}
              variant="outline"
              className="w-full sm:w-auto h-12 border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 text-xs font-bold rounded-xl"
            >
              <Camera className="h-4 w-4 mr-1.5" /> Force capture
            </Button>
          )}

          {scanning && stage === 'rotating_angles' && sampleCount >= 6 && (
            <Button
              type="button"
              onClick={finishScan}
              variant="outline"
              className="w-full sm:w-auto h-12 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 text-xs font-bold rounded-xl"
            >
              Complete now ({sampleCount} pts)
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          onClick={resetScan}
          variant="outline"
          className="w-full h-12 active:scale-[0.98] transition-transform touch-manipulation rounded-xl border-border font-semibold text-sm"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Rescan Face ID
        </Button>
      )}
    </div>
  );
};

export default Scan3DCapture;
