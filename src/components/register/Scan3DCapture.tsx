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
  Sparkles,
  ShieldCheck,
  Check,
  Volume2,
  VolumeX,
  Scan,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as faceapi from 'face-api.js';
import {
  loadRegistrationModels,
  getFaceBoxFromImage,
} from '@/services/face-recognition/OptimizedRegistrationService';

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

type CaptureStage = 'aligning' | 'capturing_profile' | 'profile_done' | 'rotating_angles' | 'complete';

const TOTAL_TICKS = 36;
const TARGET_SAMPLES_PER_SECTOR: Record<PoseSector, number> = {
  front: 3,
  left: 2,
  right: 2,
  up: 2,
  down: 2,
};
const TOTAL_REQUIRED_SAMPLES = 11;

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

  playShutter() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Realistic mechanical camera shutter sound
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);

      // Shutter click echo
      setTimeout(() => {
        try {
          if (!this.enabled || !this.ctx) return;
          const now2 = this.ctx.currentTime;
          const osc2 = this.ctx.createOscillator();
          const gain2 = this.ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(1400, now2);
          osc2.frequency.exponentialRampToValueAtTime(400, now2 + 0.06);
          gain2.gain.setValueAtTime(0.18, now2);
          gain2.gain.exponentialRampToValueAtTime(0.001, now2 + 0.07);
          osc2.connect(gain2);
          gain2.connect(this.ctx.destination);
          osc2.start(now2);
          osc2.stop(now2 + 0.07);
        } catch {}
      }, 70);
    } catch {}
  }

  playTickPop(frequency = 750) {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency + 260, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch {}
  }

  playSectorComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [659.25, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.06);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.06 + 0.14);
        osc.start(ctx.currentTime + idx * 0.06);
        osc.stop(ctx.currentTime + idx * 0.06 + 0.14);
      });
    } catch {}
  }

  playScanStart() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.18);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.18);
      });
    } catch {}
  }

  playComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      // Apple Pay / Face ID signature celebration chime
      [587.33, 880, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const start = ctx.currentTime + i * 0.11;
        gain.gain.setValueAtTime(0.22, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    } catch {}
  }

  playFail() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.25);
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
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

