import { supabase } from '@/integrations/supabase/client';
import { databases, storage as appwriteStorage, APPWRITE_CONFIG } from '@/integrations/appwrite/client';
import { storageFileId } from '@/integrations/appwrite/storage-id';
import { invalidateCollectionCache } from '@/integrations/appwrite/adapter';
import { clearCoverPhotoCache } from '@/utils/studentPhotoResolver';
import { syncFromSupabase as syncDescriptorCache } from '@/services/face-recognition/DescriptorCacheService';
import { clearMonitorCache, type MonitorStudent } from '@/services/enrollment/monitor';
import { enrollmentApi } from '@/services/enrollment/api';
import { Query } from 'appwrite';

const FACE_STORAGE_BUCKETS = [
  'student-registration-faces',
  'face-images',
  'attendance-training-faces',
  'public',
] as const;

export interface StorageReference {
  bucket: string;
  fileId: string;
  path?: string;
}

/**
 * Extracts storage bucket and file path/id from any photo URL or storage string.
 */
export function extractStorageReference(url?: string | null): StorageReference | null {
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

  // 3. Raw relative path with bucket prefix: {bucket}/{path}
  const clean = url.replace(/^\/+/, '').trim();
  for (const b of FACE_STORAGE_BUCKETS) {
    if (clean.startsWith(`${b}/`)) {
      const path = clean.slice(b.length + 1);
      return {
        bucket: b,
        fileId: storageFileId(path),
        path,
      };
    }
  }

  // 4. Structured student path without bucket: students/{adm}/...
  if (clean.startsWith('students/')) {
    return {
      bucket: 'student-registration-faces',
      fileId: storageFileId(clean),
      path: clean,
    };
  }

  // 5. Raw file ID (alphanumeric hash or UUID)
  if (!clean.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(clean)) {
    return {
      bucket: 'student-registration-faces',
      fileId: clean,
    };
  }

  return null;
}

/**
 * Safely removes a file from both Supabase and Appwrite storage.
 */
async function removeStorageFile(ref: StorageReference): Promise<void> {
  const tasks: Promise<any>[] = [];

  // Remove from Supabase storage
  if (ref.path) {
    tasks.push(
      supabase.storage
        .from(ref.bucket)
        .remove([ref.path])
        .catch((err) => {
          console.warn(`[photoDeletionService] Supabase remove path notice:`, err);
        })
    );
  }

  // Remove from Appwrite storage
  tasks.push(
    appwriteStorage.deleteFile(ref.bucket, ref.fileId).catch(() => {
      // Ignore if file doesn't exist in Appwrite
    })
  );

  // If path doesn't specify bucket, also try student-registration-faces as default
  if (ref.bucket !== 'student-registration-faces' && ref.path) {
    tasks.push(
      supabase.storage
        .from('student-registration-faces')
        .remove([ref.path])
        .catch(() => {})
    );
  }

  await Promise.allSettled(tasks);
}

/**
 * Flush all relevant descriptor, profile, and monitor caches after photo changes.
 */
export async function flushFacePhotoCaches(admissionNumber?: string): Promise<void> {
  invalidateCollectionCache('profiles');
  invalidateCollectionCache('face_descriptors');
  clearMonitorCache();
  if (admissionNumber) {
    clearCoverPhotoCache(admissionNumber);
  }
  try {
    await syncDescriptorCache();
  } catch (err) {
    console.warn('[photoDeletionService] syncDescriptorCache notice:', err);
  }
}

/**
 * Deletes a single captured face sample photo (or training angle).
 * Removes the corresponding face_descriptor record and storage asset.
 */
