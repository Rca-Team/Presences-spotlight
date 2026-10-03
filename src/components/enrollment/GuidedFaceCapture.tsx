import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Camera, Check, Glasses, RotateCcw, ScanFace, Sparkles, Volume2, VolumeX, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Eye, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { poses, type CaptureResult, type FaceSample, type Pose } from '@/services/enrollment/types';
import { eyeOpenness, estimateFacePose, imageQuality } from '@/services/enrollment/captureQuality';

type Phase = 'prepare' | 'glasses' | 'blink' | 'turn' | 'capture' | 'replace-glasses' | 'done';

const directions: Record<Pose, string> = {
  front: 'Look straight ahead',
  left: 'Turn gently to your left ⬅️',
  right: 'Turn gently to your right ➡️',
  up: 'Lift your chin slightly ⬆️',
  down: 'Lower your chin slightly ⬇️',
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
      // Signature Apple Face ID / Apple Pay chime
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

  const [stage, setStage] = useState<Phase>('prepare');
  const [message, setMessage] = useState('Preparing your camera…');
  const [failure, setFailure] = useState('');
  const [progress, setProgress] = useState(0);
  const [suggestion, setSuggestion] = useState<boolean | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [soundMuted, setSoundMuted] = useState(false);
  const [activeTargetPose, setActiveTargetPose] = useState<Pose | 'blink' | null>(null);

  const reduced = useReducedMotion();

  const toggleSound = () => {
    soundRef.current.enabled = !soundRef.current.enabled;
    setSoundMuted(!soundRef.current.enabled);
  };

  const change = (next: Phase) => {
    phase.current = next;
    setStage(next);
  };

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    worker.current?.terminate();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  const triggerBurst = (cx: number, cy: number, count = 28) => {
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
  };

  // Apple Face ID 3D HUD Canvas Animation Loop
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
      const w = (canvas.width = rect.width * dpr);
      const h = (canvas.height = rect.height * dpr);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.43; // outer ring radius
      const activeTicks = activeTicksRef.current;
      const cursorAngle = cursorAngleRef.current;
      const isDone = phase.current === 'done';

      // 1. Draw subtle landmark contours on face
      const landmarks = landmarksRef.current;
      const v = video.current;
      if (landmarks && landmarks.length >= 68 && v && v.videoWidth) {
        ctx.save();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
        ctx.lineWidth = 1.2 * dpr;

        // video is scaled via CSS scaleX(-1); coordinates are mapped from mirrored video
        const mapPt = (p: { x: number; y: number }) => ({
          x: (1 - p.x / v.videoWidth) * w,
          y: (p.y / v.videoHeight) * h,
        });

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
        ctx.restore();
      }

      // 2. Base Guide Ring (Circle)
      ctx.save();
      ctx.strokeStyle = isDone
        ? 'rgba(52, 211, 153, 0.9)'
        : activeTicks.size > 0
        ? 'rgba(52, 211, 153, 0.5)'
        : 'rgba(255, 255, 255, 0.18)';
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
          ctx.shadowColor = 'rgba(52, 211, 153, 0.85)';
          ctx.shadowBlur = 8 * dpr;
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 3.5 * dpr;
          ctx.lineCap = 'round';
        } else {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1.8 * dpr;
          ctx.lineCap = 'butt';
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // 4. Cursor Beacon Indicator
      if (cursorAngle !== null && !isDone) {
        const beaconR = r;
        const bx = cx + Math.cos(cursorAngle - Math.PI / 2) * beaconR;
        const by = cy + Math.sin(cursorAngle - Math.PI / 2) * beaconR;

        ctx.save();
        ctx.shadowColor = 'rgba(34, 211, 238, 0.9)';
        ctx.shadowBlur = 12 * dpr;
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(bx, by, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. Render Particle Bursts
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life++;
        p.alpha = 1 - p.life / p.maxLife;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
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
  }, []);

  // Main Detection & Capture Lifecycle
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let classifierTimer: ReturnType<typeof setTimeout>;
    let stableSince = 0;
    let previousTarget = '';
    let closed = false;
    let openBaseline = 0;
    let blinked = false;
    let classifierStarted = false;
    let reference: number[] | null = null;
    let lastTickAngle = -1;

    const canvas = document.createElement('canvas');
    const qualityCanvas = document.createElement('canvas');
    qualityCanvas.width = qualityCanvas.height = 128;

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

        const loop = async () => {
          if (disposed || phase.current === 'done') return;

          try {
            const v = video.current;
            if (!v?.videoWidth || document.hidden) {
              stableSince = 0;
              cursorAngleRef.current = null;
              landmarksRef.current = null;
              return;
            }

            canvas.width = 640;
            canvas.height = Math.round((640 * v.videoHeight) / v.videoWidth);
            canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);

            const detected = await faceapi
              .detectAllFaces(
                canvas,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 })
              )
              .withFaceLandmarks()
              .withFaceDescriptors();

            if (disposed) return;

            if (detected.length !== 1) {
              setMessage(
                detected.length ? 'Only the student should be in the frame' : 'Center face inside the circle'
              );
              stableSince = 0;
              cursorAngleRef.current = null;
              landmarksRef.current = null;
              return;
            }

            const face = detected[0];
            const b = face.detection.box;

            if (
              b.width < 125 ||
              b.x < 12 ||
              b.y < 12 ||
              b.x + b.width > canvas.width - 12 ||
              b.y + b.height > canvas.height - 12
            ) {
              setMessage('Move a little closer and keep your whole face in view');
              stableSince = 0;
              return;
            }

            qualityCanvas
              .getContext('2d')!
              .drawImage(canvas, b.x, b.y, b.width, b.height, 0, 0, 128, 128);
            const quality = imageQuality(
              qualityCanvas.getContext('2d')!.getImageData(0, 0, 128, 128).data,
              128,
              128
            );

            if (quality.brightness < 35 || quality.brightness > 225 || quality.sharpness < 25) {
              setMessage(
                quality.sharpness < 25 ? 'Hold still while the camera focuses' : 'Face a soft light, away from glare'
              );
              stableSince = 0;
              return;
            }

            const poseData = estimateFacePose(face.landmarks.positions);
            const currentPose = poseData.pose;
            const descriptor = Array.from(face.descriptor);

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

            if (reference && Math.hypot(...descriptor.map((x, i) => x - reference![i])) > 0.65) {
              setMessage('Please keep the same student in view');
              stableSince = 0;
              return;
            }

            const portrait = document.createElement('canvas');
            portrait.width = 384;
            portrait.height = 384;
            const pad = b.width * 0.18;
            const x = Math.max(0, b.x - pad);
            const y = Math.max(0, b.y - pad);
            portrait
              .getContext('2d')!
              .drawImage(
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
            const image = portrait.toDataURL('image/jpeg', 0.88);

            // Phase: Glasses
            if (phase.current === 'glasses') {
              setMessage('Look straight ahead while we check for glasses');
              if (!classifierStarted && currentPose === 'front') {
                classifierStarted = true;
                setClassifying(true);
                worker.current = new Worker(
                  new URL('../../services/enrollment/glasses.worker.ts', import.meta.url),
                  { type: 'module' }
                );
                worker.current.onmessage = (e) => {
                  if (!disposed) {
                    setSuggestion(e.data.glasses);
                    setClassifying(false);
                  }
                  clearTimeout(classifierTimer);
                  worker.current?.terminate();
                };
                worker.current.onerror = () => {
                  if (!disposed) setClassifying(false);
                  clearTimeout(classifierTimer);
                  worker.current?.terminate();
                };
                worker.current.postMessage({ image });
                classifierTimer = setTimeout(() => {
                  worker.current?.terminate();
                  if (!disposed) setClassifying(false);
                }, 20000);
              }
              return;
            }

            if (phase.current === 'replace-glasses') {
              setMessage('Put your glasses back on, then continue');
              return;
            }

            if (!reference && currentPose === 'front') reference = descriptor;

            // Phase: Blink
            if (phase.current === 'blink') {
              setActiveTargetPose('blink');
              setMessage('Look straight ahead, then blink slowly');
              if (currentPose !== 'front') return;
              const openness = eyeOpenness(face.landmarks.positions);
              openBaseline = Math.max(openBaseline, openness);
              if (openBaseline > 0.2 && openness < openBaseline * 0.65) closed = true;
              if (closed && openness > openBaseline * 0.85) {
                blinked = true;
                soundRef.current.playSectorComplete();
                change('turn');
              }
              return;
            }

            // Phase: Turn Challenge
            if (phase.current === 'turn') {
              setActiveTargetPose(challenge);
              setMessage(directions[challenge]);
              if (currentPose === challenge) {
                if (!stableSince) stableSince = performance.now();
                if (performance.now() - stableSince > 500) {
                  stableSince = 0;
                  soundRef.current.playSectorComplete();
                  change('capture');
                }
              } else {
                stableSince = 0;
              }
              return;
            }

            // Phase: Capture Core 5 Poses
            const needsBare = glasses.current && samples.current.length === 0;
            const capturedMain = samples.current.filter(
              (s) => s.glasses === (glasses.current ? 'with' : 'without')
            ).length;
            const target = needsBare ? 'front' : poses[capturedMain];
            if (!target) return;

            setActiveTargetPose(target);
            setMessage((needsBare ? 'Without glasses: ' : '') + directions[target]);

            if (currentPose !== target) {
              stableSince = 0;
              return;
            }

            if (previousTarget !== target) {
              previousTarget = target;
              stableSince = 0;
            }

            if (!stableSince) stableSince = performance.now();
            if (performance.now() - stableSince < 550) return;

            // Sample successfully acquired!
            samples.current.push({
              pose: target,
              glasses: needsBare || !glasses.current ? 'without' : 'with',
              descriptor,
              image,
              quality,
            });

            stableSince = 0;
            setProgress(samples.current.length);

            // Audio & particle feedback on sector complete
            soundRef.current.playSectorComplete();
            if (overlayCanvasRef.current) {
              const rect = overlayCanvasRef.current.getBoundingClientRect();
              const dpr = window.devicePixelRatio || 1;
              triggerBurst((rect.width * dpr) / 2, (rect.height * dpr) / 2, 22);
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
              change('done');
              soundRef.current.playComplete();
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
                blinked,
                challenge,
              });
            }
          } catch {
            if (!disposed) {
              setMessage('Camera analysis paused. Hold still while we retry.');
              stableSince = 0;
            }
          } finally {
            if (!disposed && phase.current !== 'done') {
              timer = setTimeout(loop, 120);
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
  }, [challenge, generation, onComplete]);

  const totalRequired = glasses.current ? poses.length + 1 : poses.length;

  return (
    <section className="faceid-stage" aria-label="Apple Face ID guided scan">
      <div className="faceid-viewport">
        {/* Circular camera mask with mirrored video */}
        <div className="faceid-circle-mask">
          <video ref={video} muted playsInline autoPlay className="faceid-video" />
          {stage === 'prepare' && (
            <div className="faceid-loading-scrim">
              <Camera size={34} className="animate-pulse text-emerald-400" />
              <span className="text-xs font-medium tracking-wide">Starting Face ID…</span>
            </div>
          )}
        </div>

        {/* Visual In-Viewport Floating Directional Beacons */}
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
        {activeTargetPose === 'blink' && (
          <div className="faceid-viewport-arrow pos-up" title="Blink Eyes">
            <Eye size={22} className="animate-bounce" />
          </div>
        )}

        {/* Apple Face ID 36-tick HUD & Particle Canvas */}
        <canvas ref={overlayCanvasRef} className="faceid-canvas-overlay" />
      </div>

      {/* AI Visual 3D Action Guidance with Animated Head Model */}
      {(stage === 'capture' || stage === 'turn' || stage === 'blink') && (
        <div className="faceid-action-guide">
          <div className="faceid-head-avatar-wrapper">
            <div
              className={`faceid-head-model ${
                activeTargetPose ? `pose-${activeTargetPose}` : 'pose-front'
              }`}
            >
              <div className="faceid-avatar-face">
                <div className="faceid-avatar-eye-left" />
                <div className="faceid-avatar-eye-right" />
                <div className="faceid-avatar-nose" />
                <div className="faceid-avatar-smile" />
              </div>
            </div>

            {/* Glowing directional arrow beacons around head avatar */}
            {activeTargetPose === 'left' && (
              <div className="faceid-arrow-beacon dir-left">
                <ArrowLeft size={18} />
              </div>
            )}
            {activeTargetPose === 'right' && (
              <div className="faceid-arrow-beacon dir-right">
                <ArrowRight size={18} />
              </div>
            )}
            {activeTargetPose === 'up' && (
              <div className="faceid-arrow-beacon dir-up">
                <ArrowUp size={18} />
              </div>
            )}
            {activeTargetPose === 'down' && (
              <div className="faceid-arrow-beacon dir-down">
                <ArrowDown size={18} />
              </div>
            )}
          </div>

          <div className="text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              AI Action Visual
            </p>
            <p className="text-sm font-medium text-slate-200">
              {activeTargetPose === 'left' && 'Follow arrow: gently face left'}
              {activeTargetPose === 'right' && 'Follow arrow: gently face right'}
              {activeTargetPose === 'up' && 'Follow arrow: lift chin up slightly'}
              {activeTargetPose === 'down' && 'Follow arrow: lower chin slightly'}
              {activeTargetPose === 'front' && 'Center position: look straight ahead'}
              {activeTargetPose === 'blink' && 'Liveness check: slow blink once'}
              {!activeTargetPose && 'Calibrating facial landmarks…'}
            </p>
          </div>
        </div>
      )}

      {/* Dynamic guidance chip */}
      <motion.div
        key={message}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center min-h-16 mt-3"
      >
        <p className="text-lg font-semibold tracking-tight" aria-live="polite">
          {failure || message}
        </p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <span className="faceid-chip active">
            <Sparkles size={13} className="text-emerald-400" />
            {progress} of {totalRequired} views calibrated
          </span>
          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
          >
            {soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      </motion.div>

      {/* Glasses Confirmation Prompt */}
      {stage === 'glasses' && (
        <div className="enrollment-inset mt-4 w-full">
          <Glasses className="mx-auto mb-2 text-emerald-300" />
          <p className="text-center text-sm mb-3">
            {classifying
              ? 'Analyzing for glasses… You can also confirm directly below.'
              : suggestion === null
              ? 'Does the student normally wear glasses?'
              : suggestion
              ? 'Glasses detected. Please confirm.'
              : 'No glasses detected. Please confirm.'}
          </p>
          <div className="flex gap-3">
            <Button
              className="flex-1 enrollment-primary"
              onClick={() => {
                glasses.current = true;
                worker.current?.terminate();
                change('blink');
              }}
            >
              Yes — remove for 1st view
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                glasses.current = false;
                worker.current?.terminate();
                change('blink');
              }}
            >
              No glasses
            </Button>
          </div>
        </div>
      )}

      {/* Replace Glasses Step */}
      {stage === 'replace-glasses' && (
        <Button className="w-full mt-4 enrollment-primary" onClick={() => change('capture')}>
          <Check className="mr-2 h-4 w-4" />
          Glasses are back on — continue
        </Button>
      )}

      {/* Failure retry */}
      {failure && (
        <Button className="w-full mt-4" variant="outline" onClick={() => setGeneration((v) => v + 1)}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Retry camera
        </Button>
      )}

      {/* Footer controls */}
      <div className="flex items-center justify-between w-full mt-5 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          <ScanFace size={15} className="text-emerald-400" />
          Apple Face ID TrueDepth Guidance
        </span>
        <Button
          variant="ghost"
          size="sm"
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
