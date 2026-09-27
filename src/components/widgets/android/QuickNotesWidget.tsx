import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StickyNote, Plus, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { AndroidWidgetItem } from './types';

interface NoteItem {
  id: string;
  text: string;
  completed: boolean;
  color: string;
}

const NOTE_COLORS = [
  '#FEF08A', // Yellow
  '#BBF7D0', // Green
  '#BAE6FD', // Sky
  '#FBCFE8', // Pink
  '#FED7AA', // Orange
];

const DEFAULT_NOTES: NoteItem[] = [
  { id: '1', text: 'Target: Complete Chapter 4 viva', completed: false, color: '#FEF08A' },
  { id: '2', text: 'Collect homework journals before lunch', completed: true, color: '#BBF7D0' },
  { id: '3', text: 'Period 5: Lab experiment session', completed: false, color: '#BAE6FD' },
];

const STORAGE_KEY = 'presence:widget_quick_notes';

interface QuickNotesWidgetProps {
  widget: AndroidWidgetItem;
}

export const QuickNotesWidget: React.FC<QuickNotesWidgetProps> = () => {
  const [notes, setNotes] = useState<NoteItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_NOTES;
  });

  const [inputVal, setInputVal] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {}
  }, [notes]);

  const handleAddNote = () => {
    if (!inputVal.trim()) return;
    const newNote: NoteItem = {
      id: Date.now().toString(),
      text: inputVal.trim(),
      completed: false,
      color: NOTE_COLORS[notes.length % NOTE_COLORS.length],
    };
    setNotes((prev) => [newNote, ...prev]);
    setInputVal('');
  };

  const handleToggle = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, completed: !n.completed } : n))
    );
  };

  const handleDelete = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="h-full flex flex-col justify-between gap-2 select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <StickyNote className="w-3.5 h-3.5" />
          <span>Sticky Notes & Goals</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
          {notes.filter((n) => !n.completed).length} pending
        </span>
      </div>

      {/* Notes List Scrollable */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-36 no-scrollbar">
        <AnimatePresence>
          {notes.map((note) => (
            <motion.div
              key={note.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center justify-between gap-2 p-1.5 rounded-xl border border-black/10 dark:border-white/10 shadow-xs group"
              style={{ backgroundColor: note.color }}
            >
              <button
                onClick={() => handleToggle(note.id)}
                className="text-slate-800 hover:text-black shrink-0 transition"
              >
                {note.completed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                ) : (
                  <Circle className="w-3.5 h-3.5 opacity-60" />
                )}
              </button>
              <span
                onClick={() => handleToggle(note.id)}
                className={`flex-1 text-[11px] font-semibold text-slate-900 cursor-pointer line-clamp-2 leading-tight ${
                  note.completed ? 'line-through opacity-50' : ''
                }`}
              >
                {note.text}
              </span>
              <button
                onClick={() => handleDelete(note.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-700 hover:text-rose-700 transition shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {notes.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground font-medium">
            No notes. Add a reminder below!
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
        <input
          type="text"
          placeholder="New task or reminder..."
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
          className="flex-1 bg-muted/50 border border-border/80 rounded-xl px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-amber-500"
        />
        <button
          onClick={handleAddNote}
          className="p-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold shadow-xs transition"
          title="Add Note"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
