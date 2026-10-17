import { supabase } from '@/integrations/supabase/client';
import { invalidateCollectionCache } from '@/integrations/appwrite/adapter';
import { invalidateUnifiedStatsCache } from '@/utils/attendanceStatsHelper';
import { clearMonitorCache } from '@/services/enrollment/monitor';

export interface StudentUpdateTarget {
  id?: string;
  user_id?: string;
  employee_id?: string;
  admission_number?: string;
  roll_number?: string;
  name?: string;
  full_name?: string;
  display_name?: string;
}

export interface StudentClassUpdatePayload {
  class: string;
  section: string;
  category?: string;
  role?: 'student' | 'teacher';
  name?: string;
  roll_number?: string;
  parent_phone?: string;
  father_name?: string;
  mother_name?: string;
  date_of_birth?: string;
  blood_group?: string;
  pen_number?: string;
  student_id_kv?: string;
  address?: string;
}

function parseMetadata(meta: any): Record<string, any> {
  if (!meta) return {};
  if (typeof meta === 'object') return { ...meta };
  try {
    const p = JSON.parse(meta);
    return typeof p === 'object' && p !== null ? p : {};
  } catch {
    return {};
  }
}

/**
 * Universally updates a student's Class, Section, and Category across:
 * 1. `profiles` collection
 * 2. `attendance_records` collection
 * 3. `face_descriptors` collection
 * 4. All in-memory, session, and local storage caches
 */
