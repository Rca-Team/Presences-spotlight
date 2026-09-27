import React, { useState } from 'react';
import { Bell, Volume2, Sparkles, Check, Siren } from 'lucide-react';
import { AndroidWidgetItem } from './types';

interface SoundboardBellWidgetProps {
  widget: AndroidWidgetItem;
}

export const SoundboardBellWidget: React.FC<SoundboardBellWidgetProps> = () => {
  const [activeSound, setActiveSound] = useState<string | null>(null);

  const playSynthesizedChime = (type: 'bell' | 'assembly' | 'quiz' | 'silence') => {
    setActiveSound(type);
    setTimeout(() => setActiveSound(null), 1200);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === 'bell') {
        // Deep School Period Gong
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(261.63, ctx.currentTime + 1.2); // C4
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
      } else if (type === 'assembly') {
        // Double pulse assembly siren
        [0, 0.2, 0.4].forEach((delay, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(idx % 2 === 0 ? 880 : 660, ctx.currentTime + delay);
          gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.18);
        });
      } else if (type === 'quiz') {
        // Ascending correct arpeggio
        [440, 554.37, 659.25, 880].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
          gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.1);
          osc.stop(ctx.currentTime + idx * 0.1 + 0.25);
        });
      } else if (type === 'silence') {
        // High soft crystal chime
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1318.51, ctx.currentTime); // E6
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
      }
    } catch (e) {
      console.warn('Audio synthesis unavailable', e);
    }
  };

  const SOUND_BUTTONS = [
    { id: 'bell', label: 'School Bell', desc: 'Period Gong', icon: Bell, color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    { id: 'silence', label: 'Quiet Chime', desc: 'Attention', icon: Volume2, color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
    { id: 'quiz', label: 'Correct Tone', desc: 'Quiz Win', icon: Sparkles, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
    { id: 'assembly', label: 'Assembly Siren', desc: 'Notice Call', icon: Siren, color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
  ];

  return (
    <div className="h-full flex flex-col justify-between gap-2 select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Bell className="w-3.5 h-3.5" />
          <span>School Soundboard & Bell</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
          Synthesized Audio
        </span>
      </div>

      {/* 2x2 Sound Action Grid */}
      <div className="grid grid-cols-2 gap-2 my-auto">
        {SOUND_BUTTONS.map((btn) => {
          const Icon = btn.icon;
          const isPlaying = activeSound === btn.id;

          return (
            <button
              key={btn.id}
              onClick={() => playSynthesizedChime(btn.id as any)}
              className={`p-2.5 rounded-2xl border text-left transition-all active:scale-95 flex items-center gap-2.5 ${btn.color} ${
                isPlaying ? 'ring-2 ring-amber-400 shadow-md scale-98' : 'hover:opacity-90'
              }`}
            >
              <div className="p-2 rounded-xl bg-background/80 shadow-xs shrink-0">
                <Icon className={`w-4 h-4 ${isPlaying ? 'animate-bounce' : ''}`} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">{btn.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{btn.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-[10px] text-center text-muted-foreground font-medium border-t border-border/40 pt-1.5">
        Tap any tile to broadcast tone through classroom speaker
      </div>
    </div>
  );
};
