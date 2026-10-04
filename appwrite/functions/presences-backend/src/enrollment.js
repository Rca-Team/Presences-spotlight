import { Query, Permission, Role } from 'node-appwrite';
import { hash, token, reject, normalizeName, normalizeDob, phoneNumber, cleanStudent, fields, validateSample, validateCapture } from './enrollment-domain.js';
import { createEnrollmentMonitor } from './enrollment-monitor.js';

export const STATE = 'student_enrollment';
export const BUCKET = 'student-registration-faces';
const staffRead = ['admin', 'principal', 'superadmin', 'teacher'].map(label => Permission.read(Role.label(label)));
const DAY = 86400000;
export function createEnrollmentService({ db, databaseId = 'presences_db', sms, files, now = Date.now }) {
  const get = async id => {
    try { const d = await db.getDocument(databaseId, STATE, id); return { ...JSON.parse(d.payload), _id: id }; }
    catch (e) { if (e.code === 404) return null; throw e; }
  };
  const save = async (id, kind, value, expires = now() + DAY) => {
    const payload = { kind, expires, payload: JSON.stringify(value) };
    if (payload.payload.length > 59000) reject(413, 'Enrollment record is too large.');
    try { await db.createDocument(databaseId, STATE, id, payload, []); }
    catch (e) { if (e.code !== 409) throw e; await db.updateDocument(databaseId, STATE, id, payload); }
    return value;
  };
  // Atomic slot claims avoid read/modify/write races in rate counters.
  const limit = async (key, count, period) => {
    const window = Math.floor(now() / period);
    for (let n = 0; n < count; n++) {
      try { await db.createDocument(databaseId, STATE, hash(`rate:${key}:${window}:${n}`), { kind: 'rate', expires: (window + 1) * period, payload: '{}' }, []); return; }
      catch (e) { if (e.code !== 409) throw e; }
    }
    reject(429, 'Too many attempts. Please wait and try again.');
  };
  const lock = async (key, run) => {
    const id = hash('lock:' + key);
    try { await db.createDocument(databaseId, STATE, id, { kind: 'lock', expires: now() + 120000, payload: '{}' }, []); }
    catch (e) { if (e.code === 409) reject(409, 'Another request is processing. Please retry shortly.'); throw e; }
    try { return await run(); } finally { await db.deleteDocument(databaseId, STATE, id); }
  };
  const audit = (event, student, method = '') => save(token().slice(0, 36), 'audit', { event, student, method, at: now() }, now() + 90 * DAY);
  const profileRow = p => {
    let meta = {};
    try { if (p.metadata) meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata; } catch (_) {}
    const rawPhone = p.parent_phone || p.phone || meta.parent_phone || meta.phone || '';
    const rawDob = p.date_of_birth || meta.date_of_birth || meta.dob || '';
    return {
      name: p.full_name || p.display_name || meta.name || '',
      admission_number: p.admission_number || p.employee_id || meta.admission_number || meta.employee_id || '',
      class: p.class || meta.class || '',
      section: p.section || meta.section || '',
      father_name: p.father_name || meta.father_name || '',
      mother_name: p.mother_name || meta.mother_name || '',
      parent_phone: phoneNumber(rawPhone),
      date_of_birth: rawDob ? normalizeDob(rawDob) : '',
      address: p.address || meta.address || ''
    };
  };
  async function profilesFor(admission) {
    const result = await db.listDocuments(databaseId, 'profiles', [Query.or([Query.equal('admission_number', admission), Query.equal('employee_id', admission), Query.equal('user_id', admission), Query.equal('$id', admission)]), Query.limit(3)]);
    if (result.documents.length > 1) reject(409, 'School staff must resolve duplicate student records.');
    return result.documents[0];
  }
  async function studentFor(admission) {
    const p = await profilesFor(admission);
    if (!p || (p.role && p.role !== 'student')) return null;
    const saved = await get(hash('student:' + admission));
    return { ...saved, ...profileRow(p), profileId: p.$id, userId: p.user_id || p.$id, revision: p.$updatedAt, status: saved?.status || 'pending' };
  }
  const profileData = row => ({ full_name: row.name, display_name: row.name, admission_number: row.admission_number, employee_id: row.admission_number, class: row.class, section: row.section, category: [row.class, row.section].filter(Boolean).join('-'), father_name: row.father_name, mother_name: row.mother_name, parent_phone: row.parent_phone, date_of_birth: row.date_of_birth, address: row.address, updated_at: new Date(now()).toISOString() });
  const sessionFor = async body => {
    if (!/^[a-f0-9]{64}$/.test(body.session || '')) reject(401, 'Enrollment session expired. Verify again.');
    const session = await get(hash('session:' + body.session));
    if (!session || session.expires <= now()) reject(401, 'Enrollment session expired. Verify again.');
    return session;
  };
  const newSession = async (student, method) => {
    const secret = token();
    const session = { student: student.admission_number, method, expires: now() + 45 * 60000, samples: [], completed: false, challenge: Math.random() < 0.5 ? 'left' : 'right' };
    await save(hash('session:' + secret), 'session', session, session.expires);
    await audit('verified', student.admission_number, method);
    return { session: secret, student: Object.fromEntries(fields.map(k => [k, student[k] || ''])), challenge: session.challenge, expires: session.expires };
  };
  // A durable commit intent allows cleanup to finish an interrupted submission.
  // Once publishing begins, its photos must never be treated as abandoned uploads.
  async function finishCommit(id, current) {
    const { student, changes, descriptor, primaryFileId } = current.commit;
    const imageUrl = files.url(primaryFileId);
    const captureId = hash('capture:' + id);

    // Erase prior capture files and documents for this student so old face data is completely purged
    try {
      const priorStudent = await get(hash('student:' + current.student));
      if (priorStudent?.lastCapture && priorStudent.lastCapture !== captureId) {
        const oldCapture = await get(priorStudent.lastCapture);
        if (oldCapture?.samples) {
          const currentFileIds = new Set((current.samples || []).map(s => s.fileId));
          for (const s of oldCapture.samples) {
            if (s.fileId && !currentFileIds.has(s.fileId)) {
              await files.remove(s.fileId).catch(() => {});
            }
          }
        }
        await db.deleteDocument(databaseId, STATE, priorStudent.lastCapture).catch(() => {});
      }
    } catch (cleanErr) {
      console.warn('[finishCommit] Prior capture cleanup warning:', cleanErr);
    }
    if (Object.keys(changes).length) await save(hash('correction:' + id), 'correction', {
      student: current.student, original: Object.fromEntries(fields.map(k => [k, student[k]])), changes, status: 'pending', at: current.commit.at,
    }, now() + 90 * DAY);
    await save(captureId, 'capture', { student: current.student, samples: current.samples, method: current.method, at: current.commit.at }, now() + 3650 * DAY);
    await db.updateDocument(databaseId, 'profiles', student.profileId, { avatar_url: imageUrl, updated_at: new Date(now()).toISOString() });
    const descriptorId = hash('enrollment-descriptor:' + current.student);
    const record = { user_id: student.userId, student_id: student.admission_number, label: student.name, descriptor: JSON.stringify(descriptor), image_url: imageUrl, created_at: new Date(current.commit.at).toISOString() };
    try { await db.createDocument(databaseId, 'face_descriptors', descriptorId, record, staffRead); }
    catch (e) { if (e.code !== 409) throw e; await db.updateDocument(databaseId, 'face_descriptors', descriptorId, record); }
    await save(hash('student:' + current.student), 'student', { ...student, status: 'completed', lastCapture: captureId }, now() + 3650 * DAY);
    current.completed = true;
    current.correctionPending = Object.keys(changes).length > 0;
    await save(id, 'session', current, current.expires);
    await audit('enrollment-completed', current.student, current.method);
    return { completed: true, correctionPending: current.correctionPending };
  }
  async function challengeFor(body) {
    const c = await get(hash('challenge:' + String(body.challenge || '')));
    if (!c || c.expires <= now()) reject(401, 'Verification expired. Start again.');
    return c;
  }
  async function send(c) {
    if (c.nextSend > now()) reject(429, 'Please wait before requesting another code.');
    if (c.otpExpires && c.otpExpires <= now() && !c.wrongCode) c.failures++;
    c.otpExpires = 0;
    c.nextSend = now() + 60000;
    c.wrongCode = false;
    if (c.student) {
      await limit('sms-student:' + c.student, 6, 3600000);
      await limit('sms-phone:' + c.phone, 6, 3600000);
      try {
        const sent = await sms.send(c.phone);
        c.otpUser = sent.userId;
        c.otpExpires = new Date(sent.expire).getTime();
        if (!Number.isFinite(c.otpExpires)) throw new Error('Invalid OTP expiry');
      } catch { c.failures++; }
    } else { c.failures++; }
    await save(c._id, 'challenge', c, c.expires);
    return { challenge: c.secret, fallback: c.failures >= 3 && !c.blockFallback, retryAt: c.nextSend, message: 'If the details match a registered student, a code will be sent to the saved parent phone.' };
  }
  const monitor = createEnrollmentMonitor({ db, databaseId, files, now });
  return async function dispatch(body, { user = null, ip = 'unknown' } = {}) {
    const action = body.action;
    if (typeof action !== 'string') reject(400, 'An action is required.');
    const admin = user?.labels?.some(l => ['admin', 'principal', 'superadmin'].includes(l));
    const staff = admin; // Import/contact changes affect authentication; school administrators own them.
    // Read-only monitoring: admins see everything, teachers only their assigned classes.
    if (action === 'staff.monitor' || action === 'staff.photo') {
      if (!user?.$id) reject(401, 'Sign in with your school account.');
      return action === 'staff.monitor' ? monitor.overview(user) : monitor.photo(user, body);
    }
    if (action.startsWith('staff.')) {
      if (!staff) reject(403, 'School administrator access required.');
      if (action === 'staff.preview') {
        const row = cleanStudent(body.student);
        const existing = await studentFor(row.admission_number);
        return { existing: existing ? { ...Object.fromEntries(fields.map(k => [k, existing[k]])), revision: existing.revision } : null };
      }
      if (action === 'staff.import') {
        const row = cleanStudent(body.student);
        return lock('student:' + row.admission_number, async () => {
          const existing = await studentFor(row.admission_number);
          if (existing && (!body.approveUpdate || body.revision !== existing.revision)) reject(409, 'Review and approve the current student record before updating.');
          const id = existing?.profileId || hash('profile:' + row.admission_number);
          const userId = existing?.userId || id;
          if (existing) await db.updateDocument(databaseId, 'profiles', id, profileData(row));
          else await db.createDocument(databaseId, 'profiles', id, { ...profileData(row), role: 'student', user_id: userId, created_at: new Date(now()).toISOString() }, staffRead);
          let portrait = existing?.portrait || null;
          if (body.portrait) portrait = await files.portrait(hash('portrait:' + id), body.portrait);
          await save(hash('student:' + row.admission_number), 'student', { ...row, profileId: id, userId, portrait, status: existing?.status || 'pending' }, now() + 3650 * DAY);
          await audit('imported', row.admission_number, user.$id);
          return { saved: true, admission_number: row.admission_number };
        });
      }
      if (action === 'staff.session') {
        const student = await studentFor(String(body.admission || ''));
        if (!student) reject(404, 'Student not found.');
        return newSession(student, 'staff');
      }
      if (action === 'staff.corrections') {
        const page = await db.listDocuments(databaseId, STATE, [Query.equal('kind', 'correction'), Query.limit(100)]);
        return { corrections: page.documents.map(d => ({ ...JSON.parse(d.payload), id: d.$id })).filter(c => c.status === 'pending') };
      }
      if (action === 'staff.review') {
        return lock('correction:' + body.id, async () => {
          const c = await get(body.id);
          if (!c || c.status !== 'pending') reject(409, 'Correction is no longer pending.');
          const student = await studentFor(c.student);
          if (!student) reject(404, 'Student no longer exists.');
          if (body.approve) {
            if (Object.keys(c.changes).some(k => student[k] !== c.original[k])) reject(409, 'School details changed after this request. Reject it and request a fresh correction.');
            const merged = cleanStudent({ ...student, ...c.changes, admission_number: c.student });
            await db.updateDocument(databaseId, 'profiles', student.profileId, profileData(merged));
          }
          await save(body.id, 'correction', { ...c, status: body.approve ? 'approved' : 'rejected', reviewer: user.$id }, now() + 90 * DAY);
          await audit('correction-reviewed', c.student, user.$id);
          return { saved: true };
        });
      }
      if (action === 'staff.revert') {
        const admission = String(body.admission || '').trim();
        if (!admission) reject(400, 'Admission number is required.');
        return lock('student:' + admission, async () => {
          const student = await studentFor(admission);
          if (!student) reject(404, 'Student not found.');

          // 1. Delete prior capture and files
          const studentState = await get(hash('student:' + admission));
          if (studentState?.lastCapture) {
            const oldCapture = await get(studentState.lastCapture);
            if (oldCapture?.samples) {
              for (const s of oldCapture.samples) {
                if (s.fileId) await files.remove(s.fileId).catch(() => {});
              }
            }
            await db.deleteDocument(databaseId, STATE, studentState.lastCapture).catch(() => {});
          }

          // 2. Delete descriptor from face_descriptors
          const descriptorId = hash('enrollment-descriptor:' + admission);
          await db.deleteDocument(databaseId, 'face_descriptors', descriptorId).catch(() => {});
          const existingDesc = await db.listDocuments(databaseId, 'face_descriptors', [Query.or([Query.equal('student_id', admission), Query.equal('user_id', student.userId)]), Query.limit(50)]).catch(() => ({ documents: [] }));
          for (const d of existingDesc.documents) {
            await db.deleteDocument(databaseId, 'face_descriptors', d.$id).catch(() => {});
          }

          // 3. Reset student state
          await save(hash('student:' + admission), 'student', { ...student, status: 'pending', lastCapture: null }, now() + 3650 * DAY);

          // 4. Clear avatar_url from profile
          if (student.profileId) {
            await db.updateDocument(databaseId, 'profiles', student.profileId, { avatar_url: '', updated_at: new Date(now()).toISOString() }).catch(() => {});
          }

          await audit('reverted', admission, user.$id);
          return { reverted: true, admission };
        });
      }
      if (action === 'staff.delete' || action === 'staff.deleteStudent') {
        const admission = cleanStudent(body).admission_number || String(body.admission || body.student_id || body.employee_id || body.id || '').trim();
        if (!admission) reject(400, 'Student identifier is required.');
        return lock('student:' + admission, async () => {
          const student = await studentFor(admission);
          const admissionKey = student?.admission_number || admission;
          const userKey = student?.userId || body.user_id;
          const profileId = student?.profileId;

          // 1. Delete prior capture and files
          const studentState = await get(hash('student:' + admissionKey));
          if (studentState?.lastCapture) {
            const oldCapture = await get(studentState.lastCapture);
            if (oldCapture?.samples) {
              for (const s of oldCapture.samples) {
                if (s.fileId) await files.remove(s.fileId).catch(() => {});
              }
            }
            await db.deleteDocument(databaseId, STATE, studentState.lastCapture).catch(() => {});
          }

          // 2. Delete student state documents
          await db.deleteDocument(databaseId, STATE, hash('student:' + admissionKey)).catch(() => {});
          await db.deleteDocument(databaseId, STATE, hash('session:' + admissionKey)).catch(() => {});
          await db.deleteDocument(databaseId, STATE, hash('correction:' + admissionKey)).catch(() => {});

          // 3. Delete descriptors from face_descriptors
          const descriptorId = hash('enrollment-descriptor:' + admissionKey);
          await db.deleteDocument(databaseId, 'face_descriptors', descriptorId).catch(() => {});
          
          const orDescQueries = [Query.equal('student_id', admissionKey)];
          if (userKey) orDescQueries.push(Query.equal('user_id', userKey));
          const existingDesc = await db.listDocuments(databaseId, 'face_descriptors', [Query.or(orDescQueries), Query.limit(100)]).catch(() => ({ documents: [] }));
          for (const d of existingDesc.documents) {
            await db.deleteDocument(databaseId, 'face_descriptors', d.$id).catch(() => {});
          }

          // 4. Delete attendance records
          const existingAtt = await db.listDocuments(databaseId, 'attendance_records', [Query.or(orDescQueries), Query.limit(100)]).catch(() => ({ documents: [] }));
          for (const a of existingAtt.documents) {
            await db.deleteDocument(databaseId, 'attendance_records', a.$id).catch(() => {});
          }

          // 5. Delete profile(s)
          if (profileId) {
            await db.deleteDocument(databaseId, 'profiles', profileId).catch(() => {});
          }
          const profileQueries = [Query.or([
            Query.equal('admission_number', admissionKey),
            Query.equal('employee_id', admissionKey),
            ...(userKey ? [Query.equal('user_id', userKey)] : [])
          ]), Query.limit(25)];
          const existingProfiles = await db.listDocuments(databaseId, 'profiles', profileQueries).catch(() => ({ documents: [] }));
          for (const p of existingProfiles.documents) {
            await db.deleteDocument(databaseId, 'profiles', p.$id).catch(() => {});
          }

          await audit('student-deleted-completely', admissionKey, user?.$id || 'admin');
          return { deleted: true, admission: admissionKey };
        });
      }
      if (action === 'staff.cleanup') {
        const expired = await db.listDocuments(databaseId, STATE, [Query.lessThan('expires', now() - 120000), Query.limit(100)]);
        for (const d of expired.documents) {
          const value = JSON.parse(d.payload);
          if (d.kind === 'session' && value.commit && !value.completed) {
            await lock(d.$id, () => finishCommit(d.$id, value));
            continue;
          }
          if (d.kind === 'session' && !value.completed) for (const s of value.samples || []) await files.remove(s.fileId);
          await db.deleteDocument(databaseId, STATE, d.$id);
        }
        return { removed: expired.documents.length };
      }
      reject(404, 'Unknown staff action.');
    }
    await limit('ip:' + ip, 120, 3600000);
        if (action === 'session.get') {
      const session = await sessionFor(body);
      const student = await studentFor(session.student);
      if (!student) reject(404, 'Student not found.');
      return {
        session: String(body.session),
        student: Object.fromEntries(fields.map(k => [k, student[k] || ''])),
        challenge: session.challenge,
        expires: session.expires
      };
    }
    if (action === 'verify-student') {
      await limit('verify-student-ip:' + ip, 20, 3600000);
      const admission = String(body.admission || '').trim().slice(0, 64);
      const phone = phoneNumber(body.phone);
      const dob = String(body.dob || '').trim().slice(0, 32);
      if (!admission || !phone || !dob) reject(400, 'Admission number, registered phone, and date of birth are all required.');
      await limit('credentials-student:' + admission, 5, 15 * 60000);
      await limit('credentials-phone:' + phone, 8, 15 * 60000);
      const student = await studentFor(admission);
      if (!student) {
        await limit('verify-student-fail:' + ip, 6, 3600000);
        reject(400, 'Details do not match school records. Check admission number, registered phone, and date of birth.');
      }

      const registeredPhone = phoneNumber(student.parent_phone);
      const phoneMatches = registeredPhone && registeredPhone === phone;
      const normalizedInputDob = normalizeDob(dob);
      const dobMatches = !student.date_of_birth || normalizeDob(student.date_of_birth) === normalizedInputDob;

      if (!phoneMatches || !dobMatches) {
        await audit('verification-failed', student.admission_number, 'credentials');
        reject(400, 'Details do not match school records. Check admission number, registered phone, and date of birth.');
      }

      if (!student.date_of_birth && normalizedInputDob) {
        student.date_of_birth = normalizedInputDob;
      }

      await audit('verified-credentials', student.admission_number, 'credentials');
      return newSession(student, 'credentials');
    }
    if (action === 'start') {
      await limit('start-ip:' + ip, 10, 3600000);
      const identifier = String(body.identifier || '').trim().slice(0, 80);
      let admission = identifier;
      if (body.mode === 'phone') {
        const phone = phoneNumber(identifier);
        if (!phone) reject(400, 'Enter a valid registered phone number.');
        // Always request admission number in phone mode; do not expose a child list.
        admission = String(body.admission || '').trim();
        if (!admission) return { needsAdmission: true };
      }
      const student = await studentFor(admission);
      const matches = student && (body.mode !== 'phone' || student.parent_phone === phoneNumber(identifier));
      const secret = token();
      const c = { _id: hash('challenge:' + secret), secret, student: matches ? student.admission_number : '', phone: matches ? student.parent_phone : '', failures: 0, nextSend: 0, expires: now() + 60 * 60000, blockFallback: false };
      return send(c);
    }
    if (['resend', 'verify-otp', 'verify-father'].includes(action)) {
      const c = await challengeFor(body);
      return lock(c._id, async () => {
        const current = await get(c._id);
        if (current.used) reject(401, 'Verification already used.');
        if (action === 'resend') return send(current);
        await limit('verify:' + (current.student || current._id), 5, 15 * 60000);
        await limit('verify-phone:' + (current.phone || current._id), 8, 15 * 60000);
        const student = current.student ? await studentFor(current.student) : null;
        let valid = false;
        if (action === 'verify-father') {
          if (current.failures < 3 || current.blockFallback) reject(403, 'This verification option is not available.');
          const matchFather = Boolean(student?.father_name && normalizeName(body.fatherName) === normalizeName(student.father_name));
          const matchDob = !student?.date_of_birth || (Boolean(body.dob) && normalizeDob(body.dob) === normalizeDob(student.date_of_birth));
          valid = matchFather && matchDob;
        } else {
          if (student && current.otpExpires > now() && body.code) {
            try {
              const verifiedPhone = await sms.verify(current.otpUser, body.code);
              if (verifiedPhone && verifiedPhone !== current.phone && verifiedPhone !== current.phone.replace('+', '')) throw new Error('Phone mismatch');
              valid = true;
            } catch { valid = false; }
          }
          if (!valid) { current.wrongCode = true; current.blockFallback = true; await save(current._id, 'challenge', current, current.expires); }
        }
        if (!valid) { await audit('verification-failed', current.student, action); reject(400, 'Verification did not match. Please retry or contact the school.'); }
        current.used = true;
        await save(current._id, 'challenge', current, current.expires);
        return newSession(student, action === 'verify-otp' ? 'otp' : 'father-name');
      });
    }
    if (['sample', 'submit', 'cancel'].includes(action)) {
      const session = await sessionFor(body);
      const id = hash('session:' + body.session);
      return lock(id, async () => {
        const current = await get(id);
        if (current.completed) { if (action === 'submit') return { completed: true, correctionPending: current.correctionPending }; reject(409, 'Enrollment is already complete.'); }
        if (current.commit) {
          if (action === 'submit') return finishCommit(id, current);
          reject(409, 'Submission is being finalized. Retry confirmation instead.');
        }
        if (action === 'cancel') {
          for (const s of current.samples) await files.remove(s.fileId);
          await db.deleteDocument(databaseId, STATE, id);
          return { cancelled: true };
        }
        if (action === 'sample') {
          const bytes = validateSample(body.sample);
          const key = body.sample.pose + ':' + body.sample.glasses;
          const fileId = hash(id + ':' + key);
          const prior = current.samples.find(s => s.fileId === fileId);
          if (prior?.uploaded) return { saved: true }; // Stable retry, never overwrite a completed slot.
          if (!prior && current.samples.length >= 10) reject(400, 'Too many samples.');
          // Persist intent first so cleanup can reclaim an interrupted storage upload.
          const sample = prior || { pose: body.sample.pose, glasses: body.sample.glasses, descriptor: body.sample.descriptor, quality: body.sample.quality, fileId };
          if (!prior) current.samples.push(sample);
          await save(id, 'session', current, current.expires);
          try { await files.put(fileId, bytes); }
          catch (e) { current.samples = current.samples.filter(s => s.fileId !== fileId); await save(id, 'session', current, current.expires); throw e; }
          sample.uploaded = true;
          await save(id, 'session', current, current.expires);
          return { saved: true };
        }
        if (!body.consent || body.challenge !== current.challenge || !body.blinked) reject(400, 'Complete consent and the guided movement checks.');
        if (current.samples.some(s => !s.uploaded)) reject(409, 'Some photos have not finished uploading.');
        const descriptor = validateCapture(current.samples, Boolean(body.wearsGlasses));
        const student = await studentFor(session.student);
        if (!student) reject(404, 'Student record is unavailable.');
        const changes = Object.fromEntries(fields.filter(k => k !== 'admission_number' && body.changes && Object.hasOwn(body.changes, k) && String(body.changes[k]).trim() !== student[k]).map(k => [k, String(body.changes[k]).trim()]));
        if (Object.keys(changes).length) cleanStudent({ ...student, ...changes });
        const primary = current.samples.find(s => s.pose === 'front' && s.glasses === (body.wearsGlasses ? 'with' : 'without'));
        current.commit = { student, changes, descriptor, primaryFileId: primary.fileId, at: now() };
        await save(id, 'session', current, current.expires);
        await save(hash('student:' + session.student), 'student', { ...student, status: 'captured' }, now() + 3650 * DAY);
        return finishCommit(id, current);
      });
    }
    reject(404, 'Unknown enrollment action.');
  };
}
