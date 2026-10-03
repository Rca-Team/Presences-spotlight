import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  ArrowLeft, RefreshCw, Download, Upload, Copy, Search, ScanFace, ShieldCheck, ShieldAlert,
  Clock, Users, FileEdit, Loader2, Activity, Image as ImageIcon, PhoneOff, CheckCircle2, Glasses, AlertCircle,
} from 'lucide-react';
import PageLayout from '@/components/layouts/PageLayout';
import PageTransition from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import { fieldLabels, type StudentDetails } from '@/services/enrollment/types';
import {
  fetchMonitor, fetchMonitorPhoto, reviewCorrection, statusMeta, eventLabels, methodLabels, REQUIRED_POSES,
  type MonitorOverview, type MonitorStudent, type MonitorStatus, type MonitorCorrection,
} from '@/services/enrollment/monitor';

const StudentEnrollmentManager = lazy(() => import('@/components/admin/StudentEnrollmentManager'));

type Filter = 'all' | 'not_started' | 'in_progress' | 'failed' | 'completed' | 'attention';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'failed', label: 'Failed' },
  { id: 'completed', label: 'Enrolled' },
  { id: 'attention', label: 'Needs attention' },
];
const PAGE = 100;
const ago = (t: number) => (t ? formatDistanceToNow(t, { addSuffix: true }) : '—');
const needsAttention = (s: MonitorStudent) => Boolean(s.correction) || !s.hasPhone || s.failures > 0;
const matchesFilter = (s: MonitorStudent, f: Filter) =>
  f === 'all' ? true
    : f === 'in_progress' ? s.status === 'verified' || s.status === 'capturing'
    : f === 'attention' ? needsAttention(s)
    : s.status === f;

function StatusBadge({ status }: { status: MonitorStatus }) {
  const m = statusMeta[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', m.tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />{m.label}
    </span>
  );
}

function Stat({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3.5 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        <p className="text-2xl font-bold tabular-nums mt-0.5">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
      </div>
      <div className="h-8 w-8 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground shrink-0"><Icon className="h-4 w-4" /></div>
    </div>
  );
}

function SamplePhoto({ admission, fileId }: { admission: string; fileId: string }) {
  const [src, setSrc] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const load = async () => {
    setState('loading');
    try { setSrc(await fetchMonitorPhoto(admission, fileId)); setState('idle'); } catch { setState('error'); }
  };
  if (src) return <img src={src} alt="Enrollment capture" className="absolute inset-0 h-full w-full object-cover" />;
  return (
    <button type="button" onClick={load} className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground hover:bg-muted/80 transition-colors">
      {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'error' ? <AlertCircle className="h-4 w-4 text-destructive" /> : <ImageIcon className="h-4 w-4" />}
      {state === 'error' ? 'Retry' : 'View'}
    </button>
  );
}

