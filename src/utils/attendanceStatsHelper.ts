import { supabase } from '@/integrations/supabase/client';

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

export interface UnifiedStudentSnapshot {
  totalRegistered: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  attendanceRate: number;
  statusesByEmployeeId: Record<string, UnifiedStudentStatus>;
}

export interface CanonicalStudent {
  id: string;
  user_id: string | null;
  employee_id: string;
  name: string;
  category?: string;
  image_url?: string;
  role?: string;
}

export interface UnifiedStudentSnapshot {
  totalRegistered: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  attendanceRate: number;
  statusesByEmployeeId: Record<string, UnifiedStudentStatus>;
  roster: CanonicalStudent[];
}

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

/**
 * Build a strictly deduplicated roster of enrolled students.
 * Groups multiple registrations, face samples, profiles, and alias IDs into unique physical students.
 */
function buildDeduplicatedRoster(
  registrationRecords: any[],
  descriptorRows: any[],
  profileRows: any[] = []
): CanonicalStudent[] {
  const candidates: CanonicalStudent[] = [];

  // 1. Process attendance_records with status='registered'
  (registrationRecords || []).forEach((r) => {
    const di = (r.device_info as any) || {};
    const meta = di.metadata || di || {};
    const rawName = meta.name || di.name || (r as any).student_name || '';
    const name = String(rawName).trim();
    const rawEmp = meta.employee_id || meta.roll_number || di.employee_id || (r as any).student_id || '';
    const employee_id = String(rawEmp).trim();
    const imageUrl = r.image_url || meta.firebase_image_url || meta.avatar_url || meta.id_card_photo_url || '';

    if (
      name &&
      name !== 'Unknown' &&
      !name.toLowerCase().includes('unknown') &&
      name !== 'User' &&
      !name.toLowerCase().includes('test face')
    ) {
      candidates.push({
        id: r.id,
        user_id: r.user_id || null,
        employee_id,
        name,
        category: r.category || meta.class_section || meta.department,
        image_url: imageUrl,
      });
    }
  });

  // 2. Process unique students from face_descriptors who might not be in attendance_records
  const descriptorsByNameOrEmp = new Map<string, any>();
  (descriptorRows || []).forEach((d) => {
    const name = String(d.student_name || d.label || '').trim();
    const empId = String(d.student_id || '').trim();
    const uid = String(d.user_id || '').trim();
    const meta = (d.metadata as any) || {};
    const imageUrl = d.image_url || meta.avatar_url || '';
    if (!name || name === 'Unknown' || name.toLowerCase().includes('unknown') || name === 'User') return;

    const groupKey = empId ? `emp:${normStr(empId)}` : `name:${normStr(name)}`;
    if (!descriptorsByNameOrEmp.has(groupKey)) {
      descriptorsByNameOrEmp.set(groupKey, {
        id: d.id,
        user_id: uid || null,
        employee_id: empId,
        name,
        category: meta.class_section || meta.category || meta.department,
        image_url: imageUrl,
      });
    }
  });

  descriptorsByNameOrEmp.forEach((cand) => {
    candidates.push(cand);
  });

  // 3. Process profiles (official roster)
  (profileRows || []).forEach((p) => {
    const rawName = p.full_name || p.display_name || '';
    const name = String(rawName).trim();
    if (!name || name === 'Unknown' || name.toLowerCase().includes('unknown') || name === 'User') return;

    const empId = String(p.admission_number || p.employee_id || p.roll_number || '').trim();
    const uid = String(p.user_id || p.id || '').trim();
    const cat = p.category || (p.class ? (p.section ? `${p.class}-${p.section}` : `Class ${p.class}`) : (p.role === 'teacher' ? 'Teacher' : undefined));

    candidates.push({
      id: p.id,
      user_id: uid || null,
      employee_id: empId,
      name,
      category: cat,
      image_url: p.avatar_url || '',
      role: p.role,
    });
  });

  // 4. Multi-key alias collapsing (collapses identical name, employee_id, or user_id)
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
    else if (nameKey && byName.has(nameKey)) existing = byName.get(nameKey);
    else if (uKey && byUserId.has(uKey)) existing = byUserId.get(uKey);

    if (existing) {
      // Merge identifiers into existing student
      if (!existing.employee_id && cand.employee_id) {
        existing.employee_id = cand.employee_id;
        byEmpId.set(normStr(existing.employee_id), existing);
      }
      if (!existing.user_id && cand.user_id) {
        existing.user_id = cand.user_id;
        byUserId.set(normStr(existing.user_id), existing);
      }
      if ((!existing.category || existing.category === 'A' || existing.category === 'Class 10') && cand.category) {
        existing.category = cand.category;
      }
      if (!existing.image_url && cand.image_url) {
        existing.image_url = cand.image_url;
      }
      if (!existing.role && cand.role) {
        existing.role = cand.role;
      }

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

  return canonicalRoster;
}

let cachedStats: { data: UnifiedAttendanceStats; expiresAt: number } | null = null;
let inFlightStatsPromise: Promise<UnifiedAttendanceStats> | null = null;

let cachedSnapshot: { data: UnifiedStudentSnapshot; expiresAt: number } | null = null;
let inFlightSnapshotPromise: Promise<UnifiedStudentSnapshot> | null = null;

export function invalidateUnifiedStatsCache() {
  cachedStats = null;
  cachedSnapshot = null;
}

/**
 * Single source of truth for attendance stats across the entire application.
 * Returns exact counts without duplicate multiplication.
 */
export async function fetchUnifiedAttendanceStats(forceFresh = false): Promise<UnifiedAttendanceStats> {
  const now = Date.now();
  if (!forceFresh && cachedStats && cachedStats.expiresAt > now) {
    return cachedStats.data;
  }
  if (!forceFresh && inFlightStatsPromise) {
    return inFlightStatsPromise;
  }

  const { startIso, localDateStr, utcDateStr } = getTodayRange();

  inFlightStatsPromise = (async () => {
    try {
      const [registeredRes, descriptorsRes, profilesRes, todayRes, gateRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, user_id, device_info, category, student_id, student_name, image_url')
          .eq('status', 'registered'),
        supabase
          .from('face_descriptors')
          .select('id, user_id, student_id, label, image_url'),
        supabase
          .from('profiles')
          .select('id, user_id, display_name, full_name, role, employee_id, admission_number, class, section, category, avatar_url'),
        supabase
          .from('attendance_records')
          .select('id, user_id, status, timestamp, device_info, student_id, student_name')
          .in('status', ['present', 'late', 'unauthorized'])
          .gte('timestamp', startIso),
        supabase
          .from('gate_entries')
          .select('id, student_id, entry_time, is_recognized')
          .gte('entry_time', startIso)
          .eq('is_recognized', true),
      ]);

      // 1. Build strictly deduplicated roster
      const roster = buildDeduplicatedRoster(
        registeredRes.data || [],
        descriptorsRes.data || [],
        profilesRes.data || []
      );

      // 2. Build present/late lookup sets
      const presentKeys = new Set<string>();
      const lateKeys = new Set<string>();

      (todayRes.data || []).forEach((r) => {
        const m = (r.device_info as any)?.metadata || r.device_info || {};
        const empId = (r as any).student_id || m.employee_id || m.roll_number || (r.device_info as any)?.employee_id;
        const name = (r as any).student_name || m.name || m.student_name || (r.device_info as any)?.name;
        const norm = normalizeStatus(r.status);

        const keys = [r.user_id, (r as any).student_id, empId, name, (r as any).student_name, r.id]
          .filter(Boolean)
          .map((k) => normStr(k));

        keys.forEach((k) => {
          if (norm === 'present') {
            presentKeys.add(k);
            lateKeys.delete(k);
          } else if (norm === 'late' && !presentKeys.has(k)) {
            lateKeys.add(k);
          }
        });
      });

      // Merge gate entries
      (gateRes.data || []).forEach((g) => {
        const sId = normStr(g.student_id);
        if (sId) {
          presentKeys.add(sId);
          lateKeys.delete(sId);
        }
      });

      // 3. Count statuses across unique students
      let totalPresent = 0;
      let totalLate = 0;

      roster.forEach((student) => {
        const identifiers = [student.employee_id, student.user_id, student.id, student.name]
          .filter(Boolean)
          .map((k) => normStr(k));

        for (const id of identifiers) {
          if (!id) continue;
          if (presentKeys.has(id)) {
            totalPresent++;
            return;
          }
          if (lateKeys.has(id)) {
            totalLate++;
            return;
          }
        }
      });

      const totalRegistered = roster.length;
      const absentToday = Math.max(0, totalRegistered - totalPresent - totalLate);
      const attendanceRate =
        totalRegistered > 0 ? Math.round(((totalPresent + totalLate) / totalRegistered) * 100) : 0;

      const result: UnifiedAttendanceStats = {
        totalRegistered,
        presentToday: totalPresent,
        lateToday: totalLate,
        absentToday,
        attendanceRate,
      };
      cachedStats = { data: result, expiresAt: Date.now() + 15000 };
      return result;
    } catch (err) {
      console.error('[attendanceStatsHelper] Error calculating attendance stats:', err);
      return {
        totalRegistered: 0,
        presentToday: 0,
        lateToday: 0,
        absentToday: 0,
        attendanceRate: 0,
      };
    } finally {
      inFlightStatsPromise = null;
    }
  })();

  return inFlightStatsPromise;
}