export async function universalUpdateStudentClassSection(
  target: StudentUpdateTarget,
  payload: StudentClassUpdatePayload
): Promise<{ success: boolean; updatedProfiles: number; updatedAttendance: number; updatedDescriptors: number }> {
  const candidateUserIds = new Set<string>();
  const candidateStudentKeys = new Set<string>();
  const candidateProfileIds = new Set<string>();

  const cleanVal = (v: any) => (v != null ? String(v).trim() : '');

  // 1. Collect identifiers from target
  const rawId = cleanVal(target.id);
  const rawUserId = cleanVal(target.user_id);
  const rawEmp = cleanVal(target.employee_id);
  const rawAdm = cleanVal(target.admission_number);
  const rawRoll = cleanVal(target.roll_number);

  if (rawId && rawId !== 'undefined' && rawId !== 'null') {
    // If it's a prefixed key like "emp:123" or "prof:xyz"
    if (rawId.startsWith('emp:')) candidateStudentKeys.add(rawId.slice(4));
    else if (rawId.startsWith('prof:')) candidateProfileIds.add(rawId.slice(5));
    else if (rawId.startsWith('rec:')) { /* attendance record id */ }
    else candidateProfileIds.add(rawId);
  }
  if (rawUserId && rawUserId !== 'undefined' && rawUserId !== 'null') candidateUserIds.add(rawUserId);
  if (rawEmp && rawEmp !== '—' && rawEmp !== 'N/A') candidateStudentKeys.add(rawEmp);
  if (rawAdm && rawAdm !== '—' && rawAdm !== 'N/A') candidateStudentKeys.add(rawAdm);
  if (rawRoll && rawRoll !== '—' && rawRoll !== 'N/A') candidateStudentKeys.add(rawRoll);

  // 2. Resolve matching profiles in DB
  const matchedProfiles: any[] = [];
  try {
    const lookups: any[] = [];
    if (candidateProfileIds.size > 0) {
      lookups.push(supabase.from('profiles').select('*').in('id', Array.from(candidateProfileIds)));
    }
    if (candidateUserIds.size > 0) {
      lookups.push(supabase.from('profiles').select('*').in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      const keys = Array.from(candidateStudentKeys);
      lookups.push(supabase.from('profiles').select('*').in('admission_number', keys));
      lookups.push(supabase.from('profiles').select('*').in('employee_id', keys));
      lookups.push(supabase.from('profiles').select('*').in('roll_number', keys));
    }

    const results = await Promise.allSettled(lookups);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.data && Array.isArray(r.value.data)) {
        for (const p of r.value.data) {
          if (!matchedProfiles.some((ex) => (ex.id || ex.$id) === (p.id || p.$id))) {
            matchedProfiles.push(p);
          }
          if (p.id) candidateProfileIds.add(p.id);
          if (p.$id) candidateProfileIds.add(p.$id);
          if (p.user_id) candidateUserIds.add(p.user_id);
          const admKey = cleanVal(p.admission_number || p.employee_id || p.roll_number);
          if (admKey) candidateStudentKeys.add(admKey);
        }
      }
    }
  } catch (err) {
    console.warn('[studentUpdateService] Error looking up profiles:', err);
  }

  // 3. Format Class, Section, and Category
  const isTeacher = payload.role === 'teacher' || payload.class === 'Teacher' || payload.category === 'Teacher';
  const finalClass = isTeacher ? 'Teacher' : cleanVal(payload.class);
  const finalSection = isTeacher ? '' : cleanVal(payload.section).toUpperCase();
  const finalCategory = isTeacher
    ? 'Teacher'
    : payload.category || (finalClass && finalSection ? `${finalClass}-${finalSection}` : finalClass || 'Unassigned');
  const finalRole = isTeacher ? 'teacher' : 'student';

  const cleanPhone = cleanVal(payload.parent_phone).replace(/\D/g, '');
  const phone10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

  let updatedProfiles = 0;
  let updatedAttendance = 0;
  let updatedDescriptors = 0;

  // 4. Update Profiles
  if (matchedProfiles.length > 0) {
    for (const prof of matchedProfiles) {
      const profId = prof.id || prof.$id;
      if (!profId) continue;
      const prevMeta = parseMetadata(prof.metadata);
      const updatedMeta = {
        ...prevMeta,
        class: finalClass,
        section: finalSection,
        category: finalCategory,
        ...(payload.father_name ? { father_name: payload.father_name.trim() } : {}),
        ...(payload.mother_name ? { mother_name: payload.mother_name.trim() } : {}),
        ...(payload.date_of_birth ? { date_of_birth: payload.date_of_birth.trim() } : {}),
        ...(payload.blood_group ? { blood_group: payload.blood_group.trim() } : {}),
        ...(payload.pen_number ? { pen_number: payload.pen_number.trim() } : {}),
        ...(payload.student_id_kv ? { student_id_kv: payload.student_id_kv.trim() } : {}),
        ...(payload.roll_number ? { roll_number: payload.roll_number.trim() } : {}),
        ...(payload.address ? { address: payload.address.trim() } : {}),
        ...(phone10 ? { verified_parent_phone: phone10 } : {}),
      };

      const profUpdate: Record<string, any> = {
        class: finalClass,
        section: finalSection,
        category: finalCategory,
        role: finalRole,
        metadata: JSON.stringify(updatedMeta),
        updated_at: new Date().toISOString(),
      };
      if (payload.name) {
        profUpdate.full_name = payload.name.trim();
        profUpdate.display_name = payload.name.trim();
      }
      if (payload.roll_number) profUpdate.roll_number = payload.roll_number.trim();
      if (phone10) {
        profUpdate.parent_phone = phone10;
        profUpdate.phone = phone10;
      }
      if (payload.father_name) profUpdate.father_name = payload.father_name.trim();
      if (payload.mother_name) profUpdate.mother_name = payload.mother_name.trim();
      if (payload.blood_group) profUpdate.blood_group = payload.blood_group.trim();
      if (payload.address) profUpdate.address = payload.address.trim();

      const { error } = await supabase.from('profiles').update(profUpdate).eq('id', profId);
      if (!error) updatedProfiles++;
    }
  } else {
    // No existing profile matched directly by ID; create or upsert by admission_number
    const fallbackAdm = Array.from(candidateStudentKeys)[0] || rawId || ID_FALLBACK();
    const newDocPayload: Record<string, any> = {
      admission_number: fallbackAdm,
      employee_id: fallbackAdm,
      full_name: payload.name || target.name || 'Student',
      display_name: payload.name || target.name || 'Student',
      class: finalClass,
      section: finalSection,
      category: finalCategory,
      role: finalRole,
      roll_number: payload.roll_number || null,
      parent_phone: phone10 || null,
      father_name: payload.father_name || null,
      mother_name: payload.mother_name || null,
      blood_group: payload.blood_group || null,
      address: payload.address || null,
      metadata: JSON.stringify({
        class: finalClass,
        section: finalSection,
        category: finalCategory,
        admission_number: fallbackAdm,
      }),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('profiles').upsert([newDocPayload], { onConflict: 'admission_number' });
    if (!error) updatedProfiles++;
  }

  // 5. Update Attendance Records
  try {
    const attLookups: any[] = [];
    if (candidateUserIds.size > 0) {
      attLookups.push(supabase.from('attendance_records').select('id, device_info').in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      attLookups.push(supabase.from('attendance_records').select('id, device_info').in('student_id', Array.from(candidateStudentKeys)));
    }
    if (rawId && rawId.startsWith('rec:')) {
      attLookups.push(supabase.from('attendance_records').select('id, device_info').eq('id', rawId.slice(4)));
    }

    const attResList = await Promise.allSettled(attLookups);
    const attIdsToUpdate = new Set<string>();
    for (const r of attResList) {
      if (r.status === 'fulfilled' && r.value?.data && Array.isArray(r.value.data)) {
        for (const item of r.value.data) {
          if (item.id) attIdsToUpdate.add(item.id);
        }
      }
    }

    for (const recId of attIdsToUpdate) {
      const { error } = await supabase
        .from('attendance_records')
        .update({
          class: finalClass,
          section: finalSection,
          category: finalCategory,
        })
        .eq('id', recId);
      if (!error) updatedAttendance++;
    }
  } catch (attErr) {
    console.warn('[studentUpdateService] Error updating attendance records:', attErr);
  }

  // 6. Update Face Descriptors
  try {
    const fdLookups: any[] = [];
    if (candidateUserIds.size > 0) {
      fdLookups.push(supabase.from('face_descriptors').select('id').in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      fdLookups.push(supabase.from('face_descriptors').select('id').in('student_id', Array.from(candidateStudentKeys)));
    }

    const fdResList = await Promise.allSettled(fdLookups);
    const fdIdsToUpdate = new Set<string>();
    for (const r of fdResList) {
      if (r.status === 'fulfilled' && r.value?.data && Array.isArray(r.value.data)) {
        for (const item of r.value.data) {
          if (item.id) fdIdsToUpdate.add(item.id);
        }
      }
    }

    for (const fdId of fdIdsToUpdate) {
      const { error } = await supabase
        .from('face_descriptors')
        .update({
          class: finalClass,
          section: finalSection,
          category: finalCategory,
        })
        .eq('id', fdId);
      if (!error) updatedDescriptors++;
    }
  } catch (fdErr) {
    console.warn('[studentUpdateService] Error updating face descriptors:', fdErr);
  }

  // 7. Thoroughly purge all query & UI caches
  invalidateCollectionCache('profiles');
  invalidateCollectionCache('attendance_records');
  invalidateCollectionCache('face_descriptors');
  invalidateUnifiedStatsCache();
  clearMonitorCache();

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('presences_unified_snapshot_v3');
      localStorage.removeItem('presences:enrollment_monitor_cache_v7');
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('presences_unified_snapshot_v3');
      sessionStorage.removeItem('presences:enrollment_monitor_cache_v7');
    }
  } catch {}

  return {
    success: true,
    updatedProfiles,
    updatedAttendance,
    updatedDescriptors,
  };
}

function ID_FALLBACK(): string {
  return 's_' + Math.random().toString(36).slice(2, 10);
}
