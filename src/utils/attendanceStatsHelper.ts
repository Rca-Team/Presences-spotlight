import { supabase } from '@/integrations/supabase/client';
import { pickPreferredPhotoCandidate, resolveStudentPhotoUrlSync } from '@/utils/studentPhotoResolver';
import { registerStudentIdentity } from '@/utils/studentIdentityResolver';

export interface UnifiedAttendanceStats {
  totalRegistered: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  attendanceRate: number;
}

export interface UnifiedStudentStatus {
  status: 'present' | 'late' | 'absent';
  time?: string;
}

export interface CanonicalStudent {
  id: string;
  user_id: string | null;
  employee_id: string;
  admission_number?: string;
  roll_number?: string;
  name: string;
  category?: string;
  class?: string;
  section?: string;
  department?: string;
  image_url?: string;
  role?: string;
  parent_name?: string;
  parent_phone?: string;
  parent_email?: string;
  phone?: string;
}

export interface UnifiedRecentCheckIn {
  id: string;
  userId?: string;
  name: string;
  studentId?: string;
  category: string;
  status: 'present' | 'late';
  timestamp: string;
  imageUrl: string;
}

export interface UnifiedStudentSnapshot {
  totalRegistered: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  attendanceRate: number;
  statusesByEmployeeId: Record<string, UnifiedStudentStatus>;
  roster: CanonicalStudent[];
  students: CanonicalStudent[];
  recentCheckIns?: UnifiedRecentCheckIn[];
}

const SNAPSHOT_STORAGE_KEY = 'presences_unified_snapshot_v3';
const SNAPSHOT_TTL_MS = 45_000;

/**
 * Returns ISO strings and local date strings for today's 00:00:00 to 23:59:59 window.
 */
function getTodayRange() {
  const now = new Date();
  const localMidnight = new Date(now);
  localMidnight.setHours(0, 0, 0, 0);

  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  // Use earlier of local midnight or UTC midnight so today's records are never missed across timezones
  const start = new Date(Math.min(localMidnight.getTime(), utcMidnight.getTime()));

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const year = localMidnight.getFullYear();
  const month = String(localMidnight.getMonth() + 1).padStart(2, '0');
  const day = String(localMidnight.getDate()).padStart(2, '0');
  const localDateStr = `${year}-${month}-${day}`;
  const utcDateStr = utcMidnight.toISOString().split('T')[0];

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    localDateStr,
    utcDateStr,
  };
}

const normStr = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase().replace(/\s+/g, ' '));

const normalizeStatus = (s: string | null | undefined): 'present' | 'late' | 'absent' | string => {
  const lower = (s || '').toLowerCase().trim();
  if (lower === 'unauthorized' || lower.includes('present')) return 'present';
  if (lower.includes('late')) return 'late';
  if (lower.includes('absent')) return 'absent';
  return lower;
};

