import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Fingerprint,
  Glasses,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sun,
  ScanFace,
  RotateCcw,
  Sparkles,
  Camera,
  Zap,
  GraduationCap,
  Phone,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import GuidedFaceCapture from '@/components/enrollment/GuidedFaceCapture';
import IdCardPhotoStep from '@/components/enrollment/IdCardPhotoStep';
import InteractiveIdCard from '@/components/enrollment/InteractiveIdCard';
import EnrollmentInformationCard from '@/components/enrollment/EnrollmentInformationCard';
import { enrollmentApi } from '@/services/enrollment/api';
import { syncEnrolledFaceDataToSupabase } from '@/services/enrollment/syncEnrolledFaceData';
import { fieldLabels, studentFields, type CaptureResult, type EnrollmentSession, type StudentDetails } from '@/services/enrollment/types';
import DobDatePicker from '@/components/enrollment/DobDatePicker';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import '@/components/enrollment/enrollment.css';

export default function StudentEnrollment() {
  const [admission, setAdmission] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [session, setSession] = useState<EnrollmentSession>();
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<'verify' | 'consent' | 'capture' | 'idphoto' | 'review' | 'done'>('verify');
  const [result, setResult] = useState<CaptureResult>();
  const [details, setDetails] = useState<StudentDetails>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingCorrections, setPendingCorrections] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isStaffBypass, setIsStaffBypass] = useState(false);
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const staffStarted = useRef(false);
  const uploadedKeysRef = useRef<Set<string>>(new Set());

  // Fast Parallel Sample Upload Pool (5 concurrent connections + caching)
  const uploadSamplesParallel = useCallback(async (
    sessionToken: string,
    samples: CaptureResult['samples'],
    onProgress?: (done: number, total: number) => void
  ) => {
    const total = samples.length;
    const pendingIndices: number[] = [];

    samples.forEach((sample, idx) => {
      const key = `${sample.pose}_${sample.glasses}_${sample.image.slice(0, 32)}`;
      if (!uploadedKeysRef.current.has(key)) {
        pendingIndices.push(idx);
      }
    });

    if (pendingIndices.length === 0) {
      onProgress?.(total, total);
      return;
    }

    let completed = total - pendingIndices.length;
    onProgress?.(completed, total);

    const CONCURRENCY = 5;
    const queue = [...pendingIndices];

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const idx = queue.shift();
        if (idx === undefined) break;
        const sample = samples[idx];
        const key = `${sample.pose}_${sample.glasses}_${sample.image.slice(0, 32)}`;
        try {
          await enrollmentApi('sample', { session: sessionToken, sample });
          uploadedKeysRef.current.add(key);
        } catch (err) {
          console.warn(`Parallel upload retry for ${sample.pose}:`, err);
        }
        completed++;
        onProgress?.(completed, total);
      }
    });

    await Promise.all(workers);
  }, []);

  const onCapture = useCallback((capture: CaptureResult) => { 
    setResult(capture); 
    setPhase('idphoto'); 
    // Ultra-Fast: Start background parallel upload immediately
    if (session?.session) {
      uploadSamplesParallel(session.session, capture.samples).catch(() => {});
    }
  }, [session?.session, uploadSamplesParallel]);

  const onIdPhotoConfirm = useCallback((finalPhotoUrl: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updatedSamples = prev.samples.map((s) => {
        if (s.pose === 'front') {
          return { ...s, image: finalPhotoUrl };
        }
        return s;
      });
      // Background upload updated front portrait
      if (session?.session) {
        uploadSamplesParallel(session.session, updatedSamples).catch(() => {});
      }
      return { ...prev, samples: updatedSamples };
    });
    setPhase('review');
  }, [session?.session, uploadSamplesParallel]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const acceptSession = async (value: EnrollmentSession, bypassMode = false) => {
    let studentDetails: StudentDetails = {
      ...value.student,
      email: value.student?.email || '',
    };

    // Preload email from profiles if not in enrollment session
    if (!studentDetails.email && value.student?.admission_number) {
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('email, parent_email')
          .or(`admission_number.eq.${value.student.admission_number},employee_id.eq.${value.student.admission_number}`)
          .limit(1)
          .maybeSingle();

        if (p?.email || p?.parent_email) {
          studentDetails = {
            ...studentDetails,
            email: p.email || p.parent_email || '',
          };
        }
      } catch {
        // Non-blocking fallback
      }
    }

    setSession(value);
    setDetails(studentDetails);
    if (bypassMode) {
      setIsStaffBypass(true);
      setConsent(true);
    }
    setPhase('consent');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const staffAdmission = params.get('student');
    const tokenParam = params.get('token');
    const isBypass = params.get('bypass') === 'true' || params.get('bypass') === '1' || Boolean(tokenParam);

    if (staffStarted.current) return;
    if (!staffAdmission && !tokenParam) return;
    staffStarted.current = true;

    // Check sessionStorage first for instantaneous 0ms transition
    try {
      const cachedStr = sessionStorage.getItem('bypass_enrollment_session');
      if (cachedStr) {
        const cached = JSON.parse(cachedStr) as EnrollmentSession;
        if (
          cached?.session &&
          (!tokenParam || cached.session === tokenParam) &&
          (!staffAdmission || cached.student?.admission_number === staffAdmission)
        ) {
          sessionStorage.removeItem('bypass_enrollment_session');
          acceptSession(cached, isBypass);
          return;
        }
      }
    } catch {
      // ignore parse failure
    }

    void run(async () => {
      let sess: EnrollmentSession | null = null;
      if (tokenParam) {
        try {
          sess = await enrollmentApi<EnrollmentSession>('session.get', { session: tokenParam });
        } catch {
          // fallback to staff.session if token query failed
        }
      }
      if (!sess && staffAdmission) {
        sess = await enrollmentApi<EnrollmentSession>('staff.session', { admission: staffAdmission });
      }
      if (sess) {
        acceptSession(sess, isBypass);
      }
    });
  }, []);

  const queryParams = new URLSearchParams(window.location.search);
  const returnTo = queryParams.get('returnTo') || (isStaffBypass ? '/enrollment-monitor' : '/');
  const returnLabel = returnTo.includes('enrollment-monitor')
    ? 'Biometric Hub'
    : returnTo.includes('admin')
    ? 'Admin Dashboard'
    : returnTo.includes('teacher')
    ? 'Teacher Portal'
    : returnTo.includes('profile')
    ? 'Profile'
    : returnTo.includes('attendance')
    ? 'Attendance'
    : 'Previous Page';

  useEffect(() => {
    const replaceParam = new URLSearchParams(window.location.search).get('replace');
    if (replaceParam === 'false') setReplaceExisting(false);
    if (replaceParam === 'true') setReplaceExisting(true);
  }, []);

  async function cancelCapture() {
    if (session) {
      if (Date.now() >= session.expires) {
        setSession(undefined); setResult(undefined); setDetails(undefined); setConsent(false); setError('');
        if (isStaffBypass || returnTo !== '/') {
          navigate(returnTo);
        } else {
          setPhase('verify');
        }
        return;
      }
      await run(async () => {
        await enrollmentApi('cancel', { session: session.session });
        setSession(undefined);
        setResult(undefined);
        setConsent(false);
        if (isStaffBypass || returnTo !== '/') {
          navigate(returnTo);
        } else {
          setPhase('verify');
        }
      });
    } else if (isStaffBypass || returnTo !== '/') {
      navigate(returnTo);
    }
  }

  const expired = session && clock >= session.expires;

  const stepsList = [
    { step: 1, label: 'Verify Student', shortLabel: 'Verify' },
    { step: 2, label: '3D Face Capture', shortLabel: 'Face Scan' },
    { step: 3, label: 'ID Photo Studio', shortLabel: 'ID Photo' },
    { step: 4, label: 'Review & Submit', shortLabel: 'Review' },
  ];

  const currentStepIndex =
    phase === 'verify'
      ? 0
      : phase === 'consent' || phase === 'capture'
      ? 1
      : phase === 'idphoto'
      ? 2
      : 3;

  return (
    <main className="enrollment-shell">
      <header className="enrollment-header">
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          <a href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative">
              <img
                src="/logo.png"
                alt="Presences AI"
                className="h-8 w-8 sm:h-9 sm:w-9 object-contain drop-shadow-md group-hover:scale-105 transition-transform"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950 animate-pulse" />
            </div>
            <div className="flex flex-col leading-none">
              <div className="flex items-center gap-1.5">
                <span className="text-sm sm:text-base font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">
                  PRESENCES
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-[9px] font-mono font-extrabold text-emerald-300 leading-none">
                  AI
                </span>
              </div>
              <span className="text-[9px] text-slate-400 tracking-[0.16em] uppercase font-medium mt-0.5">
                Smart Biometrics
              </span>
            </div>
          </a>

          <span className="text-white/25 hidden sm:inline">×</span>

          {/* PM Shri Kendriya Vidyalaya Official Collaboration Badge */}
          <div className="flex items-center gap-2 bg-white/[0.08] hover:bg-white/10 transition-colors border border-white/10 px-2.5 py-1 rounded-2xl backdrop-blur-md shadow-sm">
            <img
              src="/kvs-logo.png"
              alt="Kendriya Vidyalaya Sangathan"
              className="h-5 w-5 object-contain rounded-full bg-white p-0.5 shadow-sm shrink-0"
            />
            <div className="text-left hidden sm:block">
              <p className="text-[10px] font-black tracking-wide text-white leading-tight">
                PM SHRI KENDRIYA VIDYALAYA
              </p>
              <p className="text-[8px] font-semibold text-emerald-400 tracking-wider leading-none">
                NFC VIGYAN VIHAR
              </p>
            </div>
            <span className="text-[9px] font-bold text-emerald-300 sm:hidden">
              PM Shri KV
            </span>
          </div>

          {(isStaffBypass || returnTo !== '/') && (
            <Link
              to={returnTo}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all"
            >
              <ArrowLeft size={13} />
              <span>Back to {returnLabel}</span>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 shrink-0">
          <LockKeyhole size={12} className="text-emerald-400" />
          <span>{isStaffBypass ? 'Staff Direct Studio' : 'Official KV Enrollment'}</span>
        </div>
      </header>

      {/* Mobile Step Tracker Banner */}
      <div className="lg:hidden max-w-xl mx-auto mt-4 mb-2 p-3 rounded-2xl bg-slate-900/80 backdrop-blur-md border border-white/10 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center font-black text-xs">
              {currentStepIndex + 1}
            </div>
            <span className="text-xs font-bold text-white">
              {stepsList[currentStepIndex].label}
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold text-emerald-400/90 uppercase tracking-wider">
            Step {currentStepIndex + 1} of 4
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {stepsList.map((st, i) => (
            <div
              key={st.step}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentStepIndex
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-300 shadow-sm shadow-emerald-400/50'
                  : i < currentStepIndex
                  ? 'bg-emerald-600'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>
      </div>

      <div className={cn('enrollment-layout', (phase === 'idphoto' || phase === 'capture' || phase === 'review') && 'is-wide')}>
        {phase !== 'idphoto' && phase !== 'capture' && phase !== 'review' && (
          <aside className="enrollment-intro hidden lg:block space-y-6">
            {/* Visual Institutional Co-Branding Ribbon */}
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md shadow-sm">
              <img src="/kvs-logo.png" alt="KVS" className="h-6 w-6 object-contain rounded-full bg-white p-0.5" />
              <div className="text-left leading-none">
                <span className="text-[11px] font-black text-white block">PM SHRI KENDRIYA VIDYALAYA</span>
                <span className="text-[9px] font-semibold text-emerald-400">NFC Vigyan Vihar · Presences AI</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-3xl lg:text-4xl font-black text-white tracking-tight">
                Student 3D <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">Enrollment</span>
              </h1>
              <p className="text-xs text-slate-400 font-medium">
                Fast 1-minute biometric face calibration in 4 simple steps.
              </p>
            </div>

            {/* Visual Interactive Process Roadmap */}
            <div className="space-y-2.5 pt-1">
              {[
                { step: 1, title: 'Student Match', desc: 'Admission No. & DOB lookup', icon: Fingerprint },
                { step: 2, title: '3D Face Capture', desc: 'Guided multi-angle calibration', icon: Camera },
                { step: 3, title: 'ID Photo Studio', desc: 'High-res portrait selection', icon: Sparkles },
                { step: 4, title: 'Digital Student ID', desc: 'Verified school credential', icon: ShieldCheck },
              ].map((s, idx) => {
                const isCurrent = currentStepIndex === idx;
                const isDone = currentStepIndex > idx;
                const Icon = s.icon;
                return (
                  <div
                    key={s.step}
                    className={`flex items-center gap-3.5 p-3 rounded-2xl border transition-all duration-300 ${
                      isCurrent
                        ? 'bg-emerald-500/15 border-emerald-400/50 shadow-lg shadow-emerald-500/10 translate-x-1'
                        : isDone
                        ? 'bg-white/[0.04] border-emerald-500/20 text-slate-300 opacity-80'
                        : 'bg-white/[0.02] border-white/5 text-slate-500 opacity-60'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 border ${
                      isDone
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : isCurrent
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400 animate-pulse'
                        : 'bg-white/5 text-slate-400 border-white/10'
                    }`}>
                      {isDone ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${isCurrent ? 'text-white' : isDone ? 'text-slate-200' : 'text-slate-400'}`}>
                          {s.title}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-500">
                          0{s.step}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {s.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Visual Trust Badge Strip */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <Zap size={14} className="text-emerald-400 mx-auto mb-1" />
                <span className="text-[10px] font-bold text-slate-300 block">40ms Speed</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <LockKeyhole size={14} className="text-cyan-400 mx-auto mb-1" />
                <span className="text-[10px] font-bold text-slate-300 block">Encrypted</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <ShieldCheck size={14} className="text-purple-400 mx-auto mb-1" />
                <span className="text-[10px] font-bold text-slate-300 block">Private DB</span>
              </div>
            </div>
          </aside>
        )}

        <section className={cn('enrollment-glass', (phase === 'idphoto' || phase === 'capture' || phase === 'review') && 'w-full')}>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={reduced ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {phase === 'verify' && (
                <>
                  {/* Institutional Co-Branding Banner */}
                  <div className="flex items-center justify-between gap-3 mb-6 p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center -space-x-2 shrink-0">
                        <div className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center shadow-md border border-white/20 relative z-10">
                          <img src="/kvs-logo.png" alt="Kendriya Vidyalaya Sangathan" className="w-full h-full object-contain" />
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-slate-900/90 p-1.5 flex items-center justify-center shadow-md border border-emerald-400/40 relative z-20">
                          <img src="/logo.png" alt="Presences AI" className="w-full h-full object-contain" />
                        </div>
                      </div>
                      <div className="text-left pl-1">
                        <p className="text-xs font-black text-white leading-tight">PM SHRI KENDRIYA VIDYALAYA</p>
                        <p className="text-[10px] text-emerald-400 font-medium">Biometric Enrollment Powered by Presences AI</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="hidden sm:inline-flex text-[9px] font-bold px-2 py-0.5 bg-emerald-500/15 border-emerald-400/30 text-emerald-300">
                      Presences Vision AI
                    </Badge>
                  </div>

                  <div className="enrollment-icon"><Fingerprint /></div>
                  <h2 className="text-xl sm:text-2xl font-black text-white">Find your student</h2>
                  <p className="enrollment-muted text-xs">Verify identity to begin 3D biometric enrollment</p>

                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      void run(async () => {
                        const verifiedSession = await enrollmentApi<EnrollmentSession>('verify-student', {
                          admission,
                          phone,
                          dob
                        });
                        acceptSession(verifiedSession);
                      });
                    }}
                    className="space-y-4 mt-6 text-left"
                  >
                    <label className="enrollment-label">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <GraduationCap className="w-4 h-4 text-emerald-400" />
                        Student Admission Number
                      </span>
                      <Input
                        required
                        value={admission}
                        onChange={e => setAdmission(e.target.value)}
                        placeholder="e.g. 10425"
                        autoComplete="off"
                      />
                    </label>

                    <label className="enrollment-label">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <Phone className="w-4 h-4 text-cyan-400" />
                        Registered Parent Phone
                      </span>
                      <Input
                        required
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="e.g. 9876543210"
                      />
                    </label>

                    <label className="enrollment-label">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <Calendar className="w-4 h-4 text-purple-400" />
                        Student Date of Birth
                      </span>
                      <DobDatePicker
                        value={dob}
                        onChange={setDob}
                        required
                      />
                    </label>

                    <Button disabled={busy} className="enrollment-primary w-full mt-2 font-bold flex items-center justify-center gap-2">
                      {busy ? <Loader2 className="animate-spin" /> : <>Verify and Continue<ArrowRight className="h-4 w-4" /></>}
                    </Button>
                  </form>
                </>
              )}

              {phase === 'consent' && (
                <>
                  <div className="enrollment-icon"><ShieldCheck /></div>
                  <h2 className="text-xl sm:text-2xl font-black text-white">
                    Ready, {session?.student.name?.split(' ')[0] || 'Student'}!
                  </h2>
                  {isStaffBypass ? (
                    <div className="mt-3 mb-2 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs text-left flex items-center gap-2.5">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div>
                        <span className="font-bold text-emerald-200">Staff Verified:</span>{' '}
                        <span className="text-white font-medium">{session?.student.name}</span>{' '}
                        <span className="font-mono text-emerald-400">({session?.student.admission_number})</span>
                      </div>
                    </div>
                  ) : (
                    <p className="enrollment-muted text-xs">Quick 60-second Face ID calibration</p>
                  )}

                  {/* 4-Tile Visual Camera Preparation Grid */}
                  <div className="grid grid-cols-2 gap-2.5 my-5 text-left">
                    <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5 hover:border-amber-400/30 transition-all">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300">
                        <Sun size={17} />
                      </div>
                      <span className="text-xs font-bold text-white">Good Lighting</span>
                      <span className="text-[11px] text-slate-400 leading-tight">Face the light directly, avoid strong shadows</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5 hover:border-emerald-400/30 transition-all">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                        <ScanFace size={17} />
                      </div>
                      <span className="text-xs font-bold text-white">Eye Level</span>
                      <span className="text-[11px] text-slate-400 leading-tight">Hold camera upright at comfortable eye level</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5 hover:border-cyan-400/30 transition-all">
                      <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                        <Glasses size={17} />
                      </div>
                      <span className="text-xs font-bold text-white">Spectacles</span>
                      <span className="text-[11px] text-slate-400 leading-tight">Camera will guide: with and without glasses</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5 hover:border-purple-400/30 transition-all">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-400/30 flex items-center justify-center text-purple-300">
                        <RotateCcw size={17} />
                      </div>
                      <span className="text-xs font-bold text-white">Gentle Turns</span>
                      <span className="text-[11px] text-slate-400 leading-tight">Follow the green ring around your face</span>
                    </div>
                  </div>

                  {/* Visual Mode Selection: Clean Baseline vs Additive */}
                  <div className="grid grid-cols-2 gap-2 text-left my-4">
                    <button
                      type="button"
                      onClick={() => setReplaceExisting(true)}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        replaceExisting
                          ? 'bg-emerald-500/15 border-emerald-400 text-white shadow-md shadow-emerald-500/10'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Sparkles size={16} className={replaceExisting ? 'text-emerald-400' : 'text-slate-500'} />
                        {replaceExisting && <Check size={14} className="text-emerald-400" />}
                      </div>
                      <p className="text-xs font-bold text-white">Fresh 3D Scan</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Recommended fresh baseline</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setReplaceExisting(false)}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        !replaceExisting
                          ? 'bg-emerald-500/15 border-emerald-400 text-white shadow-md shadow-emerald-500/10'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Camera size={16} className={!replaceExisting ? 'text-emerald-400' : 'text-slate-500'} />
                        {!replaceExisting && <Check size={14} className="text-emerald-400" />}
                      </div>
                      <p className="text-xs font-bold text-white">Add New Angles</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Append to existing photos</p>
                    </button>
                  </div>

                  {/* Consent Confirmation */}
                  <label className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-xs leading-relaxed text-slate-300 text-left cursor-pointer hover:bg-white/[0.07] transition-all">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer shrink-0"
                    />
                    <span>
                      I authorize this biometric facial capture for school attendance under PM Shri KV guidelines.
                    </span>
                  </label>

                  <Button
                    className="w-full enrollment-primary mt-5 flex items-center justify-center gap-2 text-sm font-bold shadow-lg shadow-emerald-500/20"
                    disabled={!consent || expired}
                    onClick={() => setPhase('capture')}
                  >
                    <Camera size={16} />
                    Start 3D Camera Capture
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </>
              )}

              {phase === 'capture' && session && (
                <GuidedFaceCapture challenge={session.challenge} onComplete={onCapture} onCancel={() => void cancelCapture()} />
              )}

              {phase === 'idphoto' && session && result && (
                <IdCardPhotoStep
                  student={session.student}
                  defaultPhoto={
                    result.samples.find(
                      (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
                    )?.image || result.samples[0]?.image || ''
                  }
                  onConfirm={onIdPhotoConfirm}
                  onBack={() => setPhase('capture')}
                />
              )}

              {phase === 'review' && result && details && (
                <>
                  <div className="flex items-center gap-2 text-emerald-300 text-sm mb-4">
                    <CheckCircle2 size={18} />
                    <span>Capture & ID Photo Ready</span>
                  </div>

                  {/* Ultra-Modern Interactive 3D Student ID Card */}
                  <InteractiveIdCard
                    student={details}
                    photoUrl={
                      result.samples.find(
                        (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
                      )?.image || result.samples[0]?.image || ''
                    }
                    onEditPhoto={() => setPhase('idphoto')}
                  />

                  {/* Official Record Information Card */}
                  <div className="mt-6 mb-5">
                    <EnrollmentInformationCard
                      details={details}
                      editing={editing}
                      onToggleEditing={() => setEditing((v) => !v)}
                      onChangeField={(field, val) =>
                        setDetails((prev) => (prev ? { ...prev, [field]: val } : prev))
                      }
                      disabled={busy}
                    />
                  </div>
                  <Button
                    disabled={busy || expired}
                    className="enrollment-primary w-full mt-3"
                    onClick={() => void run(async () => {
                      const emailVal = details?.email?.trim();
                      if (!emailVal) {
                        setError('Email address is required. Please fill in the email field in the Information Record above to complete enrollment.');
                        setEditing(true);
                        return;
                      }
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
                        setError('Please enter a valid email address format (e.g. student@school.edu or parent@email.com).');
                        setEditing(true);
                        return;
                      }

                      setMessage('Finalizing photo uploads…');
                      await uploadSamplesParallel(
                        session!.session,
                        result.samples,
                        (done, total) => {
                          setMessage(`Saving photos (${done}/${total})…`);
                        }
                      );
                      setMessage('Confirming enrollment…');
                      const primaryPhoto =
                        result.samples.find(
                          (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
                        )?.image || result.samples[0]?.image || '';

                      const [saved] = await Promise.all([
                        enrollmentApi<{ completed: boolean; correctionPending: boolean }>('submit', {
                          session: session!.session,
                          consent,
                          wearsGlasses: result.wearsGlasses,
                          challenge: result.challenge,
                          blinked: result.blinked,
                          changes: details,
                        }),
                        syncEnrolledFaceDataToSupabase({
                          admission: details?.admission_number || admission,
                          details,
                          samples: result.samples,
                          wearsGlasses: result.wearsGlasses,
                          primaryPhotoUrl: primaryPhoto,
                          replaceExisting,
                        }).catch((syncErr) => {
                          console.warn('Supabase descriptor sync non-fatal warning:', syncErr);
                          return { success: false, descriptorsCount: 0 };
                        }),
                      ]);

                      setPendingCorrections(saved.correctionPending);
                      setResult(undefined);
                      setDetails(undefined);
                      setSession(undefined);
                      uploadedKeysRef.current.clear();
                      setPhase('done');
                      setMessage('');
                    })}
                  >
                    {busy ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />{message}</> : <><Check className="mr-2 h-4 w-4" />Confirm and save</>}
                  </Button>
                  <Button disabled={busy} variant="ghost" className="w-full mt-2" onClick={() => void cancelCapture()}>
                    Discard and start again
                  </Button>
                </>
              )}

              {phase === 'done' && (
                <div className="text-center py-12">
                  <div className="enrollment-icon mx-auto"><CheckCircle2 /></div>
                  <h2>You’re all set.</h2>
                  <p className="enrollment-muted mt-3">Your student’s face enrollment has been saved.</p>
                  {pendingCorrections && (
                    <p className="enrollment-inset mt-6 text-sm">Your corrections are waiting for school approval. Existing student details remain in place until reviewed.</p>
                  )}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
                    <Link
                      to={returnTo}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition-all active:scale-95"
                    >
                      <ArrowLeft size={16} />
                      Return to {returnLabel}
                    </Link>
                    <Link to="/" className="inline-block text-white/60 hover:text-white text-xs py-2">
                      Return to home
                    </Link>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {expired && <div role="alert" className="enrollment-error">Your session expired. Discard this capture and verify again.<Button variant="ghost" className="w-full mt-2" onClick={() => void cancelCapture()}>Verify again</Button></div>}
          {error && <p role="alert" className="enrollment-error">{error}</p>}
        </section>
      </div>
      <footer className="enrollment-footer py-6 mt-8 border-t border-white/10">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-slate-950 p-1 border border-white/15 flex items-center justify-center shadow-sm">
              <img src="/logo.png" alt="Presences AI" className="w-full h-full object-contain" />
            </div>
            <div className="text-left">
              <span className="font-extrabold text-white text-xs tracking-wide">PRESENCES AI</span>
              <span className="text-[10px] text-slate-400 block">Smart School Biometric Security & Attendance Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 text-[11px] text-slate-400">
            <img src="/kvs-logo.png" alt="KVS" className="h-4 w-4 object-contain rounded-full bg-white p-0.5" />
            <span className="text-slate-300 font-semibold">PM Shri Kendriya Vidyalaya NFC Vigyan Vihar</span>
            <span className="text-white/20">•</span>
            <span className="text-emerald-400 font-semibold">Official Deployment</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
