import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
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
  PhoneOff,
  CheckCircle2,
  Glasses,
  AlertCircle,
  Sparkles,
  Check,
  Eye,
  Camera,
  Layers,
  X,
  Phone,
  ArrowUp,
  Share2,
  RotateCcw,
  Trash2,
  MoreHorizontal,
  LayoutGrid,
  Table as TableIcon,
  UserPlus,
  Calendar,
  MapPin,
  Save,
  Pencil,
  Database,
} from 'lucide-react';
import PageTransition from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { universalDeleteStudent } from '@/services/student/studentDeletionService';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import { fieldLabels, type StudentDetails, type EnrollmentSession } from '@/services/enrollment/types';
import {
  clearMonitorCache,
  fetchMonitor,
  fetchMonitorPhoto,
  getCachedMonitorOverview,
  removeStudentFromMonitorCache,
  reviewCorrection,
  updateStudentProfileDetails,
  statusMeta,
  eventLabels,
  methodLabels,
  REQUIRED_POSES,
  type MonitorOverview,
  type MonitorStudent,
  type MonitorCorrection,
} from '@/services/enrollment/monitor';
import { ClassPDFIDCardImporter, type ExtractedStudentCard } from '@/components/register/ClassPDFIDCardImporter';
import { enrollmentApi } from '@/services/enrollment/api';
import '@/components/enrollment/enrollment.css';

const StudentStoredFaceAssets = lazy(() => import('@/components/enrollment/StudentStoredFaceAssets'));

type Filter = 'all' | 'not_started' | 'in_progress' | 'failed' | 'completed' | 'attention';
type DesktopViewMode = 'table' | 'grid';

const FILTERS: { id: Filter; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All Students', icon: Users },
  { id: 'completed', label: 'Biometric Enrolled', icon: ShieldCheck },
  { id: 'not_started', label: 'Pending Scan', icon: Sparkles },
  { id: 'in_progress', label: 'In Progress', icon: Clock },
  { id: 'attention', label: 'Needs Attention', icon: AlertCircle },
  { id: 'failed', label: 'Failed Check', icon: ShieldAlert },
];

const PAGE = 100;
const ago = (t: number) => (t ? formatDistanceToNow(t, { addSuffix: true }) : '—');
const needsAttention = (s: MonitorStudent) => Boolean(s.correction) || !s.hasPhone || s.failures > 0;
export const isStudentEnrolled = (s: MonitorStudent) =>
  s.status === 'completed' || s.faceOnFile || s.samples.length > 0 || (s.vectorCount ?? 0) > 0;

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

