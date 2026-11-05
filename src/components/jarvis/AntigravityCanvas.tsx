import React from "react";
import { motion } from "framer-motion";
import { AntigravityPromptCard } from "./AntigravityPromptCard";
import { Sparkles, Terminal, Activity, Camera, Users, ShieldAlert, Cpu } from "lucide-react";

export interface AntigravityCanvasProps {
  userName?: string;
  chatInput: string;
  onChatInputChange: (val: string) => void;
  onSendPrompt: (prompt: string, options?: { model: string; mode: string }) => void;
  isListening?: boolean;
  onToggleMic?: () => void;
  isThinking?: boolean;
  onQuickAction?: (actionPrompt: string) => void;
  onToggleViewMode?: () => void;
  viewModeLabel?: string;
}

export const AntigravityCanvas: React.FC<AntigravityCanvasProps> = ({
  userName = "RCA",
  chatInput,
  onChatInputChange,
  onSendPrompt,
  isListening = false,
  onToggleMic,
  isThinking = false,
  onQuickAction,
  onToggleViewMode,
  viewModeLabel = "Switch to Arc Reactor HUD",
}) => {
  const suggestionPills = [
    { label: "Run full diagnostic sweep", icon: Sparkles, prompt: "/sweep" },
    { label: "Check missing biometrics", icon: Camera, prompt: "/biometrics" },
    { label: "Turnstile gate telemetry", icon: Activity, prompt: "/status" },
    { label: "Missing parent contacts", icon: Users, prompt: "Show students with missing parent phone numbers" },
  ];

  return (
    <div className="relative min-h-[620px] flex flex-col justify-between items-center px-4 py-8 rounded-3xl border border-zinc-800/80 bg-[#0e0e11] overflow-hidden shadow-2xl">
      {/* Background ambient radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[340px] bg-gradient-to-b from-zinc-800/15 via-zinc-900/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Top right utility bar (like "Open IDE" in screenshot) */}
      <div className="w-full flex items-center justify-between text-xs text-zinc-400 z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[11px] tracking-wider uppercase text-zinc-500">
            Antigravity Engine Active
          </span>
        </div>

        {onToggleViewMode && (
          <button
            type="button"
            onClick={onToggleViewMode}
            className="px-3 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-all cursor-pointer font-medium"
          >
            {viewModeLabel}
          </button>
        )}
      </div>

      {/* Center Greeting & Antigravity Logo Watermark */}
      <div className="my-auto flex flex-col items-center text-center z-10 max-w-xl">
        {/* Antigravity Arch / Chevron Logo Mark */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <svg
            className="w-12 h-12 text-zinc-600/70 mx-auto"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Minimalist Antigravity glyph (curved arch apex) */}
            <path d="M4 19 C8 8, 11 4, 12 4 C13 4, 16 8, 20 19" />
            <path d="M8 15 C10 13, 14 13, 16 15" />
          </svg>
        </motion.div>

        {/* Greeting Heading (Matching: "Hi RCA, what can we get done today?") */}
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="text-2xl sm:text-3xl md:text-4xl font-normal text-zinc-100 tracking-tight"
        >
          Hi {userName}, what can we get done today?
        </motion.h1>

        <p className="text-sm text-zinc-500 mt-2 max-w-md">
          Query biometric readiness, orchestrate turnstiles, or ask Gemini to audit campus databases.
        </p>

        {/* Quick Suggestion Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          {suggestionPills.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                if (onQuickAction) {
                  onQuickAction(pill.prompt);
                } else {
                  onChatInputChange(pill.prompt);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-300 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer shadow-sm"
            >
              <pill.icon className="w-3.5 h-3.5 text-zinc-400" />
              <span>{pill.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Floating Prompt Card Docked at Bottom */}
      <div className="w-full z-10 pt-6">
        <AntigravityPromptCard
          value={chatInput}
          onChange={onChatInputChange}
          onSubmit={onSendPrompt}
          isListening={isListening}
          onToggleMic={onToggleMic}
          isThinking={isThinking}
          showContextPill={true}
          workspaceName="Presences-AI"
          branchName="main"
          onSelectContext={(ctx) => onChatInputChange(`Scope set to ${ctx}: `)}
        />
      </div>
    </div>
  );
};
