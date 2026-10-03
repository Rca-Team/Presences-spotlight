import assert from 'node:assert/strict';
import { createEnrollmentService } from '../appwrite/functions/presences-backend/src/enrollment.js';
import { cleanStudent, normalizeName, phoneNumber, validateCapture, validateSample } from '../appwrite/functions/presences-backend/src/enrollment-domain.js';

let clock = 1000000000, sequence = 0, writes = [], deleted = [], failUpload = false, failDescriptor = false;
const documents = new Map();
const err = code => Object.assign(new Error('database failure'), { code });
const db = {
  async getDocument(_, table, id) { const d = documents.get(table + ':' + id); if (!d) throw err(404); return structuredClone(d); },
  async createDocument(_, table, id, data, permissions) { if (table === 'face_descriptors' && failDescriptor) throw err(500); const key = table + ':' + id; if (documents.has(key)) throw err(409); const d = { ...structuredClone(data), $id: id, $updatedAt: String(++sequence), $permissions: permissions }; documents.set(key, d); writes.push({ table, id, permissions }); return d; },
  async updateDocument(_, table, id, data) { const key = table + ':' + id; if (!documents.has(key)) throw err(404); const d = { ...documents.get(key), ...structuredClone(data), $updatedAt: String(++sequence) }; documents.set(key, d); return d; },
  async deleteDocument(_, table, id) { if (!documents.delete(table + ':' + id)) throw err(404); },
  async listDocuments(_, table, queries = []) {
    let ds = [...documents.entries()].filter(([key]) => key.startsWith(table + ':')).map(([, d]) => d);
    const match = (d, query) => { const q = typeof query === 'string' ? JSON.parse(query) : query; if (q.method === 'or') return q.values.some(v => match(d, v)); if (q.method === 'equal') return q.values.includes(d[q.attribute]); if (q.method === 'lessThan') return d[q.attribute] < q.values[0]; return true; };
    ds = ds.filter(d => queries.every(q => match(d, q))); return { documents: structuredClone(ds), total: ds.length };
  },
};
let smsFails = true;
const files = { async put(id) { if (failUpload) throw err(500); }, async remove(id) { deleted.push(id); }, async portrait() { return 'portrait'; }, async read() { return '/9j/'; }, url: id => 'https://private/' + id };
const service = createEnrollmentService({ db, now: () => clock, files, sms: { async send() { if (smsFails) throw err(503); return { userId: 'parent', expire: new Date(clock + 900000).toISOString() }; }, async verify(_, secret) { if (secret !== '123456') throw err(401); } } });
const admin = { user: { $id: 'admin', labels: ['admin'] }, ip: 'admin' };
const row = { name: 'Student One', admission_number: 'A100', class: '5', section: 'B', father_name: 'Ravi Kumar', mother_name: '', parent_phone: '9876543210', date_of_birth: '', address: '' };
let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); passed++; }
await test('Field validation and normalization preserve IDs and reject invalid contacts', async () => {
  assert.equal(normalizeName('  RAVI   Kumar '), 'ravi kumar'); assert.equal(phoneNumber('9876543210'), '+919876543210');
  assert.throws(() => cleanStudent({ ...row, admission_number: '' })); assert.throws(() => cleanStudent({ ...row, parent_phone: 'abc' }));
});
await test('Public callers cannot import or inspect correction requests', async () => {
  for (const action of ['staff.import', 'staff.corrections', 'staff.session', 'staff.review']) await assert.rejects(() => service({ action, student: row }), e => e.status === 403);
});
await test('Import saves profile without a face and restricts document reads', async () => {
  await service({ action: 'staff.import', student: row }, admin);
  assert.equal(writes.filter(w => w.table === 'face_descriptors').length, 0);
  assert.ok(writes.find(w => w.table === 'profiles').permissions.every(p => !p.includes('any')));
});
await test('Existing student changes require explicit approval of current revision', async () => {
  await assert.rejects(() => service({ action: 'staff.import', student: row }, admin), e => e.status === 409);
  const p = await service({ action: 'staff.preview', student: row }, admin);
  await service({ action: 'staff.import', student: row, approveUpdate: true, revision: p.existing.revision }, admin);
  await assert.rejects(() => service({ action: 'staff.import', student: row, approveUpdate: true, revision: p.existing.revision }, admin), e => e.status === 409);
});
let challenge;
await test('Shared-phone flow asks for admission without disclosing children', async () => {
  const r = await service({ action: 'start', mode: 'phone', identifier: row.parent_phone }, { ip: 'phone' }); assert.deepEqual(r, { needsAdmission: true });
});
await test('Father fallback appears only after three failed sends, with resend cooldown', async () => {
  challenge = await service({ action: 'start', identifier: 'A100' }, { ip: 'fallback' }); assert.equal(challenge.fallback, false);
  await assert.rejects(() => service({ action: 'verify-father', challenge: challenge.challenge, fatherName: row.father_name }, { ip: 'fallback' }), e => e.status === 403);
  await assert.rejects(() => service({ action: 'resend', challenge: challenge.challenge }, { ip: 'fallback' }), e => e.status === 429);
  clock += 61000; challenge = await service({ action: 'resend', challenge: challenge.challenge }, { ip: 'fallback' }); assert.equal(challenge.fallback, false);
  clock += 61000; challenge = await service({ action: 'resend', challenge: challenge.challenge }, { ip: 'fallback' }); assert.equal(challenge.fallback, true);
});
let session;
await test('Father verification binds a short-lived session to the matched student', async () => {
  session = await service({ action: 'verify-father', challenge: challenge.challenge, fatherName: ' ravi  KUMAR ' }, { ip: 'fallback' });
  assert.equal(session.student.admission_number, 'A100'); assert.ok(session.expires > clock); assert.equal(session.student.userId, undefined);
  await assert.rejects(() => service({ action: 'verify-father', challenge: challenge.challenge, fatherName: row.father_name }), e => e.status === 401);
});
const sample = pose => ({ pose, glasses: 'without', descriptor: Array(128).fill(0.05), image: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(900)]).toString('base64'), quality: { brightness: 100, sharpness: 90, faces: 1 } });
await test('Quality gates reject malformed descriptors, multiple faces and blurry frames', async () => {
  for (const s of [{ ...sample('front'), descriptor: [1] }, { ...sample('front'), quality: { brightness: 100, sharpness: 2, faces: 1 } }, { ...sample('front'), quality: { brightness: 100, sharpness: 90, faces: 2 } }]) assert.throws(() => validateSample(s));
  assert.throws(() => validateCapture([sample('front')], false));
});
await test('Partial capture cannot activate recognition; uploads can retry', async () => {
  failUpload = true; await assert.rejects(() => service({ action: 'sample', session: session.session, sample: sample('front') })); failUpload = false;
  await service({ action: 'sample', session: session.session, sample: sample('front') });
  await assert.rejects(() => service({ action: 'submit', session: session.session, consent: true, blinked: true, challenge: session.challenge }), e => e.status === 400);
  assert.equal(writes.filter(w => w.table === 'face_descriptors').length, 0);
});
await test('All angles save once, activate compatible 128-value descriptor and queue corrections', async () => {
  for (const p of ['left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right']) await service({ action: 'sample', session: session.session, sample: sample(p), student: 'OTHER' });
  const input = { action: 'submit', session: session.session, consent: true, blinked: true, challenge: session.challenge, changes: { address: 'New address', admission_number: 'OTHER' } };
  assert.equal((await service(input)).completed, true); assert.equal((await service(input)).completed, true);
  const descriptors = [...documents.entries()].filter(([key]) => key.startsWith('face_descriptors:'));
  assert.equal(descriptors.length, 1); assert.equal(JSON.parse(descriptors[0][1].descriptor).length, 128); assert.equal(descriptors[0][1].student_id, 'A100');
  const corrections = (await service({ action: 'staff.corrections' }, admin)).corrections;
  assert.equal(corrections.length, 1); assert.deepEqual(corrections[0].changes, { address: 'New address' });
  assert.equal((await service({ action: 'staff.preview', student: row }, admin)).existing.address, '');
  await service({ action: 'staff.review', id: corrections[0].id, approve: true }, admin);
  assert.equal((await service({ action: 'staff.preview', student: row }, admin)).existing.address, 'New address');
});
await test('Monitor shows the whole school to admins with masked contacts and capture review data', async () => {
  await assert.rejects(() => service({ action: 'staff.monitor' }), e => e.status === 401);
  const m = await service({ action: 'staff.monitor' }, admin);
  const s = m.students.find(x => x.admission_number === 'A100');
  assert.equal(m.scope.all, true); assert.equal(s.status, 'completed'); assert.equal(s.samples.length, 9); assert.equal(s.faceOnFile, true);
  assert.equal(s.parent_phone, '•••• 3210'); assert.equal(s.userId, undefined);
  assert.ok(m.activity.some(a => a.event === 'enrollment-completed')); assert.ok(m.activity.every(a => a.method !== 'admin'));
  const photo = await service({ action: 'staff.photo', admission: 'A100', fileId: s.samples[0].fileId }, admin);
  assert.ok(photo.image.startsWith('data:image/jpeg;base64,'));
});
await test('Teachers only see their assigned classes; unassigned staff are refused', async () => {
  documents.set('class_teachers:ct1', { $id: 'ct1', teacher_id: 't-5b', class: '5', section: 'B' });
  documents.set('teacher_permissions:tp1', { $id: 'tp1', teacher_id: 't-6a', permission: 'class_access:VI-A' });
  documents.set('teacher_permissions:tp2', { $id: 'tp2', teacher_id: 't-6a', permission: 'can_take_attendance' });
  const own = await service({ action: 'staff.monitor' }, { user: { $id: 't-5b', labels: ['teacher'] } });
  assert.deepEqual(own.scope.classes, ['5-B']); assert.equal(own.students.length, 1); assert.equal(own.canManage, false);
  const other = await service({ action: 'staff.monitor' }, { user: { $id: 't-6a', labels: ['teacher'] } });
  assert.deepEqual(other.scope.classes, ['6-A']); assert.equal(other.students.length, 0); assert.equal(other.activity.length, 0); assert.equal(other.corrections.length, 0);
  const fileId = own.students[0].samples[0].fileId;
  await assert.rejects(() => service({ action: 'staff.photo', admission: 'A100', fileId }, { user: { $id: 't-6a', labels: ['teacher'] } }), e => e.status === 403);
  await assert.rejects(() => service({ action: 'staff.monitor' }, { user: { $id: 'nobody', labels: ['teacher'] } }), e => e.status === 403);
  await assert.rejects(() => service({ action: 'staff.corrections' }, { user: { $id: 't-5b', labels: ['teacher'] } }), e => e.status === 403);
});
await test('Session expiry rejects further access', async () => { clock = session.expires + 1; await assert.rejects(() => service({ action: 'sample', session: session.session, sample: sample('front') }), e => e.status === 401); });
await test('Incorrect OTP blocks fallback, and repeated guesses are rate limited', async () => {
  clock += 3600000; smsFails = false;
  const c = await service({ action: 'start', identifier: 'A100' }, { ip: 'otp-test' });
  for (let i = 0; i < 5; i++) await assert.rejects(() => service({ action: 'verify-otp', challenge: c.challenge, code: '000000' }, { ip: 'otp-test' }), e => e.status === 400);
  await assert.rejects(() => service({ action: 'verify-otp', challenge: c.challenge, code: '123456' }, { ip: 'otp-test' }), e => e.status === 429);
  clock += 16 * 60000;
  const r = await service({ action: 'resend', challenge: c.challenge }, { ip: 'otp-test' }); assert.equal(r.fallback, false);
  const verified = await service({ action: 'verify-otp', challenge: c.challenge, code: '123456' }, { ip: 'otp-test' }); assert.equal(verified.student.admission_number, 'A100');
});
await test('Direct credential verification binds session when admission, phone and dob match', async () => {
  const s1 = { ...row, admission_number: 'A200', date_of_birth: '2010-05-15', parent_phone: '9876543211' };
  await service({ action: 'staff.import', student: s1 }, admin);
  const credSession = await service({ action: 'verify-student', admission: 'A200', phone: '9876543211', dob: '15/05/2010' }, { ip: 'direct' });
  assert.equal(credSession.student.admission_number, 'A200');
  await assert.rejects(() => service({ action: 'verify-student', admission: 'A200', phone: '9876543211', dob: '16/05/2010' }, { ip: 'direct' }), e => e.status === 400);
  await assert.rejects(() => service({ action: 'verify-student', admission: 'A200', phone: '9999999999', dob: '15/05/2010' }, { ip: 'direct' }), e => e.status === 400);
});
console.log(`${passed} enrollment tests passed`);
