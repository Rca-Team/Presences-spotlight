
import { supabase } from '@/integrations/supabase/client';
import { SetDatesFunction, AttendanceRecord } from './types';

// Normalize status to consistent lowercase values
function normalizeStatus(status: string | null): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase().trim();
  if (s.includes('present')) return 'present';
  if (s.includes('late')) return 'late';
  if (s.includes('absent')) return 'absent';
  return s;
}

// Normalize date to midnight for consistent comparison
function toMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Extract name from device_info
function extractName(deviceInfo: any): string {
  try {
    if (deviceInfo && typeof deviceInfo === 'object' && !Array.isArray(deviceInfo)) {
      if (deviceInfo.metadata?.name) return deviceInfo.metadata.name;
      if (deviceInfo.name) return deviceInfo.name;
    }
  } catch (e) {
    console.error('Error extracting name from device_info:', e);
  }
  return '';
}

function normalizeGateMetadata(record: any) {
  const metadata = (record?.device_info as any)?.metadata || {};
  const source = String(record?.source || '').toLowerCase();
  const captureMode = String(record?.capture_mode || metadata.capture_mode || '').toLowerCase();
  const isGate = source === 'gate-mode' || captureMode === 'gate-mode' || Boolean((record?.device_info as any)?.gate);

  return {
    source,
    captureMode,
    periodKey: metadata.gate_period_key || metadata.periodKey || undefined,
    className: metadata.class || metadata.class_name || record?.class || undefined,
    section: metadata.section || record?.section || undefined,
    subject: metadata.subject || undefined,
    isGate,
  };
}

import { getCachedUnifiedStudentSnapshot } from '@/utils/attendanceStatsHelper';

// Get all identifiers for a registered face to match attendance records
export async function getFaceIdentifiers(faceId: string, knownEmployeeId?: string | null): Promise<{ userIds: string[]; employeeId: string | null }> {
  const userIds: string[] = [faceId];
  let employeeId: string | null = knownEmployeeId || null;

  // 1. Check in-memory snapshot first
  try {
    const snapshot = getCachedUnifiedStudentSnapshot();
    const roster = snapshot?.roster || snapshot?.students || [];
    const matched = roster.find(
      s => s.id === faceId || s.employee_id === faceId || s.admission_number === faceId || s.user_id === faceId
    );

    if (matched) {
      const adm = matched.admission_number || matched.employee_id;
      if (adm) {
        employeeId = adm;
        userIds.push(adm);
      }
      if (matched.user_id) userIds.push(matched.user_id);
      if (matched.id) userIds.push(matched.id);
    }
  } catch {}

  // 2. Query profiles directly by id (exact Appwrite $id match)
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, user_id, employee_id, admission_number')
      .eq('id', faceId)
      .maybeSingle();

    if (prof) {
      if (prof.admission_number) {
        userIds.push(prof.admission_number);
        if (!employeeId) employeeId = prof.admission_number;
      }
      if (prof.employee_id) {
        userIds.push(prof.employee_id);
        if (!employeeId) employeeId = prof.employee_id;
      }
      if (prof.user_id) userIds.push(prof.user_id);
      if (prof.id) userIds.push(prof.id);
    }
  } catch {}

  // 3. Check attendance_records directly
  try {
    let { data } = await supabase
      .from('attendance_records')
      .select('user_id, student_id, device_info')
      .eq('id', faceId)
      .maybeSingle();

    if (!data) {
      const { data: recByUid } = await supabase
        .from('attendance_records')
        .select('user_id, student_id, device_info')
        .or(`user_id.eq.${faceId},student_id.eq.${faceId}`)
        .limit(1)
        .maybeSingle();
      data = recByUid;
    }

    if (data) {
      if (data.user_id) userIds.push(data.user_id);
      if ((data as any).student_id) {
        userIds.push((data as any).student_id);
        if (!employeeId) employeeId = (data as any).student_id;
      }
      const di = data.device_info as any;
      const metaId = di?.metadata?.employee_id || di?.metadata?.admission_number || di?.employee_id;
      if (metaId) {
        if (!employeeId) employeeId = metaId;
        userIds.push(metaId);
      }
    }
  } catch {}

  return { userIds: [...new Set(userIds.filter(Boolean))], employeeId };
}

