import React, { useState, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles, Check, X, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DobDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  compact?: boolean;
  showHelper?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CURRENT_YEAR = new Date().getFullYear();
// Supported range: from 1970 up to current year
const YEARS = Array.from({ length: CURRENT_YEAR - 1970 + 1 }, (_, i) => CURRENT_YEAR - i);

export function formatDobInput(raw: string): string {
  if (!raw) return '';
  // Support pasting ISO YYYY-MM-DD
  const isoMatch = raw.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // Keep only digits
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDobParts(val: string): { day: number; month: number; year: number } | null {
  if (!val) return null;
  const parts = val.split('/');
  if (parts.length === 3 && parts[2].length === 4) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1970 && y <= CURRENT_YEAR) {
      // Validate days in that specific month and leap year
      const daysInMonth = new Date(y, m, 0).getDate();
      if (d <= daysInMonth) {
        return { day: d, month: m, year: y };
      }
    }
  }
  return null;
}

export function calculateAge(dobStr: string): number | null {
  const parts = parseDobParts(dobStr);
  if (!parts) return null;
  const today = new Date();
  let age = today.getFullYear() - parts.year;
  const m = today.getMonth() + 1 - parts.month;
  if (m < 0 || (m === 0 && today.getDate() < parts.day)) {
    age--;
  }
  return age >= 0 ? age : null;
}

export default function DobDatePicker({
  value,
  onChange,
  required = false,
  className,
  compact = false,
  showHelper = true,
  placeholder = 'DD / MM / YYYY',
  disabled = false,
}: DobDatePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseDobParts(value), [value]);
  const age = useMemo(() => calculateAge(value), [value]);

  const [viewYear, setViewYear] = useState<number>(parsed?.year || 2012);
  const [viewMonth, setViewMonth] = useState<number>(parsed ? parsed.month - 1 : 0);

  // Sync internal view when external value changes
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month - 1);
    }
  }, [parsed]);

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

  const handleClear = () => {
    onChange('');
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
    <div className={cn("relative w-full", className)}>
      <div className="relative flex items-center">
        <Input
          required={required}
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          maxLength={10}
          inputMode="numeric"
          autoComplete="bday"
          disabled={disabled}
          className={cn(
            "pr-14 font-mono tracking-wider transition-all duration-300 rounded-xl bg-slate-950/80 border-white/20 text-white placeholder:text-white/30 text-xs font-semibold focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400",
            compact ? "h-9 text-xs" : "h-11 text-sm",
            isValidDate && "border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)] text-emerald-300"
          )}
        />

        {/* Right Action Icons: Clear & Interactive Calendar Popover */}
        <div className="absolute right-1.5 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="h-6 w-6 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear date"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  "rounded-lg flex items-center justify-center transition-all duration-300 cursor-pointer",
                  compact ? "h-7 w-7" : "h-8 w-8",
                  isValidDate
                    ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                    : "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10",
                  open && "ring-2 ring-emerald-500/50 bg-emerald-500/25 text-emerald-300"
                )}
                title="Pick date from interactive calendar"
              >
                <CalendarIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              </button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[320px] p-0 rounded-2xl border border-emerald-500/30 bg-slate-950/95 backdrop-blur-2xl text-slate-100 shadow-2xl shadow-emerald-950/60 overflow-hidden z-50"
            >
              {/* Top Glowing Header */}
              <div className="px-4 py-3 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-b border-emerald-500/20">
                <div className="flex items-center justify-between gap-1 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 tracking-wide uppercase">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Select Date of Birth</span>
                  </div>
                  {isValidDate && (
                    <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      {age !== null ? `${age} yrs old` : value}
                    </span>
                  )}
                </div>

                {/* Year and Month Quick Selectors */}
                <div className="grid grid-cols-2 gap-2 mt-1">
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

              {/* Month Header Navigation */}
              <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
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
              <div className="p-3 pt-1">
                {/* Day of week headers */}
                <div className="grid grid-cols-7 gap-1 text-center mb-1">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                    <span key={d} className={cn("text-[10px] font-semibold", i === 0 ? "text-amber-400/80" : "text-slate-400")}>
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
                          "h-8 w-8 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center font-mono cursor-pointer",
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
                  {[2018, 2014, 2010, 2006, 2000].map(quickYear => (
                    <button
                      key={quickYear}
                      type="button"
                      onClick={() => setViewYear(quickYear)}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer",
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
      </div>

      {showHelper && (
        <p className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Type <strong className="text-slate-300 font-mono">DD/MM/YYYY</strong> or pick from calendar</span>
          {isValidDate && (
            <span className="text-emerald-400 font-medium inline-flex items-center gap-1">
              <Check className="h-3 w-3" />
              {age !== null ? `${age} yrs` : 'Valid'}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
