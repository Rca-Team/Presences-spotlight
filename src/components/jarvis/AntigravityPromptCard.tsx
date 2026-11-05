import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  ChevronDown,
  Shield,
  Mic,
  MicOff,
  ArrowRight,
  Folder,
  GitBranch,
  Sparkles,
  FileText,
  Activity,
  Database,
  Camera,
  Check,
  Bot,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface AntigravityPromptCardProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (prompt: string, options?: { model: string; mode: string }) => void;
  isListening?: boolean;
  onToggleMic?: () => void;
  isThinking?: boolean;
  placeholder?: string;
  className?: string;
  showContextPill?: boolean;
  workspaceName?: string;
  branchName?: string;
  onSelectContext?: (item: string) => void;
}

export const AVAILABLE_MODELS = [
  { id: "gemini-3.8-flash-med", label: "Gemini 3.8 Flash Medium", desc: "Default • Fast, intelligent & multimodal" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Complex reasoning & deep audits" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", desc: "Ultra low-latency streaming" },
  { id: "jarvis-neural-edge", label: "J.A.R.V.I.S. Neural Edge", desc: "Local campus edge & biometric engine" },
];

export const EXECUTION_MODES = [
  { id: "turbo", label: "Turbo", icon: Zap, desc: "Rapid autonomous execution" },
  { id: "strict", label: "Strict", icon: Shield, desc: "Prompt review for critical edits" },
  { id: "sandbox", label: "Sandbox", icon: Database, desc: "Simulate queries in safe sandbox" },
];

export const QUICK_MENTIONS = [
  { tag: "@students", desc: "Active student roster & registry profiles", icon: FileText },
  { tag: "@biometrics", desc: "Face descriptors & photo embeddings", icon: Camera },
  { tag: "@gate-cams", desc: "Dual-camera turnstile telemetry", icon: Activity },
  { tag: "@telemetry", desc: "System performance & edge nodes", icon: Database },
];

export const QUICK_SLASH_COMMANDS = [
  { cmd: "/sweep", desc: "Trigger 360-degree diagnostic audit sweep", icon: Sparkles },
  { cmd: "/biometrics", desc: "Audit missing photos and descriptors", icon: Camera },
  { cmd: "/export", desc: "Generate and download CSV report", icon: FileText },
  { cmd: "/status", desc: "Check campus health and turnstile gates", icon: Activity },
];

