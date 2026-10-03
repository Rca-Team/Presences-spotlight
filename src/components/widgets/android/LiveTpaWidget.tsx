import React, { useState, useEffect } from 'react';
import { Clock, GraduationCap, CheckCircle2, XCircle, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ClassStudent } from '@/components/teacher/TeacherAdminWorkspace';
import { AndroidWidgetItem } from './types';

interface LiveTpaWidgetProps {
  widget: AndroidWidgetItem;
  students?: ClassStudent[];
  activeClassName?: string;
}

export const LiveTpaWidget: React.FC<LiveTpaWidgetProps> = ({
  students = [],
  activeClassName = '10-A',
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(24 * 60 + 35); // 24m 35s
  const [currentPeriod] = useState(3);
  const totalPeriod = 45 * 60;

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 45 * 60));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const progressPct = Math.round(((totalPeriod - secondsRemaining) / totalPeriod) * 100);

  const total = students.length;
  const present = students.filter((s) => s.today_status === 'present' || s.today_status === 'late').length;
  const absent = total - present;
  const attendanceRate = total ? Math.round((present / total) * 100) : 0;

  return (
    <div className="h-full flex flex-col justify-between gap-2.5 select-none">
      {/* Header Row */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-black text-foreground">
              Period {currentPeriod} • Class {activeClassName}
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">
              Mathematics & Physics
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 font-mono font-black text-sm bg-muted/70 px-2.5 py-1 rounded-xl border border-border/80 text-foreground">
          <span>{mins.toString().padStart(2, '0')}</span>
          <span className="animate-pulse">:</span>
          <span>{secs.toString().padStart(2, '0')}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
          <span>Period Duration</span>
          <span className="text-blue-600 dark:text-blue-400">{progressPct}% elapsed</span>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Middle Stats Dual Grid */}
      <div className="grid grid-cols-2 gap-2 my-auto">
        {/* Present Box */}
        <div className="p-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Present</span>
            </div>
            <div className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">
              {present} <span className="text-[10px] text-muted-foreground font-normal">/ {total}</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
              {attendanceRate}%
            </span>
          </div>
        </div>

        {/* Absent Box */}
        <div className="p-2 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              <span>Absent</span>
            </div>
            <div className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400">
              {absent}
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
              {absent > 0 ? 'Alert sent' : '100% Full'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Launch Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11px] font-bold">
        <Link
          to="/attendance"
          className="text-primary hover:underline flex items-center gap-1"
        >
          <span>Open Scanner</span>
          <ArrowUpRight className="w-3 h-3" />
        </Link>
        <Link
          to="/teacher"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Teacher Desk</span>
        </Link>
      </div>
    </div>
  );
};