const Scan3DCapture: React.FC<Scan3DCaptureProps> = ({ onComplete, isModelLoading }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraReady, setCameraReady] = useState(false);
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
  const frontFaceStableStartRef = useRef<number>(0);
  const primaryCapturedRef = useRef<boolean>(false);

  const scanningRef = useRef(false);
  const scanCompleteRef = useRef(false);
  const faceDetectedRef = useRef(false);
  const sectorCountsRef = useRef(sectorCounts);
  const stageRef = useRef<CaptureStage>('aligning');

  useEffect(() => { scanningRef.current = scanning; }, [scanning]);
  useEffect(() => { scanCompleteRef.current = scanComplete; }, [scanComplete]);
  useEffect(() => { faceDetectedRef.current = faceDetected; }, [faceDetected]);
  useEffect(() => { sectorCountsRef.current = sectorCounts; }, [sectorCounts]);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  const streamRef = useRef<MediaStream | null>(null);

  // Toggle sound
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
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
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
        setStatusText('Camera permission required. Please allow camera access.');
      }
    };

    startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Ensure registration models are loaded
  useEffect(() => {
    loadRegistrationModels().catch((e) => console.error('Model load error:', e));
  }, []);

  // Update dynamic guidance prompt based on completed sectors
  const updateGuidancePrompt = (counts: Record<PoseSector, number>) => {
    if (counts.left < TARGET_SAMPLES_PER_SECTOR.left) {
      setActiveSector('left');
      setStatusText('Slowly turn your head left ⬅️');
      return 'left';
    }
    if (counts.right < TARGET_SAMPLES_PER_SECTOR.right) {
      setActiveSector('right');
      setStatusText('Slowly turn your head right ➡️');
      return 'right';
    }
    if (counts.up < TARGET_SAMPLES_PER_SECTOR.up) {
      setActiveSector('up');
      setStatusText('Tilt your chin slightly up ⬆️');
      return 'up';
    }
    if (counts.down < TARGET_SAMPLES_PER_SECTOR.down) {
      setActiveSector('down');
      setStatusText('Tilt your chin slightly down ⬇️');
      return 'down';
    }
    setStatusText('Finishing Apple Face ID calibration…');
    return 'front';
  };

  // Apple Face ID Particle Burst
  const triggerParticleBurst = (cx: number, cy: number, count = 28) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5.5;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3.5,
        hue: 142 + (Math.random() * 26 - 13), // Emerald Apple Green
        alpha: 1,
        life: 0,
        maxLife: 35 + Math.random() * 25,
      });
    }
  };

  // Helper to capture crystal clear 1:1 square front portrait for student profile
  const captureFrontProfilePhoto = async (): Promise<string | null> => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);

    const faceBox = await getFaceBoxFromImage(video);
    if (faceBox) {
      // Ideal square portrait crop with 35% margin for student ID card
      const pad = Math.round(Math.max(faceBox.width, faceBox.height) * 0.38);
      const sx = Math.max(0, Math.floor(faceBox.x - pad));
      const sy = Math.max(0, Math.floor(faceBox.y - pad));
      const sw = Math.min(video.videoWidth - sx, Math.floor(faceBox.width + pad * 2));
      const sh = Math.min(video.videoHeight - sy, Math.floor(faceBox.height + pad * 2));

      const out = document.createElement('canvas');
      out.width = 400;
      out.height = 400;
      const outCtx = out.getContext('2d');
      if (outCtx) {
        outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 400, 400);
        return out.toDataURL('image/jpeg', 0.94);
      }
    }
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  // Finish scan, fuse descriptors, L2 normalize
  const finishScan = useCallback(async () => {
    setScanning(false);
    scanningRef.current = false;
    const descriptors = descriptorsRef.current;

    if (descriptors.length < 3) {
      soundRef.current.playFail();
      setStatusText('Insufficient 3D face data. Hold still and rescan.');
      setProgress(0);
      setStage('aligning');
      return;
    }

    let finalProfile = primaryImage;
    if (!finalProfile) {
      finalProfile = await captureFrontProfilePhoto();
      if (finalProfile) setPrimaryImage(finalProfile);
    }

    if (!finalProfile) {
      soundRef.current.playFail();
      setStatusText('Failed to capture profile photo. Please retry.');
      setStage('aligning');
      return;
    }

    // 1. Centroid fusion of all captured descriptors
    const dim = descriptors[0].length;
    const averaged = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      averaged[i] = descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length;
    }

    // 2. L2 Normalization onto unit sphere
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += averaged[i] * averaged[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        averaged[i] /= norm;
      }
    }

    // Complete celebration
    soundRef.current.playComplete();
    setScanComplete(true);
    scanCompleteRef.current = true;
    setStage('complete');
    setProgress(100);
    setStatusText(`Apple Face ID Complete! ${descriptors.length} 3D angle vectors calibrated.`);

    if (overlayCanvasRef.current) {
      const ow = overlayCanvasRef.current.width;
      const oh = overlayCanvasRef.current.height;
      triggerParticleBurst(ow / 2, oh / 2, 45);
    }

    if ('vibrate' in navigator) {
      try { navigator.vibrate([60, 40, 80, 50, 100]); } catch {}
    }

    onComplete(averaged, finalProfile, descriptors, sampleImagesRef.current.slice());
  }, [onComplete, primaryImage]);

  // Start Apple Face ID Capture Workflow
  const startScan = useCallback(() => {
    if (!cameraReady || isModelLoading || !faceDetected) return;

    setScanning(true);
    scanningRef.current = true;
    setScanComplete(false);
    scanCompleteRef.current = false;
    setProgress(0);
    descriptorsRef.current = [];
    sampleImagesRef.current = [];
    activeTicksRef.current.clear();
    particlesRef.current = [];
    lastCaptureTimeRef.current = Date.now();
    frontFaceStableStartRef.current = 0;
    primaryCapturedRef.current = false;
    setPrimaryImage(null);

    const initialCounts: Record<PoseSector, number> = {
      front: 0,
      left: 0,
      right: 0,
      up: 0,
      down: 0,
    };
    setSectorCounts(initialCounts);
    sectorCountsRef.current = initialCounts;

    // Stage 1: Capturing Frontal Profile Photo First
    setStage('capturing_profile');
    stageRef.current = 'capturing_profile';
    setStatusText('Look straight at the camera for your profile photo 📸');
    soundRef.current.playScanStart();
  }, [cameraReady, isModelLoading, faceDetected]);

  // Real-Time Detection & Apple Face ID Continuous Rotation Engine
  useEffect(() => {
    if (!cameraReady || scanComplete || isModelLoading) return;
    let cancelled = false;
    let isProcessing = false;

    const runDetectionStep = async () => {
      if (cancelled || !videoRef.current) return;
      if (isProcessing) return;

      const video = videoRef.current;
      if (video.readyState < 2 || video.videoWidth === 0) return;

      isProcessing = true;
      try {
        let detection = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 })
          )
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection && scanningRef.current) {
          detection = await faceapi
            .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.38 }))
            .withFaceLandmarks()
            .withFaceDescriptor();
        }

        if (cancelled) return;

        if (detection) {
          setFaceDetected(true);
          faceDetectedRef.current = true;
          liveLandmarksRef.current = detection.landmarks.positions;

          const landmarks = detection.landmarks;
          const noseTip = landmarks.positions[30];
          const leftEye = landmarks.positions[36];
          const rightEye = landmarks.positions[45];
          const chin = landmarks.positions[8];

          const eyeMidX = (leftEye.x + rightEye.x) / 2;
          const eyeMidY = (leftEye.y + rightEye.y) / 2;
          const eyeDist = Math.max(Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y), 1);
          const faceH = Math.max(Math.hypot(chin.x - eyeMidX, chin.y - eyeMidY), 1);

          // Video is mirrored on screen via scaleX(-1)
          const yaw = (noseTip.x - eyeMidX) / eyeDist;
          const pitchRatio = (noseTip.y - eyeMidY) / faceH;

          // Continuous angle mapping for Apple Face ID tick circle
          const dx = yaw * 2.8;
          const dy = (pitchRatio - 0.41) * 3.2;
          const continuousAngle = Math.atan2(dy, dx);
          liveCursorAngleRef.current = continuousAngle;

          // Map continuous angle to tick index [0 .. TOTAL_TICKS - 1]
          let deg = (continuousAngle * 180) / Math.PI;
          if (deg < 0) deg += 360;
          const tickIdx = Math.floor((deg / 360) * TOTAL_TICKS) % TOTAL_TICKS;

          // Detect discrete pose sector
          let detectedSector: PoseSector = 'front';
          const isFront = Math.abs(yaw) < 0.15 && pitchRatio >= 0.35 && pitchRatio <= 0.48;
          if (isFront) {
            detectedSector = 'front';
          } else if (yaw > 0.18) {
            detectedSector = 'left';
          } else if (yaw < -0.18) {
            detectedSector = 'right';
          } else if (pitchRatio < 0.33) {
            detectedSector = 'up';
          } else if (pitchRatio > 0.49) {
            detectedSector = 'down';
          }

          const currentStage = stageRef.current;

          // ── STAGE 1: FIRST PHOTO FOR PROFILE ──
          if (scanningRef.current && currentStage === 'capturing_profile' && !primaryCapturedRef.current) {
            if (isFront) {
              if (!frontFaceStableStartRef.current) {
                frontFaceStableStartRef.current = Date.now();
              }
              const stableDuration = Date.now() - frontFaceStableStartRef.current;

              if (stableDuration >= 450) {
                // Snap official front profile photo
                primaryCapturedRef.current = true;
                soundRef.current.playShutter();
                setFlashActive(true);
                setTimeout(() => setFlashActive(false), 220);

                if ('vibrate' in navigator) {
                  try { navigator.vibrate(40); } catch {}
                }

                const profileImg = await captureFrontProfilePhoto();
                if (profileImg) {
                  setPrimaryImage(profileImg);
                }

                // Add front descriptor sample
                descriptorsRef.current.push(detection.descriptor);
                if (profileImg) sampleImagesRef.current.push(profileImg);

                const counts = { ...sectorCountsRef.current, front: 1 };
                sectorCountsRef.current = counts;
                setSectorCounts(counts);

                // Fill center ticks
                [0, 1, TOTAL_TICKS - 1].forEach((t) => activeTicksRef.current.add(t));

                soundRef.current.playSectorComplete();
                setStage('rotating_angles');
                stageRef.current = 'rotating_angles';
                setStatusText('Profile photo saved! Now slowly rotate your head in a circle 🔄');
              } else {
                setStatusText('Hold still for profile photo… 📸');
              }
            } else {
              frontFaceStableStartRef.current = 0;
              setStatusText('Look straight at the camera to take profile photo 📸');
            }
            return;
          }

          // ── STAGE 2: 360° APPLE FACE ID CIRCULAR HEAD ROTATION ──
          if (scanningRef.current && currentStage === 'rotating_angles' && !scanCompleteRef.current) {
            const now = Date.now();
            const timeSinceLast = now - lastCaptureTimeRef.current;

            const currentCounts = { ...sectorCountsRef.current };
            const neededForSector = TARGET_SAMPLES_PER_SECTOR[detectedSector];
            const currentInSector = currentCounts[detectedSector];

            // Activate radial ticks around user's continuous angle
            const prevSize = activeTicksRef.current.size;
            activeTicksRef.current.add(tickIdx);
            activeTicksRef.current.add((tickIdx + 1) % TOTAL_TICKS);
            activeTicksRef.current.add((tickIdx - 1 + TOTAL_TICKS) % TOTAL_TICKS);

            if (activeTicksRef.current.size > prevSize) {
              const beepPitch = 700 + activeTicksRef.current.size * 18;
              soundRef.current.playTickPop(beepPitch);
              if ('vibrate' in navigator) {
                try { navigator.vibrate(20); } catch {}
              }
            }

            // Capture sample if sector needs samples & throttle 150ms
            if (timeSinceLast > 150 && currentInSector < neededForSector + 1) {
              descriptorsRef.current.push(detection.descriptor);
              currentCounts[detectedSector] = currentInSector + 1;
              sectorCountsRef.current = currentCounts;
              setSectorCounts(currentCounts);
              lastCaptureTimeRef.current = now;

              // Save snapshot
              if (canvasRef.current && video) {
                const c = canvasRef.current;
                c.width = video.videoWidth;
                c.height = video.videoHeight;
                const ctx = c.getContext('2d');
                if (ctx) {
                  ctx.drawImage(video, 0, 0);
                  sampleImagesRef.current.push(c.toDataURL('image/jpeg', 0.88));
                }
              }

              // Sector completion celebration
              if (currentInSector + 1 === neededForSector) {
                soundRef.current.playSectorComplete();
                if (overlayCanvasRef.current) {
                  const ow = overlayCanvasRef.current.width;
                  const oh = overlayCanvasRef.current.height;
                  triggerParticleBurst(ow / 2, oh / 2, 22);
                }
              }

              // Calculate overall radial progress
              const totalCollected = descriptorsRef.current.length;
              const completedSectors = (Object.keys(currentCounts) as PoseSector[]).filter(
                (k) => currentCounts[k] >= TARGET_SAMPLES_PER_SECTOR[k]
              ).length;

              const tickProg = (activeTicksRef.current.size / TOTAL_TICKS) * 60;
              const sampleProg = Math.min((totalCollected / TOTAL_REQUIRED_SAMPLES) * 40, 40);
              const totalProg = Math.min(tickProg + sampleProg, 100);
              setProgress(totalProg);

              updateGuidancePrompt(currentCounts);

              // Complete when either all 5 sectors satisfied OR 11+ samples across 4+ sectors
              if (completedSectors >= 5 || (totalCollected >= TOTAL_REQUIRED_SAMPLES && completedSectors >= 4)) {
                void finishScan();
              }
            }
          }
        } else {
          setFaceDetected(false);
          faceDetectedRef.current = false;
          liveLandmarksRef.current = null;
          liveCursorAngleRef.current = null;
        }
      } catch (err) {
        console.error('Detection error:', err);
      } finally {
        isProcessing = false;
      }
    };

    const interval = setInterval(runDetectionStep, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cameraReady, scanComplete, isModelLoading, finishScan]);

  // Apple Face ID Canvas Overlay Render Loop
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
      const radius = Math.min(w, h) * 0.38; // Circular Face ID Ring
      const isScan = scanningRef.current;
      const isFace = faceDetectedRef.current;
      const isDone = scanCompleteRef.current;
      const activeTicks = activeTicksRef.current;
      const cursorAngle = liveCursorAngleRef.current;
      const currentStage = stageRef.current;
      const t = Date.now() / 1000;

      // 1. Face Landmark Wireframe Mesh
      const landmarks = liveLandmarksRef.current;
      if (landmarks && landmarks.length >= 68 && videoRef.current) {
        const vw = videoRef.current.videoWidth || 640;
        const vh = videoRef.current.videoHeight || 480;

        ctx.save();
        ctx.strokeStyle = isDone
          ? 'hsla(142, 85%, 55%, 0.6)'
          : isScan
          ? 'hsla(142, 85%, 55%, 0.45)'
          : 'hsla(185, 80%, 55%, 0.35)';
        ctx.lineWidth = 1.4;

        // video is mirrored via scaleX(-1)
        const mapPoint = (p: faceapi.Point) => ({
          x: (1 - p.x / vw) * w,
          y: (p.y / vh) * h,
        });

        // Jawline
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const pt = mapPoint(landmarks[i]);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Nose Bridge
        ctx.beginPath();
        for (let i = 27; i <= 35; i++) {
          const pt = mapPoint(landmarks[i]);
          if (i === 27) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Eye Contours
        [[36, 37, 38, 39, 40, 41], [42, 43, 44, 45, 46, 47]].forEach((indices) => {
          ctx.beginPath();
          indices.forEach((idx, i) => {
            const pt = mapPoint(landmarks[idx]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.closePath();
          ctx.stroke();
        });
        ctx.restore();
      }

      // 2. Base Guide Ring Circle (Apple Viewport)
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

      // 3. Apple Face ID 360° Radial Ticks Ring
      for (let i = 0; i < TOTAL_TICKS; i++) {
        const tickAngle = (i / TOTAL_TICKS) * Math.PI * 2 - Math.PI / 2;
        const isTickActive = activeTicks.has(i) || isDone;

        const innerR = isTickActive ? radius + 8 : radius + 10;
        const outerR = isTickActive ? radius + 25 : radius + 19;

        const x1 = cx + Math.cos(tickAngle) * innerR;
        const y1 = cy + Math.sin(tickAngle) * innerR;
        const x2 = cx + Math.cos(tickAngle) * outerR;
        const y2 = cy + Math.sin(tickAngle) * outerR;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (isTickActive) {
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

      // 4. Live Rotation Cursor Beacon (Apple Direction Radar)
      if (isScan && currentStage === 'rotating_angles' && cursorAngle !== null) {
        const cursorR = radius + 17;
        const bx = cx + Math.cos(cursorAngle) * cursorR;
        const by = cy + Math.sin(cursorAngle) * cursorR;

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

      // 5. Particle Physics & Rendering
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
    setScanComplete(false);
    scanCompleteRef.current = false;
    setScanning(false);
    scanningRef.current = false;
    setStage('aligning');
    setProgress(0);
    descriptorsRef.current = [];
    sampleImagesRef.current = [];
    activeTicksRef.current.clear();
    setPrimaryImage(null);
    primaryCapturedRef.current = false;
    frontFaceStableStartRef.current = 0;
    setStatusText('Position your face inside the circle');
    const initialCounts: Record<PoseSector, number> = {
      front: 0,
      left: 0,
      right: 0,
      up: 0,
      down: 0,
    };
    setSectorCounts(initialCounts);
    sectorCountsRef.current = initialCounts;
  };

  const getSectorIcon = (sec: PoseSector) => {
    switch (sec) {
      case 'left':
        return <ArrowLeft className="w-3.5 h-3.5" />;
      case 'right':
        return <ArrowRight className="w-3.5 h-3.5" />;
      case 'up':
        return <ArrowUp className="w-3.5 h-3.5" />;
      case 'down':
        return <ArrowDown className="w-3.5 h-3.5" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Apple Face ID Circular Viewport */}
      <div className="relative rounded-3xl overflow-hidden bg-black aspect-square max-w-[420px] max-h-[50vh] sm:max-h-[54vh] shadow-2xl border border-white/10 mx-auto flex items-center justify-center">
        {/* Mirror Camera Feed */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover scale-x-[-1]"
          style={{ transform: 'scaleX(-1) translateZ(0)' }}
        />
        <canvas ref={canvasRef} className="hidden" />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Shutter Flash Animation */}
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

        {/* Sound Mute/Unmute Icon Top Left */}
        <button
          type="button"
          onClick={toggleSound}
          className="absolute top-3 left-3 p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition-all z-20"
          title={soundEnabled ? 'Mute Face ID audio' : 'Unmute Face ID audio'}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
        </button>

        {/* Profile Photo Thumbnail Badge Top Right (First Photo) */}
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

        {/* 5-Sector Progress Bar at Top during Angle Rotation */}
        {scanning && stage === 'rotating_angles' && (
          <div className="absolute top-12 inset-x-3 flex items-center justify-between gap-1 z-10">
            {(['front', 'left', 'right', 'up', 'down'] as PoseSector[]).map((sec) => {
              const isCompleted = sectorCounts[sec] >= TARGET_SAMPLES_PER_SECTOR[sec];
              const isCurrent = activeSector === sec;
              return (
                <div
                  key={sec}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg text-[10px] font-bold uppercase transition-all backdrop-blur-md ${
                    isCompleted
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                      : isCurrent
                      ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400 animate-pulse'
                      : 'bg-black/50 text-white/50 border border-white/10'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    getSectorIcon(sec)
                  )}
                  <span className="hidden sm:inline">{sec}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Face Detection Status Pill (when not scanning) */}
        {!scanning && !scanComplete && cameraReady && (
          <div
            className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur-md transition-all z-20 ${
              faceDetected
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'
              }`}
            />
            {faceDetected ? 'Face in Position' : 'Align face in circle'}
          </div>
        )}

        {/* Model Loading State */}
        {isModelLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-30">
            <div className="text-center text-white space-y-2">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-400" />
              <p className="text-sm font-semibold">Initializing Apple Face ID 3D Engine...</p>
            </div>
          </div>
        )}

        {/* Dynamic Guidance Bottom Banner */}
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
              <p className="text-center text-white font-semibold text-xs sm:text-sm tracking-wide drop-shadow">
                {statusText}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Progress Bar during Rotation */}
          {scanning && stage === 'rotating_angles' && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden p-0.5 backdrop-blur-sm">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background:
                      'linear-gradient(90deg, hsl(185, 95%, 50%), hsl(142, 85%, 50%))',
                    boxShadow: '0 0 10px hsla(142, 85%, 50%, 0.7)',
                  }}
                  transition={{ ease: 'easeOut', duration: 0.15 }}
                />
              </div>
              <span className="text-[11px] sm:text-xs font-mono font-bold text-white/80 tabular-nums">
                {descriptorsRef.current.length}/{TOTAL_REQUIRED_SAMPLES} pts
              </span>
            </div>
          )}
        </div>

        {/* Success Completion Overlay */}
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
                  style={{
                    borderColor: 'hsl(142, 80%, 50%)',
                    boxShadow: '0 0 32px hsla(142, 80%, 50%, 0.5)',
                  }}
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
              <h4 className="font-extrabold text-base sm:text-lg text-emerald-400">
                Face ID Enrollment Complete
              </h4>
              <p className="text-white/70 text-xs mt-0.5">
                Front profile photo saved · {descriptorsRef.current.length} 3D angle vectors calibrated
              </p>
            </motion.div>
          </motion.div>
        )}
      </div>

      {/* Action Buttons */}
      {!scanComplete ? (
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <Button
            onClick={startScan}
            disabled={!cameraReady || isModelLoading || scanning || !faceDetected}
            className="w-full h-12 text-sm sm:text-base font-bold shadow-xl active:scale-[0.98] transition-all touch-manipulation rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white"
          >
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {stage === 'capturing_profile'
                  ? 'Capturing Profile Photo…'
                  : `Calibrating 3D Angles (${Math.round(progress)}%)`}
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-2" />
                {faceDetected ? 'Start Apple Face ID Scan' : 'Position face inside circle'}
              </>
            )}
          </Button>

          {/* Quick finish button if at least 6 points captured */}
          {scanning && descriptorsRef.current.length >= 6 && (
            <Button
              onClick={() => void finishScan()}
              variant="outline"
              size="sm"
              className="w-full sm:w-auto h-12 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold rounded-xl"
            >
              Complete Now ({descriptorsRef.current.length} pts)
            </Button>
          )}
        </div>
      ) : (
        <Button
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
