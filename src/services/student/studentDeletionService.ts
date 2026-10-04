import { databases, storage as appwriteStorage, APPWRITE_CONFIG } from '@/integrations/appwrite/client';
import { supabase } from '@/integrations/supabase/client';
import { storageFileId } from '@/integrations/appwrite/storage-id';
import { invalidateCollectionCache } from '@/integrations/appwrite/adapter';
import { invalidateUnifiedStatsCache } from '@/utils/attendanceStatsHelper';
import { syncFromSupabase as syncDescriptorCache } from '@/services/face-recognition/DescriptorCacheService';
import { enrollmentApi } from '@/services/enrollment/api';
import { Query } from 'appwrite';

export interface StudentDeleteTarget {
  id?: string;
  user_id?: string;
  employee_id?: string;
  admission_number?: string;
  roll_number?: string;
  name?: string;
  full_name?: string;
  display_name?: string;
  image_url?: string;
  avatar_url?: string;
  photo_url?: string;
  samples?: Array<{ id?: string; image_url?: string; fileId?: string; source_table?: string }>;
}

export interface DeletionResult {
  success: boolean;
  studentName: string;
  studentKey: string;
  deletedProfiles: number;
  deletedDescriptors: number;
  deletedAttendanceRecords: number;
  deletedFiles: number;
  errors: string[];
}

const STORAGE_BUCKETS = [
  'student-registration-faces',
  'face-images',
  'attendance-training-faces',
  'public',
];

/**
 * Extracts storage bucket and file identifier from any photo URL.
 */
function extractStorageReference(url: string): { bucket: string; fileId: string; path?: string } | null {
  if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) {
    return null;
  }

  // 1. Appwrite direct URL: /storage/buckets/{bucketId}/files/{fileId}/
  const appwriteMatch = url.match(/\/storage\/buckets\/([^/]+)\/files\/([^/?]+)/i);
  if (appwriteMatch?.[1] && appwriteMatch?.[2]) {
    return {
      bucket: appwriteMatch[1],
      fileId: appwriteMatch[2],
    };
  }

  // 2. Supabase URL: /storage/v1/object/(?:public|sign)/{bucket}/{path}
  const supabaseMatch = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*?)(?:\?|$)/i);
  if (supabaseMatch?.[1] && supabaseMatch?.[2]) {
    const bucket = decodeURIComponent(supabaseMatch[1]);
    const path = decodeURIComponent(supabaseMatch[2]);
    return {
      bucket,
      fileId: storageFileId(path),
      path,
    };
  }

  // 3. Raw relative path: {bucket}/{path} or {fileId}
  const clean = url.replace(/^\/+/, '').trim();
  for (const b of STORAGE_BUCKETS) {
    if (clean.startsWith(`${b}/`)) {
      const path = clean.slice(b.length + 1);
      return {
        bucket: b,
        fileId: storageFileId(path),
        path,
      };
    }
  }

  // If looks like raw file ID
  if (!clean.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(clean)) {
    return {
      bucket: 'face-images',
      fileId: clean,
    };
  }

  return null;
}

/**
 * Universally and completely deletes a student from EVERYWHERE:
 * - Appwrite / Supabase `profiles` collection
 * - Appwrite / Supabase `face_descriptors` collection
 * - Appwrite / Supabase `attendance_records` collection
 * - Biometric enrollment session & state documents (`student_enrollment`)
 * - Cloud Storage files (`student-registration-faces`, `face-images`, `attendance-training-faces`)
 * - Secondary tables (gate entries, wellness, emotion, notifications, user_roles)
 * - In-memory KDTree face recognition model cache & attendance dashboard cache
 */
