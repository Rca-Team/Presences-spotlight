import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
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
  UserCheck
} from 'lucide-react';
import PageTransition from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import { fieldLabels, type StudentDetails } from '@/services/enrollment/types';
import {
  fetchMonitor,
  fetchMonitorPhoto,
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
import CaptureFaceDialog, { type RecaptureStudent } from '@/components/admin/CaptureFaceDialog';
import '@/components/enrollment/enrollment.css';

const StudentEnrollmentManager = lazy(() => import('@/components/admin/StudentEnrollmentManager'));

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
const matchesFilter = (s: MonitorStudent, f: Filter) =>
  f === 'all'
    ? true
    : f === 'in_progress'
    ? s.status === 'verified' || s.status === 'capturing'
    : f === 'attention'
    ? needsAttention(s)
    : s.status === f;

// Enhanced Modern Status Badge
function ModernStatusBadge({ status }: { status: MonitorStatus }) {
  const m = statusMeta[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-tight shadow-sm select-none transition-all',
        m.tone
      )}
    >
      <span className={cn('h-2 w-2 rounded-full animate-pulse', m.dot)} />
      {m.label}
    </span>
  );
}

// Glowing Stat Card with Smooth Hover
function GlowStatCard({
  label,
  value,
  subvalue,
  hint,
  icon: Icon,
  tone = 'default',
  progress,
}: {
  label: string;
  value: number | string;
  subvalue?: string;
  hint?: string;
  icon: React.ElementType;
  tone?: 'emerald' | 'cyan' | 'amber' | 'rose' | 'default';
  progress?: number;
}) {
  const toneClasses = {
    emerald: 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent shadow-emerald-950/20 text-emerald-400',
    cyan: 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-transparent shadow-cyan-950/20 text-cyan-400',
    amber: 'border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent shadow-amber-950/20 text-amber-400',
    rose: 'border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent shadow-rose-950/20 text-rose-400',
    default: 'border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent shadow-black/40 text-slate-300',
  }[tone];

  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={cn(
        'relative rounded-2xl border p-4 backdrop-blur-xl shadow-lg flex flex-col justify-between overflow-hidden',
        toneClasses
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/70 truncate">{label}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl sm:text-3xl font-black text-white tabular-nums tracking-tight">
              {value}
            </span>
            {subvalue && (
              <span className="text-xs font-bold text-white/60 font-mono">
                {subvalue}
              </span>
            )}
          </div>
        </div>
        <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0 shadow-inner">
          <Icon className="h-5 w-5" />
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-3 space-y-1">
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
        <p className="text-[11px] text-white/50 mt-2 truncate font-medium">
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
        className="absolute inset-0 h-full w-full object-cover rounded-xl transition-all duration-300 hover:scale-105"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-xs text-white/60 hover:text-white hover:bg-white/10 transition-all rounded-xl"
    >
      {state === 'loading' ? (
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      ) : state === 'error' ? (
        <AlertCircle className="h-5 w-5 text-rose-400" />
      ) : (
        <Eye className="h-5 w-5 text-cyan-400" />
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
    <div className="rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur-md space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white truncate">
          {c.name}{' '}
          <span className="text-white/60 font-normal">
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
          <div key={k} className="grid grid-cols-[130px_1fr] gap-2 p-2 rounded-xl bg-black/30 border border-white/5">
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

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-white/50">Requested {ago(c.at)}</span>
        {canManage && c.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(false)}
              className="rounded-xl h-8 text-xs border-white/20 hover:bg-rose-500/20 hover:text-rose-300"
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(true)}
              className="rounded-xl h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Approve Changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Ultra-Modern Slide-Over Sheet
function StudentDetailSheet({
  student,
  data,
  onClose,
  onChanged,
  onOpenRecapture,
}: {
  student: MonitorStudent | null;
  data: MonitorOverview | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenRecapture: (student: MonitorStudent) => void;
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
      done: student.status === 'completed',
      detail:
        student.status === 'capturing'
          ? `${student.inProgress?.samples.length || 0} of ${REQUIRED_POSES.length} angles synced`
          : student.completedAt
          ? format(student.completedAt, 'd MMM yyyy, h:mm a')
          : 'Waiting for biometric scan',
    },
  ];

  const glasses = student.samples.some((s) => s.glasses === 'with');

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-slate-950/95 border-white/15 text-white backdrop-blur-2xl p-6">
        <SheetHeader className="text-left pb-4 border-b border-white/10">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-xl font-extrabold text-white flex items-center gap-2.5">
              {student.name}
            </SheetTitle>
            <ModernStatusBadge status={student.status} />
          </div>
          <SheetDescription className="text-xs text-white/70 font-mono mt-1">
            Admission ID: <span className="text-emerald-400 font-bold">{student.admission_number}</span> · Class:{' '}
            <span className="text-cyan-400 font-bold">{student.category || 'Unassigned'}</span> · Parent Phone:{' '}
            {student.parent_phone || 'Not on file'}
          </SheetDescription>
        </SheetHeader>

        {/* Action Button: Recapture 3D Face */}
        {data?.canManage && (
          <div className="mt-5 p-4 rounded-2xl bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20 border border-blue-500/30 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-white">Direct Biometric Calibration</p>
              <p className="text-[11px] text-white/60 mt-0.5">
                {student.status === 'completed'
                  ? 'Recapture 3D face to replace or enhance models'
                  : 'Perform biometric capture at school now'}
              </p>
            </div>
            <Button
              onClick={() => {
                onClose();
                onOpenRecapture(student);
              }}
              className="rounded-xl h-9 font-bold text-xs bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white hover:from-cyan-600 hover:to-indigo-700 shadow-md shadow-blue-500/20 gap-1.5"
            >
              <ScanFace className="h-4 w-4" />
              {student.status === 'completed' ? 'Recapture Face' : 'Capture Now'}
            </Button>
          </div>
        )}

        {/* Step Progress Timeline */}
        <section className="mt-6 space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Enrollment Flow Progress
          </h4>
          <ol className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/10">
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
                <div className="min-w-0">
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
        <section className="mt-6 space-y-2">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60">
            Database Record Verification
          </h4>
          <div className="flex flex-wrap gap-2">
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
                  'rounded-xl border px-3 py-1 text-xs font-bold flex items-center gap-1.5',
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

        {/* Captured 15-Angle Samples Grid */}
        {student.samples.length > 0 && (
          <section className="mt-6 space-y-3">
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
            <div className="grid grid-cols-3 gap-2.5">
              {student.samples.map((s) => (
                <figure
                  key={s.fileId}
                  className="rounded-2xl border border-white/15 bg-white/5 overflow-hidden shadow-md group"
                >
                  <div className="relative aspect-square bg-slate-900">
                    <SamplePhoto admission={student.admission_number} fileId={s.fileId} />
                  </div>
                  <figcaption className="p-2 text-[10px] bg-black/40 backdrop-blur-md">
                    <span className="font-extrabold text-white capitalize block">{s.pose}</span>
                    <span className="text-white/60 block mt-0.5">
                      Light: {s.brightness} · Sharp: {s.sharpness}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Corrections Requests */}
        {corrections.length > 0 && (
          <section className="mt-6 space-y-3">
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
        <section className="mt-6 space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            Audit Activity Trail
          </h4>
          {events.length ? (
            <ul className="space-y-2 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              {events.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 p-2 rounded-xl bg-black/20 border border-white/5">
                  <div>
                    <span className="font-bold text-white">{eventLabels[e.event] || e.event}</span>
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
  const [data, setData] = useState<MonitorOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [selectedStudentAdm, setSelectedStudentAdm] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [recaptureStudent, setRecaptureStudent] = useState<RecaptureStudent | null>(null);

  const parentLink = `${window.location.origin}/enroll`;
  const backTo = role === 'teacher' ? '/teacher' : '/admin';

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await fetchMonitor());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load enrollment data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 45000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => setLimit(PAGE), [query, category, filter]);

  const students = data?.students ?? [];

  // Summary statistics
  const stats = useMemo(() => {
    const done = students.filter((s) => s.status === 'completed').length;
    return {
      total: students.length,
      done,
      pct: students.length ? Math.round((done / students.length) * 100) : 0,
      progress: students.filter((s) => s.status === 'verified' || s.status === 'capturing').length,
      notStarted: students.filter((s) => s.status === 'not_started').length,
      failed: students.filter((s) => s.failures > 0 && s.status !== 'completed').length,
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
      if (s.status === 'completed') v.done++;
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
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Reminder Copied to Clipboard',
      description: `${pending.length} pending student invitations ready to paste into WhatsApp, Email, or SMS.`,
    });
  };

  return (
    <PageTransition>
      <div className="enrollment-shell min-h-screen">
        <div className="max-w-7xl mx-auto space-y-6 relative z-10">
          
          {/* Header Navigation Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center gap-3.5">
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-2xl bg-white/10 border border-white/15 text-white hover:bg-white/20 shrink-0"
              >
                <Link to={backTo} aria-label="Back">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                    <ScanFace className="h-6 w-6 text-emerald-400" />
                    Biometric Enrollment Radar
                  </h1>
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                </div>
                <p className="text-xs text-white/60 font-medium mt-0.5">
                  {data ? (data.scope.all ? 'All school classes' : `Assigned classes: ${data.scope.classes.join(', ')}`) : 'Live student biometric onboarding'}
                  {data && ` · Updated ${ago(data.generatedAt)}`}
                </p>
              </div>
            </div>

            {/* Quick Action Dock */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3.5 rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin text-emerald-400')} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3.5 rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm"
                onClick={copyReminder}
                disabled={!data}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5 text-cyan-400" />
                Share WhatsApp Reminder
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3.5 rounded-2xl text-xs font-bold border-white/15 bg-white/5 text-white hover:bg-white/15 shadow-sm"
                onClick={exportCsv}
                disabled={!visible.length}
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                Export CSV
              </Button>
              {data?.canManage && (
                <Button
                  size="sm"
                  className="h-9 px-3.5 rounded-2xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload ID Cards
                </Button>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm flex items-start gap-3 text-rose-200">
              <ShieldAlert className="h-5 w-5 text-rose-400 mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          {/* Loading Skeleton */}
          {loading && !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-3xl bg-white/5" />
                ))}
              </div>
              <Skeleton className="h-96 rounded-3xl bg-white/5" />
            </div>
          ) : data && (
            <>
              {/* TOP LIVE METRIC HIGHLIGHTS DECK */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
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
                  hint={`${stats.done} of ${stats.total} fully calibrated`}
                  icon={ShieldCheck}
                  tone="emerald"
                />
                <GlowStatCard
                  label="In Progress"
                  value={stats.progress}
                  hint="Active parent scans & OTPs"
                  icon={Clock}
                  tone="cyan"
                />
                <GlowStatCard
                  label="Awaiting Parent Action"
                  value={stats.notStarted}
                  hint="Invitation link sent"
                  icon={Sparkles}
                  tone="amber"
                />
                <GlowStatCard
                  label="Attention & Edits"
                  value={stats.corrections + stats.failed}
                  hint={`${stats.corrections} corrections · ${stats.failed} failed`}
                  icon={AlertCircle}
                  tone={stats.corrections + stats.failed > 0 ? 'rose' : 'default'}
                />
              </div>

              {/* CLASS SECTION COMPLETION CAROUSEL / STRIP */}
              {classes.length > 0 && (
                <div className="p-4 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white/70 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-cyan-400" />
                      Class Onboarding Progress (Click to Filter)
                    </span>
                    {category !== 'all' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCategory('all')}
                        className="h-6 text-[11px] rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 p-1 px-2"
                      >
                        Reset Class Filter ({category})
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {classes.map(([cls, stat]) => {
                      const pct = stat.total ? Math.round((stat.done / stat.total) * 100) : 0;
                      const isSelected = category === cls;
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => setCategory(category === cls ? 'all' : cls)}
                          className={cn(
                            'relative shrink-0 p-3 rounded-2xl border text-left transition-all duration-200 cursor-pointer min-w-[130px]',
                            isSelected
                              ? 'border-emerald-400 bg-emerald-500/20 shadow-md shadow-emerald-500/20 ring-2 ring-emerald-400/30'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-black text-white">Class {cls}</span>
                            <span className="text-[11px] font-mono font-bold text-emerald-400">{pct}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/10 rounded-full mt-2 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-white/50 mt-1.5 font-mono">
                            {stat.done}/{stat.total} enrolled
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* FILTER PILLS & SEARCH BAR DOCK */}
              <div className="p-4 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Filter Tabs */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
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
                          'relative shrink-0 h-9 px-3.5 rounded-2xl flex items-center gap-2 text-xs font-bold transition-all duration-200 cursor-pointer select-none active:scale-95',
                          active
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-black shadow-lg shadow-emerald-500/25'
                            : 'bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{f.label}</span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[10px] px-1.5 py-0 rounded-md font-mono',
                            active ? 'bg-black/30 text-white border-0' : 'bg-white/10 text-white/80'
                          )}
                        >
                          {count}
                        </Badge>
                      </button>
                    );
                  })}
                </div>

                {/* Search & Class Selector */}
                <div className="flex items-center gap-2 min-w-[260px]">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      placeholder="Search name, admission ID..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-9 pl-9 pr-8 text-xs rounded-2xl bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-emerald-400"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ROSTER GRID OF STUDENTS */}
              {visible.length === 0 ? (
                <div className="text-center py-16 px-4 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-3">
                  <ShieldAlert className="h-12 w-12 mx-auto text-white/30" />
                  <h3 className="text-base font-bold text-white">No students match your filter</h3>
                  <p className="text-xs text-white/60 max-w-sm mx-auto">
                    Try adjusting your search query, class selection, or status filter tab.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-white/20 text-white hover:bg-white/10"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <AnimatePresence mode="popLayout">
                    {visible.slice(0, limit).map((s) => {
                      const isComplete = s.status === 'completed';
                      const isCapturing = s.status === 'capturing' || s.status === 'verified';
                      const hasAttention = needsAttention(s);

                      return (
                        <motion.div
                          key={s.admission_number}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className={cn(
                            'group relative rounded-3xl border p-4 backdrop-blur-xl transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-md',
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
                          <div>
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 border border-white/15 flex items-center justify-center font-black text-sm text-white overflow-hidden shrink-0 shadow-inner">
                                  {s.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-sm font-extrabold text-white truncate group-hover:text-emerald-300 transition-colors">
                                    {s.name}
                                  </h4>
                                  <div className="flex items-center gap-1.5 text-xs text-white/60 font-mono mt-0.5">
                                    <span>ID: {s.admission_number}</span>
                                    {s.category && <span>• Class {s.category}</span>}
                                  </div>
                                </div>
                              </div>

                              <ModernStatusBadge status={s.status} />
                            </div>

                            {/* Indicators Pill Strip */}
                            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/10 text-[10px] font-medium">
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

                          {/* Actions Footer */}
                          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedStudentAdm(s.admission_number)}
                              className="flex-1 h-8 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/15 text-white gap-1.5"
                            >
                              <Eye className="h-3.5 w-3.5 text-cyan-400" />
                              Inspect
                            </Button>

                            {data.canManage && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  setRecaptureStudent({
                                    id: s.admission_number,
                                    name: s.name,
                                    employee_id: s.admission_number,
                                    category: s.category,
                                  })
                                }
                                className={cn(
                                  'h-8 px-3 rounded-xl text-xs font-bold gap-1 shadow-sm',
                                  isComplete
                                    ? 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-slate-950 font-black'
                                )}
                              >
                                <ScanFace className="h-3.5 w-3.5" />
                                {isComplete ? 'Re-scan' : 'Capture'}
                              </Button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Load More Pagination */}
              {visible.length > limit && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setLimit((prev) => prev + PAGE)}
                    className="rounded-2xl border-white/20 text-white hover:bg-white/10 px-6 font-bold"
                  >
                    Load More Students ({visible.length - limit} remaining)
                  </Button>
                </div>
              )}
            </>
          )}

        </div>

        {/* Slide-over Inspection Sheet */}
        {selectedStudent && (
          <StudentDetailSheet
            student={selectedStudent}
            data={data}
            onClose={() => setSelectedStudentAdm(null)}
            onChanged={() => void load(true)}
            onOpenRecapture={(st) =>
              setRecaptureStudent({
                id: st.admission_number,
                name: st.name,
                employee_id: st.admission_number,
                category: st.category,
              })
            }
          />
        )}

        {/* 3D Face Recapture Modal directly embedded! */}
        <CaptureFaceDialog
          open={Boolean(recaptureStudent)}
          onOpenChange={(open) => !open && setRecaptureStudent(null)}
          student={recaptureStudent}
          onSuccess={() => {
            void load(true);
            setRecaptureStudent(null);
          }}
        />

        {/* Upload ID Cards Modal */}
        {uploadOpen && (
          <Suspense fallback={null}>
            <StudentEnrollmentManager
              open={uploadOpen}
              onOpenChange={setUploadOpen}
              onImportComplete={() => {
                void load(true);
                setUploadOpen(false);
              }}
            />
          </Suspense>
        )}
      </div>
    </PageTransition>
  );
}
