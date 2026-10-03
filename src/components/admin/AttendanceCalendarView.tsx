import React from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format, isSameMonth } from 'date-fns';

interface AttendanceRecord {
  name?: string;
  timestamp: string;
  status: string;
  source?: string;
  capture_mode?: string;
  period_key?: string;
  class_name?: string;
  section?: string;
  subject?: string;
}

interface AttendanceCalendarViewProps {
  selectedDate: Date | undefined;
  setSelectedDate: (date: Date | undefined) => void;
  visibleMonth: Date;
  setVisibleMonth: (date: Date) => void;
  attendanceDays: Date[];
  lateAttendanceDays: Date[];
  absentDays: Date[];
  attendanceRecords?: Record<string, AttendanceRecord[]>;
}

const AttendanceCalendarView: React.FC<AttendanceCalendarViewProps> = ({
  selectedDate,
  setSelectedDate,
  visibleMonth,
  setVisibleMonth,
  attendanceDays,
  lateAttendanceDays,
  absentDays,
  attendanceRecords = {}
}) => {
  const today = new Date();

  // Filter counts for visible month so legend accurately reflects the displayed calendar month
  const monthPresentCount = attendanceDays.filter(d => isSameMonth(new Date(d), visibleMonth)).length;
  const monthLateCount = lateAttendanceDays.filter(d => isSameMonth(new Date(d), visibleMonth)).length;
  const monthAbsentCount = absentDays.filter(d => isSameMonth(new Date(d), visibleMonth)).length;
  const markedDaysCount = monthPresentCount + monthLateCount + monthAbsentCount;

  const isCurrentMonth = isSameMonth(visibleMonth, today);

  const goToCurrentMonth = () => {
    setVisibleMonth(new Date());
    setSelectedDate(new Date());
  };
  
  return (
    <Card className="overflow-hidden h-full min-w-0 border border-border/70 shadow-sm bg-card">
      <CardContent className="p-0">
        <div className="border-b px-3 sm:px-4 pt-3 pb-2.5 bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 sm:gap-x-4">
            <LegendItem color="bg-emerald-500" label="Present" count={monthPresentCount} />
            <LegendItem color="bg-amber-500" label="Late" count={monthLateCount} />
            <LegendItem color="bg-rose-500" label="Absent" count={monthAbsentCount} />
          </div>
          <div className="flex items-center gap-2">
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={goToCurrentMonth}
                className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Today
              </button>
            )}
            <span className="text-[10px] sm:text-xs text-muted-foreground font-medium">
              {markedDaysCount} days marked ({format(visibleMonth, 'MMM yyyy')})
            </span>
          </div>
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={setSelectedDate}
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          className={cn("p-2 sm:p-3 pointer-events-auto w-full")}
          modifiers={{
            present: attendanceDays || [],
            late: lateAttendanceDays || [],
            absent: absentDays || [],
            today: [today]
          }}
          modifiersClassNames={{
            present: "font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 relative after:content-[''] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-1 after:w-1.5 after:h-1.5 after:rounded-full after:bg-emerald-500",
            late: "font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 relative after:content-[''] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-1 after:w-1.5 after:h-1.5 after:rounded-full after:bg-amber-500",
            absent: "font-medium text-rose-700 dark:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 relative after:content-[''] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-1 after:w-1.5 after:h-1.5 after:rounded-full after:bg-rose-500",
            today: "ring-2 ring-primary ring-offset-1 font-extrabold"
          }}
          classNames={{
            months: "w-full",
            month: "w-full space-y-3",
            caption_label: "text-sm sm:text-base font-bold tracking-tight text-foreground",
            nav_button: "h-8 w-8 sm:h-9 sm:w-9 bg-background/80 hover:bg-accent rounded-xl border border-border/60 transition-colors",
            table: "w-full border-separate border-spacing-y-1",
            head_row: "grid grid-cols-7",
            row: "grid grid-cols-7 mt-0.5",
            head_cell: "text-muted-foreground text-xs font-semibold text-center py-1",
            cell: "text-center p-0.5 relative",
            day: "relative h-9 sm:h-10 w-full rounded-xl transition-all duration-150 hover:bg-accent font-medium text-xs sm:text-sm flex items-center justify-center",
            day_selected: "bg-primary text-primary-foreground font-black shadow-md hover:bg-primary/95 !opacity-100",
            day_today: "font-black ring-2 ring-primary ring-offset-1",
          }}
        />
      </CardContent>
    </Card>
  );
};

const LegendItem: React.FC<{ color: string; label: string; count: number }> = ({ color, label, count }) => (
  <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
    <span className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", color)} />
    <span className="text-[10px] sm:text-[11px] text-muted-foreground">{label}</span>
    <span className="text-[10px] sm:text-[11px] font-bold tabular-nums">{count}</span>
  </div>
);

export default AttendanceCalendarView;
