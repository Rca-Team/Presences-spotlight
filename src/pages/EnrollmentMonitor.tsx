import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  RefreshCw,
  Download,
  Upload,
  Copy,
  Search,
  ScanFace,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Users,
  FileEdit,
  Loader2,
  Activity,
  Image as ImageIcon,
  PhoneOff,
  CheckCircle2,
  Glasses,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Sparkles,
  SlidersHorizontal,
  Check,
  Eye,
  Camera,
  Layers,
  Flame,
  Filter as FilterIcon,
  X,
  Phone,
  UserCheck,
  ArrowUp,
  Share2,
  MessageSquare,
  LockKeyhole,
  Building2,
  RotateCcw,
  Trash2,
  MoreHorizontal,
  UserMinus,
} from 'lucide-react';
import PageTransition from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { universalDeleteStudent, universalDeleteStudentsBatch } from '@/services/student/studentDeletionService';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import { fieldLabels, type StudentDetails, type EnrollmentSession } from '@/services/enrollment/types';
import {
  fetchMonitor,
  fetchMonitorPhoto,
  getCachedMonitorOverview,
  removeStudentFromMonitorCache,
  reviewCorrection,
  statusMeta,
  eventLabels,
  methodLabels,
  REQUIRED_POSES,
  type MonitorOverview,
  type MonitorStudent,
  type MonitorStatus,
  type MonitorCorrection,
} from '@/services/enrollment/monitor';
import { ClassPDFIDCardImporter, type ExtractedStudentCard } from '@/components/register/ClassPDFIDCardImporter';
import { supabase } from '@/integrations/supabase/client';
import { enrollmentApi } from '@/services/enrollment/api';
import '@/components/enrollment/enrollment.css';

const StudentStoredFaceAssets = lazy(() => import('@/components/enrollment/StudentStoredFaceAssets'));

type Filter = 'all' | 'not_started' | 'in_progress' | 'failed' | 'completed' | 'attention';

const FILTERS: { id: Filter; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All Students', icon: Users },
  { id: 'completed', label: '3D Enrolled', icon: ShieldCheck },
  { id: 'in_progress', label: 'In Progress', icon: Clock },
  { id: 'attention', label: 'Needs Attention', icon: AlertCircle },
  { id: 'not_started', label: 'Not Started', icon: Sparkles },
  { id: 'failed', label: 'Failed Attempts', icon: ShieldAlert },
];

const PAGE = 80;
const ago = (t: number) => (t ? formatDistanceToNow(t, { addSuffix: true }) : '—');
const needsAttention = (s: MonitorStudent) => Boolean(s.correction) || !s.hasPhone || s.failures > 0;
export const isStudentEnrolled = (s: MonitorStudent) => s.status === 'completed' || s.faceOnFile || s.samples.length > 0;
const matchesFilter = (s: MonitorStudent, f: Filter) =>
  f === 'all'
    ? true
    : f === 'completed'
    ? isStudentEnrolled(s)
    : f === 'in_progress'
    ? (s.status === 'verified' || s.status === 'capturing') && !isStudentEnrolled(s)
    : f === 'not_started'
    ? s.status === 'not_started' && !isStudentEnrolled(s)
    : f === 'attention'
    ? needsAttention(s)
    : s.status === f;

// Enhanced Modern Status Badge
function ModernStatusBadge({ student, className }: { student: MonitorStudent; className?: string }) {
  const isEnrolled = isStudentEnrolled(student);
  const m = isEnrolled ? statusMeta['completed'] : statusMeta[student.status] || statusMeta['not_started'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-tight shadow-sm select-none transition-all shrink-0',
        m.tone,
        className
      )}
    >
      <span className={cn('h-2 w-2 rounded-full animate-pulse', m.dot)} />
      {m.label}
    </span>
  );
}

// Glowing Stat Card with Touch / Hover Polish
function GlowStatCard({
  label,
  value,
  subvalue,
  hint,
  icon: Icon,
  tone = 'default',
  progress,
  className,
}: {
  label: string;
  value: number | string;
  subvalue?: string;
  hint?: string;
  icon: React.ElementType;
  tone?: 'emerald' | 'cyan' | 'amber' | 'rose' | 'default';
  progress?: number;
  className?: string;
}) {
  const toneClasses = {
    emerald: 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent shadow-emerald-950/20 text-emerald-400',
    cyan: 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent shadow-cyan-950/20 text-cyan-400',
    amber: 'border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent shadow-amber-950/20 text-amber-400',
    rose: 'border-rose-500/30 bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent shadow-rose-950/20 text-rose-400',
    default: 'border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent shadow-black/40 text-slate-300',
  }[tone];

  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative rounded-2xl sm:rounded-3xl border p-3.5 sm:p-4 backdrop-blur-xl shadow-lg flex flex-col justify-between overflow-hidden touch-manipulation',
        toneClasses,
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-semibold text-white/70 truncate">{label}</p>
          <div className="flex items-baseline gap-1.5 sm:gap-2 mt-1">
            <span className="text-xl sm:text-3xl font-black text-white tabular-nums tracking-tight">
              {value}
            </span>
            {subvalue && (
              <span className="text-[11px] sm:text-xs font-bold text-white/60 font-mono">
                {subvalue}
              </span>
            )}
          </div>
        </div>
        <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0 shadow-inner">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-2.5 sm:mt-3 space-y-1">
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full"
            />
          </div>
        </div>
      )}

      {hint && (
        <p className="text-[10px] sm:text-[11px] text-white/50 mt-2 truncate font-medium">
          {hint}
        </p>
      )}
    </motion.div>
  );
}

