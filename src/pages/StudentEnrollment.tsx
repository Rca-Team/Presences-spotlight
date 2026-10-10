import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { prepareAppwriteBackendSamples, type CaptureResult, type EnrollmentSession, type StudentDetails } from '@/services/enrollment/types';
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
  const [expired, setExpired] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isStaffBypass, setIsStaffBypass] = useState(false);
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const staffStarted = useRef(false);
  const uploadedKeysRef = useRef<Set<string>>(new Set());
  const activeUploadRef = useRef<Promise<void> | null>(null);

  // Instant Parallel Sample Upload Pool with On-The-Fly Lightweight Compression
  const uploadSamplesParallel = useCallback(async (
    sessionToken: string,
    samples: CaptureResult['samples'],
    onProgress?: (done: number, total: number) => void
  ) => {
    const total = samples.length;
    const pendingSamples = samples.filter((sample) => {
      const key = `${sample.pose}_${sample.glasses}_${sample.image.length}_${sample.image.slice(-24)}`;
      return !uploadedKeysRef.current.has(key);
    });

    if (pendingSamples.length === 0) {
      onProgress?.(total, total);
      return;
    }

    let completed = total - pendingSamples.length;
    onProgress?.(completed, total);

    // Fast simultaneous parallel upload with lightweight image optimization
    await Promise.all(
      pendingSamples.map(async (sample) => {
        const key = `${sample.pose}_${sample.glasses}_${sample.image.length}_${sample.image.slice(-24)}`;
        try {
          let imageToSend = sample.image;
          // Quickly compress if image is large (> 110KB base64) to accelerate transfer by 5x
          if (sample.image.length > 110000 && typeof window !== 'undefined') {
            try {
              const canvas = document.createElement('canvas');
              const img = new Image();
              img.crossOrigin = 'anonymous';
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject();
                img.src = sample.image;
              });
              let w = img.width;
              let h = img.height;
              const maxDim = 420;
              if (w > maxDim || h > maxDim) {
                if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                else { w = Math.round((w * maxDim) / h); h = maxDim; }
              }
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, w, h);
                const compressed = canvas.toDataURL('image/jpeg', 0.84);
                if (compressed.length < sample.image.length) imageToSend = compressed;
              }
            } catch {
              // fallback to original image
            }
          }

          await enrollmentApi('sample', { session: sessionToken, sample: { ...sample, image: imageToSend } });
          uploadedKeysRef.current.add(key);
        } catch (err) {
          console.warn(`Parallel upload retry for ${sample.pose}:`, err);
        }
        completed++;
        onProgress?.(completed, total);
      })
    );
  }, []);

  const onCapture = useCallback((capture: CaptureResult) => { 
    setResult(capture); 
    setPhase('idphoto'); 
    // Ultra-Fast: Start background parallel upload immediately so samples are already saved when user confirms
    if (session?.session) {
      const backendSamples = prepareAppwriteBackendSamples(capture.samples, capture.wearsGlasses);
      activeUploadRef.current = uploadSamplesParallel(session.session, backendSamples).catch(() => {});
    }
  }, [session?.session, uploadSamplesParallel]);

  const onIdPhotoConfirm = useCallback((finalPhotoUrl: string) => {
    if (result) {
      const updatedSamples = result.samples.map((s) => (s.pose === 'front' ? { ...s, image: finalPhotoUrl } : s));
      const next = { ...result, samples: updatedSamples };
      setResult(next);
      // Background upload updated front portrait while student reviews
      if (session?.session) {
        const backendSamples = prepareAppwriteBackendSamples(updatedSamples, next.wearsGlasses);
        activeUploadRef.current = uploadSamplesParallel(session.session, backendSamples).catch(() => {});
      }
    }
    setPhase('review');
  }, [result, session?.session, uploadSamplesParallel]);

  // Session expiry is checked once a second but only re-renders when the flag
  // actually flips — this used to re-render the whole page every second.
  useEffect(() => {
    if (!session) {
      setExpired(false);
      return;
    }
    const check = () => {
      const isExpired = Date.now() >= session.expires;
      setExpired((prev) => (prev === isExpired ? prev : isExpired));
    };
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

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

    if (!studentDetails.category && studentDetails.class && studentDetails.section) {
      studentDetails.category = `${studentDetails.class}-${studentDetails.section.toUpperCase()}`;
    }

    // Preload email from profiles if not in enrollment session
    if (!studentDetails.email && value.student?.admission_number) {
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('email, parent_email')
          .or(`admission_number.ilike.${value.student.admission_number},employee_id.ilike.${value.student.admission_number}`)
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

  const returnTo = useMemo(
    () => new URLSearchParams(window.location.search).get('returnTo') || (isStaffBypass ? '/enrollment-monitor' : '/'),
    [isStaffBypass]
  );
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
        uploadedKeysRef.current.clear();
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
        setDetails(undefined);
        setConsent(false);
        uploadedKeysRef.current.clear();
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

  const stepsList = [
    { step: 1, label: 'Student Info', shortLabel: 'Find Student' },
    { step: 2, label: 'Face Scan', shortLabel: 'Face Scan' },
    { step: 3, label: 'ID Photo', shortLabel: 'ID Photo' },
    { step: 4, label: 'Save & Finish', shortLabel: 'Save' },
  ];

  const currentStepIndex =
    phase === 'verify'
      ? 0
      : phase === 'consent' || phase === 'capture'
      ? 1
      : phase === 'idphoto'
      ? 2
      : 3;

  const completeEnrollment = useCallback(async () => {
    if (!session || !result || !details) return;

    const emailVal = details.email?.trim();
    if (!emailVal) {
      setError('Email address is required. Please fill in your email above to complete registration.');
      setEditing(true);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setError('Please enter a valid email address (e.g. name@email.com).');
      setEditing(true);
      return;
    }

    const backendSamples = prepareAppwriteBackendSamples(result.samples, result.wearsGlasses);

    // Await any background upload that started during photo crop or review
    if (activeUploadRef.current) {
      try {
        await activeUploadRef.current;
      } catch { /* background upload already reported its own failure */ }
    }

    setMessage('Saving photos…');
    await uploadSamplesParallel(session.session, backendSamples, (done, total) => {
      setMessage(`Saving photos (${done}/${total})…`);
    });
    setMessage('Saving enrollment…');
    const primaryPhoto =
      result.samples.find(
        (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
      )?.image || result.samples[0]?.image || '';

    // 1. Sync face descriptors, 3D structure and details directly to Supabase (primary system of record)
    const supabaseSyncPromise = syncEnrolledFaceDataToSupabase({
      admission: details.admission_number || admission,
      details,
      samples: result.samples,
      wearsGlasses: result.wearsGlasses,
      primaryPhotoUrl: primaryPhoto,
      replaceExisting,
      face3DStructure: result.face3DStructure,
      masterDescriptor: result.masterDescriptor,
    }).catch((syncErr) => {
      console.warn('Supabase descriptor sync notice:', syncErr);
      return { success: false, descriptorsCount: 0, photoUrl: undefined };
    });

    // 2. Submit to Appwrite backend session with resilient fallback
    let appwriteSaved: { completed?: boolean; correctionPending?: boolean } | null = null;
    let appwriteErrMessage = '';

    try {
      appwriteSaved = await enrollmentApi<{ completed: boolean; correctionPending: boolean }>('submit', {
        session: session.session,
        consent,
        wearsGlasses: result.wearsGlasses,
        challenge: result.challenge,
        blinked: result.blinked,
        changes: details,
      });
    } catch (err: unknown) {
      console.warn('Appwrite session submission fallback:', err);
      appwriteErrMessage = err instanceof Error ? err.message : String(err || '');
    }

    // Await Supabase sync completion
    const supabaseResult = await supabaseSyncPromise;

    // If both failed, notify the user with an actionable message
    if (!appwriteSaved && (!supabaseResult || !supabaseResult.success)) {
      throw new Error(appwriteErrMessage || 'Enrollment could not be saved. Please try again.');
    }

    // Update student profile in Supabase profiles table
    if (details.admission_number || admission) {
      try {
        const adm = (details.admission_number || admission).trim();
        const finalPhotoUrl = (supabaseResult?.photoUrl && !supabaseResult.photoUrl.startsWith('data:'))
          ? supabaseResult.photoUrl
          : (primaryPhoto && !primaryPhoto.startsWith('data:'))
            ? primaryPhoto
            : undefined;

        await supabase
          .from('profiles')
          .update({
            email: emailVal,
            parent_email: emailVal,
            parent_phone: details.parent_phone?.trim() || undefined,
            phone: details.parent_phone?.trim() || undefined,
            full_name: details.name?.trim() || undefined,
            display_name: details.name?.trim() || undefined,
            class: details.class?.trim() || undefined,
            section: details.section?.trim() || undefined,
            ...(finalPhotoUrl ? { avatar_url: finalPhotoUrl, photo_url: finalPhotoUrl } : {}),
            updated_at: new Date().toISOString(),
          })
          .or(`admission_number.ilike.${adm},employee_id.ilike.${adm}`);
      } catch (profileUpdateErr) {
        console.warn('Profile metadata sync notice:', profileUpdateErr);
      }
    }

    setPendingCorrections(Boolean(appwriteSaved?.correctionPending));
    setResult(undefined);
    setDetails(undefined);
    setSession(undefined);
    uploadedKeysRef.current.clear();
    setPhase('done');
    setMessage('');
  }, [admission, consent, details, replaceExisting, result, session, uploadSamplesParallel]);

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
            <span className="text-[10px] text-slate-400">Student Attendance Registration</span>
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
                    <p className="enrollment-muted text-xs">Enter student admission number, mobile, and birth date</p>
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
                        Admission Number
                      </label>
                      <Input
                        required
                        disabled={busy}
                        value={admission}
                        onChange={e => setAdmission(e.target.value)}
                        placeholder="e.g. 10425"
                        autoComplete="off"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 h-11"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-300 block mb-1.5">
                        Parent Mobile Number
                      </label>
                      <Input
                        required
                        disabled={busy}
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
                        Date of Birth
                      </label>
                      <DobDatePicker
                        value={dob}
                        onChange={setDob}
                        required
                        disabled={busy}
                      />
                    </div>

                    <Button disabled={busy} className="w-full mt-2 font-semibold h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center gap-2 shadow-sm">
                      {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <>Find Student & Continue <ArrowRight className="h-4 w-4" /></>}
                    </Button>
                  </form>
                </>
              )}

              {phase === 'consent' && (
                <>
                  <div className="text-center mb-5">
                    <div className="enrollment-icon mx-auto"><ShieldCheck size={20} /></div>
                    <h2 className="text-xl font-bold text-white">
                      Get Ready for Camera
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Student: <span className="text-white font-medium">{session?.student.name}</span>{' '}
                      <span className="font-mono text-emerald-400">({session?.student.admission_number})</span>
                    </p>
                  </div>

                  {isStaffBypass && (
                    <div className="mb-4 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs text-left flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>Staff verification active</span>
                    </div>
                  )}

                  {/* Concise practical camera guidance for normal users */}
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-slate-300 space-y-2 text-left mb-4">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>Face the light so your face is clearly visible without dark shadows.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>Hold your device straight at eye level.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>Turn your head gently following the friendly guide bot on screen.</span>
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
                      I agree to save this face scan for school attendance.
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
                    <span>Photo ready · Review details below</span>
                  </div>

                  {/* Student ID Card Preview */}
                  <InteractiveIdCard
                    student={details}
                    photoUrl={
                      result.samples.find(
                        (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
                      )?.image || result.samples[0]?.image || ''
                    }
                    onEditPhoto={() => setPhase('idphoto')}
                  />

                  {/* Student Information Card */}
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
                    className="enrollment-primary w-full mt-3 font-bold h-12 text-sm sm:text-base rounded-2xl"
                    onClick={() => void run(completeEnrollment)}
                  >
                    {busy ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />{message}</> : <><Check className="mr-2 h-4 w-4" />Save and Finish</>}
                  </Button>
                  <Button disabled={busy} variant="ghost" className="w-full mt-2" onClick={() => void cancelCapture()}>
                    Start over
                  </Button>
                </>
              )}

              {phase === 'done' && (
                <div className="text-center py-12">
                  <div className="enrollment-icon mx-auto"><CheckCircle2 /></div>
                  <h2 className="text-2xl font-black text-white">You’re all set!</h2>
                  <p className="enrollment-muted mt-2 text-sm">Face enrollment has been saved successfully for school attendance.</p>
                  {pendingCorrections && (
                    <p className="enrollment-inset mt-6 text-xs text-amber-200">Your updated details have been submitted for school review.</p>
                  )}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
                    <Link
                      to={returnTo}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition-all active:scale-95"
                    >
                      <ArrowLeft size={16} />
                      Done & Return
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