export const AntigravityPromptCard: React.FC<AntigravityPromptCardProps> = ({
  value,
  onChange,
  onSubmit,
  isListening = false,
  onToggleMic,
  isThinking = false,
  placeholder = "Ask anything, @ to mention, / for actions",
  className = "",
  showContextPill = true,
  workspaceName = "Presences-AI",
  branchName = "main",
  onSelectContext,
}) => {
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0]);
  const [selectedMode, setSelectedMode] = useState(EXECUTION_MODES[0]);

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [contextPillMenuOpen, setContextPillMenuOpen] = useState(false);

  const [mentionSuggestionsOpen, setMentionSuggestionsOpen] = useState(false);
  const [slashSuggestionsOpen, setSlashSuggestionsOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
        setModeDropdownOpen(false);
        setPlusMenuOpen(false);
        setContextPillMenuOpen(false);
        setMentionSuggestionsOpen(false);
        setSlashSuggestionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    // Detect @ mention or / slash trigger
    const words = text.split(/\s+/);
    const lastWord = words[words.length - 1] || "";
    if (lastWord.startsWith("@")) {
      setMentionSuggestionsOpen(true);
      setSlashSuggestionsOpen(false);
    } else if (lastWord.startsWith("/")) {
      setSlashSuggestionsOpen(true);
      setMentionSuggestionsOpen(false);
    } else {
      setMentionSuggestionsOpen(false);
      setSlashSuggestionsOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!value.trim() || isThinking) return;
    onSubmit(value.trim(), {
      model: selectedModel.id,
      mode: selectedMode.id,
    });
    setMentionSuggestionsOpen(false);
    setSlashSuggestionsOpen(false);
  };

  const insertToken = (token: string) => {
    const words = value.split(/\s+/);
    words.pop(); // Remove partial word
    const nextText = words.length > 0 ? `${words.join(" ")} ${token} ` : `${token} `;
    onChange(nextText);
    setMentionSuggestionsOpen(false);
    setSlashSuggestionsOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div ref={cardRef} className={`w-full max-w-4xl mx-auto flex flex-col items-center ${className}`}>
      {/* Context Pill (e.g. 📁 Presences-AI ⌵  |  ⎇ main ⌵) */}
      {showContextPill && (
        <div className="relative mb-2.5 self-start sm:self-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-300 bg-zinc-900/90 border border-zinc-800/90 shadow-sm backdrop-blur-md">
            <button
              type="button"
              onClick={() => setContextPillMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>{workspaceName}</span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>

            <span className="text-zinc-600">|</span>

            <button
              type="button"
              onClick={() => setContextPillMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5 text-zinc-400" />
              <span>{branchName}</span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>
          </div>

          {/* Context Pill Dropdown Menu */}
          <AnimatePresence>
            {contextPillMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 mt-1.5 w-64 rounded-xl border border-zinc-800 bg-[#16161a] p-2 shadow-2xl z-50 text-xs"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Target Workspace & Scope
                </div>
                <div
                  onClick={() => {
                    onSelectContext?.("Presences-AI Smart Campus");
                    setContextPillMenuOpen(false);
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800/70 text-zinc-200 cursor-pointer"
                >
                  <Folder className="w-4 h-4 text-cyan-400" />
                  <div className="flex-1">
                    <div className="font-medium text-zinc-100">Presences-AI Core</div>
                    <div className="text-[10px] text-zinc-500">School Attendance & Biometrics</div>
                  </div>
                  <Check className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div
                  onClick={() => {
                    onSelectContext?.("Gate Kiosks Edge");
                    setContextPillMenuOpen(false);
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800/70 text-zinc-200 cursor-pointer"
                >
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <div className="flex-1">
                    <div className="font-medium text-zinc-100">Gate Turnstiles Edge</div>
                    <div className="text-[10px] text-zinc-500">Raspberry Pi Dual-Cam Stations</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Main Antigravity Floating Prompt Card */}
      <div className="w-full relative rounded-[26px] bg-[#131316] border border-[#27272a] shadow-2xl backdrop-blur-2xl transition-all duration-200 focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700/40 p-3 sm:p-4">
        {/* Autocomplete Popup for @ Mention */}
        <AnimatePresence>
          {mentionSuggestionsOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute -top-44 left-4 right-4 sm:right-auto sm:w-80 rounded-2xl border border-zinc-800 bg-[#16161a]/95 backdrop-blur-xl p-2 shadow-2xl z-50 text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Mention Context Object
              </div>
              {QUICK_MENTIONS.map((item) => (
                <div
                  key={item.tag}
                  onClick={() => insertToken(item.tag)}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-zinc-800/80 text-zinc-200 cursor-pointer transition-colors"
                >
                  <item.icon className="w-3.5 h-3.5 text-cyan-400" />
                  <div className="flex-1">
                    <span className="font-semibold text-zinc-100">{item.tag}</span>
                    <p className="text-[11px] text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Autocomplete Popup for / Slash Commands */}
        <AnimatePresence>
          {slashSuggestionsOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute -top-44 left-4 right-4 sm:right-auto sm:w-80 rounded-2xl border border-zinc-800 bg-[#16161a]/95 backdrop-blur-xl p-2 shadow-2xl z-50 text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Slash Actions
              </div>
              {QUICK_SLASH_COMMANDS.map((item) => (
                <div
                  key={item.cmd}
                  onClick={() => insertToken(item.cmd)}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-zinc-800/80 text-zinc-200 cursor-pointer transition-colors"
                >
                  <item.icon className="w-3.5 h-3.5 text-amber-400" />
                  <div className="flex-1">
                    <span className="font-semibold text-zinc-100">{item.cmd}</span>
                    <p className="text-[11px] text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text Input Area */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 resize-none outline-none border-none focus:ring-0 leading-relaxed max-h-48 py-1 px-1 font-sans"
          />
        </div>

        {/* Bottom Control Bar */}
        <div className="mt-3 pt-2.5 flex items-center justify-between gap-2 border-t border-zinc-800/60 select-none">
          {/* Left Controls: Plus Button & Model Selector Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Plus / Add Context Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlusMenuOpen((prev) => !prev)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 transition-all cursor-pointer"
                title="Add context, files or telemetry"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Plus Menu Popover */}
              <AnimatePresence>
                {plusMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    className="absolute bottom-10 left-0 w-60 rounded-xl border border-zinc-800 bg-[#16161a] p-2 shadow-2xl z-50 text-xs"
                  >
                    <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Attach Context
                    </div>
                    <div
                      onClick={() => {
                        insertToken("@students");
                        setPlusMenuOpen(false);
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Attach Student Registry</span>
                    </div>
                    <div
                      onClick={() => {
                        insertToken("@biometrics");
                        setPlusMenuOpen(false);
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-amber-400" />
                      <span>Attach Facial Biometrics</span>
                    </div>
                    <div
                      onClick={() => {
                        insertToken("@gate-cams");
                        setPlusMenuOpen(false);
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-300 cursor-pointer"
                    >
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Attach Turnstile Telemetry</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Model Selector Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModelDropdownOpen((prev) => !prev);
                  setModeDropdownOpen(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors cursor-pointer"
              >
                <span>{selectedModel.label}</span>
                <ChevronDown className="w-3 h-3 text-zinc-500" />
              </button>

              {/* Model Dropdown Menu */}
              <AnimatePresence>
                {modelDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-11 left-0 w-72 rounded-2xl border border-zinc-800 bg-[#16161a] p-2 shadow-2xl z-50 text-xs"
                  >
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Select Neural Model
                    </div>
                    {AVAILABLE_MODELS.map((model) => (
                      <div
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model);
                          setModelDropdownOpen(false);
                        }}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer transition-colors ${
                          selectedModel.id === model.id
                            ? "bg-zinc-800/90 text-white"
                            : "hover:bg-zinc-800/50 text-zinc-300"
                        }`}
                      >
                        <Bot className="w-4 h-4 mt-0.5 text-cyan-400 shrink-0" />
                        <div className="flex-1">
                          <div className="font-semibold text-zinc-100 flex items-center justify-between">
                            {model.label}
                            {selectedModel.id === model.id && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{model.desc}</p>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Controls: Turbo Mode, Mic, and Coral/Peach Submit Button */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Turbo Mode Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModeDropdownOpen((prev) => !prev);
                  setModelDropdownOpen(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-zinc-400" />
                <span>{selectedMode.label}</span>
                <ChevronDown className="w-3 h-3 text-zinc-500" />
              </button>

              {/* Mode Dropdown Menu */}
              <AnimatePresence>
                {modeDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-11 right-0 w-64 rounded-2xl border border-zinc-800 bg-[#16161a] p-2 shadow-2xl z-50 text-xs"
                  >
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Execution Policy
                    </div>
                    {EXECUTION_MODES.map((mode) => (
                      <div
                        key={mode.id}
                        onClick={() => {
                          setSelectedMode(mode);
                          setModeDropdownOpen(false);
                        }}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer transition-colors ${
                          selectedMode.id === mode.id
                            ? "bg-zinc-800/90 text-white"
                            : "hover:bg-zinc-800/50 text-zinc-300"
                        }`}
                      >
                        <mode.icon className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                        <div className="flex-1">
                          <div className="font-semibold text-zinc-100 flex items-center justify-between">
                            {mode.label}
                            {selectedMode.id === mode.id && <Check className="w-3.5 h-3.5 text-amber-400" />}
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{mode.desc}</p>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Microphone Button */}
            {onToggleMic && (
              <button
                type="button"
                onClick={onToggleMic}
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isListening
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70"
                }`}
                title={isListening ? "Listening... Click to stop" : "Voice dictation"}
              >
                {isListening ? <Mic className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4" />}
              </button>
            )}

            {/* Submit Button (Peach/Orange Circular Button as in Antigravity) */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!value.trim() || isThinking}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold transition-all duration-150 cursor-pointer shadow-lg active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed ${
                value.trim() && !isThinking
                  ? "bg-[#ffab91] hover:bg-[#ff9e7d] text-zinc-950 shadow-orange-500/10"
                  : "bg-zinc-800 text-zinc-500"
              }`}
              title="Submit prompt"
            >
              {isThinking ? (
                <Sparkles className="w-4 h-4 animate-spin text-zinc-950" />
              ) : (
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
