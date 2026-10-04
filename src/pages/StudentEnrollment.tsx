import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, CheckCircle2, Fingerprint, Glasses, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import GuidedFaceCapture from '@/components/enrollment/GuidedFaceCapture';
import IdCardPhotoStep from '@/components/enrollment/IdCardPhotoStep';
import { enrollmentApi } from '@/services/enrollment/api';
import { fieldLabels, studentFields, type CaptureResult, type EnrollmentSession, type StudentDetails } from '@/services/enrollment/types';
import DobDatePicker from '@/components/enrollment/DobDatePicker';
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
  const reduced = useReducedMotion();
  const staffStarted = useRef(false);

  const onCapture = useCallback((capture: CaptureResult) => { 
    setResult(capture); 
    setPhase('idphoto'); 
  }, []);

  const onIdPhotoConfirm = useCallback((finalPhotoUrl: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updatedSamples = prev.samples.map((s) => {
        if (s.pose === 'front') {
          return { ...s, image: finalPhotoUrl };
        }
        return s;
      });
      return { ...prev, samples: updatedSamples };
    });
    setPhase('review');
  }, []);
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

  const acceptSession = (value: EnrollmentSession) => {
    setSession(value);
    setDetails(value.student);
    setPhase('consent');
  };

  useEffect(() => {
    const staffAdmission = new URLSearchParams(window.location.search).get('student');
    if (!staffAdmission || staffStarted.current) return;
    staffStarted.current = true;
    void run(async () => acceptSession(await enrollmentApi<EnrollmentSession>('staff.session', { admission: staffAdmission })));
  }, []);

  async function cancelCapture() {
    if (session) {
      if (Date.now() >= session.expires) {
        setSession(undefined); setResult(undefined); setDetails(undefined); setConsent(false); setError(''); setPhase('verify');
        return;
      }
      await run(async () => {
        await enrollmentApi('cancel', { session: session.session });
        setSession(undefined);
        setResult(undefined);
        setConsent(false);
        setPhase('verify');
      });
    }
  }

  const expired = session && clock >= session.expires;

  return (
    <main className="enrollment-shell">
      <header className="enrollment-header">
        <a href="/" className="font-semibold tracking-tight">presences<span className="text-emerald-300">.</span></a>
        <span className="flex items-center gap-2 text-xs text-slate-400"><LockKeyhole size={13} />Student enrollment</span>
      </header>
      <div className="enrollment-layout">
        <aside className="enrollment-intro">
          <span className="enrollment-eyebrow">A familiar face. A simpler day.</span>
          <h1>Your school day,<br /><span>ready in a few turns.</span></h1>
          <p>Help your child get ready for effortless attendance. Verify your details, follow the camera, and confirm their student card.</p>
          <div className="enrollment-steps">
            {['Verify student', 'Capture face', 'ID card photo', 'Review & submit'].map((label, i) => {
              const currentStep = phase === 'verify' ? 0 : phase === 'consent' || phase === 'capture' ? 1 : phase === 'idphoto' ? 2 : 3;
              return (
                <div key={label} className={currentStep >= i ? 'active' : ''}>
                  <span>{i + 1}</span>{label}
                </div>
              );
            })}
          </div>
          <div className="enrollment-assurance">
            <ShieldCheck size={20} />
            <p>Your child’s photos are saved privately for school attendance. Your camera turns off when capture finishes.</p>
          </div>
        </aside>

        <section className="enrollment-glass">
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
                  <div className="enrollment-icon"><Fingerprint /></div>
                  <h2>Let’s find your student</h2>
                  <p className="enrollment-muted">Verify using your student’s admission number, registered parent phone, and date of birth.</p>

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
                    className="space-y-4 mt-6"
                  >
                    <label className="enrollment-label">
                      Student admission number
                      <Input
                        required
                        value={admission}
                        onChange={e => setAdmission(e.target.value)}
                        placeholder="Enter admission number"
                        autoComplete="off"
                      />
                    </label>

                    <label className="enrollment-label">
                      Registered parent phone
                      <Input
                        required
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="e.g. +91 98765 43210"
                      />
                    </label>

                    <label className="enrollment-label">
                      Student date of birth
                      <DobDatePicker
                        value={dob}
                        onChange={setDob}
                        required
                      />
                    </label>

                    <Button disabled={busy} className="enrollment-primary w-full mt-2">
                      {busy ? <Loader2 className="animate-spin" /> : <>Verify and continue<ArrowRight className="ml-2 h-4 w-4" /></>}
                    </Button>
                  </form>
                </>
              )}

              {phase === 'consent' && (
                <>
                  <div className="enrollment-icon"><ShieldCheck /></div>
                  <h2>Ready, {session?.student.name.split(' ')[0]}?</h2>
                  <p className="enrollment-muted">A parent or school staff member should help the student complete this step.</p>
                  <div className="enrollment-inset space-y-4 my-6">
                    <p>Face a soft light and keep the camera at eye level. Follow the ring as we capture each angle automatically.</p>
                    <p className="flex gap-3"><Glasses className="shrink-0" size={20} />If the student wears glasses, we’ll take one photo without them, then the remaining views with them on.</p>
                  </div>
                  <label className="flex gap-3 text-sm leading-relaxed">
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />
                    I am the parent, guardian, or authorized school staff member. I agree to save these face samples for school attendance and confirm the student is present.
                  </label>
                  <Button className="w-full enrollment-primary mt-6" disabled={!consent || expired} onClick={() => setPhase('capture')}>
                    Start guided capture<ArrowRight className="ml-2 h-4 w-4" />
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
                  <div className="flex items-center gap-2 text-emerald-300 text-sm mb-5">
                    <CheckCircle2 size={18} />Capture checks complete
                  </div>
                  <motion.div className="enrollment-idcard" initial={reduced ? false : { y: 35, rotate: -2 }} animate={{ y: 0, rotate: 0 }}>
                    <div className="flex justify-between text-xs uppercase tracking-[0.2em] mb-5">
                      <span>Student identity</span><span>Presences</span>
                    </div>
                    <div className="flex gap-5 items-center">
                      <img
                        src={result.samples.find(s => s.pose === 'front' && s.glasses === (result.wearsGlasses ? 'with' : 'without'))?.image}
                        alt="Captured student portrait"
                        className="w-24 h-28 rounded-2xl object-cover ring-2 ring-emerald-400/30 shadow-md"
                      />
                      <div>
                        <h2>{details.name}</h2>
                        <p className="mt-2 text-slate-300">Class {details.class} {details.section}</p>
                        <p className="text-sm font-mono mt-1 text-slate-400">{details.admission_number}</p>
                        {details.date_of_birth && <p className="text-xs text-emerald-300/80 mt-1">DOB: {details.date_of_birth}</p>}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPhase('idphoto')}
                          className="text-xs text-emerald-300 hover:text-emerald-200 mt-2 h-7 px-2"
                        >
                          Change / Edit ID Photo
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                  <h2 className="mt-7">Does everything look right?</h2>
                  <p className="enrollment-muted">Corrections are sent to your school for approval.</p>
                  <div className="grid grid-cols-2 gap-3 my-5">
                    {studentFields.map(field => (
                      <label key={field} className={`enrollment-label ${field === 'address' ? 'col-span-2' : ''}`}>
                        {fieldLabels[field]}
                        {editing && field !== 'admission_number' ? (
                          <Input value={details[field]} onChange={e => setDetails({ ...details, [field]: e.target.value })} />
                        ) : (
                          <span className="block text-slate-100 text-sm mt-1 break-words">{details[field] || 'Not provided'}</span>
                        )}
                      </label>
                    ))}
                  </div>
                  <Button variant="ghost" disabled={busy} onClick={() => setEditing(v => !v)}>
                    {editing ? 'Finish editing' : 'Request corrections'}
                  </Button>
                  <Button
                    disabled={busy || expired}
                    className="enrollment-primary w-full mt-3"
                    onClick={() => void run(async () => {
                      for (let i = 0; i < result.samples.length; i++) {
                        setMessage(`Saving photo ${i + 1} of ${result.samples.length}…`);
                        await enrollmentApi('sample', { session: session!.session, sample: result.samples[i] });
                      }
                      setMessage('Confirming enrollment…');
                      const saved = await enrollmentApi<{ completed: boolean; correctionPending: boolean }>('submit', {
                        session: session!.session,
                        consent,
                        wearsGlasses: result.wearsGlasses,
                        challenge: result.challenge,
                        blinked: result.blinked,
                        changes: details
                      });
                      setPendingCorrections(saved.correctionPending);
                      setResult(undefined);
                      setDetails(undefined);
                      setSession(undefined);
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
                  <a href="/" className="inline-block text-emerald-300 mt-8">Return to home</a>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {expired && <div role="alert" className="enrollment-error">Your session expired. Discard this capture and verify again.<Button variant="ghost" className="w-full mt-2" onClick={() => void cancelCapture()}>Verify again</Button></div>}
          {error && <p role="alert" className="enrollment-error">{error}</p>}
        </section>
      </div>
      <footer className="enrollment-footer">Private enrollment · Guided camera capture · School-reviewed corrections</footer>
    </main>
  );
}
