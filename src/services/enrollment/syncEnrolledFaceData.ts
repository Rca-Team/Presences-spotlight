import { supabase } from '@/integrations/supabase/client';
import { syncFromSupabase as syncDescriptorCache } from '@/services/face-recognition/DescriptorCacheService';
import type { FaceSample, StudentDetails } from './types';
import { v4 as uuidv4 } from 'uuid';

export interface SyncFaceDataOptions {
  admission: string;
  details?: Partial<StudentDetails>;
  samples: FaceSample[];
  wearsGlasses?: boolean;
  primaryPhotoUrl?: string;
  replaceExisting?: boolean;
}

/**
 * Synchronizes newly enrolled face samples directly to Supabase and in-memory caches.
 * When replaceExisting is true (default), completely removes any previous/old face descriptors
 * and registration records for this student, ensuring only fresh face data is stored.
 * When replaceExisting is false, appends the new multi-angle descriptors.
 */
export async function syncEnrolledFaceDataToSupabase({
  admission,
  details,
  samples,
  wearsGlasses = false,
  primaryPhotoUrl,
  replaceExisting = true,
}: SyncFaceDataOptions): Promise<{ success: boolean; descriptorsCount: number }> {
  const cleanAdmission = String(admission || '').trim();
  if (!cleanAdmission || !samples || samples.length === 0) {
    return { success: false, descriptorsCount: 0 };
  }

  try {
    const studentName = details?.name?.trim() || 'Student';
    const rawCategory = details?.category?.trim() || '';
    const deptMatch = rawCategory.match(/^(\d+)\s*-\s*([A-Da-d])$/);
    const parsedClass = deptMatch ? deptMatch[1] : (details?.class || null);
    const parsedSection = deptMatch ? deptMatch[2].toUpperCase() : (details?.section || null);
    const normalizedCategory = deptMatch ? `${deptMatch[1]}-${deptMatch[2].toUpperCase()}` : (rawCategory || null);

    // 1. Locate existing profile or student user_id
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, user_id, display_name, full_name')
      .or(`admission_number.eq.${cleanAdmission},employee_id.eq.${cleanAdmission}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const stableStudentUserId = existingProfile?.user_id || existingProfile?.id || uuidv4();

    // 2. Select primary front photo
    const primarySample =
      samples.find((s) => s.pose === 'front' && s.glasses === (wearsGlasses ? 'with' : 'without')) ||
      samples.find((s) => s.pose === 'front') ||
      samples[0];

    const finalPhotoUrl = primaryPhotoUrl || primarySample?.image || '';

    // 3. Purge old descriptors if replaceExisting is true
    if (replaceExisting) {
      try {
        await supabase
          .from('face_descriptors')
          .delete()
          .or(`student_id.eq.${cleanAdmission},user_id.eq.${stableStudentUserId}`);
      } catch (delErr) {
        console.warn('[SyncFaceData] Notice during prior descriptor purge:', delErr);
      }
    }

    // 4. Batch insert fresh multi-angle descriptors into face_descriptors table
    const descriptorsToInsert: any[] = [];
    const validSamples = samples.filter((s) => s.descriptor && s.descriptor.length >= 64);

    for (let i = 0; i < validSamples.length; i++) {
      const s = validSamples[i];
      const isPrimary = s === primarySample || (s.pose === 'front' && i === 0);
      
      descriptorsToInsert.push({
        user_id: stableStudentUserId,
        student_id: cleanAdmission,
        student_name: studentName,
        label: studentName,
        descriptor: s.descriptor,
        image_url: isPrimary ? finalPhotoUrl : s.image || finalPhotoUrl,
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        metadata: {
          pose: s.pose,
          glasses: s.glasses,
          quality: s.quality,
          wearsGlasses,
          enrollment_version: '3d_guided_v2',
          captured_at: new Date().toISOString(),
          is_primary: isPrimary,
        },
      });
    }

    if (descriptorsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from('face_descriptors')
        .insert(descriptorsToInsert);

      if (insertErr) {
        console.warn('[SyncFaceData] face_descriptors insert error:', insertErr.message);
      }
    }

    // 5. Update or upsert profiles record with fresh photo and details
    try {
      const profileUpdates: Record<string, any> = {
        full_name: studentName,
        display_name: studentName,
        admission_number: cleanAdmission,
        employee_id: cleanAdmission,
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        avatar_url: finalPhotoUrl || undefined,
        photo_url: finalPhotoUrl || undefined,
        updated_at: new Date().toISOString(),
      };

      if (details?.parent_phone) profileUpdates.parent_phone = details.parent_phone;
      if (details?.email) {
        profileUpdates.email = details.email.trim();
        profileUpdates.parent_email = details.email.trim();
      }
      if (details?.father_name) profileUpdates.father_name = details.father_name;
      if (details?.mother_name) profileUpdates.mother_name = details.mother_name;
      if (details?.date_of_birth) profileUpdates.date_of_birth = details.date_of_birth;
      if (details?.address) profileUpdates.address = details.address;

      if (existingProfile?.id) {
        await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', existingProfile.id);
      } else {
        await supabase.from('profiles').insert({
          user_id: stableStudentUserId,
          ...profileUpdates,
          role: 'student',
          created_at: new Date().toISOString(),
        });
      }
    } catch (profileErr) {
      console.warn('[SyncFaceData] profile update error:', profileErr);
    }

    // 6. Refresh attendance_records registered entry
    try {
      const { data: existingReg } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('student_id', cleanAdmission)
        .eq('status', 'registered')
        .limit(1)
        .maybeSingle();

      const regPayload: Record<string, any> = {
        user_id: stableStudentUserId,
        student_id: cleanAdmission,
        student_name: studentName,
        status: 'registered',
        source: 'guided_enrollment',
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        image_url: finalPhotoUrl,
        face_descriptor: primarySample?.descriptor ? JSON.stringify(primarySample.descriptor) : null,
        confidence_score: 1.0,
        timestamp: new Date().toISOString(),
        device_info: {
          type: 'guided_3d_enrollment',
          sample_count: descriptorsToInsert.length,
          wearsGlasses,
          updated_at: new Date().toISOString(),
        },
      };

      if (existingReg?.id) {
        await supabase.from('attendance_records').update(regPayload).eq('id', existingReg.id);
      } else {
        await supabase.from('attendance_records').insert(regPayload);
      }
    } catch (attErr) {
      console.warn('[SyncFaceData] attendance_records update warning:', attErr);
    }

    // 7. Invalidate and re-sync in-memory descriptor cache immediately!
    try {
      await syncDescriptorCache();
      console.log(`[SyncFaceData] Successfully erased old face data and indexed ${descriptorsToInsert.length} fresh descriptors for ${studentName} (${cleanAdmission})`);
    } catch (cacheErr) {
      console.warn('[SyncFaceData] Cache resync warning:', cacheErr);
    }

    return { success: true, descriptorsCount: descriptorsToInsert.length };
  } catch (error) {
    console.error('[SyncFaceData] Failed to sync face data:', error);
    return { success: false, descriptorsCount: 0 };
  }
}