export async function universalDeleteStudent(
  target: StudentDeleteTarget,
  onProgress?: (status: string) => void
): Promise<DeletionResult> {
  const errors: string[] = [];
  let deletedProfiles = 0;
  let deletedDescriptors = 0;
  let deletedAttendanceRecords = 0;
  let deletedFiles = 0;

  const candidateUserIds = new Set<string>();
  const candidateStudentKeys = new Set<string>();
  const candidateNames = new Set<string>();
  const candidateProfileIds = new Set<string>();
  const imageUrlsToPurge = new Set<string>();

  // 1. Gather identifiers from target
  if (target.user_id) candidateUserIds.add(target.user_id);
  if (target.employee_id) candidateStudentKeys.add(String(target.employee_id).trim());
  if (target.admission_number) candidateStudentKeys.add(String(target.admission_number).trim());
  if (target.roll_number) candidateStudentKeys.add(String(target.roll_number).trim());
  if (target.id) {
    candidateProfileIds.add(target.id);
  }

  const rawName = target.name || target.full_name || target.display_name;
  if (rawName && !['student', 'unknown', 'null', 'undefined'].includes(rawName.trim().toLowerCase())) {
    candidateNames.add(rawName.trim());
  }

  if (target.image_url) imageUrlsToPurge.add(target.image_url);
  if (target.avatar_url) imageUrlsToPurge.add(target.avatar_url);
  if (target.photo_url) imageUrlsToPurge.add(target.photo_url);
  if (target.samples && Array.isArray(target.samples)) {
    target.samples.forEach((s) => {
      if (s.image_url) imageUrlsToPurge.add(s.image_url);
    });
  }

  const primaryKey = Array.from(candidateStudentKeys)[0] || Array.from(candidateUserIds)[0] || target.id || 'unknown';
  const displayName = Array.from(candidateNames)[0] || primaryKey;

  onProgress?.(`Resolving student identity records for ${displayName}...`);

  // 2. Query DB to discover any linked profile IDs or missing user_ids
  try {
    const profileLookupQueries: any[] = [];
    if (candidateStudentKeys.size > 0) {
      const keys = Array.from(candidateStudentKeys);
      profileLookupQueries.push(supabase.from('profiles').select('*').in('admission_number', keys));
      profileLookupQueries.push(supabase.from('profiles').select('*').in('employee_id', keys));
      profileLookupQueries.push(supabase.from('profiles').select('*').in('roll_number', keys));
    }
    if (candidateUserIds.size > 0) {
      profileLookupQueries.push(supabase.from('profiles').select('*').in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateProfileIds.size > 0) {
      profileLookupQueries.push(supabase.from('profiles').select('*').in('id', Array.from(candidateProfileIds)));
    }

    const lookupResults = await Promise.all(profileLookupQueries);
    for (const res of lookupResults) {
      if (res?.data && Array.isArray(res.data)) {
        for (const p of res.data) {
          if (p.id) candidateProfileIds.add(p.id);
          if (p.$id) candidateProfileIds.add(p.$id);
          if (p.user_id) candidateUserIds.add(p.user_id);
          if (p.admission_number) candidateStudentKeys.add(String(p.admission_number).trim());
          if (p.employee_id) candidateStudentKeys.add(String(p.employee_id).trim());
          if (p.roll_number) candidateStudentKeys.add(String(p.roll_number).trim());
          const name = p.name || p.full_name || p.display_name;
          if (name) candidateNames.add(name);
          if (p.avatar_url) imageUrlsToPurge.add(p.avatar_url);
          if (p.photo_url) imageUrlsToPurge.add(p.photo_url);
        }
      }
    }
  } catch (err: any) {
    console.warn('[universalDeleteStudent] Profile identity discovery error:', err?.message);
  }

  // 3. Invoke Cloud Function `staff.deleteStudent` (Appwrite Backend)
  onProgress?.('Triggering backend biometric & enrollment purge...');
  try {
    const admissionParam = Array.from(candidateStudentKeys)[0] || Array.from(candidateUserIds)[0] || target.id;
    if (admissionParam) {
      await enrollmentApi('staff.deleteStudent', {
        admission: admissionParam,
        user_id: Array.from(candidateUserIds)[0],
      }).catch((apiErr) => {
        // Fallback to staff.revert if deleteStudent is pending
        return enrollmentApi('staff.revert', { admission: admissionParam }).catch(() => {});
      });
    }
  } catch (backendErr: any) {
    console.warn('[universalDeleteStudent] Backend cloud function purge warning:', backendErr?.message);
  }

  // 4. Delete from `face_descriptors`
  onProgress?.('Erasing facial neural descriptor models...');
  try {
    const descQueries: Promise<any>[] = [];
    if (candidateUserIds.size > 0) {
      descQueries.push(supabase.from('face_descriptors').delete().in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      descQueries.push(supabase.from('face_descriptors').delete().in('student_id', Array.from(candidateStudentKeys)));
    }
    if (candidateNames.size > 0) {
      descQueries.push(supabase.from('face_descriptors').delete().in('label', Array.from(candidateNames)));
    }
    const sampleIds = (target.samples || [])
      .filter((s) => s.source_table === 'face_descriptors' && s.id)
      .map((s) => s.id as string);
    if (sampleIds.length > 0) {
      descQueries.push(supabase.from('face_descriptors').delete().in('id', sampleIds));
    }

    const descRes = await Promise.all(descQueries);
    descRes.forEach((r) => {
      if (r?.data?.length) deletedDescriptors += r.data.length;
      if (r?.count) deletedDescriptors += r.count;
    });
  } catch (descErr: any) {
    errors.push(`Face descriptors: ${descErr.message}`);
  }

  // 5. Delete from `attendance_records`
  onProgress?.('Deleting all attendance logs & scan records...');
  try {
    const attQueries: Promise<any>[] = [];
    if (candidateUserIds.size > 0) {
      attQueries.push(supabase.from('attendance_records').delete().in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      attQueries.push(supabase.from('attendance_records').delete().in('student_id', Array.from(candidateStudentKeys)));
    }
    if (candidateNames.size > 0) {
      attQueries.push(supabase.from('attendance_records').delete().in('student_name', Array.from(candidateNames)));
    }
    if (target.id) {
      attQueries.push(supabase.from('attendance_records').delete().eq('id', target.id));
    }
    const sampleIds = (target.samples || [])
      .filter((s) => s.source_table === 'attendance_records' && s.id)
      .map((s) => s.id as string);
    if (sampleIds.length > 0) {
      attQueries.push(supabase.from('attendance_records').delete().in('id', sampleIds));
    }

    const attRes = await Promise.all(attQueries);
    attRes.forEach((r) => {
      if (r?.data?.length) deletedAttendanceRecords += r.data.length;
      if (r?.count) deletedAttendanceRecords += r.count;
    });
  } catch (attErr: any) {
    errors.push(`Attendance records: ${attErr.message}`);
  }

  // 6. Delete from `profiles`
  onProgress?.('Permanently removing student profile...');
  try {
    const profQueries: Promise<any>[] = [];
    if (candidateProfileIds.size > 0) {
      profQueries.push(supabase.from('profiles').delete().in('id', Array.from(candidateProfileIds)));
    }
    if (candidateUserIds.size > 0) {
      profQueries.push(supabase.from('profiles').delete().in('user_id', Array.from(candidateUserIds)));
    }
    if (candidateStudentKeys.size > 0) {
      const keys = Array.from(candidateStudentKeys);
      profQueries.push(supabase.from('profiles').delete().in('admission_number', keys));
      profQueries.push(supabase.from('profiles').delete().in('employee_id', keys));
      profQueries.push(supabase.from('profiles').delete().in('roll_number', keys));
    }

    const profRes = await Promise.all(profQueries);
    profRes.forEach((r) => {
      if (r?.data?.length) deletedProfiles += r.data.length;
      if (r?.count) deletedProfiles += r.count;
    });

    // Also direct delete via Appwrite database SDK if profile IDs known
    for (const pId of candidateProfileIds) {
      await databases.deleteDocument(APPWRITE_CONFIG.databaseId, 'profiles', pId).catch(() => {});
    }
  } catch (profErr: any) {
    errors.push(`Profiles: ${profErr.message}`);
  }

  // 7. Delete secondary tables (gate entries, wellness, emotion, notifications, user_roles)
  onProgress?.('Purging secondary logs & gate entries...');
  try {
    const secondaryOps: Promise<any>[] = [];
    const empKeys = Array.from(candidateStudentKeys);
    const userKeys = Array.from(candidateUserIds);
    const nameKeys = Array.from(candidateNames);

    if (empKeys.length > 0) {
      secondaryOps.push(supabase.from('gate_entries').delete().in('student_id', empKeys).catch(() => {}));
      secondaryOps.push(supabase.from('late_entries').delete().in('student_id', empKeys).catch(() => {}));
      secondaryOps.push(supabase.from('attendance_predictions').delete().in('student_id', empKeys).catch(() => {}));
      secondaryOps.push(supabase.from('attendance_points').delete().in('student_id', empKeys).catch(() => {}));
      secondaryOps.push(supabase.from('student_badges').delete().in('student_id', empKeys).catch(() => {}));
      secondaryOps.push(supabase.from('wellness_scores').delete().in('student_id', empKeys).catch(() => {}));
    }
    if (nameKeys.length > 0) {
      secondaryOps.push(supabase.from('gate_entries').delete().in('student_name', nameKeys).catch(() => {}));
      secondaryOps.push(supabase.from('late_entries').delete().in('student_name', nameKeys).catch(() => {}));
    }
    if (userKeys.length > 0) {
      secondaryOps.push(supabase.from('emotion_events').delete().in('user_id', userKeys).catch(() => {}));
      secondaryOps.push(supabase.from('notifications').delete().in('user_id', userKeys).catch(() => {}));
      secondaryOps.push(supabase.from('notification_log').delete().in('user_id', userKeys).catch(() => {}));
      secondaryOps.push(supabase.from('user_roles').delete().in('user_id', userKeys).catch(() => {}));
    }

    await Promise.allSettled(secondaryOps);
  } catch (secErr: any) {
    console.warn('[universalDeleteStudent] Secondary tables cleanup warning:', secErr?.message);
  }

  // 8. Delete Cloud Storage photos from all buckets
  onProgress?.('Reclaiming cloud storage space...');
  try {
    const refsToDelete: Array<{ bucket: string; fileId: string; path?: string }> = [];

    for (const rawUrl of imageUrlsToPurge) {
      const ref = extractStorageReference(rawUrl);
      if (ref) refsToDelete.push(ref);
    }

    // Also craft common path keys for this student
    for (const key of candidateStudentKeys) {
      for (const bucket of ['student-registration-faces', 'face-images', 'attendance-training-faces']) {
        refsToDelete.push({ bucket, fileId: storageFileId(key) });
        refsToDelete.push({ bucket, fileId: storageFileId(`student-${key}`) });
        refsToDelete.push({ bucket, fileId: storageFileId(`faces/${key}.jpg`) });
      }
    }

    for (const ref of refsToDelete) {
      try {
        await appwriteStorage.deleteFile(ref.bucket, ref.fileId).catch(() => {});
        deletedFiles++;
      } catch {}

      if (ref.path) {
        try {
          await supabase.storage.from(ref.bucket).remove([ref.path]).catch(() => {});
        } catch {}
      }
    }
  } catch (storageErr: any) {
    console.warn('[universalDeleteStudent] Storage cleanup warning:', storageErr?.message);
  }

  // 9. Synchronize & flush all system caches
  onProgress?.('Synchronizing neural recognizer and system caches...');
  try {
    invalidateCollectionCache('profiles');
    invalidateCollectionCache('face_descriptors');
    invalidateCollectionCache('attendance_records');
    invalidateCollectionCache('user_roles');
    invalidateUnifiedStatsCache();
    await syncDescriptorCache().catch(() => {});
  } catch (cacheErr: any) {
    console.warn('[universalDeleteStudent] Cache synchronization warning:', cacheErr?.message);
  }

  return {
    success: errors.length === 0,
    studentName: displayName,
    studentKey: primaryKey,
    deletedProfiles,
    deletedDescriptors,
    deletedAttendanceRecords,
    deletedFiles,
    errors,
  };
}

/**
 * Universally and completely deletes a batch of students.
 */
export async function universalDeleteStudentsBatch(
  targets: StudentDeleteTarget[],
  onProgress?: (current: number, total: number, name: string) => void
): Promise<{ successCount: number; failCount: number; errors: string[] }> {
  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const name = target.name || target.full_name || target.employee_id || `Student #${i + 1}`;
    onProgress?.(i + 1, targets.length, name);

    try {
      const result = await universalDeleteStudent(target);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        errors.push(...result.errors);
      }
    } catch (err: any) {
      failCount++;
      errors.push(`${name}: ${err?.message || 'Delete failed'}`);
    }
  }

  return { successCount, failCount, errors };
}
