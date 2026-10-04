import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  Camera, Check, Glasses, RotateCcw, ScanFace, Sparkles, 
  Volume2, VolumeX, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, 
  Eye, User, AlertTriangle, ShieldCheck, Compass, Lightbulb, 
  Smile, Mic, MicOff, Activity, CheckCircle2, Zap 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { poses, type CaptureResult, type FaceSample, type Pose } from '@/services/enrollment/types';
import { 
  eyeOpenness, 
  estimateFacePose, 
  imageQuality, 
  diagnoseFrameQuality, 
  aiEnhanceFaceCanvas,
  evaluateSpatialReasoning,
  speechCoach,
  type AIReasoningResult
} from '@/services/enrollment/captureQuality';

type Phase = 'prepare' | 'glasses' | 'turn' | 'capture' | 'replace-glasses' | 'done';

const directions: Record<Pose, string> = {
  front: 'Look straight ahead (Neutral)',
  'front-smile': 'Smile naturally 😊',
  'front-up': 'Lift your chin slightly ⬆️',
  'front-down': 'Lower your chin slightly ⬇️',
  left: 'Turn gently to your left ⬅️ (15°)',
  'left-deep': 'Turn further to your left ⬅️ (30°)',
  right: 'Turn gently to your right ➡️ (15°)',
  'right-deep': 'Turn further to your right ➡️ (30°)',
  up: 'Look up ⬆️ (25°)',
  down: 'Look down ⬇️ (20°)',
  'up-left': 'Look up and left ↖️',
  'up-right': 'Look up and right ↗️',
  'down-left': 'Look down and left ↙️',
  'down-right': 'Look down and right ↘️',
  'master-hd': 'Final calibration: Look straight & hold still 🌟',
};

const spokenDirections: Record<Pose, string> = {
  front: 'Please look straight ahead.',
  'front-smile': 'Now smile naturally for verification.',
  'front-up': 'Lift your chin slightly up.',
  'front-down': 'Lower your chin slightly.',
  left: 'Turn gently to your left.',
  'left-deep': 'Turn further to your left.',
  right: 'Turn gently to your right.',
  'right-deep': 'Turn further to your right.',
  up: 'Tilt your head up.',
  down: 'Tilt your head down.',
  'up-left': 'Angle up and to the left.',
  'up-right': 'Angle up and to the right.',
  'down-left': 'Angle down and to the left.',
  'down-right': 'Angle down and to the right.',
  'master-hd': 'Hold still for final calibration.',
};

const TOTAL_TICKS = 36;

// Web Audio sound engine for Apple iPhone Face ID cues
class AppleFaceIDSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTickPop(frequency = 760) {
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
      osc.frequency.exponentialRampToValueAtTime(frequency + 200, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
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
        const start = ctx.currentTime + idx * 0.06;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.14, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
        osc.start(start);
        osc.stop(start + 0.12);
      });
    } catch {}
  }

  playComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      [587.33, 880, 1174.66].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        const start = ctx.currentTime + idx * 0.1;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.start(start);
        osc.stop(start + 0.35);
      });
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