/**
 * Unified per-student attendance snapshot for Admin & Teacher views.
 * Uses registered users as source-of-truth roster and merges Attendance + Gate Mode records.
 */
export async function fetchUnifiedStudentSnapshot(forceFresh = false): Promise<UnifiedStudentSnapshot> {
  const now = Date.now();
  if (!forceFresh && cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return cachedSnapshot.data;
  }
  if (!forceFresh && inFlightSnapshotPromise) {
    return inFlightSnapshotPromise;
  }

  const { startIso, localDateStr, utcDateStr } = getTodayRange();

  inFlightSnapshotPromise = (async () => {
    try {
      const [registeredRes, descriptorsRes, profilesRes, todayRes, gateRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, user_id, device_info, category, student_id, student_name, image_url')
          .eq('status', 'registered'),
        supabase
          .from('face_descriptors')
          .select('id, user_id, student_id, label, image_url'),
        supabase
          .from('profiles')
          .select('id, user_id, display_name, full_name, role, employee_id, admission_number, class, section, category, avatar_url'),
        supabase
          .from('attendance_records')
          .select('id, user_id, status, timestamp, device_info, student_id, student_name, image_url')
          .in('status', ['present', 'late', 'unauthorized'])
          .gte('timestamp', startIso)
          .order('timestamp', { ascending: false }),
        supabase
          .from('gate_entries')
          .select('id, student_id, entry_time')
          .gte('entry_time', startIso)
          .eq('is_recognized', true)
          .order('entry_time', { ascending: false }),
      ]);

      const roster = buildDeduplicatedRoster(
        registeredRes.data || [],
        descriptorsRes.data || [],
        profilesRes.data || []
      );

      const idToStudentKey = new Map<string, string>();
      const statusesByEmployeeId: Record<string, UnifiedStudentStatus> = {};

      roster.forEach((student) => {
        const studentKey = student.employee_id || student.name || student.id;
        statusesByEmployeeId[studentKey] = { status: 'absent' };

        [student.employee_id, student.user_id, student.id, student.name].filter(Boolean).forEach((id) => {
          idToStudentKey.set(normStr(id), studentKey);
        });
      });

      // Latest attendance record wins
      (todayRes.data || []).forEach((r) => {
        const metadata = (r.device_info as any)?.metadata || r.device_info || {};
        const possibleIds = [
          metadata.employee_id,
          (r.device_info as any)?.employee_id,
          (r as any).student_id,
          metadata.name,
          (r.device_info as any)?.name,
          (r as any).student_name,
          r.user_id,
          r.id,
        ]
          .filter(Boolean)
          .map((s) => normStr(s));

        const matchedStudentKey = possibleIds
          .map((id) => idToStudentKey.get(id))
          .find(Boolean);

        if (!matchedStudentKey) return;
        if (statusesByEmployeeId[matchedStudentKey]?.status !== 'absent') return;

        const normalized = normalizeStatus(r.status);
        if (normalized === 'present' || normalized === 'late') {
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
        [student.employee_id, student.user_id, student.id, student.name].filter(Boolean).forEach((id) => {
          statusesByEmployeeId[id] = statusObj;
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
      };
      cachedSnapshot = { data: result, expiresAt: Date.now() + 15000 };
      return result;
    } catch (err) {
      console.error('[attendanceStatsHelper] Error fetching student snapshot:', err);
      return {
        totalRegistered: 0,
        presentToday: 0,
        lateToday: 0,
        absentToday: 0,
        attendanceRate: 0,
        statusesByEmployeeId: {},
        roster: [],
      };
    } finally {
      inFlightSnapshotPromise = null;
    }
  })();

  return inFlightSnapshotPromise;
}
