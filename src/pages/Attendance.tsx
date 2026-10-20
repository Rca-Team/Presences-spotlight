import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import PageLayout from '@/components/layouts/PageLayout';
import PageTransition from '@/components/PageTransition';
import AttendanceInstructions from '@/components/attendance/AttendanceInstructions';
import AttendanceStats from '@/components/attendance/AttendanceStats';
import FuturisticFaceScanner from '@/components/attendance/FuturisticFaceScanner';
import QRCodeScanner from '@/components/attendance/QRCodeScanner';
import LiveAttendanceFeed from '@/components/attendance/LiveAttendanceFeed';
import {
  BarChart3,
  Info,
  Scan,
  Sparkles,
  Zap,
  Activity,
  QrCode,
  Users,
  CheckCircle2,
  Clock,
  ShieldCheck,
  TrendingUp,
  Maximize2,
  Minimize2,
  Radio,
  Cpu,
  Wifi,
  ChevronRight,
  Flame,
  Volume2,
  VolumeX,
  Vibrate,
  VibrateOff,
  Sun,
  SunDim,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { useLiteFeedback } from '@/hooks/useLiteFeedback';
import { LiteFlashOverlay } from '@/components/attendance/LiteFeedbackControls';
import LiteModeToggle from '@/components/LiteModeToggle';
import { useToast } from '@/hooks/use-toast';
import { fetchUnifiedAttendanceStats, type UnifiedAttendanceStats } from '@/utils/attendanceStatsHelper';
import { supabase } from '@/integrations/supabase/client';
import { getCutoffTime } from '@/services/attendance/AttendanceSettingsService';
import { cn } from '@/lib/utils';



// Live Digital Apple Clock
const AppleLiveClock: React.FC = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const timeStrShort = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-2 text-xs sm:text-sm font-medium tracking-tight text-slate-800 dark:text-slate-200">
      <div className="flex items-center gap-1.5 font-mono font-semibold tracking-normal text-slate-900 dark:text-white">
        <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span className="hidden sm:inline">{timeStr}</span>
        <span className="sm:hidden">{timeStrShort}</span>
      </div>
      <span className="text-slate-300 dark:text-slate-700 hidden md:inline">•</span>
      <span className="text-slate-500 dark:text-slate-400 text-xs hidden md:inline">{dateStr}</span>
    </div>
  );
};

