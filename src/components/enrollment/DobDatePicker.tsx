import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DobDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => CURRENT_YEAR - i); // Last 30 years (e.g. 2026 down to 1996)

export function formatDobInput(raw: string): string {
  // Support pasting ISO YYYY-MM-DD
  const isoMatch = raw.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // Keep only numbers
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDobParts(val: string): { day: number; month: number; year: number } | null {
  const parts = val.split('/');
  if (parts.length === 3 && parts[2].length === 4) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1970 && y <= CURRENT_YEAR) {
      return { day: d, month: m, year: y };
    }
  }
  return null;
}

export default function DobDatePicker({ value, onChange, required }: DobDatePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseDobParts(value);

  const [viewYear, setViewYear] = useState<number>(parsed?.year || 2012);
  const [viewMonth, setViewMonth] = useState<number>(parsed ? parsed.month - 1 : 0);

  // Sync internal view when external value changes
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month - 1);
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDobInput(e.target.value);
    onChange(formatted);
  };

  const handleSelectDay = (day: number) => {
    const dStr = String(day).padStart(2, '0');
    const mStr = String(viewMonth + 1).padStart(2, '0');
    const newDob = `${dStr}/${mStr}/${viewYear}`;
    onChange(newDob);
    setOpen(false);
  };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const isValidDate = Boolean(parsed);

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <Input
          required={required}
          value={value}
          onChange={handleInputChange}
          placeholder="DD / MM / YYYY"
          maxLength={10}
          inputMode="numeric"
          autoComplete="bday"
          className={cn(
            "pr-12 font-mono tracking-wider transition-all duration-300",
            isValidDate && "border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
          )}
        />

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "absolute right-2.5 h-7 w-7 rounded-lg flex items-center justify-center transition-all duration-300",
                "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300",
                "border border-emerald-500/20 hover:border-emerald-500/40 shadow-sm",
                open && "ring-2 ring-emerald-500/50 bg-emerald-500/25"
              )}
              title="Pick date from interactive calendar"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[320px] p-0 rounded-2xl border border-emerald-500/30 bg-slate-950/95 backdrop-blur-2xl text-slate-100 shadow-2xl shadow-emerald-950/60 overflow-hidden"
          >
            {/* Top Glowing Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-b border-emerald-500/20">
              <div className="flex items-center justify-between gap-1 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 tracking-wide uppercase">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
                  <span>Select Date of Birth</span>
                </div>
                {isValidDate && (
                  <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    {value}
                  </span>
                )}
              </div>

              {/* Year and Month Quick Selectors */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {/* Month Picker */}
                <select
                  value={viewMonth}
                  onChange={e => setViewMonth(parseInt(e.target.value, 10))}
                  className="h-8 rounded-lg bg-slate-900 border border-emerald-500/30 px-2 text-xs font-medium text-slate-200 outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx} className="bg-slate-900 text-slate-200">
                      {name}
                    </option>
                  ))}
                </select>

                {/* Year Picker */}
                <select
                  value={viewYear}
                  onChange={e => setViewYear(parseInt(e.target.value, 10))}
                  className="h-8 rounded-lg bg-slate-900 border border-emerald-500/30 px-2 text-xs font-medium text-slate-200 outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer font-mono"
                >
                  {YEARS.map(y => (
                    <option key={y} value={y} className="bg-slate-900 text-slate-200">
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Calendar Controls */}
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={prevMonth}
                className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-bold text-slate-200 tracking-wide">
                {MONTH_NAMES[viewMonth]} <span className="text-emerald-400">{viewYear}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={nextMonth}
                className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Days Grid */}
            <div className="p-3">
              {/* Day of week headers */}
              <div className="grid grid-cols-7 gap-1 text-center mb-1">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                  <span key={d} className={cn("text-[11px] font-semibold", i === 0 ? "text-amber-400/80" : "text-slate-400")}>
                    {d}
                  </span>
                ))}
              </div>

              {/* Day numbers */}
              <div className="grid grid-cols-7 gap-1">
                {/* Empty cells before 1st day of month */}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-8 w-8" />
                ))}

                {/* Days of current month */}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const isSelected = parsed?.day === day && parsed?.month === (viewMonth + 1) && parsed?.year === viewYear;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleSelectDay(day)}
                      className={cn(
                        "h-8 w-8 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center font-mono",
                        isSelected
                          ? "bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 font-bold shadow-md shadow-emerald-500/50 scale-105"
                          : "text-slate-200 hover:bg-emerald-500/20 hover:text-emerald-300 active:scale-95"
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer with Quick decade shortcuts */}
            <div className="px-3 py-2 bg-slate-900/60 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 text-[10px]">Jump to year:</span>
              <div className="flex gap-1">
                {[2016, 2012, 2010, 2008].map(quickYear => (
                  <button
                    key={quickYear}
                    type="button"
                    onClick={() => setViewYear(quickYear)}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                      viewYear === quickYear
                        ? "bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                    )}
                  >
                    '{String(quickYear).slice(2)}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
        <span>Type <strong className="text-slate-300 font-mono">DD/MM/YYYY</strong> or pick from calendar</span>
        {isValidDate && (
          <span className="text-emerald-400 font-medium inline-flex items-center gap-1">
            ✓ Ready
          </span>
        )}
      </p>
    </div>
  );
}
