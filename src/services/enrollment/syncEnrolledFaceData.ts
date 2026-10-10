import { supabase } from '@/integrations/supabase/client';
import { syncFromSupabase as syncDescriptorCache } from '@/services/face-recognition/DescriptorCacheService';
import { uploadImage } from '@/services/face-recognition/StorageService';
import type { FaceSample, StudentDetails } from './types';
import { v4 as uuidv4 } from 'uuid';
import { 
  buildCanonical3DFaceStructure, 
  synthesizeMasterFaceDescriptor,
  type Face3DStructure 
} from './face3DReconstruction';

export interface SyncFaceDataOptions {
  admission: string;
  details?: Partial<StudentDetails>;
  samples: FaceSample[];
  wearsGlasses?: boolean;
  primaryPhotoUrl?: string;
  replaceExisting?: boolean;
  face3DStructure?: Face3DStructure;
  masterDescriptor?: number[];
}

/**
 * Safely converts a data URL or image string to a Blob
 */
async function dataUrlToJpegBlob(dataUrl: string): Promise<Blob | null> {
  try {
    if (dataUrl.startsWith('data:')) {
      const res = await fetch(dataUrl);
      return await res.blob();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Uploads a student's captured face angle to storage with a structured, deterministic path
 * Path structure: students/<cleanAdmission>/faces/<pose>.jpg
 */
async function uploadStudentFaceSample(
  blob: Blob,
  cleanAdmission: string,
  pose: string
): Promise<{ path: string; publicUrl: string }> {
  const safeAdmission = cleanAdmission.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePose = pose.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const filename = `${safePose}.jpg`;
  const storagePath = `students/${safeAdmission}/faces/${filename}`;

  let publicUrl = '';
  try {
    const { error: supaErr } = await supabase.storage
      .from('student-registration-faces')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '86400',
      });

    if (!supaErr) {
      const { data } = supabase.storage
        .from('student-registration-faces')
        .getPublicUrl(storagePath);
      if (data?.publicUrl) publicUrl = data.publicUrl;
    }
  } catch (err) {
    console.warn(`[SyncFaceData] Supabase storage upload notice for ${pose}:`, err);
  }

  if (!publicUrl) {
    try {
      const file = new File([blob], filename, { type: 'image/jpeg' });
      publicUrl = await uploadImage(file, storagePath, 'student-registration-faces');
    } catch (err) {
      console.warn(`[SyncFaceData] Storage fallback upload notice for ${pose}:`, err);
    }
  }

  return { path: storagePath, publicUrl };
}

/**
 * Uploads the complete 3D biometric face model JSON artifact for the student
 * Path structure: students/<cleanAdmission>/models/face-model.json
 */
async function uploadStudentFaceModelArtifact(
  modelData: Record<string, any>,
  cleanAdmission: string
): Promise<{ path: string; publicUrl: string }> {
  const safeAdmission = cleanAdmission.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = 'face-model.json';
  const storagePath = `students/${safeAdmission}/models/${filename}`;
  const jsonBlob = new Blob([JSON.stringify(modelData, null, 2)], { type: 'application/json' });

  let publicUrl = '';
  try {
    const { error: supaErr } = await supabase.storage
      .from('student-registration-faces')
      .upload(storagePath, jsonBlob, {
        contentType: 'application/json',
        upsert: true,
        cacheControl: '86400',
      });

    if (!supaErr) {
      const { data } = supabase.storage
        .from('student-registration-faces')
        .getPublicUrl(storagePath);
      if (data?.publicUrl) publicUrl = data.publicUrl;
    }
  } catch (err) {
    console.warn('[SyncFaceData] Supabase model JSON upload notice:', err);
  }

  return { path: storagePath, publicUrl };
}

/**
 * Synchronizes newly enrolled face samples directly to Appwrite / Supabase and in-memory caches.
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
  face3DStructure,
  masterDescriptor,
}: SyncFaceDataOptions): Promise<{ success: boolean; descriptorsCount: number; photoUrl?: string }> {
  const cleanAdmission = String(admission || '').trim();
  if (!cleanAdmission || !samples || samples.length === 0) {
    return { success: false, descriptorsCount: 0 };
  }

  try {
    const studentName = details?.name?.trim() || 'Student';
    const rawCategory = (details?.category || '').trim();
    const rawClass = (details?.class || '').trim();
    const rawSection = (details?.section || '').trim();

    let parsedClass = rawClass || null;
    let parsedSection = rawSection ? rawSection.toUpperCase() : null;
    let normalizedCategory = rawCategory || null;

    if (!parsedClass && rawCategory) {
      const deptMatch = rawCategory.match(/^(\d+)\s*-\s*([A-Da-d])$/);
      if (deptMatch) {
        parsedClass = deptMatch[1];
        parsedSection = deptMatch[2].toUpperCase();
        normalizedCategory = `${deptMatch[1]}-${deptMatch[2].toUpperCase()}`;
      }
    }

    if (parsedClass && parsedSection && !normalizedCategory) {
      normalizedCategory = `${parsedClass}-${parsedSection}`;
    }

    const departmentValue = normalizedCategory || (parsedClass && parsedSection ? `${parsedClass}-${parsedSection}` : parsedClass) || null;

    // 1. Locate existing profile strictly matching cleanAdmission (case-insensitive) to prevent cross-assignment
    let existingProfile: any = null;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, user_id, display_name, full_name, admission_number, employee_id, parent_phone, phone, metadata')
        .or(`admission_number.ilike.${cleanAdmission},employee_id.ilike.${cleanAdmission}`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        const pAdm = String(data.admission_number || '').trim().toLowerCase();
        const pEmp = String(data.employee_id || '').trim().toLowerCase();
        const targetAdm = cleanAdmission.toLowerCase();
        if (pAdm === targetAdm || pEmp === targetAdm) {
          existingProfile = data;
        }
      }
    } catch (_) {}

    const stableStudentUserId = existingProfile?.user_id || existingProfile?.id || uuidv4();

    // 2. Upload ALL captured multi-angle face images with structured, student-bound paths
    const primarySample =
      samples.find((s) => s.pose === 'front' && s.glasses === (wearsGlasses ? 'with' : 'without')) ||
      samples.find((s) => s.pose === 'front') ||
      samples[0];

    const sampleUploadPromises = samples.map(async (s) => {
      try {
        const rawImg = s.image;
        if (rawImg && rawImg.startsWith('data:')) {
          const blob = await dataUrlToJpegBlob(rawImg);
          if (blob) {
            const uploaded = await uploadStudentFaceSample(blob, cleanAdmission, s.pose);
            return { pose: s.pose, ...uploaded };
          }
        } else if (rawImg && /^https?:\/\//.test(rawImg)) {
          return {
            pose: s.pose,
            path: `students/${cleanAdmission}/faces/${s.pose}.jpg`,
            publicUrl: rawImg,
          };
        }
      } catch (uploadErr) {
        console.warn(`[SyncFaceData] Error uploading sample for pose ${s.pose}:`, uploadErr);
      }
      return { pose: s.pose, path: '', publicUrl: '' };
    });

    const uploadedSamples = await Promise.all(sampleUploadPromises);

    const poseToUrl = new Map<string, string>();
    const poseToPath = new Map<string, string>();
    const allSampleUrls: string[] = [];
    const allSamplePaths: string[] = [];

    for (const item of uploadedSamples) {
      if (item.publicUrl) {
        poseToUrl.set(item.pose, item.publicUrl);
        allSampleUrls.push(item.publicUrl);
      }
      if (item.path) {
        poseToPath.set(item.pose, item.path);
        allSamplePaths.push(item.path);
      }
    }

    // Determine primary front portrait URL
    let primaryPublicUrl =
      poseToUrl.get('front') ||
      allSampleUrls[0] ||
      (primaryPhotoUrl && !primaryPhotoUrl.startsWith('data:') ? primaryPhotoUrl : '');

    if (!primaryPublicUrl && primaryPhotoUrl && primaryPhotoUrl.startsWith('data:')) {
      const blob = await dataUrlToJpegBlob(primaryPhotoUrl);
      if (blob) {
        const res = await uploadStudentFaceSample(blob, cleanAdmission, 'front');
        primaryPublicUrl = res.publicUrl;
        if (res.publicUrl) allSampleUrls.unshift(res.publicUrl);
        if (res.path) allSamplePaths.unshift(res.path);
      }
    }

    // 3. Purge old descriptors if replaceExisting is true, strictly isolated to cleanAdmission and student user
    if (replaceExisting) {
      try {
        await supabase
          .from('face_descriptors')
          .delete()
          .or(`student_id.ilike.${cleanAdmission},user_id.eq.${stableStudentUserId}`);
      } catch (delErr) {
        console.warn('[SyncFaceData] Notice during prior descriptor purge:', delErr);
      }
    }

    // 4. Synthesize Master Centroid Biometric Descriptor & 3D Structure
    const validSamples = samples.filter((s) => s.descriptor && s.descriptor.length >= 64);
    const masterPkg = synthesizeMasterFaceDescriptor(validSamples);
    const effectiveMasterDescriptor = masterDescriptor || masterPkg.masterDescriptor;
    const canonicalFace3D = face3DStructure || buildCanonical3DFaceStructure(validSamples);

    // 5. Batch insert descriptors into face_descriptors table
    // Prepend Master Centroid Descriptor as primary row for fastest & most robust recognition match
    const descriptorsToInsert: any[] = [];

    if (effectiveMasterDescriptor && effectiveMasterDescriptor.length >= 64) {
      descriptorsToInsert.push({
        user_id: stableStudentUserId,
        student_id: cleanAdmission,
        student_name: studentName,
        label: studentName,
        descriptor: JSON.stringify(effectiveMasterDescriptor),
        image_url: primaryPublicUrl,
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        metadata: {
          pose: 'master_centroid',
          is_primary: true,
          quality: { sharpness: 95, brightness: 128, clarityScore: masterPkg.qualityScore },
          wearsGlasses,
          sample_count: validSamples.length,
          intra_cluster_coherence: masterPkg.intraClusterCoherence,
          face_3d_structure_version: canonicalFace3D.version,
          facial_metrics: canonicalFace3D.facial_metrics,
          storage_path: `students/${cleanAdmission}/faces/front.jpg`,
          storage_bucket: 'student-registration-faces',
          enrollment_version: '3d_master_centroid_v3',
          captured_at: new Date().toISOString(),
        },
      });
    }

    // Follow with each individual multi-angle pose descriptor
    for (let i = 0; i < validSamples.length; i++) {
      const s = validSamples[i];
      const descStr = typeof s.descriptor === 'string' ? s.descriptor : JSON.stringify(Array.from(s.descriptor));
      const sampleImageUrl = poseToUrl.get(s.pose) || primaryPublicUrl || undefined;
      const sampleStoragePath = poseToPath.get(s.pose) || `students/${cleanAdmission}/faces/${s.pose}.jpg`;

      descriptorsToInsert.push({
        user_id: stableStudentUserId,
        student_id: cleanAdmission,
        student_name: studentName,
        label: studentName,
        descriptor: descStr,
        image_url: sampleImageUrl,
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        metadata: {
          pose: s.pose,
          glasses: s.glasses,
          quality: s.quality,
          wearsGlasses,
          storage_path: sampleStoragePath,
          storage_bucket: 'student-registration-faces',
          enrollment_version: '3d_guided_v3',
          captured_at: new Date().toISOString(),
          is_primary: false,
          landmarks_3d_count: s.landmarks3d?.length || (s.landmarks?.length ? 68 : 0),
        },
      });
    }

    if (descriptorsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from('face_descriptors')
        .insert(descriptorsToInsert);

      if (insertErr) {
        console.warn('[SyncFaceData] face_descriptors insert error:', insertErr.message);
      } else {
        console.log(`[SyncFaceData] Inserted ${descriptorsToInsert.length} biometric descriptors (including Master Centroid) for ${studentName} (${cleanAdmission})`);
      }
    }

    // 6. Build and upload complete 3D facial model JSON artifact
    const modelArtifact = {
      version: 'face-model-v3',
      created_at: new Date().toISOString(),
      student_id: cleanAdmission,
      employee_id: cleanAdmission,
      student_name: studentName,
      class: parsedClass,
      section: parsedSection,
      category: normalizedCategory,
      capture_mode: 'guided-3d-true-depth-v3',
      sample_count: validSamples.length,
      descriptor_dimensions: masterPkg.dimensions,
      averaged_descriptor: effectiveMasterDescriptor,
      descriptor_cloud: masterPkg.descriptorCloud,
      face_3d_structure: canonicalFace3D,
      canonical_landmarks_3d: canonicalFace3D.canonical_landmarks_3d,
      point_cloud_3d: canonicalFace3D.point_cloud_3d,
      point_cloud_3d_equivalent: canonicalFace3D.point_cloud_3d,
      triangulated_mesh: canonicalFace3D.triangulated_mesh,
      facial_metrics: canonicalFace3D.facial_metrics,
      intra_cluster_coherence: masterPkg.intraClusterCoherence,
      sample_poses: validSamples.map((s) => s.pose),
      sample_images: allSampleUrls,
      sample_storage_paths: allSamplePaths,
      primary_photo_url: primaryPublicUrl,
      wears_glasses: wearsGlasses,
    };

    const uploadedModel = await uploadStudentFaceModelArtifact(modelArtifact, cleanAdmission);

    // 6. Update or upsert profiles record strictly bound to cleanAdmission
    try {
      let prevMeta: Record<string, any> = {};
      try {
        prevMeta = typeof existingProfile?.metadata === 'string'
          ? JSON.parse(existingProfile.metadata)
          : (existingProfile?.metadata || {});
      } catch {}

      const isPhoneLocked = Boolean(
        prevMeta.phone_locked ||
        prevMeta.imported_from_pdf ||
        prevMeta.source === 'pdf_upload' ||
        prevMeta.source === 'pdf_import' ||
        details?.phone_locked ||
        details?.imported_from_pdf
      );

      const verifiedParentPhone = (
        prevMeta.verified_parent_phone ||
        existingProfile?.parent_phone ||
        existingProfile?.phone ||
        details?.verified_parent_phone ||
        ''
      ).trim();

      // If phone is locked from PDF upload, strictly preserve verified parent phone
      const effectiveParentPhone = (isPhoneLocked && verifiedParentPhone)
        ? verifiedParentPhone
        : (details?.parent_phone || existingProfile?.parent_phone || '');

      const profileUpdates: Record<string, any> = {
        user_id: stableStudentUserId,
        full_name: studentName,
        display_name: studentName,
        admission_number: cleanAdmission,
        employee_id: cleanAdmission,
        class: parsedClass,
        section: parsedSection,
        category: normalizedCategory,
        department: departmentValue,
        avatar_url: primaryPublicUrl || undefined,
        photo_url: primaryPublicUrl || undefined,
        role: 'student',
        updated_at: new Date().toISOString(),
        metadata: {
          ...prevMeta,
          name: studentName,
          student_id: cleanAdmission,
          admission_number: cleanAdmission,
          employee_id: cleanAdmission,
          class: parsedClass,
          section: parsedSection,
          category: normalizedCategory,
          department: departmentValue,
          face_model_path: uploadedModel.path,
          face_model_url: uploadedModel.publicUrl,
          sample_images: allSampleUrls,
          sample_storage_paths: allSamplePaths,
          primary_photo_path: `students/${cleanAdmission}/faces/front.jpg`,
          parent_name: details?.parent_name || details?.father_name || prevMeta.parent_name || '',
          parent_phone: effectiveParentPhone,
          phone_locked: isPhoneLocked,
          imported_from_pdf: isPhoneLocked ? true : Boolean(prevMeta.imported_from_pdf),
          source: prevMeta.source || (isPhoneLocked ? 'pdf_upload' : ''),
          verified_parent_phone: verifiedParentPhone,
          parent_email: details?.email || prevMeta.parent_email || '',
          student_email: details?.email || prevMeta.student_email || '',
          date_of_birth: details?.date_of_birth || prevMeta.date_of_birth || '',
          address: details?.address || prevMeta.address || '',
          blood_group: details?.blood_group || prevMeta.blood_group || '',
          avatar_url: primaryPublicUrl || '',
          photo_url: primaryPublicUrl || '',
        },
      };

      if (effectiveParentPhone) {
        profileUpdates.parent_phone = effectiveParentPhone;
        profileUpdates.phone = effectiveParentPhone;
      }
      if (details?.email) {
        profileUpdates.email = details.email.trim();
        profileUpdates.parent_email = details.email.trim();
      }
      if (details?.father_name) profileUpdates.father_name = details.father_name;
      if (details?.mother_name) profileUpdates.mother_name = details.mother_name;
      if (details?.date_of_birth) profileUpdates.date_of_birth = details.date_of_birth;
      if (details?.address) profileUpdates.address = details.address;
      if (details?.blood_group) profileUpdates.blood_group = details.blood_group;

      if (existingProfile?.id) {
        await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', existingProfile.id);
      } else {
        await supabase.from('profiles').insert({
          ...profileUpdates,
          created_at: new Date().toISOString(),
        });
      }

      // Ensure user_roles record
      try {
        const { data: existingRole } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', stableStudentUserId)
          .limit(1)
          .maybeSingle();
        if (!existingRole) {
          await supabase.from('user_roles').insert({
            user_id: stableStudentUserId,
            role: 'student',
            created_at: new Date().toISOString(),
          });
        }
      } catch (_) {}
    } catch (profileErr) {
      console.warn('[SyncFaceData] profile update error:', profileErr);
    }

    // 7. Refresh attendance_records registered entry with model and photo paths
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
        image_url: primaryPublicUrl || undefined,
        face_descriptor: primarySample?.descriptor
          ? (typeof primarySample.descriptor === 'string' ? primarySample.descriptor : JSON.stringify(Array.from(primarySample.descriptor)))
          : null,
        confidence_score: 1.0,
        timestamp: new Date().toISOString(),
        device_info: {
          type: 'guided_3d_enrollment',
          registration: 'true',
          sample_count: descriptorsToInsert.length,
          wearsGlasses,
          updated_at: new Date().toISOString(),
          face_model: {
            storage_model_path: uploadedModel.path,
            model_url: uploadedModel.publicUrl,
            sample_images: allSampleUrls,
            sample_storage_paths: allSamplePaths,
            primary_photo_url: primaryPublicUrl,
            id_card_photo_url: primaryPublicUrl,
            sample_count: validSamples.length,
            sample_poses: validSamples.map((s) => s.pose),
          },
          training_registration_path: `students/${cleanAdmission}/faces/front.jpg`,
          metadata: {
            name: studentName,
            student_name: studentName,
            employee_id: cleanAdmission,
            student_id: cleanAdmission,
            class: parsedClass,
            section: parsedSection,
            category: normalizedCategory,
            department: departmentValue,
            face_model: {
              storage_model_path: uploadedModel.path,
              sample_images: allSampleUrls,
              primary_photo_url: primaryPublicUrl,
            },
            parent_name: details?.parent_name || details?.father_name || '',
            parent_phone: details?.parent_phone || '',
            parent_email: details?.email || '',
            student_email: details?.email || '',
            phone: details?.parent_phone || '',
            date_of_birth: details?.date_of_birth || '',
            address: details?.address || '',
            blood_group: details?.blood_group || '',
            roll_number: details?.roll_number || cleanAdmission,
            image_url: primaryPublicUrl || '',
            firebase_image_url: primaryPublicUrl || '',
            avatar_url: primaryPublicUrl || '',
            photo_url: primaryPublicUrl || '',
          },
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

    // 8. Invalidate and re-sync in-memory descriptor cache immediately!
    try {
      await syncDescriptorCache();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('presence:descriptors-updated', { detail: { count: descriptorsToInsert.length } }));
      }
      console.log(`[SyncFaceData] Successfully stored all images, model artifact, and ${descriptorsToInsert.length} descriptors for ${studentName} (${cleanAdmission})`);
    } catch (cacheErr) {
      console.warn('[SyncFaceData] Cache resync warning:', cacheErr);
    }

    return {
      success: true,
      descriptorsCount: descriptorsToInsert.length,
      photoUrl: primaryPublicUrl || undefined,
    };
  } catch (error) {
    console.error('[SyncFaceData] Failed to sync face data:', error);
    return { success: false, descriptorsCount: 0 };
  }
}
