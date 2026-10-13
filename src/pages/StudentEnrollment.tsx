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
  ScanFace,
  Search,
  ShieldCheck,
  UserCheck,
  X,
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
import { prepareAppwriteBackendSamples, type CaptureResult, type EnrollmentSession, type StudentDetails } from '@/services/enrollment/types';
import DobDatePicker from '@/components/enrollment/DobDatePicker';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import '@/components/enrollment/enrollment.css';

export default function StudentEnrollment() {
  const [admission, setAdmission] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [quickQuery, setQuickQuery] = useState('');
  const [quickResults, setQuickResults] = useState<StudentDetails[]>([]);
  const [quickSearching, setQuickSearching] = useState(false);
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
  const uploadedKeysRef = useRef<Set<string>>(new Set());
  const activeUploadRef = useRef<Promise<void> | null>(null);

  // Instant Parallel Sample Upload Pool with On-The-Fly Lightweight Compression
  const uploadSamplesParallel = useCallback(async (
    sessionToken: string,
    samples: CaptureResult['samples'],
    onProgress?: (done: number, total: number) => void
  ) => {
    if (!sessionToken || sessionToken.startsWith('fast_')) {
      onProgress?.(samples.length, samples.length);
      return;
    }
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
    if (session?.session && !session.session.startsWith('fast_')) {
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
      if (session?.session && !session.session.startsWith('fast_')) {
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

        // If initialized with a fast local session token, upgrade to a real backend session token in background
        if (value.session.startsWith('fast_')) {
          try {
            const realSess = await enrollmentApi<EnrollmentSession>('staff.session', { admission: studentAdm });
            if (realSess?.session) {
              setSession((prev) =>
                prev
                  ? {
                      ...prev,
                      session: realSess.session,
                      expires: realSess.expires || prev.expires,
                      challenge: prev.challenge || realSess.challenge,
                    }
                  : realSess
              );
            }
          } catch {
            // Direct Supabase/Appwrite sync in completeEnrollment handles saving even if cloud session function is offline
          }
        }
      })();
    }
  }, [admission]);

  // Helper to build an instant local session from StudentDetails so camera launches in 0ms
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

  // Quick search by Student Name or Admission Number right on /enroll
  useEffect(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) {
      setQuickResults([]);
      setQuickSearching(false);
      return;
    }

    // 1. Check cached monitor overview first for 0ms search results
    const cached = getCachedMonitorOverview();
    if (cached?.students?.length) {
      const matches = cached.students
        .filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.admission_number.toLowerCase().includes(q) ||
            (s.student_id_kv && s.student_id_kv.toLowerCase().includes(q)) ||
            (s.father_name && s.father_name.toLowerCase().includes(q))
        )
        .sort((a, b) => {
          const aExact = a.admission_number.toLowerCase() === q ? 0 : a.admission_number.toLowerCase().startsWith(q) ? 1 : a.name.toLowerCase().startsWith(q) ? 2 : 3;
          const bExact = b.admission_number.toLowerCase() === q ? 0 : b.admission_number.toLowerCase().startsWith(q) ? 1 : b.name.toLowerCase().startsWith(q) ? 2 : 3;
          return aExact - bExact || a.name.localeCompare(b.name);
        })
        .slice(0, 8)
        .map((s) => ({
          admission_number: s.admission_number,
          name: s.name,
          class: s.class || (s.category ? s.category.split('-')[0] : ''),
          section: s.section || (s.category && s.category.includes('-') ? s.category.split('-').slice(1).join('-') : ''),
          category: s.category,
          father_name: s.father_name || '',
          mother_name: s.mother_name || '',
          date_of_birth: s.date_of_birth || '',
          parent_phone: s.parent_phone_full || s.parent_phone || '',
          blood_group: s.blood_group || '',
          address: s.address || '',
        }));
      setQuickResults(matches);
      return;
    }

    // 2. Fallback to querying Appwrite profiles table
    let cancelled = false;
    setQuickSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data: rows } = await supabase
          .from('profiles')
          .select('full_name, display_name, admission_number, employee_id, class, section, category, father_name, parent_name, parent_phone, phone, blood_group, address, email, metadata')
          .eq('role', 'student')
          .limit(300);

        if (cancelled) return;
        const matched = (rows || [])
          .map((p: any) => {
            let meta: Record<string, any> = {};
            try {
              meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata || {};
            } catch {}
            const adm = String(p.admission_number || p.employee_id || '').trim();
            const name = String(p.full_name || p.display_name || '').trim();
            const cls = String(p.class || meta.class || '').trim();
            const sec = String(p.section || meta.section || '').trim();
            return {
              admission_number: adm,
              name,
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
            } as StudentDetails;
          })
          .filter(
            (s) =>
              s.admission_number &&
              (s.name.toLowerCase().includes(q) ||
                s.admission_number.toLowerCase().includes(q) ||
                (s.father_name && s.father_name.toLowerCase().includes(q)))
          )
          .sort((a, b) => {
            const aRank = a.admission_number.toLowerCase() === q ? 0 : a.admission_number.toLowerCase().startsWith(q) ? 1 : a.name.toLowerCase().startsWith(q) ? 2 : 3;
            const bRank = b.admission_number.toLowerCase() === q ? 0 : b.admission_number.toLowerCase().startsWith(q) ? 1 : b.name.toLowerCase().startsWith(q) ? 2 : 3;
            return aRank - bRank || a.name.localeCompare(b.name);
          })
          .slice(0, 8);
        setQuickResults(matched);
      } catch {
        if (!cancelled) setQuickResults([]);
      } finally {
        if (!cancelled) setQuickSearching(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [quickQuery]);

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

    // Enforce locked phone security for PDF-imported records:
    // If the phone is locked and user is self-enrolling (not staff/teacher/principal/admin), restore the original verified phone
    const enforcedPhone = (isPhoneLocked && !canEditPhone && originalVerifiedPhone)
      ? originalVerifiedPhone
      : (details.parent_phone?.trim() || undefined);

    const secureDetails: StudentDetails = {
      ...details,
      parent_phone: enforcedPhone || '',
    };

    // 1. Sync face descriptors, 3D structure and details directly to Supabase/Appwrite (primary system of record)
    const supabaseSyncPromise = syncEnrolledFaceDataToSupabase({
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

    // 2. Submit to Appwrite backend session with resilient fallback
    let appwriteSaved: { completed?: boolean; correctionPending?: boolean } | null = null;
    let appwriteErrMessage = '';

    if (session.session && !session.session.startsWith('fast_')) {
      try {
        appwriteSaved = await enrollmentApi<{ completed: boolean; correctionPending: boolean }>('submit', {
          session: session.session,
          consent,
          wearsGlasses: result.wearsGlasses,
          challenge: result.challenge,
          blinked: result.blinked,
          changes: secureDetails,
        });
      } catch (err: unknown) {
        console.warn('Appwrite session submission fallback:', err);
        appwriteErrMessage = err instanceof Error ? err.message : String(err || '');
      }
    }

    // Await Supabase/Appwrite sync completion
    const supabaseResult = await supabaseSyncPromise;

    // If both failed, notify the user with an actionable message
    if (!appwriteSaved && (!supabaseResult || !supabaseResult.success)) {
      throw new Error(appwriteErrMessage || 'Enrollment could not be saved. Please try again.');
    }

    // Update student profile & metadata in Appwrite profiles table
    if (details.admission_number || admission) {
      try {
        const adm = (details.admission_number || admission).trim();
        const finalPhotoUrl = (supabaseResult?.photoUrl && !supabaseResult.photoUrl.startsWith('data:'))
          ? supabaseResult.photoUrl
          : (primaryPhoto && !primaryPhoto.startsWith('data:'))
            ? primaryPhoto
            : undefined;

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('metadata')
          .or(`admission_number.ilike.${adm},employee_id.ilike.${adm}`)
          .limit(1)
          .maybeSingle();

        let mergedMeta: Record<string, any> = {};
        try {
          mergedMeta =
            typeof existingProfile?.metadata === 'string'
              ? JSON.parse(existingProfile.metadata)
              : existingProfile?.metadata || {};
        } catch {
          mergedMeta = {};
        }

        if (details.father_name?.trim()) mergedMeta.father_name = details.father_name.trim();
        if (details.mother_name?.trim()) mergedMeta.mother_name = details.mother_name.trim();
        if (details.date_of_birth?.trim()) mergedMeta.date_of_birth = details.date_of_birth.trim();
        if (details.blood_group?.trim()) mergedMeta.blood_group = details.blood_group.trim();
        if (details.address?.trim()) mergedMeta.address = details.address.trim();
        if (enforcedPhone) mergedMeta.verified_parent_phone = enforcedPhone;

        const cls = details.class?.trim() || undefined;
        const sec = details.section?.trim() || undefined;
        const cat = [cls, sec].filter(Boolean).join('-') || details.category?.trim() || undefined;

        await supabase
          .from('profiles')
          .update({
            ...(emailVal ? { email: emailVal, parent_email: emailVal } : {}),
            parent_phone: enforcedPhone,
            phone: enforcedPhone,
            full_name: details.name?.trim() || undefined,
            display_name: details.name?.trim() || undefined,
            class: cls,
            section: sec,
            category: cat,
            father_name: details.father_name?.trim() || undefined,
            parent_name: details.father_name?.trim() || details.mother_name?.trim() || undefined,
            blood_group: details.blood_group?.trim() || undefined,
            address: details.address?.trim() || undefined,
            metadata: JSON.stringify(mergedMeta),
            ...(finalPhotoUrl ? { avatar_url: finalPhotoUrl, photo_url: finalPhotoUrl } : {}),
            updated_at: new Date().toISOString(),
          })
          .or(`admission_number.ilike.${adm},employee_id.ilike.${adm}`);
      } catch (profileUpdateErr) {
        console.warn('Profile metadata sync notice:', profileUpdateErr);
      }
    }

    clearMonitorCache();
    setPendingCorrections(Boolean(appwriteSaved?.correctionPending));
    setResult(undefined);
    setDetails(undefined);
    setSession(undefined);
    uploadedKeysRef.current.clear();
    setPhase('done');
    setMessage('');
  }, [admission, canEditPhone, consent, details, isPhoneLocked, isStaffBypass, originalVerifiedPhone, replaceExisting, result, session, uploadSamplesParallel]);

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
                    <h2 className="text-xl font-bold text-white">Find Student</h2>
                    <p className="enrollment-muted text-xs">
                      Search by Student Name or Admission Number to launch Face Capture directly
                    </p>
                  </div>

                  {/* Quick Search by Name or Admission Number -> Direct Face Capture */}
                  <div className="mb-6 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/30 text-left space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <Search className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Quick Search by Name or Admission No.</span>
                      </label>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
                        Direct Face Capture
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          value={quickQuery}
                          onChange={(e) => setQuickQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && quickResults.length > 0) {
                              e.preventDefault();
                              launchInstantStudentCapture(quickResults[0]);
                            }
                          }}
                          placeholder="Type student name or admission no (e.g. 10425)..."
                          className="pl-9 pr-8 h-10 bg-slate-950/90 border-white/15 text-white text-xs rounded-xl focus:border-emerald-400"
                        />
                        {quickQuery && (
                          <button
                            type="button"
                            onClick={() => setQuickQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {quickResults.length > 0 && (
                        <Button
                          type="button"
                          onClick={() => launchInstantStudentCapture(quickResults[0])}
                          className="h-10 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shrink-0 gap-1.5 shadow-sm"
                        >
                          <ScanFace className="h-4 w-4" />
                          <span>Capture Face</span>
                        </Button>
                      )}
                    </div>

                    {quickSearching && (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                        <span>Searching student roster…</span>
                      </div>
                    )}

                    {quickQuery.trim() && !quickSearching && quickResults.length === 0 && (
                      <p className="text-xs text-slate-400 py-1">
                        No matching student found for &ldquo;{quickQuery}&rdquo;. Try another name or admission number.
                      </p>
                    )}

                    {quickResults.length > 0 && (
                      <div className="max-h-60 overflow-y-auto divide-y divide-white/10 rounded-xl border border-white/10 bg-slate-950/90">
                        {quickResults.map((st) => (
                          <div
                            key={st.admission_number}
                            className="p-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-white truncate">{st.name}</p>
                              <p className="text-[11px] text-slate-400 font-mono truncate">
                                Adm: <span className="text-emerald-400">{st.admission_number}</span>
                                {st.category ? ` · Class ${st.category}` : ''}
                                {st.father_name ? ` · F: ${st.father_name}` : ''}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => launchInstantStudentCapture(st)}
                              className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shrink-0 gap-1.5"
                            >
                              <ScanFace className="h-3.5 w-3.5" />
                              <span>Capture Face</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative my-4 flex items-center justify-center">
                    <div className="border-t border-white/10 w-full" />
                    <span className="bg-slate-900 px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
                      Or Verify with Parent Details
                    </span>
                    <div className="border-t border-white/10 w-full" />
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
                        await acceptSession(verifiedSession, false, true);
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
                      {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <>Find Student & Capture Face <ArrowRight className="h-4 w-4" /></>}
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