const Attendance: React.FC = () => {
  const [searchParams] = useSearchParams();
  const classParam = searchParams.get('class');
  const sectionParam = searchParams.get('section');
  const scopedCategory = classParam && sectionParam ? `${classParam}-${sectionParam.toUpperCase()}` : null;

  const { toast } = useToast();
  const isMobile = useIsMobile();
  const prefersReducedMotion = useReducedMotion();
  const { liteMode, signals, preference, setPreference } = usePerformanceMode();
  const { prefs: feedbackPrefs, toggle: toggleFeedback, flashKind, signal } = useLiteFeedback();
  const minimizeMotion = isMobile || prefersReducedMotion || liteMode;

  const [activeTab, setActiveTab] = useState<'kiosk' | 'qr' | 'analytics' | 'help'>('kiosk');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isKioskFocus, setIsKioskFocus] = useState(false);
  const [activeCutoffTime, setActiveCutoffTime] = useState<string>('08:00');

  const format12Hour = (time24: string) => {
    if (!time24) return '8:00 AM';
    const [hStr, mStr] = time24.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (isNaN(h)) return '8:00 AM';
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const minuteStr = m < 10 ? `0${m}` : `${m}`;
    return `${hour12}:${minuteStr} ${period}`;
  };

  useEffect(() => {
    let isMounted = true;
    getCutoffTime().then(time => {
      if (isMounted && time) setActiveCutoffTime(time);
    });

    const handleCutoffChange = (e: Event) => {
      const custom = e as CustomEvent<{ time?: string }>;
      if (custom.detail?.time) {
        setActiveCutoffTime(custom.detail.time);
      }
    };

    window.addEventListener('presence:cutoff-time-changed', handleCutoffChange);
    return () => {
      isMounted = false;
      window.removeEventListener('presence:cutoff-time-changed', handleCutoffChange);
    };
  }, []);

  // Live Synchronized Attendance Stats
  const [stats, setStats] = useState<UnifiedAttendanceStats>({
    totalRegistered: 0,
    presentToday: 0,
    lateToday: 0,
    absentToday: 0,
    attendanceRate: 0,
  });

  const refreshStats = async () => {
    try {
      const data = await fetchUnifiedAttendanceStats();
      setStats(data);
    } catch (e) {
      console.warn('Stats refresh error:', e);
    }
  };

  const refreshTimerRef = useRef<number | null>(null);
  const debouncedRefreshStats = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refreshStats();
    }, 300);
  }, []);

  useEffect(() => {
    refreshStats();
    const timer = window.setTimeout(() => setIsInitialLoading(false), 200);

    const handleLocalMarked = () => {
      refreshStats();
    };
    window.addEventListener('presence:attendance-marked', handleLocalMarked);

    const channel = supabase
      .channel('attendance-page-live-metrics')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, () => {
        debouncedRefreshStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_entries' }, () => {
        debouncedRefreshStats();
      })
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('presence:attendance-marked', handleLocalMarked);
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [debouncedRefreshStats]);

  const isQRKioskMode = searchParams.get('mode') === 'qr' && searchParams.get('autostart') === '1';

  useEffect(() => {
    if (isQRKioskMode) {
      setActiveTab('qr');
    }
  }, [isQRKioskMode]);

  // Dock Navigation Items
  const tabs = [
    { id: 'kiosk', label: 'Face Scan', shortLabel: 'Face', badge: null, icon: Scan },
    { id: 'qr', label: 'QR Pass', shortLabel: 'QR', badge: null, icon: QrCode },
    { id: 'analytics', label: 'Statistics', shortLabel: 'Stats', badge: null, icon: BarChart3 },
    { id: 'help', label: 'Guide', shortLabel: 'Help', badge: null, icon: Info },
  ];

  // ---------------------------------------------------------------------------
  // UNIFIED INTERFACE (Zero Lag in Fast Mode)
  // ---------------------------------------------------------------------------
  return (
    <PageTransition>
      <PageLayout className="min-h-screen bg-slate-50/60 dark:bg-slate-950 pb-16 selection:bg-blue-500/20">
        {/* Visual Flash feedback overlay */}
        <LiteFlashOverlay kind={flashKind} />

        {/* Multi-Chromic Ambient Light Backing */}
        <div 
          className="fixed inset-0 pointer-events-none -z-10 opacity-60 dark:opacity-25"
          style={{
            background: 'radial-gradient(ellipse 60% 40% at 80% 0%, rgba(59, 130, 246, 0.18) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 10% 40%, rgba(168, 85, 247, 0.12) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 70% 90%, rgba(16, 185, 129, 0.10) 0%, transparent 70%)',
          }}
        />

        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
          {/* 1. Clean Minimal Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  PM Shri KV NFC Vigyan Vihar
                </span>
                {scopedCategory && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                    <Users className="w-3 h-3" />
                    Class {scopedCategory}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Cutoff {format12Hour(activeCutoffTime)}
                </span>
                <div className="hidden sm:inline-block pl-1">
                  <AppleLiveClock />
                </div>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Daily Attendance
              </h1>
            </div>

            {/* Right Controls: Unified, uncluttered toolbar */}
            <div className="flex items-center gap-2 self-start sm:self-center">
              <button
                type="button"
                onClick={() => toggleFeedback('sound')}
                title={feedbackPrefs.sound ? 'Mute Arrival Sound' : 'Enable Arrival Sound'}
                className={`p-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  feedbackPrefs.sound
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/60 shadow-xs'
                    : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-white/10 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                {feedbackPrefs.sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="text-xs font-medium hidden md:inline">{feedbackPrefs.sound ? 'Sound' : 'Muted'}</span>
              </button>

              <LiteModeToggle variant="segmented" />

              <button
                type="button"
                onClick={() => setIsKioskFocus(!isKioskFocus)}
                title={isKioskFocus ? 'Exit Full Screen' : 'Open Full Screen Camera'}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer shrink-0 min-h-[38px] ${
                  isKioskFocus
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                {isKioskFocus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span className="hidden sm:inline">{isKioskFocus ? 'Exit' : 'Full Screen'}</span>
              </button>
            </div>
          </div>

          {/* 2. The 4 Clean Metric Cards (Fluid Bento Grid, Cohesive Glass Surface) */}
          {!isKioskFocus && (
            <div className="bento-grid-fluid">
              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-white/20 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">ENROLLED</span>
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-mono mt-2">
                  {stats.totalRegistered}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span>Enrolled face biometrics</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-white/20 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">PRESENT</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono mt-2">
                  {stats.presentToday}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>Before {format12Hour(activeCutoffTime)}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-white/20 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">LATE</span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-amber-600 dark:text-amber-400 font-mono mt-2">
                  {stats.lateToday}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>After {format12Hour(activeCutoffTime)}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-white/20 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">TURNOUT</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 dark:text-blue-400 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-blue-600 dark:text-blue-400 font-mono mt-2">
                  {stats.attendanceRate}%
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span>Daily turnout</span>
                </div>
              </div>
            </div>
          )}

          {/* 4. Snappy Segmented Method Switcher (Royal Neon Dock) */}
          <div className="royal-neon-dock grid grid-cols-2 md:grid-cols-4 gap-1 p-1.5 rounded-2xl shadow-xl">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`relative flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold min-h-[42px] transition-colors duration-200 cursor-pointer select-none ${
                    isActive
                      ? 'text-slate-900 dark:text-white font-bold'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="attendance-method-pill"
                      className="royal-neon-active-pill absolute inset-0 rounded-xl shadow-md"
                      transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.6 }}
                    />
                  )}
                  <tab.icon className={`relative z-10 w-4 h-4 shrink-0 ${isActive ? 'text-slate-900 dark:text-white' : 'text-primary'}`} />
                  <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                  <span className="relative z-10 sm:hidden">{tab.shortLabel}</span>
                  {tab.badge && (
                    <span className={`relative z-10 text-[9px] uppercase px-1.5 py-0.5 rounded-full font-extrabold hidden lg:inline ${
                      isActive 
                        ? 'bg-white/20 text-white' 
                        : 'bg-white/10 text-slate-300'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 4. Main Workstation Bento Stage */}
          <main className="relative">
            <div>
              {/* TAB 1: Hands-free Face Recognition Kiosk */}
              {activeTab === 'kiosk' && (
                <motion.div
                  key="kiosk"
                  initial={{ opacity: 0.88, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                  style={{ transform: 'translateZ(0)', willChange: 'transform, opacity' }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                    {/* Left 2/3: Nano-Glass Camera Stage Housing */}
                    <div className="lg:col-span-2 nano-glass rounded-2xl sm:rounded-[32px] p-2.5 sm:p-5 shadow-2xl border border-white/70 dark:border-white/10 overflow-hidden">
                      <FuturisticFaceScanner
                        onAttendanceMarked={(rec) => {
                          signal(rec.status === 'late' ? 'warn' : 'ok');
                          debouncedRefreshStats();
                        }}
                      />
                    </div>

                    {/* Right 1/3: iOS 18 Dynamic Island Live Activity Feed */}
                    <div className="nano-glass rounded-2xl sm:rounded-[32px] p-3 sm:p-4 shadow-2xl border border-white/70 dark:border-white/10 sticky top-4 hardware-layer">
                      <LiveAttendanceFeed scopedCategory={scopedCategory} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 2: Digital QR Pass Scanner */}
              {activeTab === 'qr' && (
                <motion.div
                  key="qr"
                  initial={{ opacity: 0.88, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                  style={{ transform: 'translateZ(0)', willChange: 'transform, opacity' }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                    <div className="lg:col-span-2 nano-glass rounded-2xl sm:rounded-[32px] p-3 sm:p-7 shadow-2xl border border-white/70 dark:border-white/10">
                      <QRCodeScanner autoStart={true} hideManualControls={isQRKioskMode} />
                    </div>
                    <div className="nano-glass rounded-2xl sm:rounded-[32px] p-3 sm:p-4 shadow-2xl border border-white/70 dark:border-white/10 hardware-layer">
                      <LiveAttendanceFeed scopedCategory={scopedCategory} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 3: Full Analytics & Reporting */}
              {activeTab === 'analytics' && (
                <motion.div
                  key="analytics"
                  initial={{ opacity: 0.88, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                  style={{ transform: 'translateZ(0)', willChange: 'transform, opacity' }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                    <div className="lg:col-span-2 nano-glass rounded-2xl sm:rounded-[32px] p-3.5 sm:p-7 shadow-2xl border border-white/70 dark:border-white/10">
                      <AttendanceStats />
                    </div>
                    <div className="nano-glass rounded-2xl sm:rounded-[32px] p-3 sm:p-4 shadow-2xl border border-white/70 dark:border-white/10 hardware-layer">
                      <LiveAttendanceFeed scopedCategory={scopedCategory} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 4: Operational Kiosk Guide */}
              {activeTab === 'help' && (
                <motion.div
                  key="help"
                  initial={{ opacity: 0.88, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                  style={{ transform: 'translateZ(0)', willChange: 'transform, opacity' }}
                  className="max-w-3xl mx-auto"
                >
                  <div className="nano-glass rounded-2xl sm:rounded-[32px] p-4 sm:p-8 shadow-2xl border border-white/70 dark:border-white/10">
                    <AttendanceInstructions />
                  </div>
                </motion.div>
              )}
            </div>
          </main>
        </div>
      </PageLayout>
    </PageTransition>
  );
};

export default Attendance;
