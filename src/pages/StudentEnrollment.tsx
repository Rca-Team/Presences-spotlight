import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Fingerprint,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import GuidedFaceCapture from '@/components/enrollment/GuidedFaceCapture';
import IdCardPhotoStep from '@/components/enrollment/IdCardPhotoStep';
import InteractiveIdCard from '@/components/enrollment/InteractiveIdCard';
import EnrollmentInformationCard from '@/components/enrollment/EnrollmentInformationCard';
import { enrollmentApi } from '@/services/enrollment/api';
import { clearMonitorCache, getCachedMonitorOverview } from '@/services/enrollment/monitor';
import { syncEnrolledFaceDataToSupabase } from '@/services/enrollment/syncEnrolledFaceData';
import { type CaptureResult, type EnrollmentSession, type StudentDetails } from '@/services/enrollment/types';
import { loadRegistrationModels } from '@/services/face-recognition/OptimizedRegistrationService';
import DobDatePicker from '@/components/enrollment/DobDatePicker';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import '@/components/enrollment/enrollment.css';

export default function StudentEnrollment() {
  const [admission, setAdmission] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [showCaptureDetails, setShowCaptureDetails] = useState(false);
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
  const [isPhoneLocked, setIsPhoneLocked] = useState(false);
  const [originalVerifiedPhone, setOriginalVerifiedPhone] = useState('');
  const { isAdminOrPrincipal, isTeacher, isEnroller, role } = useUserRole();

  const canEditPhone = Boolean(
    isAdminOrPrincipal ||
    isTeacher ||
    isEnroller ||
    role === 'admin' ||
    role === 'principal' ||
    role === 'teacher' ||
    role === 'enroller' ||
    role === 'student_coordinator' ||
    isStaffBypass
  );

  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const staffStarted = useRef(false);

  // Warm up face detection & landmark neural models in the background as soon as /enroll opens
  useEffect(() => {
    void loadRegistrationModels().catch(() => {});
  }, []);

  const onCapture = useCallback((capture: CaptureResult) => {
    setResult(capture);
    setPhase('idphoto');
  }, []);

  const onIdPhotoConfirm = useCallback((finalPhotoUrl: string) => {
    if (result) {
      const updatedSamples = result.samples.map((s) => (s.pose === 'front' ? { ...s, image: finalPhotoUrl } : s));
      setResult({ ...result, samples: updatedSamples });
    }
    setPhase('review');
  }, [result]);

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

  const acceptSession = useCallback(async (value: EnrollmentSession, bypassMode = false, directToCapture = false) => {
    const initialDetails: StudentDetails = {
      ...value.student,
      email: value.student?.email || '',
    };

    if (!initialDetails.category && initialDetails.class && initialDetails.section) {
      initialDetails.category = `${initialDetails.class}-${initialDetails.section.toUpperCase()}`;
    }

    // 1. Transition UI immediately (0ms delay) so camera opens right away on bypass/direct capture
    setSession(value);
    setDetails(initialDetails);
    if (bypassMode || directToCapture) {
      setIsStaffBypass(true);
      setConsent(true);
      setPhase('capture');
    } else {
      setPhase('consent');
    }

    // 2. Enrich student profile details & metadata in the background without blocking camera
    const studentAdm = (value.student?.admission_number || admission || '').trim();
    if (studentAdm) {
      void (async () => {
        try {
          const { data: p } = await supabase
            .from('profiles')
            .select('full_name, display_name, class, section, category, father_name, parent_name, email, parent_email, parent_phone, phone, blood_group, address, metadata')
            .or(`admission_number.ilike.${studentAdm},employee_id.ilike.${studentAdm}`)
            .limit(1)
            .maybeSingle();

          if (p) {
            let meta: Record<string, any> = {};
            try {
              meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : (p.metadata || {});
            } catch {
              meta = {};
            }

            const isPdfLocked = Boolean(
              meta.phone_locked ||
              meta.imported_from_pdf ||
              meta.source === 'pdf_upload' ||
              (value.student as any)?.phone_locked ||
              (value.student as any)?.imported_from_pdf ||
              (value.student as any)?.source === 'pdf_upload'
            );

            const verifiedPhone = (
              meta.verified_parent_phone ||
              p.parent_phone ||
              p.phone ||
              (value.student as any)?.verified_parent_phone ||
              value.student?.parent_phone ||
              ''
            ).trim();

            if (isPdfLocked) {
              setIsPhoneLocked(true);
              setOriginalVerifiedPhone(verifiedPhone);
            }

            setDetails((prev) => {
              const base = prev || initialDetails;
              const cls = base.class || p.class || '';
              const sec = base.section || p.section || '';
              return {
                ...base,
                name: base.name || p.full_name || p.display_name || '',
                class: cls,
                section: sec,
                category: base.category || p.category || (cls && sec ? `${cls}-${sec.toUpperCase()}` : cls),
                father_name: base.father_name || p.father_name || meta.father_name || p.parent_name || '',
                mother_name: base.mother_name || meta.mother_name || '',
                date_of_birth: base.date_of_birth || meta.date_of_birth || '',
                blood_group: base.blood_group || p.blood_group || meta.blood_group || '',
                address: base.address || p.address || meta.address || '',
                email: base.email || p.email || p.parent_email || '',
                parent_phone: verifiedPhone || base.parent_phone || '',
              };
            });
          }
        } catch {
          // Non-blocking background enrichment
        }
      })();
    }
  }, [admission]);

  // Helper to build an instant local session from StudentDetails so camera launches in 0ms when redirected from Student Management
  const launchInstantStudentCapture = useCallback((student: StudentDetails) => {
    const challenges: ('left' | 'right' | 'up')[] = ['left', 'right', 'up'];
    const fastSession: EnrollmentSession = {
      session: `fast_${student.admission_number}_${Date.now()}`,
      expires: Date.now() + 30 * 60 * 1000,
      challenge: challenges[Math.floor(Math.random() * challenges.length)],
      student,
    };
    setAdmission(student.admission_number);
    void acceptSession(fastSession, true, true);
  }, [acceptSession]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const staffAdmission = params.get('student');
    const tokenParam = params.get('token');
    const isBypass =
      params.get('bypass') === 'true' ||
      params.get('bypass') === '1' ||
      params.get('direct') === 'capture' ||
      Boolean(tokenParam);

    if (staffStarted.current) return;
    if (!staffAdmission && !tokenParam) return;
    staffStarted.current = true;

    // 1. Check sessionStorage first for instantaneous 0ms transition directly to Face Capture
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
          void acceptSession(cached, isBypass, true);
          return;
        }
      }
    } catch {
      // ignore parse failure
    }

    // 2. Check cached monitor overview in memory for 0ms transition if available
    if (staffAdmission) {
      const cachedMonitor = getCachedMonitorOverview();
      const found = cachedMonitor?.students?.find(
        (s) => s.admission_number.toLowerCase() === staffAdmission.trim().toLowerCase()
      );
      if (found) {
        launchInstantStudentCapture({
          admission_number: found.admission_number,
          name: found.name,
          class: found.class || (found.category ? found.category.split('-')[0] : ''),
          section:
            found.section ||
            (found.category && found.category.includes('-') ? found.category.split('-').slice(1).join('-') : ''),
          category: found.category,
          father_name: found.father_name || '',
          mother_name: found.mother_name || '',
          date_of_birth: found.date_of_birth || '',
          parent_phone: found.parent_phone_full || found.parent_phone || '',
          blood_group: found.blood_group || '',
          address: found.address || '',
        });
        return;
      }
    }

    // 3. Fallback: fetch from profiles / staff.session and go directly to capture
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
        try {
          sess = await enrollmentApi<EnrollmentSession>('staff.session', { admission: staffAdmission });
        } catch {
          // Fallback to direct Appwrite profiles lookup if cloud function is unreachable
          const { data: p } = await supabase
            .from('profiles')
            .select('full_name, display_name, admission_number, employee_id, class, section, category, father_name, parent_name, parent_phone, phone, blood_group, address, email, metadata')
            .or(`admission_number.ilike.${staffAdmission},employee_id.ilike.${staffAdmission}`)
            .limit(1)
            .maybeSingle();
          if (p) {
            let meta: Record<string, any> = {};
            try {
              meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata || {};
            } catch {}
            const cls = p.class || meta.class || '';
            const sec = p.section || meta.section || '';
            sess = {
              session: `fast_${staffAdmission}_${Date.now()}`,
              expires: Date.now() + 30 * 60 * 1000,
              challenge: 'left',
              student: {
                admission_number: p.admission_number || p.employee_id || staffAdmission,
                name: p.full_name || p.display_name || staffAdmission,
                class: cls,
                section: sec,
                category: p.category || (cls && sec ? `${cls}-${sec}` : cls),
                father_name: p.father_name || meta.father_name || p.parent_name || '',
                mother_name: meta.mother_name || '',
                date_of_birth: meta.date_of_birth || '',
                parent_phone: meta.verified_parent_phone || p.parent_phone || p.phone || '',
                blood_group: p.blood_group || meta.blood_group || '',
                address: p.address || meta.address || '',
                email: p.email || '',
              },
            };
          }
        }
      }
      if (sess) {
        await acceptSession(sess, isBypass, isBypass);
      }
    });
  }, [acceptSession, launchInstantStudentCapture]);

  const returnTo = useMemo(() => {
    const specified = new URLSearchParams(window.location.search).get('returnTo');
    if (specified) {
      if (specified.includes('enrollment-monitor') && !canEditPhone) {
        return '/';
      }
      return specified;
    }
    return (isStaffBypass && canEditPhone) ? '/enrollment-monitor' : '/';
  }, [isStaffBypass, canEditPhone]);
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
        setDetails(undefined);
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

  const stepsList = [
    { step: 1, label: 'Student Info', shortLabel: 'Verify Details' },
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

    const emailVal = details.email?.trim() || '';
    const requireEmail = !isStaffBypass && !canEditPhone;
    if (requireEmail && !emailVal) {
      setError('Email address is required. Please fill in your email above to complete registration.');
      setEditing(true);
      return;
    }
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setError('Please enter a valid email address (e.g. name@email.com).');
      setEditing(true);
      return;
    }

    setMessage('Saving face biometric & student profile…');
    const primaryPhoto =
      result.samples.find(
        (s) => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without')
      )?.image || result.samples[0]?.image || '';

    // Enforce locked phone security for PDF-imported records:
    // If the phone is locked and user is self-enrolling (not staff/teacher/principal/admin), restore the original verified phone
    const enforcedPhone = (isPhoneLocked && !canEditPhone && originalVerifiedPhone)
      ? originalVerifiedPhone
      : (details.parent_phone?.trim() || undefined);

    const secureDetails: StudentDetails = {
      ...details,
      parent_phone: enforcedPhone || '',
    };

    // Single parallel pipeline: uploads photos, saves all 128D face descriptors, and updates student profile in ~1 second
    const supabaseResult = await syncEnrolledFaceDataToSupabase({
      admission: details.admission_number || admission,
      details: secureDetails,
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

    if (!supabaseResult || !supabaseResult.success) {
      throw new Error('Enrollment could not be saved. Please check your connection and try again.');
    }

    clearMonitorCache();
    setPendingCorrections(false);
    setResult(undefined);
    setDetails(undefined);
    setSession(undefined);
    setPhase('done');
    setMessage('');
  }, [admission, canEditPhone, details, isPhoneLocked, isStaffBypass, originalVerifiedPhone, replaceExisting, result, session]);

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
            <span>Back to {returnLabel}</span>
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
                  <div className="text-center mb-5">
                    <div className="enrollment-icon mx-auto"><Fingerprint size={20} /></div>
                    <h2 className="text-xl font-bold text-white">Verify Student Details</h2>
                    <p className="enrollment-muted text-xs">
                      Enter your Admission Number, Parent Mobile Number, and Date of Birth to continue
                    </p>
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
                        await acceptSession(verifiedSession);
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
                      {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <>Verify & Continue <ArrowRight className="h-4 w-4" /></>}
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
                <div className="space-y-4">
                  {/* Live Student Identity & Details Verification Banner right on the Face Capture Step */}
                  {details && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-3.5 text-left shadow-lg">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                              <UserCheck className="h-3 w-3" />
                              Capturing Face
                            </span>
                            <h3 className="text-sm sm:text-base font-bold text-white truncate">
                              {details.name}
                            </h3>
                            <span className="text-xs font-mono font-bold text-emerald-400">
                              #{details.admission_number}
                            </span>
                            {(details.category || details.class) && (
                              <Badge variant="outline" className="text-[10px] border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-mono">
                                Class {details.category || [details.class, details.section].filter(Boolean).join('-')}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-300 mt-1">
                            <span>
                              <strong className="text-slate-400">Father:</strong> {details.father_name || '—'}
                            </span>
                            <span>
                              <strong className="text-slate-400">DOB:</strong> {details.date_of_birth || '—'}
                            </span>
                            <span>
                              <strong className="text-slate-400">Phone:</strong> {details.parent_phone || '—'}
                            </span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setShowCaptureDetails((v) => !v)}
                          className="h-8 px-3 rounded-xl border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold gap-1.5 shrink-0 self-start sm:self-center"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>{showCaptureDetails ? 'Hide Details' : 'Verify / Edit Details'}</span>
                          {showCaptureDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>

                      {showCaptureDetails && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <EnrollmentInformationCard
                            details={details}
                            editing={true}
                            onToggleEditing={() => {}}
                            onChangeField={(field, val) => {
                              if (field === 'parent_phone' && isPhoneLocked && !canEditPhone) {
                                return;
                              }
                              setDetails((prev) => (prev ? { ...prev, [field]: val } : prev));
                            }}
                            disabled={busy}
                            isPhoneLocked={isPhoneLocked}
                            canEditPhone={canEditPhone}
                            isStaffBypass={isStaffBypass || canEditPhone}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <GuidedFaceCapture challenge={session.challenge} onComplete={onCapture} onCancel={() => void cancelCapture()} />
                </div>
              )}

              {phase === 'idphoto' && session && result && (
                <IdCardPhotoStep
                  student={details || session.student}
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
                    <span>Face Captured · Verify Student Details & Save</span>
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
                      onChangeField={(field, val) => {
                        if (field === 'parent_phone' && isPhoneLocked && !canEditPhone) {
                          return;
                        }
                        setDetails((prev) => (prev ? { ...prev, [field]: val } : prev));
                      }}
                      disabled={busy}
                      isPhoneLocked={isPhoneLocked}
                      canEditPhone={canEditPhone}
                      isStaffBypass={isStaffBypass || canEditPhone}
                    />
                  </div>
                  <Button
                    disabled={busy || expired}
                    className="enrollment-primary w-full mt-3 font-bold h-12 text-sm sm:text-base rounded-2xl"
                    onClick={() => void run(completeEnrollment)}
                  >
                    {busy ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />{message}</> : <><Check className="mr-2 h-4 w-4" />Verify & Save Enrollment</>}
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
