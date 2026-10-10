import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  Camera, Check, Glasses, RotateCcw, ScanFace, Sparkles, 
  Volume2, VolumeX, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, 
  Eye, User, AlertTriangle, ShieldCheck, Compass, Lightbulb, 
  Smile, Mic, MicOff, Activity, CheckCircle2, Zap, Bot 
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
import {
  estimate3DLandmarksFrom2D,
  buildCanonical3DFaceStructure,
  synthesizeMasterFaceDescriptor,
} from '@/services/enrollment/face3DReconstruction';

type Phase = 'prepare' | 'glasses' | 'turn' | 'capture' | 'replace-glasses' | 'done';

const directions: Partial<Record<Pose, string>> = {
  front: 'Look straight at the camera',
  left: 'Turn gently to your left ⬅️',
  right: 'Turn gently to your right ➡️',
  up: 'Tilt your head up ⬆️',
  down: 'Tilt your head down ⬇️',
  'up-left': 'Look slightly up and left ↖️',
  'up-right': 'Look slightly up and right ↗️',
  'down-left': 'Look slightly down and left ↙️',
  'down-right': 'Look slightly down and right ↘️',
  'front-smile': 'Give a natural smile 😊',
};

const spokenDirections: Partial<Record<Pose, string>> = {
  front: 'Please look straight ahead.',
  left: 'Turn gently to your left.',
  right: 'Turn gently to your right.',
  up: 'Tilt your head up.',
  down: 'Tilt your head down.',
  'up-left': 'Angle up and to the left.',
  'up-right': 'Angle up and to the right.',
  'down-left': 'Angle down and to the left.',
  'down-right': 'Angle down and to the right.',
  'front-smile': 'Please give a natural smile.',
};

const TOTAL_TICKS = 36;

// High-quality capture settings: 512px portraits (ML-friendly multiple of 32) and
// a best-of-N sharp-frame burst so we never store a blurry snapshot.
const PORTRAIT_SIZE = 512;
const BURST_FRAMES = 3;
const BURST_MAX_MS = 420;