function safeJsonParse(val: unknown): Record<string, any> {
  if (!val) return {};
  if (typeof val === 'object') return val as Record<string, any>;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Normalizes any combination of raw class, section, category, department, and role
 * into consistent { cls, sec, category, department, isTeacher } values.
 */
export function parseStudentClassSectionRole(input: {
  rawClass?: unknown;
  rawSection?: unknown;
  rawCategory?: unknown;
  rawDepartment?: unknown;
  rawRole?: unknown;
  hasStudentId?: boolean;
}): {
  cls: string;
  sec: string;
  category: string;
  department: string;
  role: 'student' | 'teacher';
} {
  const roleStr = normStr(input.rawRole);
  const catStr = String(input.rawCategory ?? '').trim();
  const deptStr = String(input.rawDepartment ?? '').trim();
  const clsStr = String(input.rawClass ?? '').trim();
  const secStr = String(input.rawSection ?? '').trim().toUpperCase();

  const isTeacher =
    roleStr === 'teacher' ||
    roleStr === 'staff' ||
    catStr.toLowerCase() === 'teacher' ||
    catStr.toLowerCase() === 'staff' ||
    deptStr.toLowerCase() === 'teacher' ||
    deptStr.toLowerCase() === 'faculty' ||
    ((roleStr === 'admin' || roleStr === 'principal') && !clsStr && !catStr && !input.hasStudentId);

  if (isTeacher) {
    return {
      cls: 'Teacher',
      sec: '',
      category: 'Teacher',
      department: 'Faculty',
      role: 'teacher',
    };
  }

  let detectedClass = '';
  let detectedSec = /^[A-D]$/i.test(secStr) ? secStr.toUpperCase() : '';

  const tryExtract = (raw: string) => {
    if (!raw || raw === '?' || raw === '—' || raw.toLowerCase() === 'unknown') return;
    const cleaned = raw.replace(/^(?:class|grade)\s*/i, '').trim();
    const fullMatch = cleaned.match(/^(\d{1,2})\s*[-_/\s]*\s*(?:section\s*)?([A-Da-d])\b/i);
    if (fullMatch) {
      if (!detectedClass) detectedClass = String(parseInt(fullMatch[1], 10));
      if (!detectedSec) detectedSec = fullMatch[2].toUpperCase();
      return;
    }
    const numMatch = cleaned.match(/\b(\d{1,2})\b/);
    if (numMatch && !detectedClass) {
      const n = parseInt(numMatch[1], 10);
      if (n >= 1 && n <= 12) detectedClass = String(n);
    }
    const secMatch = raw.match(/section\s*([A-Da-d])\b/i);
    if (secMatch && !detectedSec) {
      detectedSec = secMatch[1].toUpperCase();
    }
  };

  tryExtract(clsStr);
  tryExtract(catStr);
  tryExtract(deptStr);

  if (!detectedClass) detectedClass = '6';
  if (!detectedSec) detectedSec = 'A';

  const category = `${detectedClass}-${detectedSec}`;
  return {
    cls: detectedClass,
    sec: detectedSec,
    category,
    department: `Class ${category}`,
    role: 'student',
  };
}

/**
 * Build a strictly deduplicated roster of enrolled students & teachers.
 * Groups multiple registrations, face samples, profiles, and alias IDs into unique physical records.
 */
function buildDeduplicatedRoster(
  registrationRecords: any[],
  descriptorRows: any[],
  profileRows: any[] = []
): CanonicalStudent[] {
  const candidates: CanonicalStudent[] = [];

  // 1. Process profiles first (authoritative source of truth for student/teacher details & class/section)
  (profileRows || []).forEach((p) => {
    const pm = safeJsonParse(p.metadata);
    const rawName = p.full_name || p.display_name || pm.name || pm.full_name || '';
    const name = String(rawName).trim();
    if (!name || name === 'Unknown' || name.toLowerCase().includes('unknown') || name === 'User') return;

    const admNo = String(p.admission_number || pm.admission_number || '').trim();
    const rollNo = String(p.roll_number || pm.roll_number || '').trim();
    const empId = String(admNo || p.employee_id || rollNo || pm.employee_id || '').trim();
    const uid = String(p.user_id || p.id || p.$id || '').trim();

    const parsed = parseStudentClassSectionRole({
      rawClass: p.class || pm.class,
      rawSection: p.section || pm.section,
      rawCategory: p.category || pm.category || pm.class_section,
      rawDepartment: p.department || pm.department,
      rawRole: p.role || pm.role,
      hasStudentId: Boolean(admNo || rollNo),
    });

    const rawPhoto = pickPreferredPhotoCandidate(
      p.avatar_url,
      p.photo_url,
      pm.photo_url,
      pm.avatar_url,
      pm.id_card_photo_url
    );

    candidates.push({
      id: p.id || p.$id || uid,
      user_id: uid || null,
      employee_id: empId,
      admission_number: admNo || empId || undefined,
      roll_number: rollNo || undefined,
      name,
      category: parsed.category,
      class: parsed.cls,
      section: parsed.sec,
      department: parsed.department,
      image_url: resolveStudentPhotoUrlSync(rawPhoto),
      role: parsed.role,
      parent_name: p.parent_name || p.father_name || pm.father_name || pm.parent_name || undefined,
      parent_phone: p.parent_phone || pm.verified_parent_phone || pm.parent_phone || p.phone || undefined,
      parent_email: p.parent_email || pm.parent_email || p.email || undefined,
      phone: p.phone || p.parent_phone || pm.parent_phone || undefined,
    });
  });

  // 2. Process attendance_records with status='registered'
  (registrationRecords || []).forEach((r) => {
    const di = safeJsonParse(r.device_info);
    const meta = di.metadata || di || {};
    const rawName = meta.name || di.name || (r as any).student_name || '';
    const name = String(rawName).trim();
    const admNo = String(meta.admission_number || (r as any).student_id || '').trim();
    const rollNo = String(meta.roll_number || '').trim();
    const rawEmp = meta.employee_id || admNo || rollNo || di.employee_id || '';
    const employee_id = String(rawEmp).trim();

    if (
      !name ||
      name === 'Unknown' ||
      name.toLowerCase().includes('unknown') ||
      name === 'User' ||
      name.toLowerCase().includes('test face')
    ) {
      return;
    }

    const parsed = parseStudentClassSectionRole({
      rawClass: (r as any).class || meta.class,
      rawSection: (r as any).section || meta.section,
      rawCategory: r.category || meta.class_section || meta.category,
      rawDepartment: meta.department,
      rawRole: meta.role || (meta.position === 'Teacher' ? 'teacher' : 'student'),
      hasStudentId: Boolean(employee_id),
    });

    const rawPhoto = pickPreferredPhotoCandidate(
      meta?.face_model?.id_card_photo_url,
      meta?.id_card_photo_url,
      r.image_url,
      meta.firebase_image_url,
      meta.avatar_url,
      meta.image
    );

    candidates.push({
      id: r.id || r.$id,
      user_id: r.user_id || null,
      employee_id,
      admission_number: admNo || employee_id || undefined,
      roll_number: rollNo || undefined,
      name,
      category: parsed.category,
      class: parsed.cls,
      section: parsed.sec,
      department: parsed.department,
      image_url: resolveStudentPhotoUrlSync(rawPhoto),
      role: parsed.role,
      parent_name: meta.parent_name || meta.father_name || undefined,
      parent_phone: meta.parent_phone || meta.phone || undefined,
      parent_email: meta.parent_email || undefined,
      phone: meta.phone || meta.parent_phone || undefined,
    });
  });

  // 3. Process unique students from face_descriptors if provided
  const descriptorsByNameOrEmp = new Map<string, any>();
  (descriptorRows || []).forEach((d) => {
    const name = String(d.student_name || d.label || '').trim();
    const empId = String(d.student_id || '').trim();
    const uid = String(d.user_id || '').trim();
    const meta = safeJsonParse(d.metadata);
    const rawPhoto = d.image_url || meta.avatar_url || '';
    if (!name || name === 'Unknown' || name.toLowerCase().includes('unknown') || name === 'User') return;

    const groupKey = empId ? `emp:${normStr(empId)}` : `name:${normStr(name)}`;
    if (!descriptorsByNameOrEmp.has(groupKey)) {
      const parsed = parseStudentClassSectionRole({
        rawClass: d.class || meta.class,
        rawSection: d.section || meta.section,
        rawCategory: d.category || meta.class_section || meta.category,
        rawDepartment: meta.department,
        hasStudentId: Boolean(empId),
      });
      descriptorsByNameOrEmp.set(groupKey, {
        id: d.id || d.$id,
        user_id: uid || null,
        employee_id: empId,
        name,
        category: parsed.category,
        class: parsed.cls,
        section: parsed.sec,
        department: parsed.department,
        image_url: resolveStudentPhotoUrlSync(rawPhoto),
        role: parsed.role,
      });
    }
  });

  descriptorsByNameOrEmp.forEach((cand) => {
    candidates.push(cand);
  });

  // 4. Multi-key alias collapsing (collapses identical employee_id, user_id, or name)
  const byEmpId = new Map<string, CanonicalStudent>();
  const byUserId = new Map<string, CanonicalStudent>();
  const byName = new Map<string, CanonicalStudent>();
  const canonicalRoster: CanonicalStudent[] = [];

  candidates.forEach((cand) => {
    const empKey = normStr(cand.employee_id);
    const uKey = normStr(cand.user_id);
    const nameKey = normStr(cand.name);

    let existing: CanonicalStudent | undefined;
    if (empKey && byEmpId.has(empKey)) existing = byEmpId.get(empKey);
    else if (uKey && byUserId.has(uKey)) existing = byUserId.get(uKey);
    else if (nameKey && byName.has(nameKey)) existing = byName.get(nameKey);

    if (existing) {
      if (!existing.employee_id && cand.employee_id) {
        existing.employee_id = cand.employee_id;
        byEmpId.set(normStr(existing.employee_id), existing);
      }
      if (!existing.admission_number && cand.admission_number) {
        existing.admission_number = cand.admission_number;
      }
      if (!existing.roll_number && cand.roll_number) {
        existing.roll_number = cand.roll_number;
      }
      if (!existing.user_id && cand.user_id) {
        existing.user_id = cand.user_id;
        byUserId.set(normStr(existing.user_id), existing);
      }
      if ((!existing.category || existing.category === '6-A') && cand.category && cand.category !== '6-A') {
        existing.category = cand.category;
        existing.class = cand.class;
        existing.section = cand.section;
        existing.department = cand.department;
      }
      if (!existing.image_url && cand.image_url) {
        existing.image_url = cand.image_url;
      }
      if ((!existing.role || existing.role === 'student') && cand.role === 'teacher') {
        existing.role = 'teacher';
        existing.category = 'Teacher';
        existing.class = 'Teacher';
        existing.section = '';
        existing.department = 'Faculty';
      }
      if (!existing.parent_name && cand.parent_name) existing.parent_name = cand.parent_name;
      if (!existing.parent_phone && cand.parent_phone) existing.parent_phone = cand.parent_phone;
      if (!existing.parent_email && cand.parent_email) existing.parent_email = cand.parent_email;
      if (!existing.phone && cand.phone) existing.phone = cand.phone;

      if (empKey) byEmpId.set(empKey, existing);
      if (uKey) byUserId.set(uKey, existing);
      if (nameKey) byName.set(nameKey, existing);
    } else {
      canonicalRoster.push(cand);
      if (empKey) byEmpId.set(empKey, cand);
      if (uKey) byUserId.set(uKey, cand);
      if (nameKey) byName.set(nameKey, cand);
    }
  });

  // Register all identities in the fast local identity resolver cache
  canonicalRoster.forEach((s) => {
    registerStudentIdentity({
      userId: s.user_id || s.id,
      name: s.name,
      studentId: s.employee_id,
      classSection: s.category,
    });
  });

  return canonicalRoster;
}

let cachedSnapshot: { data: UnifiedStudentSnapshot; expiresAt: number } | null = null;
let inFlightSnapshotPromise: Promise<UnifiedStudentSnapshot> | null = null;

// Hydrate memory cache from sessionStorage on module load for 0ms first paint
try {
  if (typeof window !== 'undefined') {
    const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { data: UnifiedStudentSnapshot; savedAt: number };
      const rawRoster = parsed?.data?.roster || (parsed?.data as any)?.students;
      if (parsed?.data && Array.isArray(rawRoster) && Date.now() - parsed.savedAt < 5 * 60 * 1000) {
        parsed.data.roster = rawRoster;
        parsed.data.students = rawRoster;
        cachedSnapshot = {
          data: parsed.data,
          expiresAt: parsed.savedAt + SNAPSHOT_TTL_MS,
        };
      }
    }
  }
} catch {
  // Ignore storage parse failure
}

