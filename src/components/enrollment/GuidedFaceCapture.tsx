import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Camera, Check, Glasses, RotateCcw, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { poses, type CaptureResult, type FaceSample, type Pose } from '@/services/enrollment/types';
import { eyeOpenness, facePose, imageQuality } from '@/services/enrollment/captureQuality';

type Phase = 'prepare' | 'glasses' | 'blink' | 'turn' | 'capture' | 'replace-glasses' | 'done';
const directions: Record<Pose, string> = { front: 'Look straight ahead', left: 'Turn gently to your left', right: 'Turn gently to your right', up: 'Lift your chin a little', down: 'Lower your chin a little', 'up-left': 'Look gently up and left', 'up-right': 'Look gently up and right', 'down-left': 'Look gently down and left', 'down-right': 'Look gently down and right' };

export default function GuidedFaceCapture({ challenge, onComplete, onCancel }: { challenge: 'left' | 'right'; onComplete: (result: CaptureResult) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>();
  const worker = useRef<Worker>();
  const phase = useRef<Phase>('prepare');
  const samples = useRef<FaceSample[]>([]);
  const glasses = useRef(false);
  const [stage, setStage] = useState<Phase>('prepare');
  const [message, setMessage] = useState('Preparing your camera…');
  const [failure, setFailure] = useState('');
  const [progress, setProgress] = useState(0);
  const [suggestion, setSuggestion] = useState<boolean | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reduced = useReducedMotion();
  const change = (next: Phase) => { phase.current = next; setStage(next); };
  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); worker.current?.terminate(); };

  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>, classifierTimer: ReturnType<typeof setTimeout>;
    let stableSince = 0, previousTarget = '', closed = false, openBaseline = 0, blinked = false, classifierStarted = false;
    let reference: number[] | null = null;
    const canvas = document.createElement('canvas');
    const qualityCanvas = document.createElement('canvas'); qualityCanvas.width = qualityCanvas.height = 128;
    phase.current = 'prepare'; samples.current = []; setStage('prepare'); setProgress(0); setFailure(''); setSuggestion(null);
    const setup = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS and a supported browser.');
        const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } } });
        if (disposed) { media.getTracks().forEach(t => t.stop()); return; }
        stream.current = media;
        video.current!.srcObject = media; await video.current!.play();
        const [{ loadRegistrationModels }, faceapi] = await Promise.all([import('@/services/face-recognition/OptimizedRegistrationService'), import('face-api.js')]);
        await loadRegistrationModels();
        if (disposed) return;
        change('glasses');
        const loop = async () => {
          if (disposed || phase.current === 'done') return;
          try {
            const v = video.current;
            if (!v?.videoWidth || document.hidden) { stableSince = 0; return; }
            canvas.width = 640; canvas.height = Math.round(640 * v.videoHeight / v.videoWidth);
            canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
            const detected = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 })).withFaceLandmarks().withFaceDescriptors();
            if (disposed) return;
            if (detected.length !== 1) { setMessage(detected.length ? 'Only the student should be in the frame' : 'Move your face into the circle'); stableSince = 0; return; }
            const face = detected[0], b = face.detection.box;
            if (b.width < 125 || b.x < 12 || b.y < 12 || b.x + b.width > canvas.width - 12 || b.y + b.height > canvas.height - 12) { setMessage('Move a little closer and keep your whole face in view'); stableSince = 0; return; }
            qualityCanvas.getContext('2d')!.drawImage(canvas, b.x, b.y, b.width, b.height, 0, 0, 128, 128);
            const quality = imageQuality(qualityCanvas.getContext('2d')!.getImageData(0, 0, 128, 128).data, 128, 128);
            if (quality.brightness < 35 || quality.brightness > 225 || quality.sharpness < 25) { setMessage(quality.sharpness < 25 ? 'Hold still while the camera focuses' : 'Face a soft light, away from glare'); stableSince = 0; return; }
            const currentPose = facePose(face.landmarks.positions);
            const descriptor = Array.from(face.descriptor);
            if (reference && Math.hypot(...descriptor.map((x, i) => x - reference![i])) > 0.65) { setMessage('Please keep the same student in view'); stableSince = 0; return; }
            const portrait = document.createElement('canvas'); portrait.width = 384; portrait.height = 384;
            const pad = b.width * 0.18, x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
            portrait.getContext('2d')!.drawImage(canvas, x, y, Math.min(canvas.width - x, b.width + pad * 2), Math.min(canvas.height - y, b.height + pad * 2), 0, 0, 384, 384);
            const image = portrait.toDataURL('image/jpeg', 0.88);
            if (phase.current === 'glasses') {
              setMessage('Look straight ahead while we check for glasses');
              if (!classifierStarted && currentPose === 'front') {
                classifierStarted = true; setClassifying(true);
                worker.current = new Worker(new URL('../../services/enrollment/glasses.worker.ts', import.meta.url), { type: 'module' });
                worker.current.onmessage = e => { if (!disposed) { setSuggestion(e.data.glasses); setClassifying(false); } clearTimeout(classifierTimer); worker.current?.terminate(); };
                worker.current.onerror = () => { if (!disposed) setClassifying(false); clearTimeout(classifierTimer); worker.current?.terminate(); };
                worker.current.postMessage({ image });
                classifierTimer = setTimeout(() => { worker.current?.terminate(); if (!disposed) setClassifying(false); }, 20000);
              }
              return;
            }
            if (phase.current === 'replace-glasses') { setMessage('Put your glasses back on, then continue'); return; }
            if (!reference && currentPose === 'front') reference = descriptor;
            if (phase.current === 'blink') {
              setMessage('Look straight ahead, then blink slowly');
              if (currentPose !== 'front') return;
              const openness = eyeOpenness(face.landmarks.positions);
              openBaseline = Math.max(openBaseline, openness);
              if (openBaseline > 0.2 && openness < openBaseline * 0.65) closed = true;
              if (closed && openness > openBaseline * 0.85) { blinked = true; change('turn'); }
              return;
            }
            if (phase.current === 'turn') {
              setMessage(directions[challenge]);
              if (currentPose === challenge) { if (!stableSince) stableSince = performance.now(); if (performance.now() - stableSince > 500) { stableSince = 0; change('capture'); } } else stableSince = 0;
              return;
            }
            const needsBare = glasses.current && samples.current.length === 0;
            const capturedMain = samples.current.filter(s => s.glasses === (glasses.current ? 'with' : 'without')).length;
            const target = needsBare ? 'front' : poses[capturedMain];
            if (!target) return;
            setMessage((needsBare ? 'Without glasses: ' : '') + directions[target]);
            if (currentPose !== target) { stableSince = 0; return; }
            if (previousTarget !== target) { previousTarget = target; stableSince = 0; }
            if (!stableSince) stableSince = performance.now();
            if (performance.now() - stableSince < 650) return;
            samples.current.push({ pose: target, glasses: needsBare || !glasses.current ? 'without' : 'with', descriptor, image, quality });
            stableSince = 0; setProgress(samples.current.length);
            if (needsBare) { change('replace-glasses'); return; }
            if (samples.current.length === (glasses.current ? 10 : 9)) {
              change('done'); stop();
              onComplete({ samples: samples.current, wearsGlasses: glasses.current, blinked, challenge });
            }
          } catch { if (!disposed) { setMessage('Camera analysis paused. Hold still while we retry.'); stableSince = 0; } }
          finally { if (!disposed && phase.current !== 'done') timer = setTimeout(loop, 130); }
        };
        void loop();
      } catch (e) { stop(); if (!disposed) setFailure(e instanceof Error ? e.message : 'Camera could not start. Check camera permission and retry.'); }
    };
    void setup();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(classifierTimer); stop(); canvas.width = qualityCanvas.width = 0; };
  }, [challenge, generation, onComplete]);

  return <section className="enrollment-capture" aria-label="Guided face capture">
    <div className="enrollment-camera">
      <video ref={video} muted playsInline autoPlay className="enrollment-video" />
      <svg className="enrollment-ring" viewBox="0 0 320 320" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => <line key={i} x1="160" y1="12" x2="160" y2="23" transform={`rotate(${i * 10} 160 160)`} stroke={i < progress / (glasses.current ? 10 : 9) * 36 ? '#68f5cf' : '#ffffff50'} strokeWidth="4" strokeLinecap="round" />)}
      </svg>
      {stage === 'prepare' && <div className="enrollment-camera-loading"><Camera size={32} /><span>Preparing camera</span></div>}
    </div>
    <motion.div key={message} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="text-center min-h-16 mt-5">
      <p className="text-lg font-semibold" aria-live="polite">{failure || message}</p>
      <p className="text-sm text-slate-400 mt-2">{progress} / {glasses.current ? 10 : 9} views · Automatic capture</p>
    </motion.div>
    {stage === 'glasses' && <div className="enrollment-inset mt-4"><Glasses className="mx-auto mb-2" /><p className="text-center text-sm mb-3">{classifying ? 'Checking glasses on this device… You can also confirm below.' : suggestion === null ? 'Does the student normally wear glasses?' : suggestion ? 'Glasses detected. Please confirm.' : 'No glasses detected. Please confirm.'}</p><div className="flex gap-3"><Button className="flex-1" onClick={() => { glasses.current = true; worker.current?.terminate(); change('blink'); }}>Yes — remove for first photo</Button><Button variant="outline" onClick={() => { glasses.current = false; worker.current?.terminate(); change('blink'); }}>No glasses</Button></div></div>}
    {stage === 'replace-glasses' && <Button className="w-full mt-4" onClick={() => change('capture')}><Check className="mr-2 h-4 w-4" />Glasses are back on</Button>}
    {failure && <Button className="w-full mt-4" onClick={() => setGeneration(v => v + 1)}><RotateCcw className="mr-2 h-4 w-4" />Retry camera</Button>}
    <div className="flex items-center justify-between mt-5 text-xs text-slate-400"><span className="flex items-center gap-2"><ScanFace size={14} />Guided multi-angle photos</span><Button variant="ghost" size="sm" onClick={() => { stop(); onCancel(); }}>Cancel</Button></div>
  </section>;
}