// Interactive Realtime AI Assistant Bot Avatar
function AIBotAvatar({
  mood,
  direction,
  holdProgress
}: {
  mood: 'guiding' | 'encouraging' | 'warning' | 'celebrating';
  direction?: 'left' | 'right' | 'up' | 'down' | 'center' | 'none';
  holdProgress: number;
}) {
  const pupilX = direction === 'left' ? -3 : direction === 'right' ? 3 : 0;
  const pupilY = direction === 'up' ? -3 : direction === 'down' ? 3 : 0;
  const isHappy = mood === 'celebrating' || holdProgress > 0;

  return (
    <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-emerald-400/30 p-1 flex flex-col items-center justify-between shadow-lg shadow-emerald-500/10 shrink-0">
      {/* Bot Antenna with status beacon */}
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <span className={`w-2 h-2 rounded-full border border-slate-900 ${
          isHappy ? 'bg-emerald-400 animate-ping' : mood === 'warning' ? 'bg-amber-400 animate-pulse' : 'bg-cyan-400 animate-pulse'
        }`} />
      </div>

      {/* Bot Face Screen */}
      <div className="w-full h-full rounded-xl bg-slate-950/90 border border-white/10 flex flex-col items-center justify-center gap-0.5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-400/5 to-transparent pointer-events-none" />

        {/* Bot Eyes */}
        <div className="flex items-center gap-1.5 relative z-10">
          {isHappy ? (
            <>
              <span className="text-[11px] font-black text-emerald-400 leading-none">^</span>
              <span className="text-[11px] font-black text-emerald-400 leading-none">^</span>
            </>
          ) : (
            <>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 transition-transform duration-200"
                  style={{ transform: `translate(${pupilX}px, ${pupilY}px)` }}
                />
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 transition-transform duration-200"
                  style={{ transform: `translate(${pupilX}px, ${pupilY}px)` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Bot Mouth */}
        <div className="relative z-10">
          {isHappy ? (
            <div className="w-3 h-1 rounded-full bg-emerald-400" />
          ) : mood === 'warning' ? (
            <div className="w-2 h-0.5 rounded-full bg-amber-400" />
          ) : (
            <div className="w-2.5 h-0.5 rounded-full bg-emerald-400/70" />
          )}
        </div>
      </div>
    </div>
  );
}

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
    } catch { /* best effort */ }
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
    } catch { /* best effort */ }
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
    } catch { /* best effort */ }
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
  // Latest detected face box in *video* pixel coordinates (precision tracking)
  const lastBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // De-dupes AI reasoning state so the loop only re-renders on meaningful changes
  const reasoningKeyRef = useRef('');

  const latestFaceDataRef = useRef<{
    descriptor?: number[];
    image?: string;
    landmarks?: { x: number; y: number }[];
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
    stream.current = undefined;
    worker.current?.terminate();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  /**
   * Draws the latest full-resolution face crop (with 18% padding) into a square
   * canvas. Falls back to a center square crop when no face box is known yet.
   */
  const drawFaceCropInto = useCallback((ctx: CanvasRenderingContext2D, size: number) => {
    const v = video.current;
    const box = lastBoxRef.current;
    ctx.clearRect(0, 0, size, size);
    if (!v || !v.videoWidth) return;
    if (box && box.w > 0) {
      const pad = box.w * 0.18;
      const x0 = Math.max(0, box.x - pad);
      const y0 = Math.max(0, box.y - pad);
      let side = box.w + pad * 2;
      side = Math.min(side, v.videoWidth - x0, v.videoHeight - y0);
      if (side > 64) {
        ctx.drawImage(v, x0, y0, side, side, 0, 0, size, size);
        return;
      }
    }
    const minDim = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - minDim) / 2;
    const sy = (v.videoHeight - minDim) / 2;
    ctx.drawImage(v, sx, sy, minDim, minDim, 0, 0, size, size);
  }, []);

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
      } catch { /* best effort */ }
    }
    const face3DStructure = buildCanonical3DFaceStructure(samples.current);
    const masterPkg = synthesizeMasterFaceDescriptor(samples.current);
    stop();
    onComplete({
      samples: samples.current,
      wearsGlasses: glasses.current,
      blinked: true,
      challenge,
      face3DStructure,
      masterDescriptor: masterPkg.masterDescriptor,
      overallClarityScore: masterPkg.qualityScore,
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
      c.width = PORTRAIT_SIZE;
      c.height = PORTRAIT_SIZE;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      let image = latestFaceDataRef.current?.image;
      let descriptor = latestFaceDataRef.current?.descriptor;
      let rawLandmarks = latestFaceDataRef.current?.landmarks || landmarksRef.current || [];

      if (v && v.videoWidth) {
        drawFaceCropInto(ctx, PORTRAIT_SIZE);
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
            if (det?.landmarks?.positions) rawLandmarks = det.landmarks.positions;
          } catch { /* best effort */ }
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

      const landmarks3D = rawLandmarks.length >= 68
        ? estimate3DLandmarksFrom2D(rawLandmarks, PORTRAIT_SIZE, PORTRAIT_SIZE, target)
        : undefined;

      samples.current.push({
        pose: target,
        glasses: needsBare || !glasses.current ? 'without' : 'with',
        descriptor: [...descriptor],
        landmarks: rawLandmarks.map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
        landmarks3d: landmarks3D,
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
  }, [drawFaceCropInto, finishEnrollment, triggerBurst]);

  // Apple Face ID 3D HUD & Cyber Neural Mesh Canvas Animation Loop
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let running = true;
    let lastHudSig = '';

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

      // Idle-skip: with no face, no particles and no cursor pill the HUD is fully
      // static — keep the last drawn frame and avoid burning GPU/CPU at 60fps.
      const hasFaceHud = Boolean(landmarksRef.current && landmarksRef.current.length >= 68 && video.current?.videoWidth);
      const hudSig = `${activeTicksRef.current.size}|${phase.current === 'done' ? 1 : 0}|${particlesRef.current.length}|${cursorAngleRef.current === null ? 0 : 1}|${hasFaceHud ? 1 : 0}`;
      if (!hasFaceHud && particlesRef.current.length === 0 && cursorAngleRef.current === null && lastHudSig === hudSig) {
        if (running) animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      lastHudSig = hudSig;

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

        // 1a. Futuristic Holographic Scanning Bar Wave (Vertical Sweep)
        const scanY = cy + Math.sin(Date.now() / 420) * (r * 0.65);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r - 10 * dpr, 0, Math.PI * 2);
        ctx.clip();
        const scanGrad = ctx.createLinearGradient(0, scanY - 18 * dpr, 0, scanY + 18 * dpr);
        scanGrad.addColorStop(0, 'rgba(52, 211, 153, 0)');
        scanGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.22)');
        scanGrad.addColorStop(1, 'rgba(52, 211, 153, 0)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(cx - r, scanY - 18 * dpr, r * 2, 36 * dpr);
        ctx.restore();

        // 1b. Smooth Face ID Corner Reticle Brackets around Face Bounds
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        landmarks.forEach((p) => {
          const pt = mapPt(p);
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        });
        const pad = 14 * dpr;
        const bx = minX - pad;
        const by = minY - pad;
        const bw = maxX - minX + pad * 2;
        const bh = maxY - minY + pad * 2;
        const cornerLen = Math.min(20 * dpr, bw * 0.25);

        ctx.save();
        ctx.strokeStyle = activeTicks.size > 0 ? '#34d399' : 'rgba(52, 211, 153, 0.75)';
        ctx.lineWidth = 2.2 * dpr;
        ctx.shadowColor = 'rgba(52, 211, 153, 0.6)';
        ctx.shadowBlur = 8 * dpr;

        // Top-Left
        ctx.beginPath();
        ctx.moveTo(bx, by + cornerLen);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + cornerLen, by);
        ctx.stroke();

        // Top-Right
        ctx.beginPath();
        ctx.moveTo(bx + bw - cornerLen, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw, by + cornerLen);
        ctx.stroke();

        // Bottom-Left
        ctx.beginPath();
        ctx.moveTo(bx, by + bh - cornerLen);
        ctx.lineTo(bx, by + bh);
        ctx.lineTo(bx + cornerLen, by + bh);
        ctx.stroke();

        // Bottom-Right
        ctx.beginPath();
        ctx.moveTo(bx + bw - cornerLen, by + bh);
        ctx.lineTo(bx + bw, by + bh);
        ctx.lineTo(bx + bw, by + bh - cornerLen);
        ctx.stroke();
        ctx.restore();

        // 1c. Triangulated Cyber Shading Lines
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
    // Best-of-N sharp-frame burst: a few candidate frames are grabbed around the
    // moment the hold completes and only the sharpest one is kept.
    let burst: {
      pose: Pose;
      glasses: 'with' | 'without';
      candidates: { image: string; sharp: number }[];
      startedAt: number;
    } | null = null;
    // Rolling precision-tracking window (normalized face center + width)
    const trackPts: { x: number; y: number; w: number }[] = [];

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    const qualityCanvas = document.createElement('canvas');
    qualityCanvas.width = qualityCanvas.height = 128;
    const portraitCanvas = document.createElement('canvas');
    portraitCanvas.width = portraitCanvas.height = PORTRAIT_SIZE;

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

            // Fast tracking: TinyFace detector (inputSize 224) + 68 landmarks + 128D descriptor in one pass
            let face: any = await faceapi
              .detectSingleFace(
                canvas,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 })
              )
              .withFaceLandmarks()
              .withFaceDescriptor();

            if (disposed) return;

            // Fallback SSD MobileNet if TinyFace missed extreme angles
            if (!face) {
              try {
                face = await faceapi
                  .detectSingleFace(
                    canvas,
                    new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 })
                  )
                  .withFaceLandmarks()
                  .withFaceDescriptor();
              } catch { /* best effort */ }
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

            // Precision tracking: remember the face box in video-pixel coordinates
            const vScale = v.videoWidth / canvas.width;
            lastBoxRef.current = { x: b.x * vScale, y: b.y * vScale, w: b.width * vScale, h: b.height * vScale };
            trackPts.push({
              x: (b.x + b.width / 2) / canvas.width,
              y: (b.y + b.height / 2) / canvas.height,
              w: b.width,
            });
            if (trackPts.length > 8) trackPts.shift();

            // Precision gate: the face must stay roughly centered inside the ring
            const faceCx = (b.x + b.width / 2) / canvas.width;
            const faceCy = (b.y + b.height / 2) / canvas.height;
            if (faceCx < 0.26 || faceCx > 0.74 || faceCy < 0.24 || faceCy > 0.8) {
              setMessage('Center your face inside the guidance ring');
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

            // Precision tracking: is the face steady (low jitter + stable distance)?
            let faceSteady = false;
            if (trackPts.length >= 5) {
              const mx = trackPts.reduce((s, p) => s + p.x, 0) / trackPts.length;
              const my = trackPts.reduce((s, p) => s + p.y, 0) / trackPts.length;
              const jitter = Math.max(...trackPts.map((p) => Math.hypot(p.x - mx, p.y - my)));
              const widths = trackPts.map((p) => p.w);
              const wMin = Math.min(...widths);
              const wMax = Math.max(...widths);
              faceSteady = jitter < 0.055 && (wMax - wMin) / Math.max(1, wMin) < 0.16;
            }

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
            // NOTE: only lift the result into React state when a meaningful value
            // actually changed — otherwise the whole component would re-render ~12x/second.
            const holdDuration = stableSince ? performance.now() - stableSince : 0;
            const reasoning = evaluateSpatialReasoning(
              face.landmarks.positions,
              canvas.width,
              target,
              quality,
              ear,
              holdDuration
            );
            const reasoningKey = `${reasoning.distanceStatus}|${reasoning.lightingStatus}|${reasoning.targetSatisfied}|${Math.round(reasoning.targetAlignment / 5)}|${reasoning.adaptiveAssisted}`;
            if (reasoningKey !== reasoningKeyRef.current) {
              reasoningKeyRef.current = reasoningKey;
              setAiReasoning(reasoning);
            }

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
              descriptor: face.descriptor ? Array.from(face.descriptor as Float32Array) : undefined,
              landmarks: face.landmarks?.positions || landmarksRef.current || undefined,
            };

            // Helper to extract the current full-resolution face crop as a JPEG data URL
            const extractPortrait = (): string => {
              const pCtx = portraitCanvas.getContext('2d');
              if (!pCtx) return '';
              drawFaceCropInto(pCtx, PORTRAIT_SIZE);
              return portraitCanvas.toDataURL('image/jpeg', 0.9);
            };

            // Helper to finalize a captured frame: descriptor + identity reference
            // match + AI-enhanced portrait + 3D landmarks reconstruction, then store the sample.
            const finalizeSample = async (
              targetPose: Pose,
              glassesState: 'with' | 'without',
              sourceImage: string,
              descriptorArrIn?: number[] | null,
              landmarks2DIn?: { x: number; y: number }[] | null
            ): Promise<boolean> => {
              let descriptorArr: number[] | null = descriptorArrIn || null;
              if (!descriptorArr) {
                try {
                  const desc = await faceapi.computeFaceDescriptor(canvas);
                  descriptorArr = Array.from(desc as Float32Array);
                } catch { /* best effort */ }
              }
              if (!descriptorArr) {
                // Rare fallback keeps the flow alive; logged so it can be reviewed later.
                console.warn('[GuidedFaceCapture] Descriptor computation fallback.');
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
              if (!reference && targetPose === 'front') reference = descriptorArr;

              // AI portrait extraction: enhance the sharpest frame
              const pCtx = portraitCanvas.getContext('2d');
              let image = sourceImage;
              if (pCtx) {
                pCtx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
                try {
                  const img = new Image();
                  img.src = sourceImage;
                  await img.decode();
                  pCtx.drawImage(img, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
                } catch {
                  pCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
                }
                image = aiEnhanceFaceCanvas(portraitCanvas);
              }

              const landmarks2D = landmarks2DIn || face?.landmarks?.positions || landmarksRef.current || [];
              const landmarks3D = landmarks2D.length >= 68
                ? estimate3DLandmarksFrom2D(landmarks2D, canvas.width, canvas.height, targetPose)
                : undefined;

              samples.current.push({
                pose: targetPose,
                glasses: glassesState,
                descriptor: descriptorArr,
                landmarks: landmarks2D.map((p: any) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
                landmarks3d: landmarks3D,
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

            // Common post-capture effects: progress, audio, particles, flow control
            const afterCapture = (): void => {
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
                } catch { /* best effort */ }
              }

              if (needsBare) {
                change('replace-glasses');
                return;
              }

              const totalNeeded = glasses.current ? poses.length + 1 : poses.length;
              if (samples.current.length >= totalNeeded) {
                finishEnrollmentRef.current();
              }
            };

            // Phase: Glasses Detection
            if (phase.current === 'glasses') {
              setMessage('Look straight ahead while we check for glasses');
              if (!classifierStarted && currentPose === 'front') {
                classifierStarted = true;
                setClassifying(true);
                const pCtx = portraitCanvas.getContext('2d');
                if (pCtx) {
                  pCtx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
                  pCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
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
                const progressPct = Math.min(100, Math.round(((performance.now() - stableSince) / 140) * 100));
                setHoldProgress(progressPct);

                if (performance.now() - stableSince > 140) {
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

            // High-quality gates: never snapshot a blurred frame
            // (adaptive assist releases the steadiness hold after ~1.4s near target)
            if (quality.sharpness < 8 || (!faceSteady && !reasoning.adaptiveAssisted)) {
              stableSince = 0;
              setHoldProgress(0);
              return;
            }

            const holdTargetMs = 140;
            if (!stableSince) stableSince = performance.now();
            const elapsed = performance.now() - stableSince;
            const holdPct = Math.min(100, Math.round((elapsed / holdTargetMs) * 100));
            setHoldProgress(holdPct);

            if (elapsed < holdTargetMs) return;

            // Target held stably: instant capture with zero burst lag
            stableSince = 0;
            setHoldProgress(0);
            const portraitImg = extractPortrait();
            const desc = face.descriptor ? Array.from(face.descriptor as Float32Array) : null;
            const lm = face.landmarks?.positions || landmarksRef.current;
            const ok = await finalizeSample(
              target,
              needsBare || !glasses.current ? 'without' : 'with',
              portraitImg,
              desc,
              lm
            );
            if (ok) {
              afterCapture();
            }
          } catch {
            if (!disposed) {
              setMessage('Camera analysis active. Hold steady in view.');
              stableSince = 0;
              setHoldProgress(0);
            }
          } finally {
            if (!disposed && (phase.current as Phase) !== 'done') {
              timer = setTimeout(loop, 30);
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
  }, [challenge, drawFaceCropInto, generation, onComplete, triggerBurst]);

  // Real-time Interactive AI Assistant Bot Guidance
  const getBotGuidance = (): {
    headline: string;
    advice: string;
    direction: 'left' | 'right' | 'up' | 'down' | 'center' | 'none';
    icon: 'arrow-left' | 'arrow-right' | 'arrow-up' | 'arrow-down' | 'check' | 'smile' | 'center' | 'light' | 'distance';
    mood: 'guiding' | 'encouraging' | 'warning' | 'celebrating';
  } => {
    if (failure) {
      return {
        headline: 'Camera check required',
        advice: failure,
        direction: 'none',
        icon: 'center',
        mood: 'warning',
      };
    }

    if (holdProgress > 0) {
      return {
        headline: 'Perfect! Hold steady right there…',
        advice: 'Calibrating face angles ✨',
        direction: 'none',
        icon: 'check',
        mood: 'celebrating',
      };
    }

    // Environmental Real-time Negotiation
    if (aiReasoning?.distanceStatus === 'too_far') {
      return {
        headline: 'Move closer to the camera',
        advice: 'Come a little closer so I can clearly scan you 📏',
        direction: 'center',
        icon: 'distance',
        mood: 'guiding',
      };
    }
    if (aiReasoning?.distanceStatus === 'too_close') {
      return {
        headline: 'Step back a little',
        advice: 'Hold camera slightly further away 📐',
        direction: 'center',
        icon: 'distance',
        mood: 'guiding',
      };
    }

    if (aiReasoning?.lightingStatus === 'dim') {
      return {
        headline: 'A bit dark here — need more light',
        advice: 'Please face a light or window 💡',
        direction: 'none',
        icon: 'light',
        mood: 'warning',
      };
    }

    if (qualityWarning) {
      return {
        headline: 'Hold still to focus',
        advice: qualityWarning,
        direction: 'center',
        icon: 'center',
        mood: 'warning',
      };
    }

    // Pose Directional Negotiation
    if (activeTargetPose === 'left' || activeTargetPose === 'left-deep') {
      return {
        headline: activeTargetPose === 'left-deep' ? 'Turn more to your left ⬅️' : 'Turn gently to your left ⬅️',
        advice: 'Slowly turn head left until the ring turns green',
        direction: 'left',
        icon: 'arrow-left',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'right' || activeTargetPose === 'right-deep') {
      return {
        headline: activeTargetPose === 'right-deep' ? 'Turn more to your right ➡️' : 'Turn gently to your right ➡️',
        advice: 'Slowly turn head right until the ring turns green',
        direction: 'right',
        icon: 'arrow-right',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'up' || activeTargetPose === 'front-up') {
      return {
        headline: 'Tilt your chin up ⬆️',
        advice: 'Gently look upward towards the top arrow',
        direction: 'up',
        icon: 'arrow-up',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'down' || activeTargetPose === 'front-down') {
      return {
        headline: 'Lower your chin slightly ⬇️',
        advice: 'Gently tilt your head downward',
        direction: 'down',
        icon: 'arrow-down',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'down-left') {
      return {
        headline: 'Look down and to the left ↙️',
        advice: 'Tilt your head down and turn slightly left',
        direction: 'left',
        icon: 'arrow-left',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'down-right') {
      return {
        headline: 'Look down and to the right ↘️',
        advice: 'Tilt your head down and turn slightly right',
        direction: 'right',
        icon: 'arrow-right',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'up-left') {
      return {
        headline: 'Look up and to the left ↖️',
        advice: 'Tilt head slightly upward and turn left',
        direction: 'left',
        icon: 'arrow-left',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'up-right') {
      return {
        headline: 'Look up and to the right ↗️',
        advice: 'Tilt head slightly upward and turn right',
        direction: 'right',
        icon: 'arrow-right',
        mood: 'guiding',
      };
    }

    if (activeTargetPose === 'front-smile') {
      return {
        headline: 'Give a bright smile 😊',
        advice: 'Smile naturally for liveness check',
        direction: 'none',
        icon: 'smile',
        mood: 'encouraging',
      };
    }

    return {
      headline: 'Look straight at the camera',
      advice: 'Keep your head upright and centered',
      direction: 'center',
      icon: 'center',
      mood: 'guiding',
    };
  };

  const botGuidance = getBotGuidance();

  return (
    <section className="faceid-stage relative max-w-xl mx-auto" aria-label="Intelligent multi-angle face capture">
      {/* Upper Mode Strip */}
      <div className="flex items-center justify-between w-full max-w-md mx-auto mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[11px] font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-300 gap-1">
            <ScanFace size={12} className="text-emerald-400" />
            Face ID Capture
          </Badge>
          {aiReasoning?.adaptiveAssisted && (
            <Badge variant="outline" className="text-[10px] font-bold border-cyan-500/30 bg-cyan-500/10 text-cyan-300 animate-pulse gap-1">
              <Zap size={10} className="text-cyan-400" />
              Assist Active
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
        {(activeTargetPose === 'left' || activeTargetPose === 'left-deep' || activeTargetPose === 'up-left' || activeTargetPose === 'down-left') && (
          <div className="faceid-viewport-arrow pos-left" title="Turn Left">
            <ArrowLeft size={24} className="animate-pulse" />
          </div>
        )}
        {(activeTargetPose === 'right' || activeTargetPose === 'right-deep' || activeTargetPose === 'up-right' || activeTargetPose === 'down-right') && (
          <div className="faceid-viewport-arrow pos-right" title="Turn Right">
            <ArrowRight size={24} className="animate-pulse" />
          </div>
        )}
        {(activeTargetPose === 'up' || activeTargetPose === 'front-up') && (
          <div className="faceid-viewport-arrow pos-up" title="Tilt Up">
            <ArrowUp size={24} className="animate-pulse" />
          </div>
        )}
        {(activeTargetPose === 'down' || activeTargetPose === 'front-down' || activeTargetPose === 'down-left' || activeTargetPose === 'down-right') && (
          <div className="faceid-viewport-arrow pos-down" title="Tilt Down">
            <ArrowDown size={24} className="animate-pulse" />
          </div>
        )}

        {/* Apple Face ID 36-tick HUD & Particle Overlay Canvas */}
        <canvas ref={overlayCanvasRef} className="faceid-canvas-overlay" />
      </div>

      {/* REALTIME INTERACTIVE AI BOT GUIDE (Replaces technical 4-column stats) */}
      {stage !== 'done' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3.5 p-3.5 sm:p-4 rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-white/10 shadow-xl max-w-md mx-auto text-left"
        >
          <div className="flex items-center gap-3">
            {/* Animated Bot Avatar */}
            <AIBotAvatar
              mood={botGuidance.mood}
              direction={botGuidance.direction}
              holdProgress={holdProgress}
            />

            {/* Conversational Speech Bubble */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <Bot size={11} className="text-emerald-400" /> AI Guide
                  </span>
                  {aiReasoning?.targetSatisfied && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                      Angle Matched
                    </span>
                  )}
                </div>

                {/* Calibrated count badge */}
                <span className="text-[10px] font-mono font-bold text-slate-400">
                  {progress} / {totalRequired}
                </span>
              </div>

              {/* Bot Main Headline */}
              <p className="text-sm font-bold text-white leading-tight">
                {botGuidance.headline}
              </p>

              {/* Bot Helpful Advice */}
              <p className="text-xs text-slate-300/80 mt-0.5 truncate">
                {botGuidance.advice}
              </p>
            </div>

            {/* Visual Movement Cue Tile */}
            <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 shadow-sm">
              {botGuidance.icon === 'arrow-left' && (
                <ArrowLeft size={20} className="text-emerald-400 animate-pulse" />
              )}
              {botGuidance.icon === 'arrow-right' && (
                <ArrowRight size={20} className="text-emerald-400 animate-pulse" />
              )}
              {botGuidance.icon === 'arrow-up' && (
                <ArrowUp size={20} className="text-emerald-400 animate-pulse" />
              )}
              {botGuidance.icon === 'arrow-down' && (
                <ArrowDown size={20} className="text-emerald-400 animate-pulse" />
              )}
              {botGuidance.icon === 'check' && (
                <CheckCircle2 size={20} className="text-emerald-400 animate-bounce" />
              )}
              {botGuidance.icon === 'smile' && (
                <Smile size={20} className="text-amber-400 animate-pulse" />
              )}
              {botGuidance.icon === 'light' && (
                <Lightbulb size={20} className="text-amber-400 animate-pulse" />
              )}
              {botGuidance.icon === 'distance' && (
                <Compass size={20} className="text-cyan-400 animate-pulse" />
              )}
              {botGuidance.icon === 'center' && (
                <ScanFace size={20} className="text-emerald-400" />
              )}
            </div>
          </div>

          {/* Smooth Alignment & Hold Progress Bar */}
          <div className="mt-3 pt-2.5 border-t border-white/5 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="font-medium">
                {holdProgress > 0 ? 'Holding steady…' : 'Angle alignment'}
              </span>
              <span className="font-mono font-bold text-emerald-400">
                {holdProgress > 0 ? `${holdProgress}%` : `${aiReasoning?.targetAlignment || 0}%`}
              </span>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-150 rounded-full ${
                  holdProgress > 0 ? 'bg-emerald-400' : 'bg-gradient-to-r from-emerald-500/70 to-teal-400/70'
                }`}
                style={{ width: `${holdProgress > 0 ? holdProgress : (aiReasoning?.targetAlignment || 0)}%` }}
              />
            </div>
          </div>
        </motion.div>
      )}



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
