import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCw, Quote, Share2, Check } from 'lucide-react';
import { AndroidWidgetItem } from './types';

const QUOTES_COLLECTION = [
  { text: "Education is not the learning of facts, but the training of the mind to think.", author: "Albert Einstein", role: "Theoretical Physicist" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King", role: "Legendary Musician" },
  { text: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Mahatma Gandhi", role: "Father of the Nation" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier", role: "Author" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela", role: "Leader & Visionary" },
  { text: "Intelligence plus character—that is the goal of true education.", author: "Dr. Martin Luther King Jr.", role: "Civil Rights Leader" },
  { text: "Tell me and I forget. Teach me and I remember. Involve me and I learn.", author: "Benjamin Franklin", role: "Founding Polymath" },
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", author: "Plutarch", role: "Philosopher" },
];

interface DailyQuoteWidgetProps {
  widget: AndroidWidgetItem;
}

export const DailyQuoteWidget: React.FC<DailyQuoteWidgetProps> = () => {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUOTES_COLLECTION.length));
  const [copied, setCopied] = useState(false);

  const quote = QUOTES_COLLECTION[index];

  const handleNext = () => {
    setIndex((prev) => (prev + 1) % QUOTES_COLLECTION.length);
  };

  const handleCopyQuote = async () => {
    try {
      await navigator.clipboard.writeText(`"${quote.text}" — ${quote.author}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="h-full flex flex-col justify-between select-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Quote className="w-3.5 h-3.5 fill-amber-500/20" />
          <span>Wisdom & Quote</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyQuote}
            className="p-1 rounded-lg hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all"
            title="Copy Quote"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Share2 className="w-3 h-3" />}
          </button>
          <button
            onClick={handleNext}
            className="p-1 rounded-lg hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all active:rotate-180"
            title="Next Quote"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Quote Body with Animated Transitions */}
      <div className="my-auto py-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-1.5"
          >
            <p className="text-xs sm:text-sm font-serif italic text-foreground leading-snug line-clamp-3">
              "{quote.text}"
            </p>
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              <span>— {quote.author}</span>
              <span className="text-[10px] text-muted-foreground font-normal">({quote.role})</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Pill */}
      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
        <span className="flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-amber-500" />
          <span>Daily Thought</span>
        </span>
        <span>#{index + 1} of {QUOTES_COLLECTION.length}</span>
      </div>
    </div>
  );
};