export function getCachedUnifiedStudentSnapshot(): UnifiedStudentSnapshot | null {
  if (cachedSnapshot?.data) {
    const d = cachedSnapshot.data;
    if (!d.roster && (d as any).students) d.roster = (d as any).students;
    if (!d.students && d.roster) d.students = d.roster;
    return d;
  }
  return null;
}

export function invalidateUnifiedStatsCache() {
  cachedSnapshot = null;
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage removal failure
  }
}

/**
 * Single source of truth for attendance stats across the entire application.
 * Reuses fetchUnifiedStudentSnapshot so duplicate queries are never executed.
 */
export async function fetchUnifiedAttendanceStats(forceFresh = false): Promise<UnifiedAttendanceStats> {
  const snapshot = await fetchUnifiedStudentSnapshot(forceFresh);
  return {
    totalRegistered: snapshot.totalRegistered,
    presentToday: snapshot.presentToday,
    lateToday: snapshot.lateToday,
    absentToday: snapshot.absentToday,
    attendanceRate: snapshot.attendanceRate,
  };
}

/**
 * Unified per-student attendance snapshot for Admin (Dashboard, Students, Classes & Sections) & Teacher views.
 * Fetches the full school roster + today's attendance in a single parallel burst.
 */
export async function fetchUnifiedStudentSnapshot(forceFresh = false): Promise<UnifiedStudentSnapshot> {
  const now = Date.now();
  if (!forceFresh && cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return cachedSnapshot.data;
  }
  if (!forceFresh && inFlightSnapshotPromise) {
    return inFlightSnapshotPromise;
  }

  const { startIso } = getTodayRange();

  inFlightSnapshotPromise = (async () => {
    try {
      const [registeredRes, profilesRes, todayRes, gateRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, user_id, device_info, category, class, section, student_id, student_name, image_url')
          .eq('status', 'registered')
          .limit(2000),
        supabase
          .from('profiles')
          .select('id, user_id, display_name, full_name, role, employee_id, admission_number, roll_number, class, section, category, department, avatar_url, photo_url, parent_name, father_name, parent_phone, phone, parent_email, email, metadata')
          .limit(2000),
        supabase
          .from('attendance_records')
          .select('id, user_id, status, timestamp, device_info, category, class, section, student_id, student_name, image_url')
          .in('status', ['present', 'late', 'unauthorized'])
          .gte('timestamp', startIso)
          .order('timestamp', { ascending: false })
          .limit(500),
        supabase
          .from('gate_entries')
          .select('id, student_id, entry_time')
          .gte('entry_time', startIso)
          .eq('is_recognized', true)
          .order('entry_time', { ascending: false })
          .limit(500),
      ]);

      let fallbackDescriptors: any[] = [];
      if (!(profilesRes.data?.length) && !(registeredRes.data?.length)) {
        const descriptorsRes = await supabase
          .from('face_descriptors')
          .select('id, user_id, student_id, label, image_url')
          .limit(500);
        fallbackDescriptors = descriptorsRes.data || [];
      }

      const roster = buildDeduplicatedRoster(
        registeredRes.data || [],
        fallbackDescriptors,
        profilesRes.data || []
      );

      const idToStudentKey = new Map<string, string>();
      const keyToStudent = new Map<string, CanonicalStudent>();
      const statusesByEmployeeId: Record<string, UnifiedStudentStatus> = {};

      roster.forEach((student) => {
        const studentKey = student.employee_id || student.name || student.id;
        statusesByEmployeeId[studentKey] = { status: 'absent' };
        keyToStudent.set(studentKey, student);

        [student.employee_id, student.admission_number, student.roll_number, student.user_id, student.id, student.name]
          .filter(Boolean)
          .forEach((id) => {
            idToStudentKey.set(normStr(id), studentKey);
          });
      });

      const recentCheckIns: UnifiedRecentCheckIn[] = [];

      // Latest attendance record wins
      (todayRes.data || []).forEach((r) => {
        const di = safeJsonParse(r.device_info);
        const metadata = di.metadata || di || {};
        const possibleIds = [
          metadata.employee_id,
          di.employee_id,
          (r as any).student_id,
          metadata.name,
          di.name,
          (r as any).student_name,
          r.user_id,
          r.id,
        ]
          .filter(Boolean)
          .map((s) => normStr(s));

        const matchedStudentKey = possibleIds
          .map((id) => idToStudentKey.get(id))
          .find(Boolean);

        const normalized = normalizeStatus(r.status);
        const isPresentOrLate = normalized === 'present' || normalized === 'late';

        if (isPresentOrLate && recentCheckIns.length < 30) {
          const matchedStudent = matchedStudentKey ? keyToStudent.get(matchedStudentKey) : undefined;
          recentCheckIns.push({
            id: r.id,
            userId: r.user_id || matchedStudent?.user_id || undefined,
            name: matchedStudent?.name || (r as any).student_name || metadata.name || di.name || 'Student',
            studentId: matchedStudent?.employee_id || (r as any).student_id || metadata.employee_id || undefined,
            category: matchedStudent?.category || r.category || metadata.class_section || '',
            status: normalized === 'late' ? 'late' : 'present',
            timestamp: r.timestamp,
            imageUrl: matchedStudent?.image_url || resolveStudentPhotoUrlSync(r.image_url || metadata.firebase_image_url || ''),
          });
        }

        if (!matchedStudentKey) return;
        if (statusesByEmployeeId[matchedStudentKey]?.status !== 'absent') return;

        if (isPresentOrLate) {
          statusesByEmployeeId[matchedStudentKey] = {
            status: normalized as 'present' | 'late',
            time: r.timestamp,
          };
        }
      });

      // Gate entries fill remaining absentees
      (gateRes.data || []).forEach((g) => {
        if (!g.student_id) return;
        const sId = normStr(g.student_id);
        const matchedStudentKey = idToStudentKey.get(sId);
        if (!matchedStudentKey) return;

        if (statusesByEmployeeId[matchedStudentKey]?.status === 'absent') {
          statusesByEmployeeId[matchedStudentKey] = {
            status: 'present',
            time: g.entry_time,
          };
        }
      });

      // Also index all aliases of each student into statusesByEmployeeId so consumers can look up by any identifier
      roster.forEach((student) => {
        const studentKey = student.employee_id || student.name || student.id;
        const statusObj = statusesByEmployeeId[studentKey] || { status: 'absent' };
        [student.employee_id, student.admission_number, student.roll_number, student.user_id, student.id, student.name]
          .filter(Boolean)
          .forEach((id) => {
            statusesByEmployeeId[String(id)] = statusObj;
            statusesByEmployeeId[normStr(id)] = statusObj;
          });
      });

      const totalRegistered = roster.length;
      const presentToday = roster.filter((student) => {
        const key = student.employee_id || student.name || student.id;
        return statusesByEmployeeId[key]?.status === 'present';
      }).length;
      const lateToday = roster.filter((student) => {
        const key = student.employee_id || student.name || student.id;
        return statusesByEmployeeId[key]?.status === 'late';
      }).length;
      const absentToday = Math.max(0, totalRegistered - presentToday - lateToday);
      const attendanceRate =
        totalRegistered > 0 ? Math.round(((presentToday + lateToday) / totalRegistered) * 100) : 0;

      const result: UnifiedStudentSnapshot = {
        totalRegistered,
        presentToday,
        lateToday,
        absentToday,
        attendanceRate,
        statusesByEmployeeId,
        roster,
        students: roster,
        recentCheckIns,
      };
      cachedSnapshot = { data: result, expiresAt: Date.now() + SNAPSHOT_TTL_MS };

      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(
            SNAPSHOT_STORAGE_KEY,
            JSON.stringify({ data: result, savedAt: Date.now() })
          );
        }
      } catch {
        // Ignore sessionStorage quota issues
      }

      return result;
    } catch (err) {
      console.error('[attendanceStatsHelper] Error fetching student snapshot:', err);
      if (cachedSnapshot?.data) {
        return cachedSnapshot.data;
      }
      return {
        totalRegistered: 0,
        presentToday: 0,
        lateToday: 0,
        absentToday: 0,
        attendanceRate: 0,
        statusesByEmployeeId: {},
        roster: [],
        students: [],
        recentCheckIns: [],
      };
    } finally {
      inFlightSnapshotPromise = null;
    }
  })();

  return inFlightSnapshotPromise;
}
