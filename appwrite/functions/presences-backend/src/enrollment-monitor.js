import { Query } from 'node-appwrite';
import { reject } from './enrollment-domain.js';

// Read-only enrollment monitoring. Admins see the whole school; every other
// signed-in staff member only sees the classes assigned to them server-side.
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12' };
export function normalizeCategory(value) {
  const raw = String(value || '').trim().replace(/^class\s+/i, '').replace(/section\s+/i, '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+|[ivxlcdm]+)(?:st|nd|rd|th)?[\s\-_:]*([a-z])(?:[\s\-_:]+[a-z])*$/i);
  if (m) return `${ROMAN[m[1].toLowerCase()] || m[1]}-${m[2].toUpperCase()}`;
  const f = raw.match(/(\d+)\s*(?:st|nd|rd|th)?[\s\-_:]*([a-z])/i);
  return f ? `${f[1]}-${f[2].toUpperCase()}` : null;
}
const categoryOf = (cls, sec, fallback = '') => normalizeCategory(`${cls || ''}-${sec || ''}`) || normalizeCategory(fallback) || '';
const maskPhone = phone => (phone ? '•••• ' + String(phone).slice(-4) : '');
const parse = d => { try { return JSON.parse(d.payload); } catch { return {}; } };

export function createEnrollmentMonitor({ db, databaseId, files, now }) {
  async function listAll(collection, queries, max = 5000) {
    const out = [];
    let cursor;
    while (out.length < max) {
      const page = await db.listDocuments(databaseId, collection, [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
      out.push(...page.documents);
      const last = page.documents.at(-1)?.$id;
      if (page.documents.length < 100 || !last || last === cursor) break;
      cursor = last;
    }
    return out;
  }
  const safe = async (work, fallback = []) => { try { return await work(); } catch { return fallback; } };
  const kind = (k, extra = [], max) => safe(() => listAll('student_enrollment', [Query.equal('kind', k), ...extra], max));

  async function scopeFor(user) {
    if (user?.labels?.some(l => ['admin', 'principal', 'superadmin'].includes(l))) return { all: true, classes: [] };
    const classes = new Set();
    const lookups = [['teacher_permissions', 'teacher_id'], ['teacher_permissions', 'user_id'], ['class_teachers', 'teacher_id']];
    await Promise.all(lookups.map(([collection, field]) => safe(async () => {
      for (const d of await listAll(collection, [Query.equal(field, user.$id)], 300)) {
        const perm = String(d.permission || '');
        const raw = d.category || (perm.startsWith('class_access:') ? perm.slice('class_access:'.length) : '');
        if (collection === 'teacher_permissions' && !raw && !d.class) continue; // feature flags, not classes
        const c = normalizeCategory(raw) || categoryOf(d.class, d.section);
        if (c) classes.add(c);
      }
    })));
    if (!classes.size) reject(403, 'No class is assigned to your account yet. Ask the school administrator to assign your class.');
    return { all: false, classes: [...classes].sort() };
  }

  async function overview(user) {
    const scope = await scopeFor(user);
    const t = now();
    const [profiles, states, captures, sessions, corrections, audits, descriptors] = await Promise.all([
      safe(() => listAll('profiles', [Query.or([Query.equal('role', 'student'), Query.isNull('role')])], 6000)),
      kind('student'),
      kind('capture'),
      kind('session', [Query.greaterThan('expires', t)], 1000),
      kind('correction', [], 1000),
      kind('audit', [Query.orderDesc('$createdAt')], 1500),
      safe(() => listAll('face_descriptors', [Query.select(['student_id', 'user_id', 'created_at'])], 8000)),
    ]);
    const byAdmission = new Map();
    for (const p of profiles) {
      const admission = String(p.admission_number || p.employee_id || '').trim();
      if (!admission || (p.role && p.role !== 'student')) continue;
      const category = categoryOf(p.class, p.section, p.category);
      if (!scope.all && !scope.classes.includes(category)) continue;
      byAdmission.set(admission, {
        admission_number: admission, name: p.full_name || p.display_name || admission, class: p.class || '', section: p.section || '', category,
        parent_phone: maskPhone(p.parent_phone), hasPhone: Boolean(p.parent_phone), hasDob: Boolean(p.date_of_birth), hasFather: Boolean(p.father_name),
        userId: p.user_id || p.$id, status: 'not_started', imported: false, portrait: false, faceOnFile: false, samples: [], method: '',
        verifiedAt: 0, completedAt: 0, failures: 0, correction: null, lastActivity: Date.parse(p.$updatedAt || '') || 0,
      });
    }
    const touch = (row, at) => { if (at > row.lastActivity) row.lastActivity = at; };
    for (const d of states) {
      const s = parse(d); const row = byAdmission.get(s.admission_number);
      if (!row) continue;
      row.imported = true; row.portrait = Boolean(s.portrait);
      if (s.status === 'completed') row.status = 'completed';
    }
    const latestCapture = new Map();
    for (const d of captures) { const c = parse(d); if (!latestCapture.has(c.student) || latestCapture.get(c.student).at < c.at) latestCapture.set(c.student, c); }
    for (const [admission, c] of latestCapture) {
      const row = byAdmission.get(admission); if (!row) continue;
      row.status = 'completed'; row.completedAt = c.at; row.method = c.method || row.method; touch(row, c.at);
      row.samples = (c.samples || []).map(s => ({ pose: s.pose, glasses: s.glasses, fileId: s.fileId, brightness: Math.round(s.quality?.brightness || 0), sharpness: Math.round(s.quality?.sharpness || 0) }));
    }
    for (const d of sessions) {
      const s = parse(d); const row = byAdmission.get(s.student);
      if (!row || s.completed || row.status === 'completed') continue;
      row.status = s.samples?.length ? 'capturing' : 'verified';
      row.method = s.method || row.method;
      row.inProgress = { samples: (s.samples || []).filter(x => x.uploaded).map(x => `${x.pose}:${x.glasses}`), expires: s.expires };
    }
    const activity = [];
    for (const d of audits) {
      const a = parse(d); const row = byAdmission.get(a.student);
      if (!row) continue;
      if (a.event === 'verification-failed') { row.failures++; if (row.status === 'not_started') row.status = 'failed'; }
      if (a.event === 'verified' && a.at > row.verifiedAt) { row.verifiedAt = a.at; row.method = row.method || a.method; }
      touch(row, a.at);
      // Staff user ids are never exposed; only the parent verification method is meaningful.
      if (activity.length < 300) activity.push({ event: a.event, student: a.student, name: row.name, category: row.category, method: ['otp', 'father-name', 'staff', 'verify-otp', 'verify-father'].includes(a.method) ? a.method : '', at: a.at });
    }
    const correctionList = [];
    for (const d of corrections) {
      const c = parse(d); const row = byAdmission.get(c.student);
      if (!row) continue;
      const item = { id: d.$id, student: c.student, name: row.name, category: row.category, original: c.original, changes: c.changes, status: c.status, at: c.at };
      correctionList.push(item);
      if (c.status === 'pending') row.correction = item.id;
    }
    const descriptorKeys = new Set(descriptors.flatMap(d => [d.student_id, d.user_id].filter(Boolean)));
    for (const row of byAdmission.values()) {
      const hasFace = descriptorKeys.has(row.admission_number) || descriptorKeys.has(row.userId);
      row.faceOnFile = row.status === 'completed' || hasFace;
      if (hasFace && row.status === 'not_started') {
        row.status = 'completed';
      }
    }
    const students = [...byAdmission.values()].map(({ userId, ...row }) => row);
    return { scope, generatedAt: t, students, activity, corrections: correctionList.sort((a, b) => b.at - a.at), canManage: scope.all };
  }

  async function photo(user, body) {
    const scope = await scopeFor(user);
    const admission = String(body.admission || '');
    const fileId = String(body.fileId || '');
    if (!/^[a-f0-9]{36}$/.test(fileId)) reject(400, 'Invalid photo reference.');
    const [profile] = (await db.listDocuments(databaseId, 'profiles', [Query.or([Query.equal('admission_number', admission), Query.equal('employee_id', admission)]), Query.limit(1)])).documents;
    if (!profile) reject(404, 'Student not found.');
    if (!scope.all && !scope.classes.includes(categoryOf(profile.class, profile.section, profile.category))) reject(403, 'This student is outside your assigned classes.');
    const owned = (await kind('capture')).some(d => { const c = parse(d); return c.student === admission && (c.samples || []).some(s => s.fileId === fileId); });
    if (!owned) reject(404, 'Photo not found for this student.');
    return { image: 'data:image/jpeg;base64,' + await files.read(fileId) };
  }

  return { overview, photo };
}