function ModernStatusBadge({ student, className }: { student: MonitorStudent; className?: string }) {
  const isEnrolled = isStudentEnrolled(student);
  const m = isEnrolled ? statusMeta['completed'] : statusMeta[student.status] || statusMeta['not_started'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight select-none shrink-0',
        m.tone,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

function StatCard({
  label,
  value,
  subvalue,
  hint,
  icon: Icon,
  tone = 'default',
  progress,
  onClick,
  active,
}: {
  label: string;
  value: number | string;
  subvalue?: string;
  hint?: string;
  icon: React.ElementType;
  tone?: 'emerald' | 'cyan' | 'amber' | 'rose' | 'indigo' | 'default';
  progress?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClasses = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400',
    default: 'border-slate-800 bg-slate-900/80 text-slate-300',
  }[tone];

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
      className={cn(
        'rounded-2xl border p-3.5 sm:p-4 flex flex-col justify-between transition-all',
        toneClasses,
        onClick && 'cursor-pointer hover:border-white/30 hover:bg-slate-800/70',
        active && 'ring-2 ring-emerald-400 border-emerald-400'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-medium text-slate-400 truncate">{label}</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight">
              {value}
            </span>
            {subvalue && (
              <span className="text-xs font-semibold text-slate-300 font-mono">{subvalue}</span>
            )}
          </div>
        </div>
        <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-2.5">
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full transition-all duration-500"
            />
          </div>
        </div>
      )}

      {hint && <p className="text-[11px] text-slate-400 mt-2 truncate">{hint}</p>}
    </div>
  );
}

function SamplePhoto({
  admission,
  fileId,
  directUrl,
}: {
  admission: string;
  fileId: string;
  directUrl?: string;
}) {
  const [src, setSrc] = useState(directUrl || '');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(directUrl ? 'idle' : 'loading');

  useEffect(() => {
    if (directUrl) {
      setSrc(directUrl);
      setState('idle');
      return;
    }
    let active = true;
    setSrc('');
    setState('loading');
    void fetchMonitorPhoto(admission, fileId)
      .then((image) => {
        if (active) {
          setSrc(image);
          setState('idle');
        }
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [admission, fileId, directUrl]);

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
        onError={() => {
          setSrc('');
          setState('error');
        }}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover rounded-xl"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all rounded-xl"
    >
      {state === 'loading' ? (
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
      ) : state === 'error' ? (
        <AlertCircle className="h-4 w-4 text-rose-400" />
      ) : (
        <Eye className="h-4 w-4 text-cyan-400" />
      )}
      <span className="text-[10px] font-semibold">
        {state === 'loading' ? 'Loading...' : state === 'error' ? 'Retry' : 'View'}
      </span>
    </button>
  );
}

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
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white truncate">
          {c.name}{' '}
          <span className="text-slate-400 font-normal text-xs">
            · Adm: {c.student} · Class: {c.category || '—'}
          </span>
        </p>
        <Badge variant="outline" className="text-[10px] uppercase border-amber-500/40 text-amber-300">
          {c.status}
        </Badge>
      </div>

      <dl className="space-y-1.5 text-xs">
        {Object.entries(c.changes).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_1fr] gap-2 p-2 rounded-lg bg-black/30 border border-white/5">
            <dt className="text-slate-400 font-medium">{fieldLabels[k as keyof StudentDetails] || k}</dt>
            <dd className="text-white">
              <span className="line-through text-slate-500 mr-1.5">
                {c.original?.[k as keyof StudentDetails] || '(blank)'}
              </span>
              → <span className="font-bold text-emerald-400">{v || '(blank)'}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-slate-400">Requested {ago(c.at)}</span>
        {canManage && c.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(false)}
              className="rounded-lg h-8 text-xs border-slate-700"
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(true)}
              className="rounded-lg h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Approve
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [form, setForm] = useState({
    name: '',
    class: '',
    section: '',
    roll_number: '',
    father_name: '',
    mother_name: '',
    date_of_birth: '',
    parent_phone: '',
    blood_group: '',
    pen_number: '',
    student_id_kv: '',
    address: '',
  });

  useEffect(() => {
    if (student) {
      setEditing(false);
      setForm({
        name: student.name || '',
        class: student.class || '',
        section: student.section || '',
        roll_number: student.roll_number || '',
        father_name: student.father_name || '',
        mother_name: student.mother_name || '',
        date_of_birth: student.date_of_birth || '',
        parent_phone: student.parent_phone_full || student.parent_phone || '',
        blood_group: student.blood_group || '',
        pen_number: student.pen_number || '',
        student_id_kv: student.student_id_kv || '',
        address: student.address || '',
      });
    }
  }, [student]);

  const events = useMemo(
    () => (student && data ? data.activity.filter((a) => a.student === student.admission_number) : []),
    [student, data]
  );
  const corrections = useMemo(
    () => (student && data ? data.corrections.filter((c) => c.student === student.admission_number) : []),
    [student, data]
  );

  if (!student) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await updateStudentProfileDetails(student.admission_number, form);
      toast({
        title: 'Student Profile Updated',
        description: `Saved updated details for ${form.name || student.name} to Appwrite Cloud.`,
      });
      setEditing(false);
      onChanged();
    } catch (err: any) {
      toast({
        title: 'Save Failed',
        description: err?.message || 'Could not update student record.',
        variant: 'destructive',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const glasses = student.samples.some((s) => s.glasses === 'with');
  const vecCount = student.vectorCount ?? student.samples.length;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl max-h-[100dvh] overflow-y-auto bg-slate-950 border-slate-800 text-white p-4 sm:p-6 pb-24 sm:pb-10">
        <SheetHeader className="text-left pb-4 border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-14 w-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center font-bold text-base text-white overflow-hidden shrink-0">
                {student.avatarUrl ? (
                  <img src={student.avatarUrl} alt={student.name} className="h-full w-full object-cover" />
                ) : (
                  student.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-lg sm:text-xl font-bold text-white truncate">
                  {student.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-slate-400 font-mono mt-0.5">
                  Adm No: <span className="text-emerald-400 font-semibold">{student.admission_number}</span>
                  {' · '}Class: <span className="text-cyan-400 font-semibold">{student.category || 'Unassigned'}</span>
                  {student.roll_number ? ` · Roll: ${student.roll_number}` : ''}
                </SheetDescription>
              </div>
            </div>
            <ModernStatusBadge student={student} />
          </div>
        </SheetHeader>

        {/* Action Toolbar */}
        {data?.canManage && (
          <div className="mt-4 p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenRecapture(student);
                }}
                className="rounded-lg h-9 font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              >
                <ScanFace className="h-4 w-4" />
                {isStudentEnrolled(student) ? 'Re-scan 3D Face' : 'Capture Face in Studio'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing((v) => !v)}
                className="rounded-lg h-9 text-xs border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-white gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5 text-cyan-400" />
                {editing ? 'Cancel Edit' : 'Edit Details'}
              </Button>
              {onCopyBypassLink && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyBypassLink(student)}
                  className="rounded-lg h-9 text-xs border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-white gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5 text-cyan-400" />
                  Copy Capture Link
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isStudentEnrolled(student) && onRevert && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onRevert(student);
                  }}
                  className="rounded-lg h-9 text-xs border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 gap-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Revert
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onDelete(student);
                  }}
                  className="rounded-lg h-9 text-xs border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Inline Edit Form OR Complete Student Details Grid */}
        {editing ? (
          <form onSubmit={handleSaveProfile} className="mt-5 p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Edit Student Record ({student.admission_number})
              </h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-300">Full Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-slate-300">Class</Label>
                  <Input
                    value={form.class}
                    onChange={(e) => setForm((f) => ({ ...f, class: e.target.value }))}
                    placeholder="e.g. 10"
                    className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-300">Section</Label>
                  <Input
                    value={form.section}
                    onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
                    placeholder="e.g. A"
                    className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-300">Roll No</Label>
                  <Input
                    value={form.roll_number}
                    onChange={(e) => setForm((f) => ({ ...f, roll_number: e.target.value }))}
                    className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-slate-300">Father's Name</Label>
                <Input
                  value={form.father_name}
                  onChange={(e) => setForm((f) => ({ ...f, father_name: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-300">Mother's Name</Label>
                <Input
                  value={form.mother_name}
                  onChange={(e) => setForm((f) => ({ ...f, mother_name: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-300">Parent Phone (10 digits)</Label>
                <Input
                  value={form.parent_phone}
                  onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white font-mono"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-300">Date of Birth</Label>
                <Input
                  value={form.date_of_birth}
                  onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                  placeholder="DD.MM.YYYY or YYYY-MM-DD"
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-300">KV Student ID</Label>
                <Input
                  value={form.student_id_kv}
                  onChange={(e) => setForm((f) => ({ ...f, student_id_kv: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-slate-300">PEN Number</Label>
                  <Input
                    value={form.pen_number}
                    onChange={(e) => setForm((f) => ({ ...f, pen_number: e.target.value }))}
                    className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white font-mono"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-300">Blood Group</Label>
                  <Input
                    value={form.blood_group}
                    onChange={(e) => setForm((f) => ({ ...f, blood_group: e.target.value }))}
                    className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-slate-300">Residential Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="mt-1 h-9 text-xs bg-slate-950 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={savingEdit}
                className="text-xs text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingEdit}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold gap-1.5"
              >
                {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </Button>
            </div>
          </form>
        ) : (
          <section className="mt-5 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Complete Student Profile Details
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Admission No</span>
                <span className="font-mono font-semibold text-white">{student.admission_number}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Class & Section</span>
                <span className="font-semibold text-cyan-400">{student.category || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Roll No / KV ID</span>
                <span className="font-mono text-white">
                  {student.roll_number || '—'} {student.student_id_kv ? `(${student.student_id_kv})` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Father's Name</span>
                <span className="font-semibold text-white">{student.father_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Mother's Name</span>
                <span className="font-semibold text-white">{student.mother_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Date of Birth</span>
                <span className="font-mono text-white">{student.date_of_birth || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Parent Phone</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {student.parent_phone_full || student.parent_phone || 'Not on file'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">PEN / Blood Group</span>
                <span className="font-mono text-white">
                  {student.pen_number || '—'} {student.blood_group ? `· ${student.blood_group}` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">3D Vectors Stored</span>
                <span className="font-mono font-semibold text-cyan-400">
                  {vecCount > 0 ? `${vecCount} biometric sample(s)` : '0 samples'}
                </span>
              </div>
              {student.address && (
                <div className="col-span-2 sm:col-span-3 pt-1 border-t border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">Address</span>
                  <span className="text-slate-200">{student.address}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Verification Checklist */}
        <section className="mt-5 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Data & Biometric Readiness Checks
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Parent Phone', student.hasPhone],
              ["Father's Name", student.hasFather],
              ['Date of Birth', student.hasDob],
              ['ID Portrait', student.portrait],
              ['3D Face Vectors', isStudentEnrolled(student)],
            ].map(([label, ok]) => (
              <span
                key={String(label)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium flex items-center gap-1.5',
                  ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
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
            <div className="mt-5 p-5 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-2">
              <div className="h-6 w-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-400">Loading Biometric 3D Models & Assets…</p>
            </div>
          }
        >
          <StudentStoredFaceAssets key={student.admission_number} student={student} />
        </Suspense>

        {/* Captured Samples */}
        {student.samples.length > 0 && (
          <section className="mt-5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 text-cyan-400" />
              Captured Face Samples ({student.samples.length})
              {glasses && (
                <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 text-[10px] ml-1">
                  <Glasses className="h-3 w-3 mr-1" /> Glasses
                </Badge>
              )}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {student.samples.map((s) => (
                <figure
                  key={s.fileId}
                  className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden"
                >
                  <div className="relative aspect-square bg-slate-950">
                    <SamplePhoto
                      admission={student.admission_number}
                      fileId={s.fileId}
                      directUrl={s.imageUrl}
                    />
                  </div>
                  <figcaption className="p-2 text-[10px] bg-slate-900">
                    <span className="font-bold text-white capitalize block truncate">{s.pose}</span>
                    <span className="text-slate-400 block mt-0.5 truncate">
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
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pending Correction Requests
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
        {events.length > 0 && (
          <section className="mt-5 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              Recent Activity
            </h4>
            <ul className="space-y-1.5 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              {events.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/60 last:border-0">
                  <div>
                    <span className="font-semibold text-white">{eventLabels[e.event] || e.event}</span>
                    {e.method && (
                      <span className="text-slate-400 ml-2 text-[11px]">
                        ({methodLabels[e.method] || e.method})
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

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
  const [desktopView, setDesktopView] = useState<DesktopViewMode>('table');
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
  const backTo =
    role === 'teacher'
      ? '/teacher'
      : role === 'enroller' || role === 'student_coordinator'
      ? '/attendance'
      : '/admin';

  const handleLaunchDirectCapture = (student: MonitorStudent) => {
    try {
      setLaunchingCaptureAdm(student.admission_number);

      const challenges: ('left' | 'right' | 'up')[] = ['left', 'right', 'up'];
      const cls = student.class || (student.category ? student.category.split('-')[0] : '');
      const sec =
        student.section ||
        (student.category && student.category.includes('-')
          ? student.category.split('-').slice(1).join('-')
          : '');

      const fastSession: EnrollmentSession = {
        session: `fast_${student.admission_number}_${Date.now()}`,
        expires: Date.now() + 30 * 60 * 1000,
        challenge: challenges[Math.floor(Math.random() * challenges.length)],
        student: {
          admission_number: student.admission_number,
          name: student.name,
          class: cls,
          section: sec,
          category: student.category,
          father_name: student.father_name || '',
          mother_name: student.mother_name || '',
          date_of_birth: student.date_of_birth || '',
          parent_phone: student.parent_phone_full || student.parent_phone || '',
          blood_group: student.blood_group || '',
          address: student.address || '',
        },
      };

      try {
        sessionStorage.setItem('bypass_enrollment_session', JSON.stringify(fastSession));
      } catch {
        // ignore storage quota errors
      }

      const params = new URLSearchParams({
        student: student.admission_number,
        bypass: 'true',
        direct: 'capture',
      });

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
      const result = await enrollmentApi<{ reverted: boolean }>('staff.revert', {
        admission: s.admission_number,
      });
      if (!result.reverted) throw new Error('The server did not confirm face unenrollment.');

      toast({
        title: 'Enrollment Reverted',
        description: `Biometric enrollment for ${s.name} has been cleared.`,
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
          const result = await enrollmentApi<{ reverted: boolean }>('staff.revert', {
            admission: student.admission_number,
          });
          if (!result.reverted) throw new Error('Server did not confirm unenrollment.');
          saved++;
          setSelectedAdmissions((previous) => {
            const next = new Set(previous);
            next.delete(student.admission_number);
            return next;
          });
        } catch (error) {
          failed.push(student);
          errors.push(`${student.name}: ${error instanceof Error ? error.message : 'Request failed'}`);
        }
      }
      setUnenrollTargets(failed);
      setUnenrollProgress(errors.slice(0, 3).join('\n'));
      toast({
        title: `${saved} students unenrolled`,
        description: failed.length
          ? `${failed.length} failed. Review the errors and retry.`
          : 'Students can enroll their faces again.',
        variant: failed.length ? 'destructive' : 'default',
      });
      setSelectedStudentAdm(null);
      await load(true);
    } finally {
      setUnenrollBusy(false);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!studentToDelete) return;
    const admissionToRemove = studentToDelete.admission_number;
    const nameToRemove = studentToDelete.name;
    setIsDeleting(true);
    setDeleteProgress(`Starting permanent deletion for ${nameToRemove}...`);

    removeStudentFromMonitorCache(admissionToRemove);
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        students: prev.students.filter((s) => s.admission_number !== admissionToRemove),
      };
    });
    setSelectedAdmissions((prev) => {
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
          samples: studentToDelete.samples.map((s) => ({ fileId: s.fileId })),
        },
        (status) => setDeleteProgress(status)
      );

      if (res.success) {
        toast({
          title: 'Student Permanently Deleted',
          description: `Completely removed ${nameToRemove} (${admissionToRemove}) from database and storage.`,
        });
        setStudentToDelete(null);
        setSelectedStudentAdm(null);
        await load(true);
      } else {
        toast({
          title: 'Deletion Completed with Warnings',
          description: res.errors.join('; ') || 'Some records could not be purged.',
          variant: 'destructive',
        });
        setStudentToDelete(null);
        await load(true);
      }
    } catch (err: any) {
      toast({
        title: 'Deletion Failed',
        description: err?.message || 'Could not permanently delete student.',
        variant: 'destructive',
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

    for (const student of bulkDeleteTargets) {
      removeStudentFromMonitorCache(student.admission_number);
    }
    const targetAdms = new Set(bulkDeleteTargets.map((s) => s.admission_number));
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        students: prev.students.filter((s) => !targetAdms.has(s.admission_number)),
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
            samples: student.samples.map((s) => ({ fileId: s.fileId })),
          });
          if (res.success) {
            successCount++;
            setSelectedAdmissions((prev) => {
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
          ? `${errors.length} could not be completely removed.`
          : `Permanently removed ${successCount} students from the database.`,
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

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const hasDataRef = React.useRef(Boolean(data));
  hasDataRef.current = Boolean(data);

  const load = useCallback(async (force = false) => {
    if (!force && !hasDataRef.current) setLoading(true);
    try {
      const fresh = await fetchMonitor(force);
      setData(fresh);
      setError('');
    } catch (e) {
      if (!hasDataRef.current) {
        setError(e instanceof Error ? e.message : 'Could not load enrollment data.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && (typeof navigator === 'undefined' || navigator.onLine)) {
        void load(false);
      }
    }, 120000);
    return () => window.clearInterval(id);
  }, [load]);

  const handleImportClassCards = async (cards: ExtractedStudentCard[], _batchName: string) => {
    if (!cards.length) return;
    toast({
      title: 'Saving Students...',
      description: `Fast-syncing ${cards.length} students into Appwrite Cloud...`,
    });

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const BATCH_SIZE = 50;
      let directSaved = 0;
      let directFailed = 0;

      const allAdmNumbers = Array.from(
        new Set(cards.map((c) => (c.employee_id || c.student_id_kv || '').trim()).filter(Boolean))
      );
      const existingMetaMap: Record<string, Record<string, any>> = {};
      if (allAdmNumbers.length > 0) {
        try {
          const { data: existingRows } = await supabase
            .from('profiles')
            .select('admission_number, employee_id, metadata')
            .in('admission_number', allAdmNumbers);
          for (const row of existingRows || []) {
            const key = (row.admission_number || row.employee_id || '').toLowerCase();
            try {
              existingMetaMap[key] =
                typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
            } catch {
              existingMetaMap[key] = {};
            }
          }
        } catch {}
      }

      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const chunk = cards.slice(i, i + BATCH_SIZE);
        const rows = chunk.map((c) => {
          const adm = (c.employee_id || c.student_id_kv || '').trim().replace(/\s+/g, '-');
          const rawPhone = String(c.parent_phone || c.phone || '').replace(/\D/g, '');
          const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;
          const existingMeta = existingMetaMap[adm.toLowerCase()] || {};
          const mergedMeta: Record<string, any> = {
            ...existingMeta,
            blood_group: c.blood_group || existingMeta.blood_group || '',
            pen_number: c.pen_number || existingMeta.pen_number || '',
            student_id_kv: c.student_id_kv || existingMeta.student_id_kv || '',
            mother_name: c.mother_name || existingMeta.mother_name || '',
            date_of_birth: c.date_of_birth || existingMeta.date_of_birth || '',
            address: c.address || existingMeta.address || '',
            phone_locked: true,
            source: 'pdf_upload',
            imported_from_pdf: true,
            verified_parent_phone: cleanPhone,
          };
          for (const k of Object.keys(mergedMeta)) {
            if (mergedMeta[k] === '' || mergedMeta[k] == null) delete mergedMeta[k];
          }
          return {
            full_name: c.name.trim(),
            display_name: c.name.trim(),
            admission_number: adm,
            employee_id: adm,
            roll_number: c.roll_number?.trim() || null,
            class: c.class?.trim() || null,
            section: c.section?.trim() || null,
            category: [c.class?.trim(), c.section?.trim()].filter(Boolean).join('-') || null,
            parent_phone: cleanPhone || null,
            phone: cleanPhone || null,
            parent_name: c.parent_name || c.father_name || c.mother_name || null,
            father_name: c.father_name?.trim() || null,
            blood_group: c.blood_group?.trim() || null,
            address: c.address?.trim() || null,
            role: 'student',
            metadata: JSON.stringify(mergedMeta),
            updated_at: new Date().toISOString(),
          };
        });

        try {
          const { error: upsertErr } = await supabase
            .from('profiles')
            .upsert(rows, { onConflict: 'admission_number' });
          if (upsertErr) {
            directFailed += chunk.length;
            console.warn('Upsert chunk error:', upsertErr.message);
          } else {
            directSaved += chunk.length;
          }
        } catch (chunkErr: any) {
          directFailed += chunk.length;
          console.warn('Chunk save error:', chunkErr?.message);
        }
      }

      if (directSaved > 0) {
        clearMonitorCache();
        toast({
          title:
            directFailed > 0
              ? `Partial Import (${directSaved}/${cards.length})`
              : 'Class ID Cards Imported! 🚀',
          description:
            directFailed > 0
              ? `${directSaved} students saved quickly. ${directFailed} could not be saved.`
              : `Successfully added ${directSaved} students to Enrollment Management.`,
        });
        void load(true);
        setUploadOpen(false);
        return;
      }

      const { idCardFunction } = await import('@/services/enrollment/bulkPdfExtractor');
      const result: { saved: string[]; failed: { admission_number: string; error: string }[] } = {
        saved: [],
        failed: [],
      };
      const SAVE_BATCH_SIZE = 50;
      for (let offset = 0; offset < cards.length; offset += SAVE_BATCH_SIZE) {
        const batch = await idCardFunction<typeof result>({
          action: 'idcards.save',
          approveUpdates: true,
          students: cards.slice(offset, offset + SAVE_BATCH_SIZE).map((card) => {
            const rawDigits = String(card.parent_phone || card.phone || '').replace(/\D/g, '');
            const tenDigits = rawDigits.length >= 10 ? rawDigits.slice(-10) : '';
            const validMobile = /^[6-9]\d{9}$/.test(tenDigits) ? tenDigits : '';
            const adm = (card.employee_id || card.student_id_kv || '').trim().replace(/\s+/g, '-');
            return {
              name: card.name.trim(),
              admission_number: adm,
              employee_id: adm,
              student_id_kv: (card.student_id_kv || '').trim(),
              class: (card.class || '').trim(),
              section: (card.section || '').trim(),
              father_name: (card.father_name || '').trim(),
              mother_name: (card.mother_name || '').trim(),
              parent_phone: validMobile,
              date_of_birth: (card.date_of_birth || '').trim(),
              address: (card.address || '').trim(),
              parent_email: (card.parent_email || '').trim(),
              email: (card.student_email || '').trim(),
              roll_number: (card.roll_number || '').trim(),
              blood_group: (card.blood_group || '').trim(),
              pen_number: (card.pen_number || '').trim(),
              barcode: (card.barcode || '').trim(),
            };
          }),
        });
        result.saved.push(...batch.saved);
        result.failed.push(...batch.failed);
      }

      clearMonitorCache();
      toast({
        title: 'Class ID Cards Imported! 🚀',
        description: `Successfully added ${result.saved.length || cards.length} students to Enrollment Management.`,
      });
      void load(true);
      setUploadOpen(false);
    } catch (err: any) {
      toast({
        title: 'Import Failure',
        description: err?.message || 'Some records could not be saved. Please refresh.',
        variant: 'destructive',
      });
      void load(true);
      throw err;
    }
  };

  useEffect(() => setLimit(PAGE), [query, category, filter]);

  const students = data?.students ?? [];

  // Accurate, Comprehensive Summary Statistics
  const stats = useMemo(() => {
    const total = students.length;
    const done = students.filter(isStudentEnrolled).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const progress = students.filter(
      (s) => !isStudentEnrolled(s) && (s.status === 'verified' || s.status === 'capturing')
    ).length;
    const notStarted = students.filter((s) => !isStudentEnrolled(s) && s.status === 'not_started').length;
    const failed = students.filter((s) => !isStudentEnrolled(s) && s.failures > 0).length;
    const corrections = data?.corrections.filter((c) => c.status === 'pending').length ?? 0;
    const withPhone = students.filter((s) => s.hasPhone).length;
    const noPhone = total - withPhone;
    const phonePct = total ? Math.round((withPhone / total) * 100) : 0;
    const withDob = students.filter((s) => s.hasDob).length;
    const withFather = students.filter((s) => s.hasFather).length;
    const totalVectors = students.reduce((acc, s) => acc + (s.vectorCount ?? s.samples.length), 0);
    const attentionCount = students.filter(needsAttention).length;

    return {
      total,
      done,
      pct,
      progress,
      notStarted,
      failed,
      corrections,
      withPhone,
      noPhone,
      phonePct,
      withDob,
      withFather,
      totalVectors,
      attentionCount,
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

  // Helper to score search relevance by Admission Number or Student Name
  const getSearchScore = useCallback((s: MonitorStudent, q: string): number => {
    if (!q) return 10;
    const adm = s.admission_number.toLowerCase();
    const name = s.name.toLowerCase();
    const kvId = (s.student_id_kv || '').toLowerCase();
    const father = (s.father_name || '').toLowerCase();
    const phone = s.parent_phone_full || s.parent_phone || '';

    if (adm === q || kvId === q) return 0; // Exact admission / KV ID match
    if (adm.startsWith(q) || kvId.startsWith(q)) return 1; // Admission prefix match
    if (name === q) return 2; // Exact name match
    if (name.startsWith(q)) return 3; // Name prefix match
    if (name.split(/\s+/).some((word) => word.startsWith(q))) return 4; // Any word in name starts with query
    if (adm.includes(q) || kvId.includes(q)) return 5; // Admission substring
    if (name.includes(q)) return 6; // Name substring
    if (father.includes(q) || phone.includes(q)) return 7; // Father or phone match
    return -1;
  }, []);

  // Filtered students
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((s) => (category === 'all' || (s.category || 'Unassigned') === category) && matchesFilter(s, filter))
      .filter((s) => !q || getSearchScore(s, q) >= 0)
      .sort((a, b) => {
        if (q) {
          const scoreDiff = getSearchScore(a, q) - getSearchScore(b, q);
          if (scoreDiff !== 0) return scoreDiff;
        }
        return (
          (a.category || '').localeCompare(b.category || '', undefined, { numeric: true }) ||
          a.name.localeCompare(b.name)
        );
      });
  }, [students, query, category, filter, getSearchScore]);

  // Global quick matches across ALL classes/filters when searching by Name or Admission Number
  const quickSearchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => getSearchScore(s, q) >= 0)
      .sort((a, b) => {
        const scoreDiff = getSearchScore(a, q) - getSearchScore(b, q);
        if (scoreDiff !== 0) return scoreDiff;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [students, query, getSearchScore]);

  const selectedStudent = students.find((s) => s.admission_number === selectedStudentAdm) ?? null;

  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selectedAdmissions.has(s.admission_number));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedAdmissions((prev) => {
        const next = new Set(prev);
        for (const s of visible) next.delete(s.admission_number);
        return next;
      });
    } else {
      setSelectedAdmissions((prev) => {
        const next = new Set(prev);
        for (const s of visible) next.add(s.admission_number);
        return next;
      });
    }
  };

  const exportCsv = () => {
    const rows = [
      [
        'Admission Number',
        'KV Student ID',
        'Roll Number',
        'Full Name',
        'Class Section',
        'Father Name',
        'Mother Name',
        'Date of Birth',
        'Parent Phone',
        'Blood Group',
        'PEN Number',
        'Address',
        'Biometric Status',
        '3D Vectors Count',
        'Completed Timestamp',
      ],
    ];
    for (const s of visible) {
      rows.push([
        s.admission_number,
        s.student_id_kv || '',
        s.roll_number || '',
        s.name,
        s.category || '',
        s.father_name || '',
        s.mother_name || '',
        s.date_of_birth || '',
        s.parent_phone_full || s.parent_phone || '',
        s.blood_group || '',
        s.pen_number || '',
        s.address || '',
        isStudentEnrolled(s) ? 'Face Enrolled' : statusMeta[s.status]?.label || s.status,
        String(s.vectorCount ?? s.samples.length ?? 0),
        s.completedAt ? new Date(s.completedAt).toISOString() : '',
      ]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-roster-${category !== 'all' ? `${category}-` : ''}${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyReminder = async () => {
    const pending = visible.filter((s) => !isStudentEnrolled(s));
    if (!pending.length) {
      toast({ title: 'Everyone in this view is already enrolled!' });
      return;
    }
    const text =
      `Dear parents, please complete your child's 3D face biometric registration at ${parentLink} using your registered admission number.\n\n` +
      `Pending Students (${pending.length}):\n` +
      pending.map((s) => `• ${s.name} (${s.category || '—'}) – Admission ID: ${s.admission_number}`).join('\n');

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Student Biometric Enrollment Reminder',
          text,
          url: parentLink,
        });
        return;
      } catch {}
    }

    await navigator.clipboard.writeText(text);
    toast({
      title: 'Reminder Copied to Clipboard',
      description: `${pending.length} pending student invitations ready to paste into WhatsApp or SMS.`,
    });
  };

  return (
    <PageTransition>
      <div className="enrollment-shell min-h-screen bg-slate-950 text-white pb-24 sm:pb-14">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 relative z-10">
          {/* TOP COMMAND BAR (Desktop-Logical & Mobile-Friendly) */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                asChild
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl border-slate-700 bg-slate-800/70 text-white hover:bg-slate-800 shrink-0"
              >
                <Link to={backTo} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <ScanFace className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 shrink-0" />
                    <span>Enrollment Management</span>
                  </h1>
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Appwrite Cloud Synced
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {data
                    ? `${stats.total} registered students across ${classes.length} class sections · Updated ${ago(data.generatedAt)}`
                    : 'Loading student roster and biometric status from Appwrite Cloud…'}
                </p>
              </div>
            </div>

            {/* Action Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              {data?.canManage && (
                <>
                  <Button
                    size="sm"
                    onClick={() => setUploadOpen(true)}
                    className="h-9 px-3.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm gap-1.5"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import ID Cards (PDF)
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 px-3.5 rounded-xl text-xs font-semibold border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-white gap-1.5"
                  >
                    <Link to="/register">
                      <UserPlus className="h-3.5 w-3.5 text-cyan-400" />
                      Register Student
                    </Link>
                  </Button>
                </>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={copyReminder}
                disabled={!data}
                className="h-9 px-3 rounded-xl text-xs font-medium border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200 gap-1.5"
              >
                <Share2 className="h-3.5 w-3.5 text-cyan-400" />
                Share Pending
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={exportCsv}
                disabled={!visible.length}
                className="h-9 px-3 rounded-xl text-xs font-medium border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200 gap-1.5"
              >
                <Download className="h-3.5 w-3.5 text-blue-400" />
                Export CSV ({visible.length})
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => void load(true)}
                disabled={loading}
                className="h-9 px-3 rounded-xl text-xs font-medium border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200 gap-1.5"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin text-emerald-400')} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs sm:text-sm flex items-center gap-3 text-rose-200"
            >
              <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0" />
              <div className="flex-1">{error}</div>
              <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => void load(true)}>
                Retry
              </Button>
            </div>
          )}

          {loading && !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl bg-slate-900" />
                ))}
              </div>
              <Skeleton className="h-96 rounded-2xl bg-slate-900" />
            </div>
          ) : (
            data && (
              <>
                {/* 6-CARD KPI OVERVIEW GRID (Interactive filter cards) */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <StatCard
                    label="Total Students"
                    value={stats.total}
                    hint={`${classes.length} active class sections`}
                    icon={Users}
                    tone="default"
                    active={filter === 'all'}
                    onClick={() => setFilter('all')}
                  />
                  <StatCard
                    label="Biometric Enrolled"
                    value={stats.done}
                    subvalue={`${stats.pct}%`}
                    progress={stats.pct}
                    hint={`${stats.totalVectors} total 3D face vectors`}
                    icon={ShieldCheck}
                    tone="emerald"
                    active={filter === 'completed'}
                    onClick={() => setFilter('completed')}
                  />
                  <StatCard
                    label="Pending Scan"
                    value={stats.notStarted}
                    subvalue={stats.total ? `${100 - stats.pct}%` : '0%'}
                    hint="Awaiting face calibration"
                    icon={Sparkles}
                    tone="amber"
                    active={filter === 'not_started'}
                    onClick={() => setFilter('not_started')}
                  />
                  <StatCard
                    label="In Progress"
                    value={stats.progress}
                    hint="Active capture sessions"
                    icon={Clock}
                    tone="cyan"
                    active={filter === 'in_progress'}
                    onClick={() => setFilter('in_progress')}
                  />
                  <StatCard
                    label="Profile Completeness"
                    value={`${stats.phonePct}%`}
                    subvalue={`${stats.withPhone}/${stats.total}`}
                    hint={`DOB: ${stats.withDob} · Father: ${stats.withFather}`}
                    icon={Database}
                    tone="indigo"
                  />
                  <StatCard
                    label="Needs Attention"
                    value={stats.attentionCount}
                    hint={`${stats.noPhone} no phone · ${stats.corrections} edits`}
                    icon={AlertCircle}
                    tone={stats.attentionCount > 0 ? 'rose' : 'default'}
                    active={filter === 'attention'}
                    onClick={() => setFilter('attention')}
                  />
                </div>

                {/* CLASS / SECTION SELECTOR BAR */}
                {classes.length > 0 && (
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-cyan-400" />
                        Filter by Class & Section
                      </span>
                      {category !== 'all' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCategory('all')}
                          className="h-6 text-xs text-emerald-400 hover:text-emerald-300 px-2"
                        >
                          Show All Classes (Reset {category})
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                      <button
                        type="button"
                        onClick={() => setCategory('all')}
                        className={cn(
                          'shrink-0 px-3 py-2 rounded-xl border text-left transition-all min-w-[110px]',
                          category === 'all'
                            ? 'border-emerald-400 bg-emerald-500/20 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800/60'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold">All Classes</span>
                          <span className="text-[11px] font-mono font-semibold text-emerald-400">
                            {stats.pct}%
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono mt-1">
                          {stats.done}/{stats.total} enrolled
                        </p>
                      </button>

                      {classes.map(([cls, stat]) => {
                        const pct = stat.total ? Math.round((stat.done / stat.total) * 100) : 0;
                        const isSelected = category === cls;
                        return (
                          <button
                            key={cls}
                            type="button"
                            onClick={() => setCategory(isSelected ? 'all' : cls)}
                            className={cn(
                              'shrink-0 px-3 py-2 rounded-xl border text-left transition-all min-w-[115px]',
                              isSelected
                                ? 'border-emerald-400 bg-emerald-500/20 text-white'
                                : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800/60'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold truncate">Class {cls}</span>
                              <span className="text-[11px] font-mono font-semibold text-emerald-400">{pct}%</span>
                            </div>
                            <div className="h-1 w-full bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full bg-emerald-400 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono">
                              {stat.done}/{stat.total} enrolled
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* FILTER TABS, SEARCH, BULK ACTIONS & VIEW SWITCHER */}
                <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Status Filter Tabs */}
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
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
                            ? stats.attentionCount
                            : f.id === 'not_started'
                            ? stats.notStarted
                            : stats.failed;

                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={cn(
                              'shrink-0 h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all',
                              active
                                ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                                : 'bg-slate-950/70 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800'
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="whitespace-nowrap">{f.label}</span>
                            <span
                              className={cn(
                                'text-[10px] px-1.5 py-0.2 rounded font-mono',
                                active ? 'bg-black/25 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'
                              )}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Search Input, 1-Click Direct Capture Button & Desktop View Toggle */}
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full lg:w-auto">
                      <div className="relative flex-1 lg:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-400" />
                        <Input
                          placeholder="Search student name or admission no (Press Enter to Capture)..."
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && quickSearchMatches.length > 0) {
                              e.preventDefault();
                              handleLaunchDirectCapture(quickSearchMatches[0]);
                            }
                          }}
                          className="h-9 pl-9 pr-8 text-xs rounded-xl bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-400"
                        />
                        {query && (
                          <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                            aria-label="Clear search"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* 1-Click Direct Face Capture Button for Top Match */}
                      {query.trim() && quickSearchMatches.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleLaunchDirectCapture(quickSearchMatches[0])}
                          className="h-9 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs gap-1.5 shadow-md shadow-emerald-500/20 shrink-0"
                          title={`Directly open Face Capture & Verify Details for ${quickSearchMatches[0].name} (#${quickSearchMatches[0].admission_number})`}
                        >
                          <ScanFace className="h-4 w-4" />
                          <span className="truncate max-w-[180px]">
                            Capture: {quickSearchMatches[0].name.split(' ')[0]} (#{quickSearchMatches[0].admission_number})
                          </span>
                        </Button>
                      )}

                      {/* Desktop Table vs Card Grid Switcher */}
                      <div className="hidden md:flex items-center rounded-xl bg-slate-950 border border-slate-800 p-0.5">
                        <button
                          type="button"
                          onClick={() => setDesktopView('table')}
                          className={cn(
                            'h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all',
                            desktopView === 'table'
                              ? 'bg-slate-800 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          )}
                          title="Table View (Best for Desktop)"
                        >
                          <TableIcon className="h-3.5 w-3.5" />
                          <span>Table</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDesktopView('grid')}
                          className={cn(
                            'h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all',
                            desktopView === 'grid'
                              ? 'bg-slate-800 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          )}
                          title="Card Grid View"
                        >
                          <LayoutGrid className="h-3.5 w-3.5" />
                          <span>Cards</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Instant Quick-Match & Direct Face Capture Bar when searching by Name or Admission Number */}
                  {query.trim() && quickSearchMatches.length > 0 && (
                    <div className="pt-2.5 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                          <ScanFace className="h-3.5 w-3.5" />
                          Quick Match — Click &ldquo;Capture Face &amp; Verify&rdquo; to jump straight to camera scan:
                        </span>
                        {(category !== 'all' || filter !== 'all') && visible.length === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCategory('all');
                              setFilter('all');
                            }}
                            className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline"
                          >
                            Show in full table (clear class/status filter)
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {quickSearchMatches.slice(0, 3).map((match) => {
                          const enrolled = isStudentEnrolled(match);
                          return (
                            <div
                              key={match.admission_number}
                              className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-slate-950/90 border border-emerald-500/30 hover:border-emerald-400/60 transition-all"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="h-9 w-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-white overflow-hidden shrink-0">
                                  {match.avatarUrl ? (
                                    <img
                                      src={match.avatarUrl}
                                      alt={match.name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    match.name.slice(0, 2).toUpperCase()
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-bold text-white truncate">{match.name}</p>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-mono shrink-0"
                                    >
                                      {match.category || '—'}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] text-slate-400 font-mono truncate">
                                    Adm: <span className="text-emerald-400 font-semibold">{match.admission_number}</span>
                                    {match.father_name ? ` · F: ${match.father_name}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleLaunchDirectCapture(match)}
                                  className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs gap-1.5 shadow-sm"
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                  <span>{enrolled ? 'Re-scan & Verify' : 'Capture Face & Verify'}</span>
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Bulk Selection Bar (Shown when students are selected or for quick selection) */}
                  {data.canManage && selectedAdmissions.size > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs">
                          {selectedAdmissions.size} student(s) selected
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedAdmissions(new Set())}
                          className="h-7 px-2 text-xs text-slate-400 hover:text-white"
                        >
                          Clear Selection
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={unenrollBusy || isReverting || isDeleting}
                          onClick={() => {
                            setUnenrollProgress('');
                            setUnenrollTargets(
                              students.filter((student) => selectedAdmissions.has(student.admission_number))
                            );
                          }}
                          className="h-8 px-3 rounded-lg border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Unenroll Faces ({selectedAdmissions.size})
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={unenrollBusy || isReverting || isDeleting}
                          onClick={() =>
                            setBulkDeleteTargets(
                              students.filter((student) => selectedAdmissions.has(student.admission_number))
                            )
                          }
                          className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Delete Selected ({selectedAdmissions.size})
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* STUDENT ROSTER: Empty State */}
                {visible.length === 0 ? (
                  <div className="text-center py-14 px-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <ShieldAlert className="h-10 w-10 mx-auto text-slate-500" />
                    <h3 className="text-base font-bold text-white">No students match the current filter</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Try clearing your search query, switching class sections, or importing student ID cards.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-slate-700 text-white hover:bg-slate-800 text-xs"
                        onClick={() => {
                          setQuery('');
                          setCategory('all');
                          setFilter('all');
                        }}
                      >
                        Reset Filters
                      </Button>
                      {data.canManage && (
                        <Button
                          size="sm"
                          onClick={() => setUploadOpen(true)}
                          className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                        >
                          <Upload className="h-3.5 w-3.5 mr-1.5" />
                          Import ID Cards
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* DESKTOP TABLE VIEW (Visible on md+ when desktopView === 'table') */}
                    {desktopView === 'table' && (
                      <div className="hidden md:block rounded-2xl bg-slate-900/95 border border-slate-800 overflow-hidden shadow-xl">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                {data.canManage && (
                                  <th className="py-3.5 pl-4 pr-2 w-10">
                                    <input
                                      type="checkbox"
                                      checked={allVisibleSelected}
                                      onChange={toggleSelectAllVisible}
                                      aria-label="Select all visible students"
                                      className="rounded border-slate-700 bg-slate-900"
                                    />
                                  </th>
                                )}
                                <th className="py-3.5 px-3">Student</th>
                                <th className="py-3.5 px-3">Class & Roll</th>
                                <th className="py-3.5 px-3">Parents & Phone</th>
                                <th className="py-3.5 px-3">DOB & Profile Data</th>
                                <th className="py-3.5 px-3">Biometric Status</th>
                                <th className="py-3.5 pl-3 pr-4 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/80 text-xs">
                              {visible.slice(0, limit).map((s) => {
                                const isComplete = isStudentEnrolled(s);
                                const vecCount = s.vectorCount ?? s.samples.length;
                                const phoneDisplay = s.parent_phone_full || s.parent_phone;

                                return (
                                  <tr
                                    key={s.admission_number}
                                    className="hover:bg-slate-800/50 transition-colors group"
                                  >
                                    {data.canManage && (
                                      <td className="py-3 pl-4 pr-2 align-middle">
                                        <input
                                          type="checkbox"
                                          checked={selectedAdmissions.has(s.admission_number)}
                                          onChange={(e) =>
                                            setSelectedAdmissions((prev) => {
                                              const next = new Set(prev);
                                              if (e.target.checked) next.add(s.admission_number);
                                              else next.delete(s.admission_number);
                                              return next;
                                            })
                                          }
                                          aria-label={`Select ${s.name}`}
                                          className="rounded border-slate-700 bg-slate-900"
                                        />
                                      </td>
                                    )}

                                    {/* Student Identity */}
                                    <td className="py-3 px-3 align-middle">
                                      <div className="flex items-center gap-3">
                                        <button
                                          type="button"
                                          onClick={() => setSelectedStudentAdm(s.admission_number)}
                                          className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-white overflow-hidden shrink-0 hover:ring-2 hover:ring-emerald-400 transition-all"
                                        >
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
                                        </button>
                                        <div className="min-w-0">
                                          <button
                                            type="button"
                                            onClick={() => setSelectedStudentAdm(s.admission_number)}
                                            className="font-bold text-white hover:text-emerald-400 transition-colors text-left block truncate max-w-[220px]"
                                          >
                                            {s.name}
                                          </button>
                                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono mt-0.5">
                                            <span>Adm: {s.admission_number}</span>
                                            {s.student_id_kv && <span>· KV: {s.student_id_kv}</span>}
                                          </div>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Class & Roll */}
                                    <td className="py-3 px-3 align-middle">
                                      <Badge
                                        variant="outline"
                                        className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-mono text-xs"
                                      >
                                        {s.category || 'Unassigned'}
                                      </Badge>
                                      {s.roll_number && (
                                        <span className="block text-[11px] text-slate-400 font-mono mt-1">
                                          Roll: {s.roll_number}
                                        </span>
                                      )}
                                    </td>

                                    {/* Parents & Phone */}
                                    <td className="py-3 px-3 align-middle">
                                      <div className="space-y-0.5">
                                        <p className="text-slate-200 truncate max-w-[200px]">
                                          {s.father_name ? (
                                            <>
                                              <span className="text-slate-500">F:</span> {s.father_name}
                                            </>
                                          ) : (
                                            <span className="text-slate-500 italic">Father not recorded</span>
                                          )}
                                        </p>
                                        {s.mother_name && (
                                          <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
                                            <span className="text-slate-500">M:</span> {s.mother_name}
                                          </p>
                                        )}
                                        {phoneDisplay ? (
                                          <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                                            <Phone className="h-3 w-3" />
                                            <span>{phoneDisplay}</span>
                                          </div>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-400">
                                            <PhoneOff className="h-3 w-3" /> No phone
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    {/* DOB & Data Completeness */}
                                    <td className="py-3 px-3 align-middle">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
                                          <Calendar className="h-3 w-3 text-slate-400" />
                                          <span>{s.date_of_birth || 'DOB missing'}</span>
                                          {s.blood_group && (
                                            <Badge
                                              variant="outline"
                                              className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-300"
                                            >
                                              {s.blood_group}
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span
                                            title={s.hasPhone ? 'Phone on file' : 'Missing phone'}
                                            className={cn(
                                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                              s.hasPhone
                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                : 'bg-rose-500/15 text-rose-300'
                                            )}
                                          >
                                            Phone
                                          </span>
                                          <span
                                            title={s.hasFather ? "Father's name on file" : "Missing father's name"}
                                            className={cn(
                                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                              s.hasFather
                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                : 'bg-amber-500/15 text-amber-300'
                                            )}
                                          >
                                            Parent
                                          </span>
                                          <span
                                            title={s.hasDob ? 'DOB on file' : 'Missing DOB'}
                                            className={cn(
                                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                              s.hasDob
                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                : 'bg-amber-500/15 text-amber-300'
                                            )}
                                          >
                                            DOB
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Biometric Status */}
                                    <td className="py-3 px-3 align-middle">
                                      <div className="space-y-1">
                                        <ModernStatusBadge student={s} />
                                        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                                          <Camera className="h-3 w-3 text-cyan-400" />
                                          <span>
                                            {vecCount > 0 ? `${vecCount} 3D sample(s)` : 'No face vectors'}
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Actions */}
                                    <td className="py-3 pl-3 pr-4 align-middle text-right">
                                      <div className="inline-flex items-center justify-end gap-1.5">
                                        {data.canManage && (
                                          <Button
                                            size="sm"
                                            disabled={launchingCaptureAdm === s.admission_number}
                                            onClick={() => void handleLaunchDirectCapture(s)}
                                            className={cn(
                                              'h-8 px-3 rounded-lg text-xs font-semibold gap-1.5',
                                              isComplete
                                                ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                            )}
                                          >
                                            {launchingCaptureAdm === s.admission_number ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <ScanFace className="h-3.5 w-3.5" />
                                            )}
                                            <span>{isComplete ? 'Re-scan' : 'Capture'}</span>
                                          </Button>
                                        )}

                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setSelectedStudentAdm(s.admission_number)}
                                          className="h-8 px-2.5 rounded-lg text-xs border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200 gap-1"
                                        >
                                          <Eye className="h-3.5 w-3.5 text-cyan-400" />
                                          <span>Manage</span>
                                        </Button>

                                        {data.canManage && (
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                                                aria-label="More student actions"
                                              >
                                                <MoreHorizontal className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                              align="end"
                                              className="bg-slate-900 border-slate-800 text-white w-48 rounded-xl p-1"
                                            >
                                              <DropdownMenuItem
                                                onClick={() => setSelectedStudentAdm(s.admission_number)}
                                                className="text-xs rounded-lg cursor-pointer"
                                              >
                                                <Pencil className="h-3.5 w-3.5 mr-2 text-cyan-400" />
                                                View / Edit Profile
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                onClick={() => void copyDirectCaptureLink(s)}
                                                className="text-xs rounded-lg cursor-pointer"
                                              >
                                                <Copy className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                                                Copy Capture Link
                                              </DropdownMenuItem>
                                              {isComplete && (
                                                <DropdownMenuItem
                                                  onClick={() => setRevertingStudent(s)}
                                                  className="text-xs rounded-lg cursor-pointer text-amber-300"
                                                >
                                                  <RotateCcw className="h-3.5 w-3.5 mr-2 text-amber-400" />
                                                  Revert Biometrics
                                                </DropdownMenuItem>
                                              )}
                                              <DropdownMenuSeparator className="bg-slate-800 my-1" />
                                              <DropdownMenuItem
                                                onClick={() => setStudentToDelete(s)}
                                                className="text-xs rounded-lg cursor-pointer text-rose-400"
                                              >
                                                <Trash2 className="h-3.5 w-3.5 mr-2 text-rose-400" />
                                                Delete Student
                                              </DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* MOBILE CARDS & DESKTOP CARD GRID VIEW */}
                    <div
                      className={cn(
                        'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3',
                        desktopView === 'table' && 'md:hidden'
                      )}
                    >
                      {visible.slice(0, limit).map((s) => {
                        const isComplete = isStudentEnrolled(s);
                        const vecCount = s.vectorCount ?? s.samples.length;
                        const phoneDisplay = s.parent_phone_full || s.parent_phone;

                        return (
                          <div
                            key={s.admission_number}
                            className={cn(
                              'rounded-2xl border p-4 bg-slate-900/90 flex flex-col justify-between transition-all',
                              isComplete
                                ? 'border-emerald-500/25'
                                : needsAttention(s)
                                ? 'border-amber-500/25'
                                : 'border-slate-800'
                            )}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  {data.canManage && (
                                    <input
                                      type="checkbox"
                                      checked={selectedAdmissions.has(s.admission_number)}
                                      onChange={(e) =>
                                        setSelectedAdmissions((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(s.admission_number);
                                          else next.delete(s.admission_number);
                                          return next;
                                        })
                                      }
                                      aria-label={`Select ${s.name}`}
                                      className="rounded border-slate-700 bg-slate-950 shrink-0"
                                    />
                                  )}
                                  <div className="h-11 w-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-white overflow-hidden shrink-0">
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
                                    <h4 className="text-sm font-bold text-white truncate">{s.name}</h4>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono mt-0.5">
                                      <span>ID: {s.admission_number}</span>
                                      <span>· Class {s.category || 'Unassigned'}</span>
                                    </div>
                                  </div>
                                </div>
                                <ModernStatusBadge student={s} />
                              </div>

                              {/* Rich Student Info Grid on Mobile Card */}
                              <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                                <div className="truncate">
                                  <span className="text-slate-500">Father: </span>
                                  <span className="text-slate-200 font-medium">{s.father_name || '—'}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-slate-500">DOB: </span>
                                  <span className="text-slate-200 font-mono">{s.date_of_birth || '—'}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-slate-500">Phone: </span>
                                  <span className={cn('font-mono', phoneDisplay ? 'text-emerald-400' : 'text-rose-400')}>
                                    {phoneDisplay || 'Missing'}
                                  </span>
                                </div>
                                <div className="truncate">
                                  <span className="text-slate-500">Biometrics: </span>
                                  <span className="text-cyan-400 font-mono">
                                    {vecCount > 0 ? `${vecCount} sample(s)` : '0 samples'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Card Footer Actions */}
                            <div className="flex items-center gap-2 mt-3.5 pt-2.5 border-t border-slate-800">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedStudentAdm(s.admission_number)}
                                className="flex-1 h-9 rounded-xl text-xs font-semibold border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-white gap-1.5"
                              >
                                <Eye className="h-3.5 w-3.5 text-cyan-400" />
                                Details & Edit
                              </Button>

                              {data.canManage && (
                                <>
                                  {isComplete && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setRevertingStudent(s)}
                                      className="h-9 px-2.5 rounded-xl text-xs text-amber-300 hover:bg-amber-500/20 border border-amber-500/30"
                                      title="Revert biometric enrollment"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setStudentToDelete(s)}
                                    className="h-9 px-2.5 rounded-xl text-xs text-rose-400 hover:bg-rose-500/20 border border-rose-500/30"
                                    title="Delete student"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={launchingCaptureAdm === s.admission_number}
                                    onClick={() => void handleLaunchDirectCapture(s)}
                                    className={cn(
                                      'h-9 px-3.5 rounded-xl text-xs font-semibold gap-1.5',
                                      isComplete
                                        ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    )}
                                  >
                                    {launchingCaptureAdm === s.admission_number ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <ScanFace className="h-3.5 w-3.5" />
                                    )}
                                    <span>{isComplete ? 'Re-scan' : 'Capture'}</span>
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Load More Pagination */}
                {visible.length > limit && (
                  <div className="text-center pt-3">
                    <Button
                      variant="outline"
                      onClick={() => setLimit((prev) => prev + PAGE)}
                      className="w-full sm:w-auto rounded-xl border-slate-700 bg-slate-900 text-white hover:bg-slate-800 px-6 font-semibold text-xs h-10"
                    >
                      Show More Students ({visible.length - limit} remaining)
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </div>

        {/* Mobile Scroll-To-Top Button */}
        {showScrollTop && (
          <div className="fixed bottom-4 right-4 z-40 sm:hidden">
            <Button
              size="sm"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="h-10 px-3.5 rounded-full bg-slate-900 border border-slate-700 text-white shadow-xl gap-1 text-xs font-bold"
            >
              <ArrowUp className="h-4 w-4 text-emerald-400" />
              Top
            </Button>
          </div>
        )}

        {/* Slide-over Inspection & Inline Profile Edit Sheet */}
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

        {/* Bulk Unenroll Dialog */}
        <Dialog
          open={unenrollTargets.length > 0}
          onOpenChange={(open) => {
            if (!open && !unenrollBusy) setUnenrollTargets([]);
          }}
        >
          <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
            <DialogHeader>
              <DialogTitle>Unenroll faces for {unenrollTargets.length} students?</DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                This removes saved face samples and recognition vectors so students can re-enroll. Student profiles and attendance history are kept.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-48 overflow-auto text-xs space-y-1 p-2 rounded-lg bg-slate-950 border border-slate-800">
              {unenrollTargets.map((student) => (
                <p key={student.admission_number}>
                  {student.name} · {student.admission_number} · {student.category}
                </p>
              ))}
            </div>
            {unenrollProgress && <p className="text-xs text-cyan-400 whitespace-pre-line">{unenrollProgress}</p>}
            <DialogFooter>
              <Button variant="outline" disabled={unenrollBusy} onClick={() => setUnenrollTargets([])}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={unenrollBusy} onClick={() => void handleBulkUnenroll()}>
                {unenrollBusy ? 'Unenrolling…' : 'Confirm Unenrollment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Single Revert Dialog */}
        <Dialog open={Boolean(revertingStudent)} onOpenChange={(open) => !open && setRevertingStudent(null)}>
          <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-400">
                <RotateCcw className="h-5 w-5" />
                Revert Biometric Enrollment
              </DialogTitle>
              <DialogDescription className="text-slate-300 text-xs">
                Revert biometric enrollment for <strong className="text-white">{revertingStudent?.name}</strong> (ID:{' '}
                <span className="font-mono text-emerald-300">{revertingStudent?.admission_number}</span>)?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="ghost" size="sm" disabled={isReverting} onClick={() => setRevertingStudent(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isReverting}
                onClick={() => revertingStudent && void handleRevert(revertingStudent)}
              >
                {isReverting ? 'Reverting...' : 'Yes, Revert Enrollment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Single Permanent Delete AlertDialog */}
        <AlertDialog
          open={Boolean(studentToDelete)}
          onOpenChange={(open) => {
            if (!open && !isDeleting) setStudentToDelete(null);
          }}
        >
          <AlertDialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
                <Trash2 className="h-5 w-5" />
                Permanently Delete Student?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300 text-xs space-y-2 pt-1">
                <p>
                  Permanently delete <strong className="text-white">{studentToDelete?.name}</strong> (Admission ID:{' '}
                  <span className="font-mono text-emerald-300">{studentToDelete?.admission_number}</span>) and all associated biometric records?
                </p>
                {deleteProgress && <p className="text-xs font-semibold text-cyan-400">{deleteProgress}</p>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 mt-2">
              <AlertDialogCancel
                disabled={isDeleting}
                onClick={() => setStudentToDelete(null)}
                className="border-slate-700 bg-slate-800 text-white"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmPermanentDelete();
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Permanently Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Permanent Delete AlertDialog */}
        <AlertDialog
          open={bulkDeleteTargets.length > 0}
          onOpenChange={(open) => {
            if (!open && !isDeleting) setBulkDeleteTargets([]);
          }}
        >
          <AlertDialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
                <Trash2 className="h-5 w-5" />
                Permanently Delete {bulkDeleteTargets.length} Students?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300 text-xs space-y-2 pt-1">
                <p>
                  This will permanently erase all {bulkDeleteTargets.length} selected students, their profiles, and biometric descriptors from Appwrite Cloud.
                </p>
                {deleteProgress && <p className="text-xs font-semibold text-cyan-400">{deleteProgress}</p>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 mt-2">
              <AlertDialogCancel
                disabled={isDeleting}
                onClick={() => setBulkDeleteTargets([])}
                className="border-slate-700 bg-slate-800 text-white"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleBulkPermanentDelete();
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Permanent Deletion'}
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
