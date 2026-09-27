import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Trophy, RotateCcw, Shuffle, Users } from 'lucide-react';
import { ClassStudent } from '@/components/teacher/TeacherAdminWorkspace';
import { AndroidWidgetItem } from './types';

const SAMPLE_NAMES = [
  'Aarav Sharma', 'Ananya Verma', 'Diya Patel', 'Ishaan Malhotra', 
  'Kavya Iyer', 'Rohan Gupta', 'Sneha Nair', 'Tanvi Joshi', 
  'Vihaan Reddy', 'Zoya Khan', 'Aditya Sen', 'Priya Deshmukh'
];

interface StudentWheelWidgetProps {
  widget: AndroidWidgetItem;
  students?: ClassStudent[];
}

export const StudentWheelWidget: React.FC<StudentWheelWidgetProps> = ({ students = [] }) => {
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinDeg, setSpinDeg] = useState(0);

  const availableList = students.length > 0 
    ? students.map(s => s.name)
    : SAMPLE_NAMES;

  const handleSpin = () => {
    if (isSpinning) return;
    setIsSpinning(true);
    setSelectedStudent(null);

    // Random rotation between 5 and 10 full turns
    const extraTurns = 1800 + Math.floor(Math.random() * 1800);
    setSpinDeg(prev => prev + extraTurns);

    let counter = 0;
    const interval = setInterval(() => {
      const randomName = availableList[Math.floor(Math.random() * availableList.length)];
      setSelectedStudent(randomName);
      counter++;
      if (counter > 24) {
        clearInterval(interval);
        const winner = availableList[Math.floor(Math.random() * availableList.length)];
        setSelectedStudent(winner);
        setIsSpinning(false);
      }
    }, 70);
  };

  return (
    <div className="h-full flex flex-col justify-between gap-2 select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-wider text-rose-600 dark:text-rose-400">
          <Shuffle className={`w-3.5 h-3.5 ${isSpinning ? 'animate-spin' : ''}`} />
          <span>Lucky Quiz Wheel</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300">
          {availableList.length} Students
        </span>
      </div>

      {/* Wheel & Center Display */}
      <div className="flex items-center justify-center gap-3 my-auto py-1">
        <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0 flex items-center justify-center">
          {/* Animated Wheel Circle */}
          <motion.div
            animate={{ rotate: spinDeg }}
            transition={{ duration: 1.8, ease: "easeOut" }}
            className="w-full h-full rounded-full border-4 border-rose-500/40 bg-gradient-to-tr from-rose-500/20 via-purple-500/20 to-amber-500/20 shadow-lg relative overflow-hidden flex items-center justify-center"
          >
            <div className="absolute inset-0 border-t-2 border-r-2 border-white/20 rotate-45" />
            <div className="absolute inset-0 border-t-2 border-r-2 border-white/20 rotate-90" />
            <div className="w-8 h-8 rounded-full bg-background border-2 border-rose-500/80 shadow-md flex items-center justify-center text-rose-500 font-black text-[10px]">
              ★
            </div>
          </motion.div>
          {/* Arrow Indicator */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[10px] border-t-rose-600 drop-shadow-md z-10" />
        </div>

        {/* Selected Student Card */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Trophy className="w-3 h-3 text-amber-500" />
            <span>Selected Candidate</span>
          </div>
          <div className="p-2 rounded-2xl bg-muted/50 border border-border/80 min-h-[44px] flex items-center justify-center text-center">
            <AnimatePresence mode="wait">
              {selectedStudent ? (
                <motion.div
                  key={selectedStudent}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  className="font-black text-xs sm:text-sm text-foreground truncate"
                >
                  🎉 {selectedStudent}
                </motion.div>
              ) : (
                <span className="text-[11px] text-muted-foreground font-medium italic">
                  Tap Spin to Pick
                </span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Spin Button */}
      <button
        onClick={handleSpin}
        disabled={isSpinning}
        className="w-full py-2 px-3 rounded-2xl bg-gradient-to-r from-rose-600 via-pink-600 to-purple-600 hover:from-rose-500 hover:to-purple-500 active:scale-98 disabled:opacity-50 text-white font-black text-xs shadow-md shadow-rose-500/20 flex items-center justify-center gap-1.5 transition-all"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>{isSpinning ? 'SPINNING WHEEL...' : 'SPIN LUCKY WHEEL'}</span>
      </button>
    </div>
  );
};