function CorrectionCard({ c, canManage, onReviewed }: { c: MonitorCorrection; canManage: boolean; onReviewed: () => void }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const act = async (approve: boolean) => {
    setBusy(true);
    try { await reviewCorrection(c.id, approve); toast({ title: approve ? 'Correction approved' : 'Correction rejected' }); onReviewed(); }
    catch (e) { toast({ title: 'Could not review', description: e instanceof Error ? e.message : 'Retry shortly', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-border/70 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold truncate">{c.name} <span className="text-muted-foreground font-normal">· {c.student} · {c.category || '—'}</span></p>
        <Badge variant="outline" className="text-[10px] capitalize shrink-0">{c.status}</Badge>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        {Object.entries(c.changes).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
            <dt className="text-muted-foreground">{fieldLabels[k as keyof StudentDetails] || k}</dt>
            <dd><span className="line-through text-muted-foreground">{c.original?.[k as keyof StudentDetails] || '(blank)'}</span> → <span className="font-medium">{v || '(blank)'}</span></dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] text-muted-foreground">Requested {ago(c.at)}</span>
        {canManage && c.status === 'pending' && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(false)}>Reject</Button>
            <Button size="sm" disabled={busy} onClick={() => act(true)}>Approve</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StudentSheet({ student, data, onClose, onChanged }: { student: MonitorStudent | null; data: MonitorOverview | null; onClose: () => void; onChanged: () => void }) {
  const events = useMemo(() => (student && data ? data.activity.filter(a => a.student === student.admission_number) : []), [student, data]);
  const corrections = useMemo(() => (student && data ? data.corrections.filter(c => c.student === student.admission_number) : []), [student, data]);
  if (!student) return null;
  const steps = [
    { label: 'Record on file', done: true, detail: student.imported ? 'Imported from ID card' : 'Existing school record' },
    { label: 'Parent verified', done: Boolean(student.verifiedAt) || ['verified', 'capturing', 'completed'].includes(student.status), detail: student.method ? methodLabels[student.method] || student.method : student.failures ? `${student.failures} failed attempt(s)` : 'Waiting' },
    { label: 'Face captured', done: student.status === 'completed', detail: student.status === 'capturing' ? `${student.inProgress?.samples.length || 0} of ${REQUIRED_POSES.length} views uploaded` : student.completedAt ? format(student.completedAt, 'd MMM yyyy, h:mm a') : 'Waiting' },
  ];
  const glasses = student.samples.some(s => s.glasses === 'with');
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 flex-wrap">{student.name} <StatusBadge status={student.status} /></SheetTitle>
          <SheetDescription>Adm. {student.admission_number} · Class {student.category || '—'} · Parent phone {student.parent_phone || 'not on file'}</SheetDescription>
        </SheetHeader>

        <section className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress</h4>
          <ol className="mt-2 space-y-2">
            {steps.map(s => (
              <li key={s.label} className="flex items-start gap-2.5">
                <span className={cn('mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center shrink-0', s.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border')}>{s.done && <CheckCircle2 className="h-3 w-3" />}</span>
                <div><p className="text-sm font-medium">{s.label}</p><p className="text-xs text-muted-foreground">{s.detail}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Record checks</h4>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {[
              ['Parent phone', student.hasPhone], ["Father's name", student.hasFather], ['Date of birth', student.hasDob],
              ['ID-card portrait', student.portrait], ['Face data on file', student.faceOnFile],
            ].map(([label, ok]) => (
              <span key={String(label)} className={cn('rounded-full border px-2 py-0.5', ok ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/30 text-amber-700 dark:text-amber-300')}>{ok ? '✓' : '!'} {label}</span>
            ))}
          </div>
          {!student.hasPhone && <p className="text-xs text-muted-foreground mt-2">Without a parent phone the SMS code cannot be sent; parents will need the father's-name fallback or staff capture.</p>}
        </section>

        {student.samples.length > 0 && (
          <section className="mt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">Captured views {glasses && <Glasses className="h-3.5 w-3.5" />}</h4>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {student.samples.map(s => (
                <figure key={s.fileId} className="rounded-xl border border-border/70 overflow-hidden">
                  <div className="relative aspect-square bg-muted"><SamplePhoto admission={student.admission_number} fileId={s.fileId} /></div>
                  <figcaption className="px-2 py-1.5 text-[10px] leading-tight">
                    <span className="font-semibold capitalize">{s.pose}</span>{s.glasses === 'with' && ' · glasses'}
                    <span className="block text-muted-foreground">Light {s.brightness} · Sharp {s.sharpness}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Photos stay private and load only when you tap them.</p>
          </section>
        )}

        {corrections.length > 0 && (
          <section className="mt-5 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Correction requests</h4>
            {corrections.map(c => <CorrectionCard key={c.id} c={c} canManage={Boolean(data?.canManage)} onReviewed={onChanged} />)}
          </section>
        )}

        <section className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</h4>
          {events.length ? (
            <ul className="mt-2 space-y-2">
              {events.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <span>{eventLabels[e.event] || e.event}{e.method && <span className="text-muted-foreground"> · {methodLabels[e.method] || e.method}</span>}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground mt-2">No activity in the last 90 days.</p>}
        </section>

        {data?.canManage && student.status !== 'completed' && (
          <div className="mt-6">
            <Button asChild variant="outline" className="w-full"><Link to={`/enroll?student=${encodeURIComponent(student.admission_number)}`}><ScanFace className="h-4 w-4 mr-2" />Capture at school</Link></Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

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
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState('all');
  const parentLink = `${window.location.origin}/enroll`;
  const backTo = role === 'teacher' ? '/teacher' : '/admin';

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setData(await fetchMonitor()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load enrollment data.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 60000);
    return () => window.clearInterval(id);
  }, [load]);
  useEffect(() => setLimit(PAGE), [query, category, filter]);

  const students = data?.students ?? [];
  const classes = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const s of students) {
      const key = s.category || 'Unassigned';
      const v = map.get(key) || { total: 0, done: 0 };
      v.total++; if (s.status === 'completed') v.done++;
      map.set(key, v);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  const stats = useMemo(() => {
    const done = students.filter(s => s.status === 'completed').length;
    return {
      total: students.length,
      done,
      pct: students.length ? Math.round((done / students.length) * 100) : 0,
      progress: students.filter(s => s.status === 'verified' || s.status === 'capturing').length,
      notStarted: students.filter(s => s.status === 'not_started').length,
      failed: students.filter(s => s.failures > 0 && s.status !== 'completed').length,
      corrections: data?.corrections.filter(c => c.status === 'pending').length ?? 0,
      noPhone: students.filter(s => !s.hasPhone).length,
    };
  }, [students, data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter(s => (category === 'all' || (s.category || 'Unassigned') === category) && matchesFilter(s, filter))
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q))
      .sort((a, b) => (a.category || '').localeCompare(b.category || '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  }, [students, query, category, filter]);

  const activity = useMemo(() => (data?.activity ?? []).filter(a => (eventFilter === 'all' || a.event === eventFilter) && (category === 'all' || a.category === category)), [data, eventFilter, category]);
  const selectedStudent = students.find(s => s.admission_number === selected) ?? null;

  const exportCsv = () => {
    const rows = [['Admission', 'Name', 'Class', 'Status', 'Verification', 'Views captured', 'Verified', 'Completed', 'Failed attempts', 'Correction pending', 'Parent phone on file']];
    for (const s of visible) rows.push([s.admission_number, s.name, s.category, statusMeta[s.status].label, methodLabels[s.method] || s.method, String(s.samples.length || s.inProgress?.samples.length || 0), s.verifiedAt ? new Date(s.verifiedAt).toISOString() : '', s.completedAt ? new Date(s.completedAt).toISOString() : '', String(s.failures), s.correction ? 'Yes' : 'No', s.hasPhone ? 'Yes' : 'No']);
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `enrollment-status-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const copyReminder = async () => {
    const pending = visible.filter(s => s.status !== 'completed');
    if (!pending.length) { toast({ title: 'Everyone in this view is enrolled' }); return; }
    const text = `Dear parents, please complete your child's face registration at ${parentLink} using the admission number.\n\nPending:\n` +
      pending.map(s => `• ${s.name} (${s.category || '—'}) – Adm ${s.admission_number}`).join('\n');
    await navigator.clipboard.writeText(text);
    toast({ title: 'Reminder copied', description: `${pending.length} pending students — paste into WhatsApp or SMS.` });
  };

  return (
    <PageTransition>
      <PageLayout className="min-h-screen bg-background pb-20 md:pb-12">
        <div className="container mx-auto px-3 sm:px-4 py-4 max-w-6xl space-y-5">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-0.5"><Link to={backTo} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link></Button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">Enrollment Monitor</h1>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {data ? (data.scope.all ? 'All classes' : `Your classes: ${data.scope.classes.join(', ')}`) : 'Face registration & parent verification'}
                  {data && ` · Updated ${ago(data.generatedAt)}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => void load()} disabled={loading}><RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />Refresh</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={copyReminder} disabled={!data}><Copy className="h-3.5 w-3.5 mr-1.5" />Copy reminder</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={exportCsv} disabled={!visible.length}><Download className="h-3.5 w-3.5 mr-1.5" />Export</Button>
              {data?.canManage && <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => setUploadOpen(true)}><Upload className="h-3.5 w-3.5 mr-1.5" />Upload ID cards</Button>}
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
              <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          {loading && !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
              <Skeleton className="h-96 rounded-2xl" />
            </div>
          ) : data && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Stat label="Students" value={stats.total} hint={stats.noPhone ? `${stats.noPhone} without parent phone` : 'All have parent phone'} icon={Users} />
                <Stat label="Face enrolled" value={`${stats.done}`} hint={`${stats.pct}% complete`} icon={ShieldCheck} />
                <Stat label="In progress" value={stats.progress} hint="Verified or capturing now" icon={Clock} />
                <Stat label="Verification issues" value={stats.failed} hint={`${stats.notStarted} not started`} icon={ShieldAlert} />
                <Stat label="Corrections pending" value={stats.corrections} hint="Parent-requested edits" icon={FileEdit} />
              </div>

              {/* Class progress */}
              {classes.length > 1 && (
                <div className="rounded-2xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Progress by class</h2>
                    {category !== 'all' && <button className="text-xs text-primary" onClick={() => setCategory('all')}>Show all</button>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {classes.map(([cat, v]) => {
                      const pct = Math.round((v.done / v.total) * 100);
                      return (
                        <button key={cat} type="button" onClick={() => setCategory(category === cat ? 'all' : cat)}
                          className={cn('rounded-xl border p-2.5 text-left transition-colors', category === cat ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/50')}>
                          <div className="flex items-baseline justify-between text-xs"><span className="font-semibold">{cat}</span><span className="text-muted-foreground tabular-nums">{v.done}/{v.total}</span></div>
                          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-primary/70')} style={{ width: `${pct}%` }} /></div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <Tabs defaultValue="students" className="space-y-3">
                <TabsList className="rounded-xl">
                  <TabsTrigger value="students" className="text-xs">Students</TabsTrigger>
                  <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
                  <TabsTrigger value="corrections" className="text-xs">Corrections{stats.corrections ? ` (${stats.corrections})` : ''}</TabsTrigger>
                </TabsList>

                <TabsContent value="students" className="space-y-3 mt-0">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or admission number" className="pl-9 h-9" aria-label="Search students" />
                    </div>
                    {classes.length > 1 && (
                      <select aria-label="Class" value={category} onChange={e => setCategory(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
                        <option value="all">All classes</option>
                        {classes.map(([c]) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                    {FILTERS.map(f => {
                      const count = students.filter(s => (category === 'all' || (s.category || 'Unassigned') === category) && matchesFilter(s, f.id)).length;
                      return (
                        <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                          className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors', filter === f.id ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted')}>
                          {f.label} <span className="opacity-60 tabular-nums">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="text-left font-medium px-3 py-2">Student</th>
                            <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Class</th>
                            <th className="text-left font-medium px-3 py-2">Status</th>
                            <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Verification</th>
                            <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Views</th>
                            <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Last activity</th>
                            <th className="px-3 py-2"><span className="sr-only">Flags</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.slice(0, limit).map(s => {
                            const views = s.samples.length || s.inProgress?.samples.length || 0;
                            return (
                              <tr key={s.admission_number} onClick={() => setSelected(s.admission_number)} className="border-t border-border/60 hover:bg-muted/40 cursor-pointer">
                                <td className="px-3 py-2.5"><p className="font-medium leading-tight">{s.name}</p><p className="text-xs text-muted-foreground">{s.admission_number}<span className="sm:hidden"> · {s.category || '—'}</span></p></td>
                                <td className="px-3 py-2.5 hidden sm:table-cell text-muted-foreground">{s.category || '—'}</td>
                                <td className="px-3 py-2.5"><StatusBadge status={s.status} /></td>
                                <td className="px-3 py-2.5 hidden md:table-cell text-xs text-muted-foreground">{methodLabels[s.method] || (s.failures ? `${s.failures} failed` : '—')}</td>
                                <td className="px-3 py-2.5 hidden md:table-cell text-xs tabular-nums">{views ? `${views}/${REQUIRED_POSES.length}` : '—'}</td>
                                <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">{ago(s.lastActivity)}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
                                    {s.correction && <FileEdit className="h-3.5 w-3.5 text-amber-500" aria-label="Correction pending" />}
                                    {!s.hasPhone && <PhoneOff className="h-3.5 w-3.5 text-amber-500" aria-label="No parent phone" />}
                                    {s.failures > 0 && s.status !== 'completed' && <ShieldAlert className="h-3.5 w-3.5 text-rose-500" aria-label="Verification failed" />}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!visible.length && <p className="p-8 text-center text-sm text-muted-foreground">No students match this view.</p>}
                    {visible.length > limit && (
                      <div className="border-t border-border/60 p-2 text-center">
                        <Button variant="ghost" size="sm" onClick={() => setLimit(l => l + PAGE)}>Show more ({visible.length - limit} remaining)</Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  <div className="rounded-2xl border border-border/70 bg-card">
                    <div className="flex items-center justify-between gap-2 p-3 border-b border-border/60">
                      <p className="text-sm font-semibold flex items-center gap-1.5"><Activity className="h-4 w-4 text-muted-foreground" />Recent activity</p>
                      <select aria-label="Event type" value={eventFilter} onChange={e => setEventFilter(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
                        <option value="all">All events</option>
                        {Object.entries(eventLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    {activity.length ? (
                      <ul className="divide-y divide-border/60">
                        {activity.slice(0, 200).map((a, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 cursor-pointer" onClick={() => setSelected(a.student)}>
                            <div className="min-w-0">
                              <p className="text-sm truncate"><span className="font-medium">{a.name}</span> <span className="text-muted-foreground">· {a.category || '—'}</span></p>
                              <p className={cn('text-xs', a.event === 'verification-failed' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                                {eventLabels[a.event] || a.event}{a.method && ` · ${methodLabels[a.method] || a.method}`}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{ago(a.at)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="p-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>}
                  </div>
                </TabsContent>

                <TabsContent value="corrections" className="mt-0 space-y-2">
                  {data.corrections.filter(c => category === 'all' || c.category === category).length ? (
                    data.corrections.filter(c => category === 'all' || c.category === category).map(c => (
                      <CorrectionCard key={c.id} c={c} canManage={data.canManage} onReviewed={() => void load(true)} />
                    ))
                  ) : <p className="rounded-2xl border border-border/70 bg-card p-8 text-center text-sm text-muted-foreground">No correction requests.</p>}
                  {!data.canManage && <p className="text-xs text-muted-foreground">Only school administrators can approve record changes.</p>}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>

        <StudentSheet student={selectedStudent} data={data} onClose={() => setSelected(null)} onChanged={() => void load(true)} />

        {data?.canManage && (
          <Sheet open={uploadOpen} onOpenChange={open => { setUploadOpen(open); if (!open) void load(true); }}>
            <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
              <SheetHeader className="text-left mb-4">
                <SheetTitle>Upload student ID cards</SheetTitle>
                <SheetDescription>Imported students appear in the monitor as “Not started” until their parent completes face registration.</SheetDescription>
              </SheetHeader>
              <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}><StudentEnrollmentManager /></Suspense>
            </SheetContent>
          </Sheet>
        )}
      </PageLayout>
    </PageTransition>
  );
}