// Fetch attendance records - determines present/late days
export const fetchAttendanceRecords = async (
  faceId: string,
  setAttendanceDays: SetDatesFunction,
  setLateAttendanceDays: SetDatesFunction
) => {
  try {
    const { userIds, employeeId } = await getFaceIdentifiers(faceId);
    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // Build queries for all possible identifier matches
    const queries = userIds.map(uid => {
      let q = supabase.from('attendance_records')
        .select('id, timestamp, status, source, capture_mode, class, section, device_info, student_id');
      if (isUuid(uid)) {
        q = q.or(`user_id.eq.${uid},id.eq.${uid},student_id.eq.${uid}`);
      } else {
        q = q.eq('student_id', uid);
      }
      return q.in('status', ['present', 'late', 'unauthorized']);
    });

    // Also query by employee_id in device_info or student_id column
    if (employeeId) {
      queries.push(
        supabase.from('attendance_records')
          .select('id, timestamp, status, source, capture_mode, class, section, device_info, student_id')
          .eq('student_id', employeeId)
          .in('status', ['present', 'late', 'unauthorized'])
      );
      queries.push(
        supabase.from('attendance_records')
          .select('id, timestamp, status, source, capture_mode, class, section, device_info, student_id')
          .eq('user_id', employeeId)
          .in('status', ['present', 'late', 'unauthorized'])
      );
    }

    const results = await Promise.all(queries);
    
    // Deduplicate by record ID
    const seen = new Set<string>();
    const allRecords = results.flatMap(r => r.data || []).filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    if (allRecords.length === 0) {
      setAttendanceDays([]);
      setLateAttendanceDays([]);
      return;
    }

    const presentDaysMap = new Map<string, Date>();
    const lateDaysMap = new Map<string, Date>();

    for (const record of allRecords) {
      if (!record.timestamp) continue;
      const di = record.device_info as any;
      if (di?.registration) continue;

      const status = normalizeStatus(record.status);
      if (status !== 'present' && status !== 'late') continue;

      const date = toMidnight(new Date(record.timestamp));
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

      if (status === 'present') {
        presentDaysMap.set(dateKey, date);
        lateDaysMap.delete(dateKey);
      } else if (status === 'late' && !presentDaysMap.has(dateKey)) {
        lateDaysMap.set(dateKey, date);
      }
    }

    setAttendanceDays(Array.from(presentDaysMap.values()));
    setLateAttendanceDays(Array.from(lateDaysMap.values()));
  } catch (error) {
    console.error('Error in fetchAttendanceRecords:', error);
    throw error;
  }
};

// Fetch daily attendance for a specific date
export const fetchDailyAttendance = async (
  faceId: string,
  date: Date,
  setDailyAttendance: (records: AttendanceRecord[]) => void
) => {
  try {
    const { userIds, employeeId } = await getFaceIdentifiers(faceId);

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const timestampStart = startOfDay.toISOString();
    const timestampEnd = endOfDay.toISOString();

    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    const queries = userIds.map(uid => {
      let q = supabase.from('attendance_records')
        .select('id, timestamp, status, source, capture_mode, class, section, device_info, user_id, student_id, image_url');
      if (isUuid(uid)) {
        q = q.or(`user_id.eq.${uid},id.eq.${uid},student_id.eq.${uid}`);
      } else {
        q = q.eq('student_id', uid);
      }
      return q.gte('timestamp', timestampStart)
        .lte('timestamp', timestampEnd)
        .order('timestamp', { ascending: true });
    });

    if (employeeId) {
      queries.push(
        supabase.from('attendance_records')
          .select('id, timestamp, status, source, capture_mode, class, section, device_info, user_id, student_id, image_url')
          .eq('student_id', employeeId)
          .gte('timestamp', timestampStart)
          .lte('timestamp', timestampEnd)
          .order('timestamp', { ascending: true })
      );
      queries.push(
        supabase.from('attendance_records')
          .select('id, timestamp, status, source, capture_mode, class, section, device_info, user_id, student_id, image_url')
          .eq('user_id', employeeId)
          .gte('timestamp', timestampStart)
          .lte('timestamp', timestampEnd)
          .order('timestamp', { ascending: true })
      );
    }

    const results = await Promise.all(queries);

    const allRecordsMap = new Map();
    results.flatMap(r => r.data || []).forEach(r => allRecordsMap.set(r.id, r));
    let allRecords = Array.from(allRecordsMap.values());

    // Filter out registration records
    allRecords = allRecords.filter(r => {
      const di = r.device_info as any;
      if (di?.registration) return false;
      const status = normalizeStatus(r.status);
      return status === 'present' || status === 'late';
    });

    if (allRecords.length > 0) {
      const normalizedRecords = allRecords.map(record => ({
        ...(normalizeGateMetadata(record)),
        id: record.id,
        timestamp: record.timestamp,
        status: normalizeStatus(record.status),
        name: extractName(record.device_info) || 'Student',
        image_url: record.image_url
      }));

      const nonGate = normalizedRecords
        .filter((r) => !r.isGate)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const gateLatestByPeriod = new Map<string, (typeof normalizedRecords)[number]>();
      normalizedRecords
        .filter((r) => r.isGate)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .forEach((record) => {
          const key = record.periodKey || record.id;
          gateLatestByPeriod.set(key, record);
        });

      const merged = [...nonGate, ...Array.from(gateLatestByPeriod.values())]
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(({ isGate, ...record }) => record);

      setDailyAttendance(merged);
    } else {
      setDailyAttendance([]);
    }
  } catch (error) {
    console.error('Error in fetchDailyAttendance:', error);
    throw error;
  }
};