export async function deleteSingleFacePhoto(options: {
  student: MonitorStudent;
  photoUrl?: string;
  fileId?: string;
  descriptorId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { student, photoUrl, fileId, descriptorId } = options;
  const cleanAdm = student.admission_number?.trim();
  const userId = student.userId?.trim();

  try {
    // 1. Delete matching storage file
    const storageRef = extractStorageReference(photoUrl || fileId);
    if (storageRef) {
      await removeStorageFile(storageRef);
    }

    // 2. Remove matching descriptor row(s) from Supabase face_descriptors
    let deletedCount = 0;
    if (descriptorId && /^[0-9a-fA-F-]{20,36}$/.test(descriptorId)) {
      const { data } = await supabase
        .from('face_descriptors')
        .delete()
        .eq('id', descriptorId)
        .select('id');
      if (data?.length) deletedCount += data.length;
    }

    // If not deleted by ID or descriptor ID wasn't a UUID, search by student + image_url
    if (cleanAdm || userId) {
      const filterConditions: string[] = [];
      if (cleanAdm) filterConditions.push(`student_id.ilike.${cleanAdm}`);
      if (userId) filterConditions.push(`user_id.ilike.${userId}`);

      if (filterConditions.length > 0) {
        // Find candidate descriptors
        const { data: rows } = await supabase
          .from('face_descriptors')
          .select('id, image_url, metadata')
          .or(filterConditions.join(','));

        if (rows && rows.length > 0) {
          const idsToDelete: string[] = [];

          for (const row of rows) {
            let matches = false;

            // Direct ID match
            if (descriptorId && row.id === descriptorId) matches = true;
            if (fileId && row.id === fileId) matches = true;

            // Direct URL match
            if (photoUrl && row.image_url === photoUrl) matches = true;

            // Partial URL match (e.g., path or fileId substring)
            if (photoUrl && row.image_url && (row.image_url.includes(photoUrl) || photoUrl.includes(row.image_url))) {
              matches = true;
            }

            // Storage path match inside metadata
            let meta: any = row.metadata;
            if (typeof meta === 'string') {
              try { meta = JSON.parse(meta); } catch { meta = {}; }
            }
            if (meta?.storage_path && photoUrl && photoUrl.includes(meta.storage_path)) {
              matches = true;
            }
            if (fileId && (meta?.fileId === fileId || meta?.pose === fileId)) {
              matches = true;
            }

            if (matches && !idsToDelete.includes(row.id)) {
              idsToDelete.push(row.id);
            }
          }

          if (idsToDelete.length > 0) {
            const { data: delData } = await supabase
              .from('face_descriptors')
              .delete()
              .in('id', idsToDelete)
              .select('id');
            if (delData?.length) deletedCount += delData.length;

            // Also delete matching documents from Appwrite face_descriptors
            for (const id of idsToDelete) {
              await databases
                .deleteDocument(APPWRITE_CONFIG.databaseId, 'face_descriptors', id)
                .catch(() => {});
            }
          }
        }
      }
    }

    // 3. If photo was also the profile avatar or primary photo, clear it from profiles
    const isProfilePhoto =
      photoUrl &&
      (photoUrl === student.avatarUrl ||
        photoUrl === student.primaryPhotoUrl ||
        photoUrl === student.profilePhotoUrl);

    if (isProfilePhoto && cleanAdm) {
      await supabase
        .from('profiles')
        .update({ avatar_url: null, photo_url: null, updated_at: new Date().toISOString() })
        .or(`admission_number.ilike.${cleanAdm},employee_id.ilike.${cleanAdm}`);

      if (student.id) {
        await databases
          .updateDocument(APPWRITE_CONFIG.databaseId, 'profiles', student.id, {
            avatar_url: '',
            updated_at: new Date().toISOString(),
          })
          .catch(() => {});
      }
    }

    // 4. Invalidate all caches
    await flushFacePhotoCaches(cleanAdm);

    return {
      success: true,
      message: 'Photo removed successfully.',
    };
  } catch (err: any) {
    console.error('[photoDeletionService] deleteSingleFacePhoto error:', err);
    throw new Error(err?.message || 'Could not delete face photo.');
  }
}

/**
 * Removes the primary profile photo or ID card photo for a student.
 */
export async function deleteStudentProfilePhoto(options: {
  student: MonitorStudent;
  type: 'primary' | 'profile' | 'avatar';
}): Promise<{ success: boolean; message?: string }> {
  const { student, type } = options;
  const cleanAdm = student.admission_number?.trim();
  const targetUrl =
    type === 'profile'
      ? student.profilePhotoUrl || student.avatarUrl
      : student.primaryPhotoUrl || student.avatarUrl;

  try {
    // 1. Delete from storage if URL is available
    if (targetUrl) {
      const storageRef = extractStorageReference(targetUrl);
      if (storageRef) {
        await removeStorageFile(storageRef);
      }
    }

    // 2. Clear avatar_url and photo_url on profiles table in Supabase
    if (cleanAdm) {
      await supabase
        .from('profiles')
        .update({
          avatar_url: null,
          photo_url: null,
          updated_at: new Date().toISOString(),
        })
        .or(`admission_number.ilike.${cleanAdm},employee_id.ilike.${cleanAdm}`);

      if (student.id) {
        await databases
          .updateDocument(APPWRITE_CONFIG.databaseId, 'profiles', student.id, {
            avatar_url: '',
            updated_at: new Date().toISOString(),
          })
          .catch(() => {});
      }
    }

    // 3. Clear caches
    await flushFacePhotoCaches(cleanAdm);

    return {
      success: true,
      message: 'Profile photo removed.',
    };
  } catch (err: any) {
    console.error('[photoDeletionService] deleteStudentProfilePhoto error:', err);
    throw new Error(err?.message || 'Could not remove profile photo.');
  }
}

/**
 * Completely removes ALL captured face photos, biometric descriptor slots, and model artifacts
 * for a student, returning their biometric enrollment status to pending.
 */
export async function deleteAllStudentFacePhotos(
  student: MonitorStudent
): Promise<{ success: boolean; deletedCount: number; message?: string }> {
  const cleanAdm = student.admission_number?.trim();
  const userId = student.userId?.trim();

  if (!cleanAdm && !userId) {
    throw new Error('Student identifier is required to delete photos.');
  }

  try {
    let deletedCount = 0;

    // 1. Query all descriptors to gather storage paths
    const filterConditions: string[] = [];
    if (cleanAdm) filterConditions.push(`student_id.ilike.${cleanAdm}`);
    if (userId) filterConditions.push(`user_id.ilike.${userId}`);

    const { data: descRows } = await supabase
      .from('face_descriptors')
      .select('id, image_url, metadata')
      .or(filterConditions.join(','));

    const urlsToPurge = new Set<string>();
    if (student.avatarUrl) urlsToPurge.add(student.avatarUrl);
    if (student.primaryPhotoUrl) urlsToPurge.add(student.primaryPhotoUrl);
    if (student.profilePhotoUrl) urlsToPurge.add(student.profilePhotoUrl);

    if (descRows && descRows.length > 0) {
      for (const row of descRows) {
        if (row.image_url) urlsToPurge.add(row.image_url);
        let meta: any = row.metadata;
        if (typeof meta === 'string') {
          try { meta = JSON.parse(meta); } catch { meta = {}; }
        }
        if (meta?.storage_path) urlsToPurge.add(meta.storage_path);
      }
    }

    // 2. Add standard predictable paths for this student
    if (cleanAdm) {
      const safeAdm = cleanAdm.replace(/[^a-zA-Z0-9_-]/g, '_');
      for (const pose of ['front', 'left', 'right', 'up', 'down', 'master_centroid', 'idcard']) {
        urlsToPurge.add(`students/${safeAdm}/faces/${pose}.jpg`);
      }
      urlsToPurge.add(`students/${safeAdm}/models/face-model.json`);
      urlsToPurge.add(`students/${safeAdm}/idcard-photo.jpg`);
    }

    // 3. Delete files from storage
    for (const rawUrl of urlsToPurge) {
      const ref = extractStorageReference(rawUrl);
      if (ref) {
        await removeStorageFile(ref);
      }
    }

    // 4. Delete all descriptors from Supabase face_descriptors
    const { data: delData } = await supabase
      .from('face_descriptors')
      .delete()
      .or(filterConditions.join(','))
      .select('id');

    if (delData?.length) {
      deletedCount = delData.length;
    }

    // 5. Delete from Appwrite face_descriptors collection
    if (descRows && descRows.length > 0) {
      for (const row of descRows) {
        await databases
          .deleteDocument(APPWRITE_CONFIG.databaseId, 'face_descriptors', row.id)
          .catch(() => {});
      }
    }

    // 6. Reset avatar_url and photo_url on profiles
    if (cleanAdm) {
      await supabase
        .from('profiles')
        .update({
          avatar_url: null,
          photo_url: null,
          updated_at: new Date().toISOString(),
        })
        .or(`admission_number.ilike.${cleanAdm},employee_id.ilike.${cleanAdm}`);

      if (student.id) {
        await databases
          .updateDocument(APPWRITE_CONFIG.databaseId, 'profiles', student.id, {
            avatar_url: '',
            updated_at: new Date().toISOString(),
          })
          .catch(() => {});
      }
    }

    // 7. Invoke Appwrite backend staff.revert if available to reset enrollment session state
    if (cleanAdm) {
      await enrollmentApi('staff.revert', { admission: cleanAdm }).catch(() => {
        // Staff revert is optional if backend is temporarily unreachable
      });
    }

    // 8. Invalidate all caches
    await flushFacePhotoCaches(cleanAdm);

    return {
      success: true,
      deletedCount,
      message: `All face photos and biometric samples removed for ${student.name}.`,
    };
  } catch (err: any) {
    console.error('[photoDeletionService] deleteAllStudentFacePhotos error:', err);
    throw new Error(err?.message || 'Could not delete student face photos.');
  }
}