// Sample Photo Viewer with High-Res Fetching
function SamplePhoto({ admission, fileId }: { admission: string; fileId: string }) {
  const [src, setSrc] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    let active = true;
    setSrc(''); setState('loading');
    void fetchMonitorPhoto(admission, fileId).then(image => {
      if (active) { setSrc(image); setState('idle'); }
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [admission, fileId]);

  const load = async () => {
    setState('loading');
    try {
      setSrc(await fetchMonitorPhoto(admission, fileId));
      setState('idle');
    } catch {
      setState('error');
    }
  };

  if (src) {
    return (
      <img
        src={src}
        alt="Enrollment capture"
        onError={() => { setSrc(''); setState('error'); }}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover rounded-xl transition-all duration-300 hover:scale-105"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all rounded-xl touch-manipulation"
    >
      {state === 'loading' ? (
        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-emerald-400" />
      ) : state === 'error' ? (
        <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-rose-400" />
      ) : (
        <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-400" />
      )}
      <span className="text-[10px] font-bold">
        {state === 'loading' ? 'Loading...' : state === 'error' ? 'Retry' : 'View Face'}
      </span>
    </button>
  );
}

// Correction Request Card
function CorrectionCard({
  c,
  canManage,
  onReviewed,
}: {
  c: MonitorCorrection;
  canManage: boolean;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const act = async (approve: boolean) => {
    setBusy(true);
    try {
      await reviewCorrection(c.id, approve);
      toast({
        title: approve ? 'Correction approved' : 'Correction rejected',
        description: `Updated student record for ${c.name}.`,
      });
      onReviewed();
    } catch (e) {
      toast({
        title: 'Could not review',
        description: e instanceof Error ? e.message : 'Retry shortly',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-3.5 sm:p-4 backdrop-blur-md space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white truncate">
          {c.name}{' '}
          <span className="text-white/60 font-normal text-xs block sm:inline">
            · Adm: {c.student} · Class: {c.category || '—'}
          </span>
        </p>
        <Badge
          variant="outline"
          className="text-[10px] uppercase font-bold tracking-wider border-amber-500/40 text-amber-300 shrink-0"
        >
          {c.status}
        </Badge>
      </div>

      <dl className="space-y-1.5 text-xs">
        {Object.entries(c.changes).map(([k, v]) => (
          <div key={k} className="flex flex-col sm:grid sm:grid-cols-[130px_1fr] gap-1 sm:gap-2 p-2 rounded-xl bg-black/30 border border-white/5">
            <dt className="text-white/60 font-medium">{fieldLabels[k as keyof StudentDetails] || k}</dt>
            <dd className="text-white">
              <span className="line-through text-white/40 mr-1.5">
                {c.original?.[k as keyof StudentDetails] || '(blank)'}
              </span>
              → <span className="font-bold text-emerald-400">{v || '(blank)'}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-white/50">Requested {ago(c.at)}</span>
        {canManage && c.status === 'pending' && (
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(false)}
              className="flex-1 sm:flex-initial rounded-xl h-9 sm:h-8 text-xs border-white/20 hover:bg-rose-500/20 hover:text-rose-300"
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(true)}
              className="flex-1 sm:flex-initial rounded-xl h-9 sm:h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Approve Changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Ultra-Modern Mobile & Desktop Slide-Over Sheet
function StudentDetailSheet({
  student,
  data,
  onClose,
  onChanged,
  onOpenRecapture,
  onRevert,
  onDelete,
  onCopyBypassLink,
}: {
  student: MonitorStudent | null;
  data: MonitorOverview | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenRecapture: (student: MonitorStudent) => void;
  onRevert?: (student: MonitorStudent) => void;
  onDelete?: (student: MonitorStudent) => void;
  onCopyBypassLink?: (student: MonitorStudent) => void;
}) {
  const events = useMemo(
    () => (student && data ? data.activity.filter((a) => a.student === student.admission_number) : []),
    [student, data]
  );
  const corrections = useMemo(
    () => (student && data ? data.corrections.filter((c) => c.student === student.admission_number) : []),
    [student, data]
  );

  if (!student) return null;

  const steps = [
    {
      label: 'Record on File',
      done: true,
      detail: student.imported ? 'Imported from Official ID Card' : 'Existing School Record Database',
    },
    {
      label: 'Parent Phone Verification',
      done: Boolean(student.verifiedAt) || ['verified', 'capturing', 'completed'].includes(student.status),
      detail: student.method
        ? methodLabels[student.method] || student.method
        : student.failures
        ? `${student.failures} failed OTP attempt(s)`
        : 'Awaiting parent sign-in',
    },
    {
      label: 'TrueDepth 15-Angle 3D Face Calibration',
      done: isStudentEnrolled(student),
      detail:
        student.status === 'capturing'
          ? `${student.inProgress?.samples.length || 0} of ${REQUIRED_POSES.length} angles synced`
          : student.completedAt
          ? format(student.completedAt, 'd MMM yyyy, h:mm a')
          : isStudentEnrolled(student)
          ? 'Biometric vectors calibrated & active'
          : 'Waiting for biometric scan',
    },
  ];

  const glasses = student.samples.some((s) => s.glasses === 'with');

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl max-h-[100dvh] overflow-y-auto bg-slate-950/95 border-white/15 text-white backdrop-blur-2xl p-4 sm:p-6 pb-28 sm:pb-8">
        <SheetHeader className="text-left pb-4 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2 truncate">
                {student.name}
              </SheetTitle>
              <p className="text-xs text-white/70 font-mono mt-1">
                Adm: <span className="text-emerald-400 font-bold">{student.admission_number}</span> · Class:{' '}
                <span className="text-cyan-400 font-bold">{student.category || 'Unassigned'}</span>
              </p>
            </div>
            <ModernStatusBadge student={student} />
          </div>
          <SheetDescription className="text-xs text-white/60 font-mono">
            Parent Phone: {student.parent_phone || 'Not on file'}
          </SheetDescription>
        </SheetHeader>

        {/* Action Button: Recapture 3D Face & Revert */}
        {data?.canManage && (
          <div className="mt-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20 border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-white">Biometric Face Management</p>
              <p className="text-[11px] text-white/60 mt-0.5">
                {isStudentEnrolled(student)
                  ? 'Open dedicated studio to recapture, or copy direct link'
                  : 'Open full-screen capture studio or copy bypass link'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {onCopyBypassLink && (
                <Button
                  variant="outline"
                  size="sm"
                  title="Copy Direct Capture Bypass Link"
                  onClick={() => onCopyBypassLink(student)}
                  className="rounded-xl h-10 sm:h-9 font-semibold text-xs border-white/20 bg-white/5 hover:bg-white/10 text-white/90 gap-1.5 touch-manipulation"
                >
                  <Copy className="h-3.5 w-3.5 text-cyan-400" />
                  Copy Link
                </Button>
              )}
              {isStudentEnrolled(student) && onRevert && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onRevert(student);
                  }}
                  className="flex-1 sm:flex-none rounded-xl h-10 sm:h-9 font-bold text-xs border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-white gap-1.5 shrink-0 touch-manipulation"
                >
                  <RotateCcw className="h-4 w-4 text-amber-400" />
                  Revert
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onDelete(student);
                  }}
                  className="flex-1 sm:flex-none rounded-xl h-10 sm:h-9 font-bold text-xs border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 hover:text-white gap-1.5 shrink-0 touch-manipulation"
                >
                  <Trash2 className="h-4 w-4 text-rose-400" />
                  Delete Student
                </Button>
              )}
              <Button
                onClick={() => {
                  onClose();
                  onOpenRecapture(student);
                }}
                className="flex-1 sm:flex-none rounded-xl h-10 sm:h-9 font-bold text-xs bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white hover:from-cyan-600 hover:to-indigo-700 shadow-md shadow-blue-500/20 gap-1.5 shrink-0 touch-manipulation"
              >
                <ScanFace className="h-4 w-4" />
                {isStudentEnrolled(student) ? 'Recapture Face' : 'Capture in Studio'}
              </Button>
            </div>
          </div>
        )}

        {/* Step Progress Timeline */}
        <section className="mt-5 space-y-2.5">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Enrollment Flow Progress
          </h4>
          <ol className="space-y-3 p-3.5 sm:p-4 rounded-2xl bg-white/5 border border-white/10">
            {steps.map((s, idx) => (
              <li key={s.label} className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 h-6 w-6 rounded-full border flex items-center justify-center shrink-0 text-xs font-bold shadow-sm',
                    s.done
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-emerald-500/30'
                      : 'border-white/20 text-white/40 bg-white/5'
                  )}
                >
                  {s.done ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-bold', s.done ? 'text-white' : 'text-white/60')}>
                    {s.label}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Record Checks Chips */}
        <section className="mt-5 space-y-2">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60">
            Database Record Verification
          </h4>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {[
              ['Parent Phone on File', student.hasPhone],
              ["Father's Name Recorded", student.hasFather],
              ['Date of Birth Verified', student.hasDob],
              ['ID-Card Photo Extracted', student.portrait],
              ['Biometric Vectors Ready', student.faceOnFile],
            ].map(([label, ok]) => (
              <span
                key={String(label)}
                className={cn(
                  'rounded-xl border px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold flex items-center gap-1.5',
                  ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                )}
              >
                {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {label}
              </span>
            ))}
          </div>
        </section>

        <Suspense
          fallback={
            <div className="mt-5 p-5 rounded-2xl bg-white/5 border border-white/10 text-center space-y-2">
              <div className="h-6 w-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-white/60">Loading Biometric 3D Models & Assets…</p>
            </div>
          }
        >
          <StudentStoredFaceAssets key={student.admission_number} student={student} />
        </Suspense>

        {/* Captured 15-Angle Samples Grid */}
        {student.samples.length > 0 && (
          <section className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 text-cyan-400" />
                Captured 3D Face Samples ({student.samples.length})
                {glasses && (
                  <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 text-[10px] ml-1">
                    <Glasses className="h-3 w-3 mr-1" /> Glasses
                  </Badge>
                )}
              </h4>
            </div>
            {/* 2 columns on mobile for large clear photos, 3 on larger */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
              {student.samples.map((s) => (
                <figure
                  key={s.fileId}
                  className="rounded-2xl border border-white/15 bg-white/5 overflow-hidden shadow-md group"
                >
                  <div className="relative aspect-square bg-slate-900">
                    <SamplePhoto admission={student.admission_number} fileId={s.fileId} />
                  </div>
                  <figcaption className="p-2 text-[10px] bg-black/40 backdrop-blur-md">
                    <span className="font-extrabold text-white capitalize block truncate">{s.pose}</span>
                    <span className="text-white/60 block mt-0.5 truncate text-[9px]">
                      L: {s.brightness} · S: {s.sharpness}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Corrections Requests */}
        {corrections.length > 0 && (
          <section className="mt-5 space-y-3">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60">
              Pending Corrections Requests
            </h4>
            {corrections.map((c) => (
              <CorrectionCard
                key={c.id}
                c={c}
                canManage={Boolean(data?.canManage)}
                onReviewed={onChanged}
              />
            ))}
          </section>
        )}

        {/* Audit Activity Trail */}
        <section className="mt-5 space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            Audit Activity Trail
          </h4>
          {events.length ? (
            <ul className="space-y-2 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              {events.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-2 p-2 rounded-xl bg-black/20 border border-white/5">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-white block truncate">{eventLabels[e.event] || e.event}</span>
                    {e.method && (
                      <span className="text-white/60 block text-[11px] mt-0.5">
                        Method: {methodLabels[e.method] || e.method}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-white/40 font-mono shrink-0">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-white/50 italic p-3 rounded-xl bg-white/5 border border-white/10">
              No recent audit activity in the last 90 days.
            </p>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

// MAIN ENROLLMENT MONITOR PAGE
export default function EnrollmentMonitor() {
  const { role } = useUserRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<MonitorOverview | null>(() => getCachedMonitorOverview());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !getCachedMonitorOverview());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [selectedStudentAdm, setSelectedStudentAdm] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [launchingCaptureAdm, setLaunchingCaptureAdm] = useState<string | null>(null);
  const [revertingStudent, setRevertingStudent] = useState<MonitorStudent | null>(null);
  const [isReverting, setIsReverting] = useState(false);
  const [selectedAdmissions, setSelectedAdmissions] = useState<Set<string>>(new Set());
  const [unenrollTargets, setUnenrollTargets] = useState<MonitorStudent[]>([]);
  const [unenrollBusy, setUnenrollBusy] = useState(false);
  const [unenrollProgress, setUnenrollProgress] = useState('');
  const [studentToDelete, setStudentToDelete] = useState<MonitorStudent | null>(null);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<MonitorStudent[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);

  const parentLink = `${window.location.origin}/enroll`;
  const backTo = role === 'teacher' ? '/teacher' : (role === 'enroller' || role === 'student_coordinator') ? '/attendance' : '/admin';

  const handleLaunchDirectCapture = async (student: MonitorStudent) => {
    try {
      setLaunchingCaptureAdm(student.admission_number);
      toast({
        title: 'Opening Biometric Studio',
        description: `Preparing 3D face scan studio for ${student.name}...`,
      });

      let token = '';
      try {
        const res = await enrollmentApi<EnrollmentSession>('staff.session', {
          admission: student.admission_number,
        });
        if (res?.session) {
          token = res.session;
          sessionStorage.setItem('bypass_enrollment_session', JSON.stringify(res));
        }
      } catch (e) {
        console.warn('Could not pre-fetch session; will initialize on enroll page:', e);
      }

      const params = new URLSearchParams({
        student: student.admission_number,
        bypass: 'true',
      });
      if (token) {
        params.set('token', token);
      }

      navigate(`/enroll?${params.toString()}`);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error launching studio',
        description: err?.message || 'Could not open capture studio.',
      });
    } finally {
      setLaunchingCaptureAdm(null);
    }
  };

  const copyDirectCaptureLink = async (student: MonitorStudent) => {
    try {
      let token = '';
      try {
        const res = await enrollmentApi<EnrollmentSession>('staff.session', {
          admission: student.admission_number,
        });
        if (res?.session) token = res.session;
      } catch {}

      const params = new URLSearchParams({
        student: student.admission_number,
        bypass: 'true',
      });
      if (token) params.set('token', token);

      const url = `${window.location.origin}/enroll?${params.toString()}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Bypass Link Copied!',
        description: `Direct capture link for ${student.name} copied to clipboard.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Could not copy link.',
      });
    }
  };

  const handleRevert = async (s: MonitorStudent) => {
    setIsReverting(true);
    try {
      const result = await enrollmentApi<{ reverted: boolean }>('staff.revert', { admission: s.admission_number });
      if (!result.reverted) throw new Error('The server did not confirm face unenrollment.');

      toast({
        title: 'Enrollment Reverted',
        description: `Biometric enrollment for ${s.name} has been cleared. The student can now re-enroll.`,
      });

      setRevertingStudent(null);
      setSelectedStudentAdm(null);
      await load(true);
    } catch (err: any) {
      toast({
        title: 'Revert Failed',
        description: err.message || 'Could not revert enrollment.',
        variant: 'destructive',
      });
    } finally {
      setIsReverting(false);
    }
  };

  const handleBulkUnenroll = async () => {
    setUnenrollBusy(true);
    const failed: MonitorStudent[] = [];
    const errors: string[] = [];
    let saved = 0;
    try {
      for (const [index, student] of unenrollTargets.entries()) {
        setUnenrollProgress(`Unenrolling ${index + 1}/${unenrollTargets.length}: ${student.name}`);
        try {
          const result = await enrollmentApi<{ reverted: boolean }>('staff.revert', { admission: student.admission_number });
          if (!result.reverted) throw new Error('Server did not confirm unenrollment.');
          saved++;
          setSelectedAdmissions(previous => { const next = new Set(previous); next.delete(student.admission_number); return next; });
        } catch (error) {
          failed.push(student);
          errors.push(`${student.name}: ${error instanceof Error ? error.message : 'Request failed'}`);
        }
      }
      setUnenrollTargets(failed);
      setUnenrollProgress(errors.slice(0, 3).join('\n'));
      toast({ title: `${saved} students unenrolled`, description: failed.length ? `${failed.length} failed. Review the errors and retry.` : 'Students can enroll their faces again. Profiles and attendance history were kept.', variant: failed.length ? 'destructive' : 'default' });
      setSelectedStudentAdm(null);
      await load(true);
    } finally { setUnenrollBusy(false); }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!studentToDelete) return;
    const admissionToRemove = studentToDelete.admission_number;
    const nameToRemove = studentToDelete.name;
    setIsDeleting(true);
    setDeleteProgress(`Starting permanent deletion for ${nameToRemove}...`);

    // Optimistically update the UI and cache immediately for 0ms latency
    removeStudentFromMonitorCache(admissionToRemove);
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        students: prev.students.filter(s => s.admission_number !== admissionToRemove)
      };
    });
    setSelectedAdmissions(prev => {
      const next = new Set(prev);
      next.delete(admissionToRemove);
      return next;
    });

    try {
      const res = await universalDeleteStudent(
        {
          admission_number: admissionToRemove,
          employee_id: admissionToRemove,
          name: nameToRemove,
          samples: studentToDelete.samples.map(s => ({ fileId: s.fileId })),
        },
        (status) => setDeleteProgress(status)
      );

      if (res.success) {
        toast({
          title: "Student Permanently Deleted",
          description: `Completely removed ${nameToRemove} (${admissionToRemove}) from the database and storage.`,
        });
        setStudentToDelete(null);
        setSelectedStudentAdm(null);
        await load(true);
      } else {
        toast({
          title: "Deletion Completed with Warnings",
          description: res.errors.join("; ") || "Some records could not be purged.",
          variant: "destructive",
        });
        setStudentToDelete(null);
        await load(true);
      }
    } catch (err: any) {
      console.error('Delete student error:', err);
      toast({
        title: "Deletion Failed",
        description: err?.message || "Could not permanently delete student.",
        variant: "destructive",
      });
      await load(true);
    } finally {
      setIsDeleting(false);
      setDeleteProgress('');
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (!bulkDeleteTargets.length) return;
    setIsDeleting(true);
    let successCount = 0;
    const errors: string[] = [];

    // Optimistically remove bulk targets immediately
    for (const student of bulkDeleteTargets) {
      removeStudentFromMonitorCache(student.admission_number);
    }
    const targetAdms = new Set(bulkDeleteTargets.map(s => s.admission_number));
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        students: prev.students.filter(s => !targetAdms.has(s.admission_number))
      };
    });

    try {
      for (const [index, student] of bulkDeleteTargets.entries()) {
        setDeleteProgress(`Deleting ${index + 1}/${bulkDeleteTargets.length}: ${student.name}...`);
        try {
          const res = await universalDeleteStudent({
            admission_number: student.admission_number,
            employee_id: student.admission_number,
            name: student.name,
            samples: student.samples.map(s => ({ fileId: s.fileId })),
          });
          if (res.success) {
            successCount++;
            setSelectedAdmissions(prev => {
              const next = new Set(prev);
              next.delete(student.admission_number);
              return next;
            });
          } else {
            errors.push(`${student.name}: ${res.errors.join(', ')}`);
          }
        } catch (err: any) {
          errors.push(`${student.name}: ${err.message || 'Failed'}`);
        }
      }

      toast({
        title: `${successCount} Students Permanently Deleted`,
        description: errors.length
          ? `${errors.length} could not be completely removed. Check logs.`
          : `Permanently removed ${successCount} students and their biometric records from the database.`,
        variant: errors.length ? 'destructive' : 'default',
      });

      setBulkDeleteTargets([]);
      setSelectedStudentAdm(null);
      await load(true);
    } finally {
      setIsDeleting(false);
      setDeleteProgress('');
    }
  };

  // Scroll to top listener for mobile FAB
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet && !data) setLoading(true);
    try {
      const fresh = await fetchMonitor();
      setData(fresh);
      setError('');
    } catch (e) {
      if (!data) setError(e instanceof Error ? e.message : 'Could not load enrollment data.');
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && (typeof navigator === 'undefined' || navigator.onLine)) {
        void load(true);
      }
    }, 45000);
    return () => window.clearInterval(id);
  }, [load]);

  const handleImportClassCards = async (cards: ExtractedStudentCard[], batchName: string) => {
    if (!cards.length) return;
    toast({
      title: 'Processing ID Cards...',
      description: `Saving ${cards.length} students into enrollment database...`,
    });

    try {
      const { idCardFunction } = await import('@/services/enrollment/bulkPdfExtractor');
      const result: { saved: string[]; failed: { admission_number: string; error: string }[] } = { saved: [], failed: [] };
      for (let offset = 0; offset < cards.length; offset += 3) {
        const batch = await idCardFunction<typeof result>({
          action: 'idcards.save', approveUpdates: true,
          students: cards.slice(offset, offset + 3).map(card => ({ ...card, admission_number: card.employee_id, email: card.student_email || '' })),
        });
        result.saved.push(...batch.saved); result.failed.push(...batch.failed);
      }
      if (result.failed.length) throw new Error(`${result.saved.length} students saved; ${result.failed.length} failed. ${result.failed.map(item => `${item.admission_number}: ${item.error}`).join('; ')}`);      toast({
        title: 'Class ID Cards Imported! 🚀',
        description: `Successfully added ${cards.length} students to Biometric Enrollment Hub.`,
      });

      await load(true);
      setUploadOpen(false);
    } catch (err: any) {
      console.error('Import failed:', err);
      toast({
        title: 'Import Partial Failure',
        description: err.message || 'Some records could not be saved. Please refresh.',
        variant: 'destructive',
      });
      await load(true);
      throw err;
    }
  };

  useEffect(() => setLimit(PAGE), [query, category, filter]);

  const students = data?.students ?? [];

  // Summary statistics
  const stats = useMemo(() => {
    const done = students.filter(isStudentEnrolled).length;
    return {
      total: students.length,
      done,
      pct: students.length ? Math.round((done / students.length) * 100) : 0,
      progress: students.filter((s) => !isStudentEnrolled(s) && (s.status === 'verified' || s.status === 'capturing')).length,
      notStarted: students.filter((s) => !isStudentEnrolled(s) && s.status === 'not_started').length,
      failed: students.filter((s) => !isStudentEnrolled(s) && s.failures > 0).length,
      corrections: data?.corrections.filter((c) => c.status === 'pending').length ?? 0,
      noPhone: students.filter((s) => !s.hasPhone).length,
    };
  }, [students, data]);

  // Classes & Sections breakdown
  const classes = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const s of students) {
      const key = s.category || 'Unassigned';
      const v = map.get(key) || { total: 0, done: 0 };
      v.total++;
      if (isStudentEnrolled(s)) v.done++;
      map.set(key, v);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Filtered students
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((s) => (category === 'all' || (s.category || 'Unassigned') === category) && matchesFilter(s, filter))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q))
      .sort((a, b) => (a.category || '').localeCompare(b.category || '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  }, [students, query, category, filter]);

  const selectedStudent = students.find((s) => s.admission_number === selectedStudentAdm) ?? null;

  const exportCsv = () => {
    const rows = [
      [
        'Admission Number',
        'Full Name',
        'Class Section',
        'Status',
        'Verification Method',
        'Captured Views Count',
        'Verified Timestamp',
        'Completed Timestamp',
        'Failed Attempts',
        'Pending Correction',
        'Phone on File',
      ],
    ];
    for (const s of visible) {
      rows.push([
        s.admission_number,
        s.name,
        s.category || '',
        statusMeta[s.status].label,
        methodLabels[s.method] || s.method || '',
        String(s.samples.length || s.inProgress?.samples.length || 0),
        s.verifiedAt ? new Date(s.verifiedAt).toISOString() : '',
        s.completedAt ? new Date(s.completedAt).toISOString() : '',
        String(s.failures),
        s.correction ? 'Yes' : 'No',
        s.hasPhone ? 'Yes' : 'No',
      ]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-radar-status-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyReminder = async () => {
    const pending = visible.filter((s) => s.status !== 'completed');
    if (!pending.length) {
      toast({ title: 'Everyone in this view is enrolled!' });
      return;
    }
    const text =
      `Dear parents, please complete your child's 3D face biometric registration at ${parentLink} using your registered admission number.\n\n` +
      `Pending Students:\n` +
      pending.map((s) => `• ${s.name} (${s.category || '—'}) – Admission ID: ${s.admission_number}`).join('\n');
    
    // Check if Web Share API is supported (mobile native share)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Student Biometric Enrollment Reminder',
          text,
          url: parentLink,
        });
        toast({ title: 'Shared via native dialog!' });
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    await navigator.clipboard.writeText(text);
    toast({
      title: 'Reminder Copied to Clipboard',
      description: `${pending.length} pending student invitations ready to paste into WhatsApp, Email, or SMS.`,
    });
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <PageTransition>
      <div className="enrollment-shell min-h-screen pb-24 sm:pb-16">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 relative z-10">
          
          {/* Official Presences Brand Header */}
          <header className="flex items-center justify-between gap-3 px-1 py-1">
            <Link to="/" className="font-semibold tracking-tight text-white flex items-center gap-2 group">
              <img
                src="/logo.png"
                alt="Presences AI"
                className="w-7 h-7 sm:w-8 sm:h-8 object-contain group-hover:scale-105 transition-transform"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="flex items-center gap-1">
                <span className="font-black text-base sm:text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">
                  presences
                </span>
                <span className="text-emerald-400 font-black text-base sm:text-lg">.ai</span>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <div className="hidden xs:flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 backdrop-blur-md">
                <ShieldCheck size={13} className="text-emerald-400" />
                <span>Biometric Operations</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <Badge variant="outline" className="text-[10px] font-mono font-bold px-2 py-0.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                v2.4
              </Badge>
            </div>
          </header>

          {/* Header Navigation Bar */}
          <div className="flex flex-col gap-3.5 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
            
            {/* Top row: Back Button + Title + Status */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl bg-white/10 border border-white/15 text-white hover:bg-white/20 active:scale-95 shrink-0"
                >
                  <Link to={backTo} aria-label="Back">
                    <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Link>
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight flex items-center gap-1.5 sm:gap-2 truncate">
                      <ScanFace className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 shrink-0" />
                      <span className="truncate">Biometric Enrollment Hub</span>
                    </h1>
                    <span className="flex h-2 w-2 sm:h-2.5 sm:w-2.5 relative shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-emerald-500"></span>
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-white/60 font-medium truncate mt-0.5">
                    {data ? (data.scope.all ? 'All school classes' : `Assigned: ${data.scope.classes.join(', ')}`) : 'Live student biometric onboarding'}
                    {data && ` · Updated ${ago(data.generatedAt)}`}
                  </p>
                </div>
              </div>

              {/* Mobile Quick Refresh Icon */}
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 sm:hidden rounded-xl bg-white/10 border border-white/15 text-white hover:bg-white/20 active:scale-95 shrink-0"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin text-emerald-400')} />
              </Button>
            </div>

            {/* Action Bar (Horizontally scrollable on mobile, flex on desktop) */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 -mx-1 px-1">
              <Button
                size="sm"
                variant="outline"
                className="hidden sm:inline-flex h-9 px-3.5 rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm active:scale-95 shrink-0"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin text-emerald-400')} />
                Refresh
              </Button>

              {data?.canManage && (
                <Button
                  size="sm"
                  className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-xl sm:rounded-2xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20 active:scale-95 shrink-0"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload ID Cards
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-xl sm:rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm active:scale-95 shrink-0"
                onClick={copyReminder}
                disabled={!data}
              >
                <Share2 className="h-3.5 w-3.5 mr-1.5 text-cyan-400" />
                <span className="hidden xs:inline">Share</span> WhatsApp Reminder
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-xl sm:rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm active:scale-95 shrink-0"
                onClick={exportCsv}
                disabled={!visible.length}
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                Export CSV
              </Button>

              {data?.canManage && (
                <>
                  {selectedAdmissions.size > 0 ? (
                    /* Active Selection Operations */
                    <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 font-semibold">
                        {selectedAdmissions.size} Selected
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 sm:h-9 px-2.5 rounded-xl sm:rounded-2xl text-xs text-slate-300 hover:text-white"
                        disabled={unenrollBusy || isDeleting}
                        onClick={() => setSelectedAdmissions(new Set())}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Clear
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 sm:h-9 px-3 rounded-xl sm:rounded-2xl border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold"
                        disabled={unenrollBusy || isReverting || isDeleting}
                        onClick={() => {
                          setUnenrollProgress('');
                          setUnenrollTargets(students.filter(student => selectedAdmissions.has(student.admission_number)));
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Unenroll ({selectedAdmissions.size})
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 sm:h-9 px-3 rounded-xl sm:rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20"
                        disabled={unenrollBusy || isReverting || isDeleting}
                        onClick={() => setBulkDeleteTargets(students.filter(student => selectedAdmissions.has(student.admission_number)))}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Permanently Delete
                      </Button>
                    </div>
                  ) : (
                    /* Inactive Selection Controls */
                    <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 sm:h-9 px-3 rounded-xl sm:rounded-2xl border-white/15 bg-white/5 text-slate-300 hover:text-white text-xs font-semibold"
                        disabled={unenrollBusy || isReverting || isDeleting || !visible.length}
                        onClick={() => setSelectedAdmissions(new Set(visible.map(student => student.admission_number)))}
                      >
                        Select Filtered ({visible.length})
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl sm:rounded-2xl border border-white/15 bg-white/5 text-slate-300 hover:text-white"
                            aria-label="More actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-900 border-white/10 text-white w-56 rounded-2xl shadow-2xl p-1.5">
                          <DropdownMenuItem
                            className="text-xs py-2 rounded-xl cursor-pointer hover:bg-white/10"
                            disabled={!visible.length}
                            onClick={() => setSelectedAdmissions(new Set(visible.map(student => student.admission_number)))}
                          >
                            <Check className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                            Select all filtered ({visible.length})
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10 my-1" />
                          <DropdownMenuItem
                            className="text-xs py-2 rounded-xl cursor-pointer text-rose-300 hover:bg-rose-500/20 focus:bg-rose-500/20 focus:text-rose-200"
                            disabled={unenrollBusy || isReverting || isDeleting || !students.length}
                            onClick={() => {
                              setUnenrollProgress('');
                              setUnenrollTargets([...students]);
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-2 text-rose-400" />
                            Unenroll all school students ({students.length})
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 sm:p-4 text-xs sm:text-sm flex items-start gap-3 text-rose-200">
              <ShieldAlert className="h-5 w-5 text-rose-400 mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
              <Button size="sm" variant="outline" className="rounded-xl h-8" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          {/* Loading Skeleton */}
          {loading && !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 sm:gap-3.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 sm:h-28 rounded-2xl sm:rounded-3xl bg-white/5" />
                ))}
              </div>
              <Skeleton className="h-96 rounded-2xl sm:rounded-3xl bg-white/5" />
            </div>
          ) : data && (
            <>
              {/* TOP LIVE METRIC HIGHLIGHTS DECK (Swipeable carousel on mobile, grid on desktop) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
                <GlowStatCard
                  label="Total Students"
                  value={stats.total}
                  hint={stats.noPhone ? `${stats.noPhone} missing parent phone` : '100% phone coverage'}
                  icon={Users}
                  tone="default"
                />
                <GlowStatCard
                  label="3D Face Enrolled"
                  value={stats.done}
                  subvalue={`${stats.pct}%`}
                  progress={stats.pct}
                  hint={`${stats.done} of ${stats.total} calibrated`}
                  icon={ShieldCheck}
                  tone="emerald"
                />
                <GlowStatCard
                  label="In Progress"
                  value={stats.progress}
                  hint="Active parent scans"
                  icon={Clock}
                  tone="cyan"
                />
                <GlowStatCard
                  label="Awaiting Action"
                  value={stats.notStarted}
                  hint="Invitation link sent"
                  icon={Sparkles}
                  tone="amber"
                />
                <GlowStatCard
                  label="Attention & Edits"
                  value={stats.corrections + stats.failed}
                  hint={`${stats.corrections} edits · ${stats.failed} failed`}
                  icon={AlertCircle}
                  tone={stats.corrections + stats.failed > 0 ? 'rose' : 'default'}
                  className="col-span-2 sm:col-span-1"
                />
              </div>

              {/* CLASS SECTION COMPLETION CAROUSEL / STRIP */}
              {classes.length > 0 && (
                <div className="p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-white/70 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-cyan-400" />
                      Class Onboarding Progress (Tap to filter)
                    </span>
                    {category !== 'all' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCategory('all')}
                        className="h-6 text-[10px] sm:text-[11px] rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 p-1 px-2"
                      >
                        Reset Class ({category})
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1.5 no-scrollbar snap-x snap-mandatory -mx-1 px-1">
                    {classes.map(([cls, stat]) => {
                      const pct = stat.total ? Math.round((stat.done / stat.total) * 100) : 0;
                      const isSelected = category === cls;
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => setCategory(category === cls ? 'all' : cls)}
                          className={cn(
                            'relative shrink-0 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border text-left transition-all duration-200 cursor-pointer min-w-[115px] sm:min-w-[130px] snap-center active:scale-95 touch-manipulation',
                            isSelected
                              ? 'border-emerald-400 bg-emerald-500/25 shadow-md shadow-emerald-500/20 ring-2 ring-emerald-400/40'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-black text-white truncate">Class {cls}</span>
                            <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-400">{pct}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/10 rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[9px] sm:text-[10px] text-white/50 mt-1 font-mono">
                            {stat.done}/{stat.total} enrolled
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* FILTER PILLS & SEARCH BAR DOCK */}
              <div className="p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
                
                {/* Filter Tabs (Smooth horizontal touch scrolling on mobile) */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5 -mx-1 px-1 snap-x snap-mandatory">
                  {FILTERS.map((f) => {
                    const active = filter === f.id;
                    const Icon = f.icon;
                    const count =
                      f.id === 'all'
                        ? stats.total
                        : f.id === 'completed'
                        ? stats.done
                        : f.id === 'in_progress'
                        ? stats.progress
                        : f.id === 'attention'
                        ? stats.corrections + stats.failed
                        : f.id === 'not_started'
                        ? stats.notStarted
                        : stats.failed;

                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        className={cn(
                          'relative shrink-0 h-8 sm:h-9 px-3 sm:px-3.5 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-bold transition-all duration-200 cursor-pointer select-none active:scale-95 touch-manipulation snap-start',
                          active
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-black shadow-lg shadow-emerald-500/25'
                            : 'bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="whitespace-nowrap">{f.label}</span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[9px] sm:text-[10px] px-1.5 py-0 rounded-md font-mono shrink-0',
                            active ? 'bg-black/30 text-white border-0' : 'bg-white/10 text-white/80'
                          )}
                        >
                          {count}
                        </Badge>
                      </button>
                    );
                  })}
                </div>

                {/* Search Bar */}
                <div className="flex items-center gap-2 w-full md:w-auto md:min-w-[280px]">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                    <Input
                      placeholder="Search name, admission ID..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-9 pl-9 pr-8 text-xs rounded-xl sm:rounded-2xl bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-emerald-400"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ROSTER GRID OF STUDENTS */}
              {visible.length === 0 ? (
                <div className="text-center py-12 sm:py-16 px-4 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-3">
                  <ShieldAlert className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-white/30" />
                  <h3 className="text-sm sm:text-base font-bold text-white">No students match your filter</h3>
                  <p className="text-xs text-white/60 max-w-sm mx-auto">
                    Try adjusting your search query, class selection, or status filter tab.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-white/20 text-white hover:bg-white/10 text-xs"
                    onClick={() => {
                      setQuery('');
                      setCategory('all');
                      setFilter('all');
                    }}
                  >
                    Reset Filters
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">
                    {visible.slice(0, limit).map((s) => {
                      const isComplete = isStudentEnrolled(s);
                      const isCapturing = s.status === 'capturing' || s.status === 'verified';
                      const hasAttention = needsAttention(s);

                      return (
                        <div
                          key={s.admission_number}
                          className={cn(
                            'group relative rounded-2xl sm:rounded-3xl border p-3.5 sm:p-4 backdrop-blur-xl transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-md touch-manipulation',
                            isComplete
                              ? 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-white/5 to-transparent hover:border-emerald-500/40'
                              : isCapturing
                              ? 'border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-white/5 to-transparent hover:border-cyan-500/40'
                              : hasAttention
                              ? 'border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-white/5 to-transparent hover:border-amber-500/40'
                              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                          )}
                        >
                          {/* Student Header */}
                          {data?.canManage && (
                            <label className="flex items-center gap-2 mb-3 text-xs text-white/80">
                              <input type="checkbox" checked={selectedAdmissions.has(s.admission_number)} disabled={unenrollBusy || isReverting} onChange={event => setSelectedAdmissions(previous => { const next = new Set(previous); if (event.target.checked) next.add(s.admission_number); else next.delete(s.admission_number); return next; })} aria-label={`Select ${s.name} (${s.admission_number}) for face unenrollment`} />
                              Select student
                            </label>
                          )}
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                                <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-white/20 to-white/5 border border-white/15 flex items-center justify-center font-black text-xs sm:text-sm text-white overflow-hidden shrink-0 shadow-inner">
                                  {s.avatarUrl ? (
                                    <img
                                      src={s.avatarUrl}
                                      alt={s.name}
                                      className="h-full w-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLElement).style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    s.name.slice(0, 2).toUpperCase()
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-sm font-extrabold text-white truncate group-hover:text-emerald-300 transition-colors">
                                    {s.name}
                                  </h4>
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs text-white/60 font-mono mt-0.5">
                                    <span>ID: {s.admission_number}</span>
                                    {s.category && <span>• Class {s.category}</span>}
                                  </div>
                                </div>
                              </div>

                              <ModernStatusBadge student={s} />
                            </div>

                            {/* Indicators Pill Strip */}
                            <div className="flex flex-wrap gap-1.5 mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-white/10 text-[10px] font-medium">
                              {s.samples.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                                  <Camera className="h-3 w-3" /> {s.samples.length} 3D views
                                </span>
                              )}
                              {s.hasPhone ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-white/70">
                                  <Phone className="h-3 w-3 text-emerald-400" /> Phone on file
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300">
                                  <PhoneOff className="h-3 w-3" /> Missing phone
                                </span>
                              )}
                              {s.correction && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300">
                                  <FileEdit className="h-3 w-3" /> Edit requested
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions Footer (Enhanced touch target height on mobile) */}
                          <div className="flex items-center gap-2 mt-3.5 pt-2.5 sm:pt-3 border-t border-white/10">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedStudentAdm(s.admission_number)}
                              className="flex-1 h-9 sm:h-8 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/15 text-white gap-1.5 active:scale-95 touch-manipulation"
                            >
                              <Eye className="h-3.5 w-3.5 text-cyan-400" />
                              Inspect
                            </Button>

                            {data.canManage && (
                              <>
                                {isComplete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Revert biometric enrollment"
                                    onClick={() => setRevertingStudent(s)}
                                    className="h-9 sm:h-8 px-2 rounded-xl text-xs font-bold text-amber-300 hover:text-amber-100 hover:bg-amber-500/20 border border-amber-500/30 gap-1 active:scale-95 touch-manipulation"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                                    <span className="hidden xs:inline">Revert</span>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Permanently delete student from database"
                                  onClick={() => setStudentToDelete(s)}
                                  className="h-9 sm:h-8 px-2 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 border border-rose-500/30 gap-1 active:scale-95 touch-manipulation"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                                  <span className="hidden xs:inline">Delete</span>
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={launchingCaptureAdm === s.admission_number}
                                  onClick={() => void handleLaunchDirectCapture(s)}
                                  className={cn(
                                    'h-9 sm:h-8 px-3 rounded-xl text-xs font-bold gap-1.5 shadow-sm active:scale-95 touch-manipulation',
                                    isComplete
                                      ? 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
                                      : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-slate-950 font-black'
                                  )}
                                >
                                  {launchingCaptureAdm === s.admission_number ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      <span>Opening...</span>
                                    </>
                                  ) : (
                                    <>
                                      <ScanFace className="h-3.5 w-3.5" />
                                      <span>{isComplete ? 'Re-scan' : 'Capture'}</span>
                                    </>
                                  )}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Load More Pagination */}
              {visible.length > limit && (
                <div className="text-center pt-3 sm:pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setLimit((prev) => prev + PAGE)}
                    className="w-full sm:w-auto rounded-xl sm:rounded-2xl border-white/20 text-white hover:bg-white/10 px-6 font-bold text-xs sm:text-sm h-10"
                  >
                    Load More Students ({visible.length - limit} remaining)
                  </Button>
                </div>
              )}
            </>
          )}

        </div>

        {/* Mobile Quick Floating Status & Scroll-To-Top Button */}
        {showScrollTop && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 right-4 z-40 sm:hidden flex items-center gap-2"
          >
            <Button
              size="sm"
              onClick={scrollToTop}
              className="h-10 px-3.5 rounded-full bg-slate-900/90 border border-white/20 text-white shadow-2xl backdrop-blur-xl gap-1 text-xs font-bold"
            >
              <ArrowUp className="h-4 w-4 text-emerald-400" />
              Top
            </Button>
          </motion.div>
        )}

        {/* Slide-over Inspection Sheet */}
        {selectedStudent && (
          <StudentDetailSheet
            student={selectedStudent}
            data={data}
            onClose={() => setSelectedStudentAdm(null)}
            onChanged={() => void load(true)}
            onOpenRecapture={(st) => void handleLaunchDirectCapture(st)}
            onCopyBypassLink={(st) => void copyDirectCaptureLink(st)}
            onRevert={(st) => setRevertingStudent(st)}
            onDelete={(st) => setStudentToDelete(st)}
          />
        )}

        <Dialog open={unenrollTargets.length > 0} onOpenChange={open => { if (!open && !unenrollBusy) setUnenrollTargets([]); }}>
          <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white" onInteractOutside={event => { if (unenrollBusy) event.preventDefault(); }} onEscapeKeyDown={event => { if (unenrollBusy) event.preventDefault(); }}>
            <DialogHeader>
              <DialogTitle>Unenroll faces for {unenrollTargets.length} students?</DialogTitle>
              <DialogDescription>This permanently removes saved face samples and recognition vectors and invalidates enrollment sessions. Student profiles and attendance history are kept. Students will need to enroll again.</DialogDescription>
            </DialogHeader>
            <div className="max-h-48 overflow-auto text-sm space-y-1">{unenrollTargets.map(student => <p key={student.admission_number}>{student.name} · {student.admission_number} · {student.category}</p>)}</div>
            {unenrollProgress && <p role="status" className="text-xs whitespace-pre-line">{unenrollProgress}</p>}
            <DialogFooter>
              <Button variant="outline" disabled={unenrollBusy} onClick={() => setUnenrollTargets([])}>Cancel</Button>
              <Button variant="destructive" disabled={unenrollBusy} onClick={() => void handleBulkUnenroll()}>{unenrollBusy ? 'Unenrolling…' : 'Confirm face unenrollment'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revert Confirmation Dialog */}
        <Dialog open={Boolean(revertingStudent)} onOpenChange={(open) => !open && setRevertingStudent(null)}>
          <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-400">
                <RotateCcw className="h-5 w-5" />
                Revert Biometric Enrollment
              </DialogTitle>
              <DialogDescription className="text-white/70 text-xs">
                Are you sure you want to revert biometric enrollment for{' '}
                <strong className="text-white">{revertingStudent?.name}</strong> (ID:{' '}
                <span className="font-mono text-emerald-300">{revertingStudent?.admission_number}</span>)?
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200 space-y-1">
              <p className="font-semibold">This action will:</p>
              <ul className="list-disc list-inside text-rose-200/80 space-y-0.5">
                <li>Clear all 3D face samples and registered biometric vectors</li>
                <li>Reset enrollment status to <strong>Not Started</strong></li>
                <li>Allow the student or parent to start fresh calibration</li>
              </ul>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 mt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={isReverting}
                onClick={() => setRevertingStudent(null)}
                className="text-white/70 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isReverting}
                onClick={() => revertingStudent && void handleRevert(revertingStudent)}
                className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5 font-bold"
              >
                {isReverting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Reverting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Yes, Revert Enrollment
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Permanent Delete Single Student AlertDialog */}
        <AlertDialog open={Boolean(studentToDelete)} onOpenChange={(open) => { if (!open && !isDeleting) setStudentToDelete(null); }}>
          <AlertDialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
                <Trash2 className="h-5 w-5" />
                Permanently Delete Student from Database?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-white/80 text-xs sm:text-sm space-y-3 pt-2">
                <p>
                  Are you sure you want to permanently erase <strong className="text-white">{studentToDelete?.name}</strong> (Admission ID:{' '}
                  <span className="font-mono text-emerald-300">{studentToDelete?.admission_number}</span>)?
                </p>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200 space-y-1.5">
                  <p className="font-bold text-rose-300">This will permanently delete from EVERYWHERE:</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-rose-200/90">
                    <li>Student profile & registration accounts</li>
                    <li>All facial biometric descriptors and recognition models</li>
                    <li>All attendance records and verification history</li>
                    <li>All stored face samples and ID photos in Cloud Storage</li>
                    <li>Enrollment credentials and session documents</li>
                  </ul>
                </div>
                {deleteProgress && (
                  <p className="text-xs font-semibold text-cyan-400 animate-pulse">{deleteProgress}</p>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0 mt-2">
              <AlertDialogCancel
                disabled={isDeleting}
                onClick={() => setStudentToDelete(null)}
                className="border-white/10 bg-white/5 hover:bg-white/10 text-white"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmPermanentDelete();
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold gap-1.5 shadow-md shadow-rose-600/20"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting Permanently...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Yes, Permanently Delete</span>
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Permanent Delete AlertDialog */}
        <AlertDialog open={bulkDeleteTargets.length > 0} onOpenChange={(open) => { if (!open && !isDeleting) setBulkDeleteTargets([]); }}>
          <AlertDialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
                <Trash2 className="h-5 w-5" />
                Permanently Delete {bulkDeleteTargets.length} Students?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-white/80 text-xs sm:text-sm space-y-3 pt-2">
                <p>
                  This will permanently erase all selected students from the database including their profiles, biometric face models, attendance records, and cloud storage images. This action cannot be undone.
                </p>
                <div className="max-h-36 overflow-auto text-xs space-y-1 p-2 rounded-lg bg-black/40 border border-white/10">
                  {bulkDeleteTargets.map(s => (
                    <p key={s.admission_number} className="text-white/80 truncate">
                      {s.name} · {s.admission_number} · {s.category || 'N/A'}
                    </p>
                  ))}
                </div>
                {deleteProgress && (
                  <p className="text-xs font-semibold text-cyan-400 animate-pulse">{deleteProgress}</p>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0 mt-2">
              <AlertDialogCancel
                disabled={isDeleting}
                onClick={() => setBulkDeleteTargets([])}
                className="border-white/10 bg-white/5 hover:bg-white/10 text-white"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleBulkPermanentDelete();
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold gap-1.5 shadow-md shadow-rose-600/20"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting Selected...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirm Permanent Deletion</span>
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Class PDF Bulk ID Cards Importer Modal */}
        {uploadOpen && (
          <ClassPDFIDCardImporter
            isOpen={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onImportDrafts={handleImportClassCards}
          />
        )}
      </div>
    </PageTransition>
  );
}