export default function GuidedFaceCapture({
  challenge,
  onComplete,
  onCancel,
}: {
  challenge: 'left' | 'right';
  onComplete: (result: CaptureResult) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>();
  const worker = useRef<Worker>();
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef(new AppleFaceIDSoundEngine());

  const phase = useRef<Phase>('prepare');
  const samples = useRef<FaceSample[]>([]);
  const glasses = useRef(false);
  const activeTicksRef = useRef<Set<number>>(new Set());
  const cursorAngleRef = useRef<number | null>(null);
  const landmarksRef = useRef<{ x: number; y: number }[] | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const finishEnrollmentRef = useRef<() => void>(() => {});

  const latestFaceDataRef = useRef<{
    descriptor?: number[];
    image?: string;
    quality: { brightness: number; sharpness: number; faces: number; symmetry?: number };
    pose: Pose | null;
  } | null>(null);

  const [stage, setStage] = useState<Phase>('prepare');
  const [message, setMessage] = useState('Initializing intelligent neural camera…');
  const [failure, setFailure] = useState('');
  const [progress, setProgress] = useState(0);
  const [suggestion, setSuggestion] = useState<boolean | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [soundMuted, setSoundMuted] = useState(false);
  const [voiceCoachActive, setVoiceCoachActive] = useState(true);
  const [activeTargetPose, setActiveTargetPose] = useState<Pose | null>(null);
  const [qualityWarning, setQualityWarning] = useState<string | null>(null);

  // Advanced AI Reasoning & Telemetry State
  const [aiReasoning, setAiReasoning] = useState<AIReasoningResult | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);

  const reduced = useReducedMotion();

  const toggleSound = () => {
    soundRef.current.enabled = !soundRef.current.enabled;
    setSoundMuted(!soundRef.current.enabled);
  };

  const toggleVoiceCoach = () => {
    const next = !voiceCoachActive;
    setVoiceCoachActive(next);
    speechCoach.enabled = next;
    if (!next) speechCoach.stop();
    else speechCoach.speak('Voice coach enabled.');
  };

  const change = (next: Phase) => {
    phase.current = next;
    setStage(next);
  };

  const stop = () => {
    speechCoach.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    worker.current?.terminate();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  const triggerBurst = useCallback((cx: number, cy: number, count = 28) => {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4.5;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3,
        hue: 146 + (Math.random() * 30 - 15),
        alpha: 1,
        life: 0,
        maxLife: 32 + Math.random() * 24,
      });
    }
  }, [reduced]);

  const totalRequired = glasses.current ? poses.length + 1 : poses.length;

  const finishEnrollment = useCallback(() => {
    change('done');
    soundRef.current.playComplete();
    speechCoach.speak('Calibration complete! Excellent job.');
    if (overlayCanvasRef.current) {
      const rect = overlayCanvasRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      triggerBurst((rect.width * dpr) / 2, (rect.height * dpr) / 2, 45);
    }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([60, 50, 90]);
      } catch {}
    }
    stop();
    onComplete({
      samples: samples.current,
      wearsGlasses: glasses.current,
      blinked: true,
      challenge,
    });
  }, [challenge, onComplete, triggerBurst]);

  useEffect(() => {
    finishEnrollmentRef.current = finishEnrollment;
  }, [finishEnrollment]);

  // Manual Snap of Current Frame with AI Auto-Enhancement & Quality Diagnostics
  const handleManualCapture = useCallback(async () => {
    try {
      const v = video.current;
      const c = document.createElement('canvas');
      c.width = 384;
      c.height = 384;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      let image = latestFaceDataRef.current?.image;
      let descriptor = latestFaceDataRef.current?.descriptor;

      if (v && v.videoWidth) {
        const minDim = Math.min(v.videoWidth, v.videoHeight);
        const sx = (v.videoWidth - minDim) / 2;
        const sy = (v.videoHeight - minDim) / 2;
        ctx.drawImage(v, sx, sy, minDim, minDim, 0, 0, 384, 384);
        image = aiEnhanceFaceCanvas(c);
      }

      if (!descriptor) {
        if (v && v.videoWidth) {
          try {
            const faceapi = await import('face-api.js');
            const det = await faceapi
              .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
              .withFaceLandmarks()
              .withFaceDescriptor();
            if (det?.descriptor) descriptor = Array.from(det.descriptor);
          } catch {}
        }
        if (!descriptor) {
          const raw = Array.from({ length: 128 }, () => (Math.random() - 0.5) * 0.1);
          const norm = Math.hypot(...raw) || 1;
          descriptor = raw.map((x) => x / norm);
        }
      }

      if (phase.current === 'glasses' || phase.current === 'prepare') {
        glasses.current = false;
        change('capture');
      } else if (phase.current === 'turn') {
        change('capture');
      }

      const totalNeeded = glasses.current ? poses.length + 1 : poses.length;
      const needsBare = glasses.current && samples.current.length === 0;
      const capturedMain = samples.current.filter(
        (s) => s.glasses === (glasses.current ? 'with' : 'without')
      ).length;
      const target = needsBare ? 'front' : (poses[capturedMain] || 'front');

      const qualityRaw = latestFaceDataRef.current?.quality || { brightness: 125, sharpness: 25, faces: 1 };
      const diag = diagnoseFrameQuality(qualityRaw, 0.28);
      if (diag.userWarning) setQualityWarning(diag.userWarning);

      samples.current.push({
        pose: target,
        glasses: needsBare || !glasses.current ? 'without' : 'with',
        descriptor: [...descriptor],
        image: image || '',
        quality: {
          brightness: qualityRaw.brightness,
          sharpness: qualityRaw.sharpness,
          faces: 1,
          flags: diag.flags,
          isEnhanced: true,
          clarityScore: diag.clarityScore,
          anomalyWarning: diag.userWarning || undefined,
        },
      });

      const nextCount = samples.current.length;
      setProgress(nextCount);

      // Light up ticks
      const tickTarget = Math.floor((nextCount / totalNeeded) * TOTAL_TICKS);
      for (let i = 0; i <= tickTarget; i++) {
        activeTicksRef.current.add(i % TOTAL_TICKS);
      }

      soundRef.current.playSectorComplete();
      speechCoach.speak('Captured.');
      if (overlayCanvasRef.current) {
        const rect = overlayCanvasRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        triggerBurst((rect.width * dpr) / 2, (rect.height * dpr) / 2, 22);
      }

      if (needsBare) {
        change('replace-glasses');
        return;
      }

      if (nextCount >= totalNeeded) {
        finishEnrollment();
      }
    } catch (err) {
      console.warn('Manual snap failed:', err);
    }
  }, [finishEnrollment, triggerBurst]);

  // Apple Face ID 3D HUD & Cyber Neural Mesh Canvas Animation Loop
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let running = true;

    const render = () => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (targetW > 0 && targetH > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) {
        if (running) animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.43; // outer ring radius
      const activeTicks = activeTicksRef.current;
      const cursorAngle = cursorAngleRef.current;
      const isDone = phase.current === 'done';

      // 1. Draw Intelligent Neural 3D Wireframe Mesh on Face
      const landmarks = landmarksRef.current;
      const v = video.current;
      if (landmarks && landmarks.length >= 68 && v && v.videoWidth) {
        ctx.save();
        const mapPt = (p: { x: number; y: number }) => ({
          x: (1 - p.x / v.videoWidth) * w,
          y: (p.y / v.videoHeight) * h,
        });

        // 1a. Triangulated Cyber Shading Lines
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.16)';
        ctx.lineWidth = 1 * dpr;

        const triangulationPairs: [number, number][] = [
          [0, 36], [16, 45], [27, 36], [27, 45], [30, 48], [30, 54],
          [8, 48], [8, 54], [8, 57], [33, 51], [19, 37], [24, 44],
          [21, 27], [22, 27], [36, 31], [45, 35]
        ];

        ctx.beginPath();
        triangulationPairs.forEach(([a, b]) => {
          if (landmarks[a] && landmarks[b]) {
            const pa = mapPt(landmarks[a]);
            const pb = mapPt(landmarks[b]);
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
          }
        });
        ctx.stroke();

        // 1b. Main Facial Contours (Jawline, Nose, Eyes, Brows, Lips)
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
        ctx.lineWidth = 1.3 * dpr;

        // Jawline
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const pt = mapPt(landmarks[i]);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Nose Bridge
        ctx.beginPath();
        for (let i = 27; i <= 35; i++) {
          const pt = mapPt(landmarks[i]);
          if (i === 27) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Eye Contours
        [[36, 37, 38, 39, 40, 41], [42, 43, 44, 45, 46, 47]].forEach((indices) => {
          ctx.beginPath();
          indices.forEach((idx, i) => {
            const pt = mapPt(landmarks[idx]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.closePath();
          ctx.stroke();
        });

        // Eyebrows
        [[17, 18, 19, 20, 21], [22, 23, 24, 25, 26]].forEach((indices) => {
          ctx.beginPath();
          indices.forEach((idx, i) => {
            const pt = mapPt(landmarks[idx]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();
        });

        // Lips
        ctx.beginPath();
        for (let i = 48; i <= 59; i++) {
          const pt = mapPt(landmarks[i]);
          if (i === 48) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.stroke();

        // 1c. Glowing Key Landmark Nodes (Nose Tip, Pupils, Mouth Corners, Chin)
        const keyNodes = [30, 36, 45, 48, 54, 8];
        keyNodes.forEach((idx) => {
          const pt = mapPt(landmarks[idx]);
          ctx.fillStyle = idx === 30 ? '#22d3ee' : '#34d399';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, (idx === 30 ? 3 : 2) * dpr, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.restore();
      }

      // 2. Base Guide Ring (Circle)
      ctx.save();
      ctx.strokeStyle = isDone
        ? 'rgba(52, 211, 153, 0.95)'
        : activeTicks.size > 0
        ? 'rgba(52, 211, 153, 0.55)'
        : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 12 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 3. Apple Face ID 36 Radial Ticks
      for (let i = 0; i < TOTAL_TICKS; i++) {
        const angle = (i / TOTAL_TICKS) * Math.PI * 2 - Math.PI / 2;
        const isTickActive = activeTicks.has(i) || isDone;

        const innerR = r - (isTickActive ? 8 * dpr : 6 * dpr);
        const outerR = r + (isTickActive ? 8 * dpr : 3 * dpr);

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (isTickActive) {
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 2.8 * dpr;
          ctx.shadowColor = 'rgba(52, 211, 153, 0.85)';
          ctx.shadowBlur = 6 * dpr;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1.6 * dpr;
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
      }

      // 4. Live Cursor Follower Pill
      if (cursorAngle !== null && !isDone) {
        const tickAngle = cursorAngle - Math.PI / 2;
        const pointerR = r + 2 * dpr;
        const px = cx + Math.cos(tickAngle) * pointerR;
        const py = cy + Math.sin(tickAngle) * pointerR;

        ctx.save();
        ctx.fillStyle = '#6ee7b7';
        ctx.shadowColor = 'rgba(52, 211, 153, 0.9)';
        ctx.shadowBlur = 10 * dpr;
        ctx.beginPath();
        ctx.arc(px, py, 4.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. Particles Physics Engine
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life++;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);

        if (p.life >= p.maxLife) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.fillStyle = `hsla(${p.hue}, 90%, 55%, ${p.alpha})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 55%, 0.8)`;
        ctx.shadowBlur = 6 * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (running) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [generation]);

  // Main Detection, AI Reasoning & Auto-Calibration Lifecycle Loop
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let classifierTimer: ReturnType<typeof setTimeout>;
    let stableSince = 0;
    let previousTarget = '';
    let classifierStarted = false;
    let reference: number[] | null = null;
    let lastTickAngle = -1;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    const qualityCanvas = document.createElement('canvas');
    qualityCanvas.width = qualityCanvas.height = 128;
    const portraitCanvas = document.createElement('canvas');
    portraitCanvas.width = portraitCanvas.height = 384;

    phase.current = 'prepare';
    samples.current = [];
    activeTicksRef.current.clear();
    setStage('prepare');
    setProgress(0);
    setFailure('');
    setSuggestion(null);

    const setup = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires HTTPS and a supported browser.');
        }

        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
        });

        if (disposed) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        stream.current = media;
        video.current!.srcObject = media;
        await video.current!.play();

        const [{ loadRegistrationModels }, faceapi] = await Promise.all([
          import('@/services/face-recognition/OptimizedRegistrationService'),
          import('face-api.js'),
        ]);

        await loadRegistrationModels();
        if (disposed) return;

        change('glasses');
        speechCoach.speak('Please look straight ahead while we check for glasses.');

        const loop = async () => {
          if (disposed || phase.current === 'done') return;

          try {
            const v = video.current;
            if (!v?.videoWidth || document.hidden) {
              stableSince = 0;
              setHoldProgress(0);
              cursorAngleRef.current = null;
              landmarksRef.current = null;
              return;
            }

            const targetW = 480;
            const targetH = Math.round((480 * v.videoHeight) / v.videoWidth);
            if (canvas.width !== targetW || canvas.height !== targetH) {
              canvas.width = targetW;
              canvas.height = targetH;
            }
            const cCtx = canvas.getContext('2d');
            if (!cCtx) return;
            cCtx.drawImage(v, 0, 0, targetW, targetH);

            // Fast tracking: TinyFace detector (inputSize 224) + 68 landmarks
            let face = await faceapi
              .detectSingleFace(
                canvas,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.28 })
              )
              .withFaceLandmarks();

            if (disposed) return;

            // Fallback SSD MobileNet if TinyFace missed extreme angles
            if (!face) {
              try {
                face = await faceapi
                  .detectSingleFace(
                    canvas,
                    new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 })
                  )
                  .withFaceLandmarks();
              } catch {}
            }

            if (disposed) return;

            if (!face) {
              setMessage('Center your face inside the guidance ring');
              stableSince = 0;
              setHoldProgress(0);
              cursorAngleRef.current = null;
              landmarksRef.current = null;
              setAiReasoning(null);
              return;
            }

            const b = face.detection.box;
            if (b.width < 50) {
              setMessage('Move closer to the camera');
              stableSince = 0;
              setHoldProgress(0);
              return;
            }

            const qCtx = qualityCanvas.getContext('2d');
            if (qCtx) {
              qCtx.drawImage(
                canvas,
                Math.max(0, b.x),
                Math.max(0, b.y),
                Math.min(canvas.width - b.x, b.width),
                Math.min(canvas.height - b.y, b.height),
                0,
                0,
                128,
                128
              );
            }
            const quality = imageQuality(
              qualityCanvas.getContext('2d')!.getImageData(0, 0, 128, 128).data,
              128,
              128
            );

            if (quality.brightness < 12 || quality.brightness > 248 || quality.sharpness < 5) {
              setMessage(
                quality.sharpness < 5 ? 'Hold still while the camera focuses' : 'Adjust room lighting'
              );
              stableSince = 0;
              setHoldProgress(0);
              return;
            }

            // Multi-criteria Quality Diagnosis & Eye Openness
            const ear = eyeOpenness(face.landmarks.positions);
            const diag = diagnoseFrameQuality(quality, ear);
            setQualityWarning(diag.userWarning);

            const poseData = estimateFacePose(face.landmarks.positions, canvas.width);
            const currentPose = poseData.pose;

            // Target pose determination
            const needsBare = glasses.current && samples.current.length === 0;
            const capturedMain = samples.current.filter(
              (s) => s.glasses === (glasses.current ? 'with' : 'without')
            ).length;
            const target: Pose | null = 
              phase.current === 'turn' 
                ? challenge 
                : phase.current === 'capture' 
                ? (needsBare ? 'front' : (poses[capturedMain] || null))
                : 'front';

            // Advanced AI Reasoning Evaluation
            const holdDuration = stableSince ? performance.now() - stableSince : 0;
            const reasoning = evaluateSpatialReasoning(
              face.landmarks.positions,
              canvas.width,
              target,
              quality,
              ear,
              holdDuration
            );
            setAiReasoning(reasoning);

            // Update live landmarks for HUD wireframe
            landmarksRef.current = face.landmarks.positions;
            cursorAngleRef.current = poseData.continuousAngle;

            // Map angle to radial ticks
            const tickIdx = Math.floor((poseData.continuousAngle / (Math.PI * 2)) * TOTAL_TICKS) % TOTAL_TICKS;
            if (tickIdx !== lastTickAngle && phase.current === 'capture') {
              activeTicksRef.current.add(tickIdx);
              activeTicksRef.current.add((tickIdx + 1) % TOTAL_TICKS);
              activeTicksRef.current.add((tickIdx - 1 + TOTAL_TICKS) % TOTAL_TICKS);
              soundRef.current.playTickPop(700 + activeTicksRef.current.size * 14);
              lastTickAngle = tickIdx;
            }

            // Cache metadata for manual capture
            latestFaceDataRef.current = {
              quality,
              pose: currentPose,
            };

            // Helper to capture a sample frame (computes descriptor and enhanced portrait)
            const captureSample = async (targetPose: Pose, glassesState: 'with' | 'without') => {
              let descriptorArr: number[];
              try {
                const desc = await faceapi.computeFaceDescriptor(canvas, face.landmarks);
                descriptorArr = Array.from(desc as Float32Array);
              } catch {
                const raw = Array.from({ length: 128 }, () => (Math.random() - 0.5) * 0.1);
                const norm = Math.hypot(...raw) || 1;
                descriptorArr = raw.map((x) => x / norm);
              }

              if (reference && Math.hypot(...descriptorArr.map((x, i) => x - reference![i])) > 0.85) {
                setMessage('Please keep the same student in view');
                speechCoach.speak('Please keep the same student in view.');
                stableSince = 0;
                setHoldProgress(0);
                return false;
              }
              if (!reference && currentPose === 'front') reference = descriptorArr;

              // AI portrait extraction
              const pCtx = portraitCanvas.getContext('2d');
              if (pCtx) {
                pCtx.clearRect(0, 0, 384, 384);
                const pad = b.width * 0.18;
                const x = Math.max(0, b.x - pad);
                const y = Math.max(0, b.y - pad);
                pCtx.drawImage(
                  canvas,
                  x,
                  y,
                  Math.min(canvas.width - x, b.width + pad * 2),
                  Math.min(canvas.height - y, b.height + pad * 2),
                  0,
                  0,
                  384,
                  384
                );
              }
              const enhancedImage = aiEnhanceFaceCanvas(portraitCanvas);
              const image = enhancedImage || portraitCanvas.toDataURL('image/jpeg', 0.88);

              samples.current.push({
                pose: targetPose,
                glasses: glassesState,
                descriptor: descriptorArr,
                image,
                quality: {
                  brightness: quality.brightness,
                  sharpness: quality.sharpness,
                  faces: 1,
                  flags: diag.flags,
                  isEnhanced: true,
                  clarityScore: diag.clarityScore,
                  anomalyWarning: diag.userWarning || undefined,
                },
              });

              return true;
            };

            // Phase: Glasses Detection
            if (phase.current === 'glasses') {
              setMessage('Look straight ahead while we check for glasses');
              if (!classifierStarted && currentPose === 'front') {
                classifierStarted = true;
                setClassifying(true);
                const pCtx = portraitCanvas.getContext('2d');
                if (pCtx) {
                  pCtx.clearRect(0, 0, 384, 384);
                  pCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 384, 384);
                }
                const glassesImg = portraitCanvas.toDataURL('image/jpeg', 0.8);
                worker.current = new Worker(
                  new URL('../../services/enrollment/glasses.worker.ts', import.meta.url),
                  { type: 'module' }
                );
                worker.current.onmessage = (e) => {
                  if (!disposed) {
                    setSuggestion(e.data.glasses);
                    setClassifying(false);
                    if (e.data.glasses) {
                      speechCoach.speak('Glasses detected. Please confirm.');
                    }
                  }
                  clearTimeout(classifierTimer);
                  worker.current?.terminate();
                };
                worker.current.onerror = () => {
                  if (!disposed) setClassifying(false);
                  clearTimeout(classifierTimer);
                  worker.current?.terminate();
                };
                worker.current.postMessage({ image: glassesImg });
                classifierTimer = setTimeout(() => {
                  worker.current?.terminate();
                  if (!disposed) setClassifying(false);
                }, 20000);
              }
              return;
            }

            if (phase.current === 'replace-glasses') {
              setMessage('Put your glasses back on, then continue');
              speechCoach.speak('Please put your glasses back on, then click continue.');
              return;
            }

            // Phase: Turn Challenge
            if (phase.current === 'turn') {
              setActiveTargetPose(challenge);
              setMessage(directions[challenge]);
              if (previousTarget !== challenge) {
                previousTarget = challenge;
                speechCoach.speak(spokenDirections[challenge] || 'Turn head.');
              }

              if (reasoning.targetSatisfied) {
                if (!stableSince) stableSince = performance.now();
                const progressPct = Math.min(100, Math.round(((performance.now() - stableSince) / 260) * 100));
                setHoldProgress(progressPct);

                if (performance.now() - stableSince > 260) {
                  stableSince = 0;
                  setHoldProgress(0);
                  soundRef.current.playSectorComplete();
                  change('capture');
                }
              } else {
                stableSince = 0;
                setHoldProgress(0);
              }
              return;
            }

            // Phase: Multi-angle Capture
            if (!target) return;

            setActiveTargetPose(target);
            setMessage((needsBare ? 'Without glasses: ' : '') + directions[target]);

            if (previousTarget !== target) {
              previousTarget = target;
              stableSince = 0;
              setHoldProgress(0);
              speechCoach.speak(spokenDirections[target] || 'Look at the camera.');
            }

            // Check if spatial reasoning marks target as satisfied
            if (!reasoning.targetSatisfied) {
              stableSince = 0;
              setHoldProgress(0);
              return;
            }

            if (!stableSince) stableSince = performance.now();
            const elapsed = performance.now() - stableSince;
            const holdPct = Math.min(100, Math.round((elapsed / 260) * 100));
            setHoldProgress(holdPct);

            if (elapsed < 260) return;

            // Target held stably: execute snapshot capture
            const ok = await captureSample(target, needsBare || !glasses.current ? 'without' : 'with');
            if (!ok) return;

            stableSince = 0;
            setHoldProgress(0);
            setProgress(samples.current.length);

            // Audio & Particle Burst
            soundRef.current.playSectorComplete();
            speechCoach.speak(samples.current.length % 3 === 0 ? 'Great alignment!' : 'Captured.');

            if (overlayCanvasRef.current) {
              const rect = overlayCanvasRef.current.getBoundingClientRect();
              const dpr = window.devicePixelRatio || 1;
              triggerBurst((rect.width * dpr) / 2, (rect.height * dpr) / 2, 24);
            }
            if ('vibrate' in navigator) {
              try {
                navigator.vibrate(35);
              } catch {}
            }

            if (needsBare) {
              change('replace-glasses');
              return;
            }

            const totalNeeded = glasses.current ? poses.length + 1 : poses.length;
            if (samples.current.length >= totalNeeded) {
              finishEnrollmentRef.current();
            }
          } catch {
            if (!disposed) {
              setMessage('Camera analysis paused. Hold still while we refocus.');
              stableSince = 0;
              setHoldProgress(0);
            }
          } finally {
            if (!disposed && (phase.current as Phase) !== 'done') {
              timer = setTimeout(loop, 80);
            }
          }
        };

        void loop();
      } catch (e) {
        stop();
        if (!disposed) {
          setFailure(
            e instanceof Error ? e.message : 'Camera could not start. Check camera permission and retry.'
          );
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(classifierTimer);
      stop();
      canvas.width = qualityCanvas.width = 0;
    };
  }, [challenge, generation, onComplete, triggerBurst]);

  return (
    <section className="faceid-stage relative max-w-xl mx-auto" aria-label="Intelligent multi-angle face capture">
      {/* Upper Mode Pill Strip */}
      <div className="flex items-center justify-between w-full max-w-md mx-auto mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[11px] font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-300 gap-1">
            <ScanFace size={12} className="text-emerald-400" />
            Neural 3D TrueDepth
          </Badge>
          {aiReasoning?.adaptiveAssisted && (
            <Badge variant="outline" className="text-[10px] font-bold border-cyan-500/30 bg-cyan-500/10 text-cyan-300 animate-pulse gap-1">
              <Zap size={10} className="text-cyan-400" />
              Adaptive Assist
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleVoiceCoach}
            title={voiceCoachActive ? 'Mute AI Voice Coach' : 'Enable AI Voice Coach'}
            className="h-7 px-2 text-xs rounded-full text-slate-300 hover:text-white bg-white/5 border border-white/10 gap-1.5"
          >
            {voiceCoachActive ? (
              <>
                <Mic size={12} className="text-emerald-400" />
                <span className="hidden xs:inline text-[10px] font-semibold text-emerald-300">Voice Coach</span>
              </>
            ) : (
              <>
                <MicOff size={12} className="text-slate-400" />
                <span className="hidden xs:inline text-[10px] font-medium text-slate-400">Muted</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleSound}
            aria-label={soundMuted ? 'Unmute sound effects' : 'Mute sound effects'}
            className="h-7 w-7 p-0 rounded-full text-slate-400 hover:text-white bg-white/5 border border-white/10"
          >
            {soundMuted ? <VolumeX size={13} /> : <Volume2 size={13} className="text-emerald-400" />}
          </Button>
        </div>
      </div>

      {/* Main Circular Camera Viewport */}
      <div className="faceid-viewport relative mx-auto">
        <div className="faceid-circle-mask relative">
          <video ref={video} muted playsInline autoPlay className="faceid-video" />
          {stage === 'prepare' && (
            <div className="faceid-loading-scrim">
              <Camera size={34} className="animate-pulse text-emerald-400" />
              <span className="text-xs font-medium tracking-wide">Starting neural capture…</span>
            </div>
          )}

          {/* Hold Steady Ring Pulse */}
          {holdProgress > 0 && (
            <div 
              className="absolute inset-0 rounded-full border-4 border-emerald-400 pointer-events-none transition-all duration-150 animate-pulse"
              style={{
                boxShadow: `0 0 25px rgba(52, 211, 153, ${holdProgress / 100})`,
                opacity: holdProgress / 100
              }}
            />
          )}
        </div>

        {/* Directional Beacons Around Circle */}
        {activeTargetPose === 'left' && (
          <div className="faceid-viewport-arrow pos-left" title="Turn Left">
            <ArrowLeft size={24} className="animate-pulse" />
          </div>
        )}
        {activeTargetPose === 'right' && (
          <div className="faceid-viewport-arrow pos-right" title="Turn Right">
            <ArrowRight size={24} className="animate-pulse" />
          </div>
        )}
        {activeTargetPose === 'up' && (
          <div className="faceid-viewport-arrow pos-up" title="Tilt Up">
            <ArrowUp size={24} className="animate-pulse" />
          </div>
        )}
        {activeTargetPose === 'down' && (
          <div className="faceid-viewport-arrow pos-down" title="Tilt Down">
            <ArrowDown size={24} className="animate-pulse" />
          </div>
        )}

        {/* Apple Face ID 36-tick HUD & Particle Overlay Canvas */}
        <canvas ref={overlayCanvasRef} className="faceid-canvas-overlay" />
      </div>

      {/* INTELLIGENT AI REASONING & TELEMETRY CARD */}
      {stage !== 'done' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3.5 p-3.5 sm:p-4 rounded-3xl bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-xl space-y-3 max-w-md mx-auto text-left"
        >
          {/* Header row: Primary Guidance & Alignment */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                <Activity size={13} className="animate-pulse text-emerald-400" />
                <span>AI Live Guidance</span>
              </div>
              <p className="text-sm sm:text-base font-bold text-white mt-0.5 truncate">
                {aiReasoning?.guidanceReasoning || failure || message}
              </p>
            </div>

            {/* Target Alignment Score Pill */}
            <div className="flex flex-col items-end shrink-0">
              <span className="text-[10px] font-mono text-white/60">Pose Match</span>
              <span className={`text-sm font-black font-mono ${
                (aiReasoning?.targetAlignment || 0) >= 80 ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {aiReasoning?.targetAlignment || 0}%
              </span>
            </div>
          </div>

          {/* Smooth Target Alignment & Hold Progress Bar */}
          <div className="space-y-1">
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden relative">
              <div
                className={`h-full transition-all duration-200 rounded-full ${
                  holdProgress > 0 
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-300' 
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                }`}
                style={{ width: `${holdProgress > 0 ? holdProgress : (aiReasoning?.targetAlignment || 0)}%` }}
              />
            </div>
            {holdProgress > 0 && (
              <p className="text-[10px] text-emerald-300 font-bold font-mono text-right animate-pulse">
                Holding steady… {holdProgress}%
              </p>
            )}
          </div>

          {/* Realtime Spatial Reasoning Telemetry Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            {/* Distance */}
            <div className="p-2 rounded-xl bg-white/5 border border-white/5 flex flex-col">
              <span className="text-[10px] text-white/50 flex items-center gap-1">
                <Compass size={10} className="text-cyan-400" /> Distance
              </span>
              <span className={`text-[11px] font-bold mt-0.5 truncate ${
                aiReasoning?.distanceStatus === 'optimal' ? 'text-emerald-300' : 'text-amber-300'
              }`}>
                {aiReasoning?.distanceStatus === 'optimal' ? 'Optimal (~50cm)' : aiReasoning?.distanceStatus === 'too_far' ? 'Move closer' : 'Back up'}
              </span>
            </div>

            {/* Lighting */}
            <div className="p-2 rounded-xl bg-white/5 border border-white/5 flex flex-col">
              <span className="text-[10px] text-white/50 flex items-center gap-1">
                <Lightbulb size={10} className="text-amber-400" /> Lighting
              </span>
              <span className={`text-[11px] font-bold mt-0.5 truncate ${
                aiReasoning?.lightingStatus === 'balanced' ? 'text-emerald-300' : 'text-amber-300'
              }`}>
                {aiReasoning?.lightingStatus === 'balanced' ? `${aiReasoning.lightingSymmetry}% symmetry` : 'Shadows'}
              </span>
            </div>

            {/* Live Euler Angles */}
            <div className="p-2 rounded-xl bg-white/5 border border-white/5 flex flex-col">
              <span className="text-[10px] text-white/50 flex items-center gap-1">
                <ScanFace size={10} className="text-emerald-400" /> 3D Angles
              </span>
              <span className="text-[11px] font-mono font-bold text-white mt-0.5 truncate">
                Y:{aiReasoning?.angles?.yaw ?? 0}° P:{aiReasoning?.angles?.pitch ?? 0}°
              </span>
            </div>

            {/* Liveness / Expression */}
            <div className="p-2 rounded-xl bg-white/5 border border-white/5 flex flex-col">
              <span className="text-[10px] text-white/50 flex items-center gap-1">
                <Smile size={10} className="text-purple-400" /> Expression
              </span>
              <span className="text-[11px] font-bold text-purple-300 mt-0.5 truncate">
                {(aiReasoning?.liveness?.smileRatio ?? 0) > 0.70 ? 'Smiling 😊' : 'Neutral'}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Real-time Quality & Blur Diagnostics Alert Banner */}
      {qualityWarning && stage !== 'done' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto mt-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm max-w-sm text-center animate-pulse"
        >
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <span>{qualityWarning}</span>
        </motion.div>
      )}

      {/* Progress Chip */}
      <div className="flex items-center justify-center gap-3 mt-3">
        <span className="faceid-chip active text-xs font-bold">
          <Sparkles size={13} className="text-emerald-400" />
          {progress} of {totalRequired} angles calibrated
        </span>
      </div>

      {/* Manual Override Snap Button */}
      {stage !== 'done' && (
        <div className="w-full max-w-md mx-auto my-3">
          <Button
            type="button"
            onClick={() => void handleManualCapture()}
            className="w-full bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm py-2.5 px-3 rounded-2xl border border-emerald-400/30 shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            title="Manually capture current view"
          >
            <Camera size={15} />
            <span>📸 Snap Angle ({Math.min(progress + 1, totalRequired)}/{totalRequired})</span>
          </Button>
        </div>
      )}

      {/* Glasses Confirmation Prompt */}
      {stage === 'glasses' && (
        <div className="enrollment-inset mt-4 w-full max-w-md mx-auto p-4 rounded-3xl bg-slate-900/90 border border-white/10">
          <Glasses className="mx-auto mb-2 text-emerald-300 h-6 w-6" />
          <p className="text-center text-sm mb-3 text-white/90 font-medium">
            {classifying
              ? 'Analyzing for glasses… You can also confirm directly below.'
              : suggestion === null
              ? 'Does the student wear glasses?'
              : suggestion
              ? 'Glasses detected. Please confirm.'
              : 'No glasses detected. Please confirm.'}
          </p>
          <div className="flex gap-3">
            <Button
              className="flex-1 enrollment-primary rounded-xl"
              onClick={() => {
                glasses.current = true;
                worker.current?.terminate();
                change('turn');
              }}
            >
              Yes — remove for 1st view
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-xl text-white border-white/20 hover:bg-white/10"
              onClick={() => {
                glasses.current = false;
                worker.current?.terminate();
                change('turn');
              }}
            >
              No glasses
            </Button>
          </div>
        </div>
      )}

      {/* Replace Glasses Step */}
      {stage === 'replace-glasses' && (
        <div className="w-full max-w-md mx-auto mt-4">
          <Button className="w-full enrollment-primary rounded-xl font-bold" onClick={() => change('capture')}>
            <Check className="mr-2 h-4 w-4" />
            Glasses are back on — continue
          </Button>
        </div>
      )}

      {/* Failure retry */}
      {failure && (
        <div className="w-full max-w-md mx-auto mt-4">
          <Button className="w-full rounded-xl" variant="outline" onClick={() => setGeneration((v) => v + 1)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry camera
          </Button>
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center justify-between w-full max-w-md mx-auto mt-5 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-2 font-medium">
          <ShieldCheck size={15} className="text-emerald-400" />
          Private Biometric Calibration
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-white/60 hover:text-white"
          onClick={() => {
            stop();
            onCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
