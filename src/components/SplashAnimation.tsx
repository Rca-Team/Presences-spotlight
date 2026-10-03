import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Shield, Cpu, Scan, CheckCircle2 } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';

interface SplashAnimationProps {
  onComplete?: () => void;
  duration?: number;
}

// Crisp, signature iOS/Apple startup harmonic acoustic chime
const playStartupChime = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      try { ctx.close().catch(() => {}); } catch {}
      return;
    }

    // Ascending harmonic triad (F#4, A#4, C#5, F#5)
    const notes = [369.99, 466.16, 554.37, 739.99];
    const startTime = ctx.currentTime + 0.05;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.06);

      gain.gain.setValueAtTime(0.0001, startTime + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.14 / (idx + 1), startTime + idx * 0.06 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.06);
      osc.stop(startTime + 1.9);
    });
  } catch {
    // Autoplay restrictions handle silently
  }
};

export const SplashAnimation: React.FC<SplashAnimationProps> = ({
  onComplete,
  duration = 2000,
}) => {
  const { theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (typeof window !== 'undefined' &&
      window.document.documentElement.classList.contains('dark'));

  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);
  const hasTriggeredChime = useRef(false);

  useEffect(() => {
    if (!hasTriggeredChime.current) {
      hasTriggeredChime.current = true;
      playStartupChime();
    }

    // Smooth mobile progress animation
    const startTime = performance.now();
    let animId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.round((elapsed / (duration - 300)) * 100));
      setProgress(pct);

      if (pct < 100) {
        animId = requestAnimationFrame(tick);
      } else {
        setExiting(true);
        setTimeout(() => {
          if (onComplete) onComplete();
        }, 320);
      }
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [duration, onComplete]);

  const handleSkip = () => {
    setExiting(true);
    setTimeout(() => {
      if (onComplete) onComplete();
    }, 120);
  };

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: 1.04,
            filter: 'blur(8px)',
            transition: { duration: 0.35, ease: [0.32, 0.72, 0, 1] },
          }}
          onClick={handleSkip}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-between select-none overflow-hidden cursor-pointer bg-[#050914] text-white px-6 py-12"
          style={{
            touchAction: 'none',
          }}
        >
          {/* Ambient iOS Aurora Glow Background */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <motion.div
              animate={{
                scale: [1, 1.25, 1],
                opacity: [0.3, 0.55, 0.3],
                x: [0, 15, 0],
                y: [0, -20, 0],
              }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -top-32 -left-32 w-[340px] h-[340px] sm:w-[500px] sm:h-[500px] rounded-full blur-[100px] bg-gradient-to-br from-cyan-500/35 to-blue-600/25"
            />
            <motion.div
              animate={{
                scale: [1.2, 1, 1.2],
                opacity: [0.25, 0.45, 0.25],
                x: [0, -20, 0],
                y: [0, 25, 0],
              }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
              className="absolute -bottom-32 -right-32 w-[340px] h-[340px] sm:w-[500px] sm:h-[500px] rounded-full blur-[110px] bg-gradient-to-br from-emerald-500/30 to-teal-600/20"
            />
            {/* Subtle Texture Noise */}
            <div
              className="absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%23fff' filter='url(%23n)' opacity='.7' d='M0 0h180v180H0z'/%3E%3C/svg%3E")`,
              }}
            />
          </div>

          {/* Top Status Bar Pill */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-lg"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium tracking-wide text-slate-300">
              Presences OS • Secure Gate Active
            </span>
          </motion.div>

          {/* Center Stage: Apple Glass Icon with Neon Pulsing Aura */}
          <div className="relative z-10 flex flex-col items-center justify-center my-auto">
            {/* Pulsing Light Aura */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{
                scale: [0.95, 1.12, 0.95],
                opacity: [0.6, 0.9, 0.6],
              }}
              transition={{
                scale: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
                opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
              }}
              className="absolute w-44 h-44 rounded-full bg-gradient-to-tr from-cyan-500/20 via-emerald-500/25 to-blue-500/20 blur-2xl pointer-events-none"
            />

            {/* Apple Squircle Icon Enclosure */}
            <motion.div
              initial={{ scale: 0.75, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="relative p-6 sm:p-7 rounded-[32px] border border-white/20 bg-gradient-to-b from-white/[0.12] to-white/[0.03] backdrop-blur-3xl shadow-[0_20px_60px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center group"
            >
              <img
                src="/logo.png"
                alt="Presences Logo"
                className="w-20 h-20 sm:w-24 sm:h-24 object-contain filter drop-shadow-[0_10px_20px_rgba(16,185,129,0.35)]"
              />

              {/* Glowing Corner Accents */}
              <div className="absolute top-2.5 right-2.5">
                <Sparkles size={14} className="text-emerald-300/80 animate-pulse" />
              </div>
            </motion.div>

            {/* Branding Typography */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 text-center space-y-1"
            >
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
                Presences
              </h1>
              <p className="text-[11px] sm:text-xs font-semibold tracking-[0.22em] uppercase text-emerald-400/90 font-mono">
                Smart School Automation
              </p>
            </motion.div>
          </div>

          {/* Bottom Module: iOS Smooth Progress Capsule & Modules Loaded */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="relative z-10 w-full max-w-[280px] flex flex-col items-center gap-3.5"
          >
            {/* iOS Micro Progress Bar */}
            <div className="w-full h-1.5 rounded-full bg-white/[0.08] p-0.5 overflow-hidden backdrop-blur-md border border-white/[0.05]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-teal-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                style={{ width: `${progress}%` }}
                transition={{ ease: 'linear' }}
              />
            </div>

            {/* Status Indicator */}
            <div className="flex items-center justify-between w-full text-[11px] text-slate-400 font-medium">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Scan size={13} className="text-cyan-400" />
                {progress < 40
                  ? 'Loading AI vision…'
                  : progress < 80
                  ? 'Connecting Smart Gate…'
                  : 'Ready'}
              </span>
              <span className="font-mono text-emerald-400 font-semibold">{progress}%</span>
            </div>

            <p className="text-[10px] text-slate-500 tracking-wider text-center mt-1">
              Tap anywhere to skip
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashAnimation;
