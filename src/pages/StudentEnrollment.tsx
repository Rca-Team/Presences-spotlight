import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Fingerprint,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
        <div className="flex items-center gap-2.5">
          <div className="flex items-center -space-x-1 shrink-0">
            <img
              src="/kvs-logo.png"
              alt="PM Shri KV"
              className="h-7 w-7 object-contain rounded-full bg-white p-0.5 border border-white/10 shadow-sm"
            />
            <img
              src="/logo.png"
              alt="Presences AI"
              className="h-7 w-7 object-contain rounded-full bg-slate-900 p-1 border border-white/10 shadow-sm"
            />
          </div>
          <div>
            <span className="text-xs font-semibold text-white block leading-tight">PM Shri Kendriya Vidyalaya</span>
            <span className="text-[10px] text-slate-400">Student Biometric Enrollment</span>
          </div>
        </div>

        {(isStaffBypass || returnTo !== '/') ? (
          <Link
            to={returnTo}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-all"
          >
            <ArrowLeft size={13} />
            <span>Back</span>
          </Link>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400">
            <LockKeyhole size={11} className="text-emerald-400" />
            <span>Secure</span>
          </div>
        )}
      </header>

      {/* Clean Minimal Step Progress Indicator */}
      {phase !== 'done' && (
        <div className="max-w-[500px] mx-auto mt-4 mb-2 px-1">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
            <span>Step {currentStepIndex + 1} of 4: {stepsList[currentStepIndex].shortLabel}</span>
            <span className="text-[11px] font-mono text-emerald-400">{Math.round(((currentStepIndex + 1) / 4) * 100)}%</span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${((currentStepIndex + 1) / 4) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className={cn('enrollment-layout', (phase === 'idphoto' || phase === 'capture' || phase === 'review') && 'is-wide')}>
        <section className={cn('enrollment-glass', (phase === 'idphoto' || phase === 'capture' || phase === 'review') && 'w-full')}>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              {phase === 'verify' && (
                <>
                  <div className="text-center mb-6">
                    <div className="enrollment-icon mx-auto"><Fingerprint size={20} /></div>
                    <h2 className="text-xl font-bold text-white">Find Student</h2>
                    <p className="enrollment-muted text-xs">Enter your details to locate student record</p>
                  </div>

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
                    className="space-y-4 text-left"
                  >
                    <div>
                      <label className="text-xs font-medium text-slate-300 block mb-1.5">
                        Student Admission Number
                      </label>
                      <Input
                        required
                        value={admission}
                        onChange={e => setAdmission(e.target.value)}
                        placeholder="e.g. 10425"
                        autoComplete="off"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 h-11"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-300 block mb-1.5">
                        Registered Parent Phone
                      </label>
                      <Input
                        required
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="e.g. 9876543210"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 h-11"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-300 block mb-1.5">
                        Student Date of Birth
                      </label>
                      <DobDatePicker
                        value={dob}
                        onChange={setDob}
                        required
                      />
                    </div>

                    <Button disabled={busy} className="w-full mt-2 font-semibold h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center gap-2 shadow-sm">
                      {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
                    </Button>
                  </form>
                </>
              )}

              {phase === 'consent' && (
                <>
                  <div className="text-center mb-5">
                    <div className="enrollment-icon mx-auto"><ShieldCheck size={20} /></div>
                    <h2 className="text-xl font-bold text-white">
                      Camera Preparation
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Student: <span className="text-white font-medium">{session?.student.name}</span>{' '}
                      <span className="font-mono text-emerald-400">({session?.student.admission_number})</span>
                    </p>
                  </div>

                  {isStaffBypass && (
                    <div className="mb-4 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs text-left flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>Staff verification bypass active</span>
                    </div>
                  )}

                  {/* Concise practical camera guidance */}
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-slate-300 space-y-2 text-left mb-4">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>Ensure good, direct face lighting without heavy shadows.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>Hold camera straight at eye level and follow the on-screen prompts.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>If wearing spectacles, you'll be prompted with and without glasses.</span>
                    </div>
                  </div>

                  {/* Simple practical consent check */}
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-xs text-slate-300 text-left cursor-pointer hover:bg-white/[0.04] transition-all mb-4">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded accent-emerald-500 cursor-pointer shrink-0"
                    />
                    <span>
                      I authorize facial biometric capture for school attendance under PM Shri KV guidelines.
                    </span>
                  </label>

                  <Button
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold h-11 rounded-xl flex items-center justify-center gap-2 shadow-sm"
                    disabled={!consent || expired}
                    onClick={() => setPhase('capture')}
                  >
                    <Camera size={16} />
                    <span>Start Camera</span>
                    <ArrowRight className="h-4 w-4" />
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
      <footer className="max-w-[500px] mx-auto py-6 mt-8 text-center text-xs text-slate-500 border-t border-white/5">
        PM Shri Kendriya Vidyalaya NFC Vigyan Vihar · Presences AI
      </footer>
    </main>
  );
}
