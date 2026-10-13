
import { supabase } from '@/integrations/supabase/client';
import { uploadImage } from './StorageService';
import { v4 as uuidv4 } from 'uuid';
import { descriptorToString } from './ModelService';
import { uploadRegistrationTrainingImage } from './TrainingDataStorageService';

// Define an interface for the metadata to ensure type safety
export interface RegistrationMetadata {
  name: string;
  employee_id: string;
  department: string;
  position: string;
  firebase_image_url: string;
  faceDescriptor?: string; // Make this optional since it's added conditionally
}

export const registerFace = async (
  imageBlob: Blob,
  name: string,
  employee_id: string,
  department: string,
  position: string,
  userId: string | undefined,
  faceDescriptor?: Float32Array,
  parentContactInfo?: {
    phone?: string;
    parent_name?: string;
    parent_email?: string;
    parent_phone?: string;
    student_email?: string;
    roll_number?: string;
    blood_group?: string;
    medical_info?: string;
    transport_mode?: string;
    class_section?: string;
    address?: string;
  },
  category?: string,
  faceModel?: {
    sample_count: number;
    capture_mode: 'auto-10' | 'scan-3d';
    storage_model_path?: string;
    id_card_photo_url?: string;
  }
): Promise<any> => {
  try {
    console.log('Starting face registration process', {
      name,
      employee_id,
      department,
      position,
      hasDescriptor: !!faceDescriptor
    });
    
    let faceDescriptorString: string | null = null;
    
    if (!imageBlob || imageBlob.size === 0) {
      console.error('Invalid image blob provided');
      throw new Error('Invalid image: The image blob is empty or invalid');
    }
    
    if (!faceDescriptor) {
      console.warn('No face descriptor provided for registration. This may limit face recognition capabilities.');
    }
    
    // Get authenticated user if available (so we never accidentally assign a teacher's auth UUID to a student)
    const { data: { user } } = await supabase.auth.getUser();
    const cleanEmployeeId = employee_id?.trim() || '';

    // 1. Resolve canonical existing student identity across profiles, attendance_records, and face_descriptors upfront
    let existingProfile: any = null;
    let existingRegistrationId: string | null = null;
    let existingRegistrationUserId: string | null = null;
    let existingFdId: string | null = null;
    let existingFdUserId: string | null = null;

    if (cleanEmployeeId) {
      const [profRes, regRes, fdRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, user_id')
          .or(`admission_number.eq.${cleanEmployeeId},employee_id.eq.${cleanEmployeeId}`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('attendance_records')
          .select('id, user_id')
          .eq('status', 'registered')
          .eq('student_id', cleanEmployeeId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('face_descriptors')
          .select('id, user_id')
          .eq('student_id', cleanEmployeeId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      existingProfile = profRes.data ?? null;
      existingRegistrationId = regRes.data?.id ?? null;
      existingRegistrationUserId = regRes.data?.user_id ?? null;
      existingFdId = fdRes.data?.id ?? null;
      existingFdUserId = fdRes.data?.user_id ?? null;
    }

    // Single authoritative student user_id shared across profiles, attendance_records, and face_descriptors
    const stableStudentUserId =
      existingProfile?.user_id ||
      existingFdUserId ||
      existingRegistrationUserId ||
      (userId && userId !== user?.id ? userId : uuidv4());
    console.log('Using canonical student user ID:', stableStudentUserId);

    // 2. Upload primary registration photo to deterministic student path (prevents duplicate orphan files on re-registration)
    const folderId = (cleanEmployeeId || stableStudentUserId || 'unassigned')
      .toString()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const file = new File([imageBlob], 'front.jpg', { type: 'image/jpeg' });
    const filePath = `students/${folderId}/faces/front.jpg`;
    console.log('Uploading primary registration photo to deterministic path:', filePath);

    const imageUrl = await uploadImage(file, filePath, 'student-registration-faces');
    const registrationTrainingPath = filePath;

    // Prepare metadata as a plain object that conforms to Json type
    const metadata: Record<string, any> = {
      name,
      employee_id: cleanEmployeeId || employee_id,
      department,
      position,
      firebase_image_url: imageUrl,
      training_registration_path: registrationTrainingPath,
    };

    if (faceDescriptor) {
      faceDescriptorString = descriptorToString(faceDescriptor);
      metadata.faceDescriptor = faceDescriptorString;
    }

    if (faceModel) {
      metadata.face_model = {
        ...faceModel,
        created_at: new Date().toISOString(),
      };
    }

    const deviceInfo: Record<string, any> = {
      type: 'webcam',
      registration: 'true',
      metadata: {
        ...metadata,
        ...parentContactInfo,
      },
      timestamp: new Date().toISOString(),
    };

    // Parse class & section from "6-A" style department string
    const rawDept = String(parentContactInfo?.class_section || department || '').trim();
    const deptMatch = rawDept.match(/^(\d+)\s*-\s*([A-Da-d])$/);
    const parsedClass = deptMatch ? deptMatch[1] : (rawDept || null);
    const parsedSection = deptMatch ? deptMatch[2].toUpperCase() : null;

    // 3. Upsert attendance_records registration row (never creates duplicate status='registered' rows)
    const insertData: Record<string, any> = {
      user_id: stableStudentUserId,
      timestamp: new Date().toISOString(),
      status: 'registered',
      source: 'registration',
      capture_mode: faceModel?.capture_mode ?? 'scan-3d',
      class: parsedClass,
      section: parsedSection,
      student_name: name,
      student_id: cleanEmployeeId || null,
      device_info: deviceInfo,
      image_url: imageUrl,
      face_descriptor: faceDescriptorString,
      category: category || rawDept || 'A',
      roll_number: parentContactInfo?.roll_number || position || null,
      confidence_score: 1.0,
    };

    let recordData: any = null;
    let recordError: any = null;

    if (existingRegistrationId) {
      const { data: updated, error: updateError } = await supabase
        .from('attendance_records')
        .update(insertData)
        .eq('id', existingRegistrationId)
        .select()
        .single();

      recordData = updated;
      recordError = updateError;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('attendance_records')
        .insert(insertData)
        .select()
        .single();

      recordData = inserted;
      recordError = insertError;
    }

    if (recordError) {
      console.error('Error inserting attendance record:', recordError);
      throw new Error(`Error inserting attendance record: ${recordError.message}`);
    }

    // 4. Write primary descriptor to face_descriptors using the exact same stableStudentUserId
    const descriptorUserIdUsed = stableStudentUserId;
    if (faceDescriptorString) {
      const rawCategory = String(category || parentContactInfo?.class_section || '').trim();
      const catMatch = rawCategory.match(/^(\d+)\s*-\s*([A-Da-d])$/);
      const normalizedCategory = catMatch ? `${catMatch[1]}-${catMatch[2].toUpperCase()}` : (rawCategory || null);

      const fdPayload: Record<string, any> = {
        user_id: stableStudentUserId,
        descriptor: faceDescriptorString,
        image_url: imageUrl,
        label: name,
        student_id: cleanEmployeeId || null,
        student_name: name,
        class: catMatch ? catMatch[1] : parsedClass,
        section: catMatch ? catMatch[2].toUpperCase() : parsedSection,
        category: normalizedCategory,
        metadata: {
          ...metadata,
          ...parentContactInfo,
          pose: 'master_centroid',
          is_primary: true,
          category: normalizedCategory || 'A',
        },
      };

      if (existingFdId) {
        await supabase.from('face_descriptors').update(fdPayload).eq('id', existingFdId);
      } else {
        await supabase.from('face_descriptors').insert(fdPayload);
      }
    }

    // 5. Upsert profiles table with the exact same stableStudentUserId and pre-computed biometric_summary
    try {
      const profilePayload: Record<string, any> = {
        user_id: stableStudentUserId,
        display_name: name,
        full_name: name,
        admission_number: cleanEmployeeId || null,
        employee_id: cleanEmployeeId || null,
        class: parsedClass,
        section: parsedSection,
        category: category || rawDept || null,
        roll_number: parentContactInfo?.roll_number || position || null,
        phone: parentContactInfo?.phone || null,
        email: parentContactInfo?.student_email || null,
        parent_name: parentContactInfo?.parent_name || null,
        parent_phone: parentContactInfo?.parent_phone || null,
        parent_email: parentContactInfo?.parent_email || null,
        blood_group: parentContactInfo?.blood_group || null,
        address: parentContactInfo?.address || null,
        avatar_url: imageUrl,
        photo_url: imageUrl,
        updated_at: new Date().toISOString(),
        metadata: {
          ...metadata,
          ...parentContactInfo,
          registration_source: 'student_registration_page',
          ...(faceDescriptor
            ? {
                biometric_summary: {
                  version: 1,
                  centroid_descriptor: Array.from(faceDescriptor, (v) => Number(v.toFixed(5))),
                  exemplar_descriptors: [Array.from(faceDescriptor, (v) => Number(v.toFixed(5)))],
                  sample_count: faceModel?.sample_count || 1,
                  has_glasses_profile: false,
                  updated_at: new Date().toISOString(),
                },
              }
            : {}),
        },
      };

      if (existingProfile?.id) {
        await supabase.from('profiles').update(profilePayload).eq('id', existingProfile.id);
      } else {
        await supabase.from('profiles').insert(profilePayload);
      }
      const { syncUserBiometricSummaryToProfile, invalidateTrainedDescriptorsCache } = await import('./ProgressiveTrainingService');
      await syncUserBiometricSummaryToProfile(stableStudentUserId, cleanEmployeeId || null);
      invalidateTrainedDescriptorsCache();
    } catch (profileErr) {
      console.warn('Profile sync failed (non-fatal):', profileErr);
    }

    const enrichedRecordData = {
      ...recordData,
      primary_image_url: imageUrl,
      registration_user_id: stableStudentUserId,
      descriptor_user_id: descriptorUserIdUsed,
    };

    console.log('Registration completed successfully:', enrichedRecordData);
    return enrichedRecordData;
  } catch (error: any) {
    console.error('Face registration failed:', error);
    throw error;
  }
};

export const uploadFaceImage = async (imageBlob: Blob): Promise<string> => {
  try {
    console.log('Starting face image upload, blob size:', imageBlob.size);
    
    // Validate the blob
    if (!imageBlob || imageBlob.size === 0) {
      throw new Error('Invalid image: The image blob is empty or invalid');
    }
    
    // Create a unique filename
    const uniqueId = uuidv4();
    const file = new File([imageBlob], `face_${uniqueId}.jpg`, { type: 'image/jpeg' });
    const filePath = `${uniqueId}.jpg`;
    
    console.log('Uploading image as:', filePath);
    
    // Use our storage service upload function with 'public' bucket only
    const publicUrl = await uploadImage(file, filePath);
    console.log('Image uploaded successfully:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('Error uploading face image:', error);
    throw error;
  }
};

// Store unrecognized face
export const storeUnrecognizedFace = async (imageData: string): Promise<void> => {
  try {
    console.log('Storing unrecognized face');
    
    // Convert base64 image data to a Blob
    const response = await fetch(imageData);
    const blob = await response.blob();
    
    if (!blob || blob.size === 0) {
      console.error('Failed to convert image data to blob');
      return;
    }
    
    // Always store unrecognized captures in Lovable Cloud storage
    const imageUrl = await uploadFaceImage(blob);
    
    // Create a device info object with the current timestamp as a plain object
    const deviceInfo: Record<string, any> = {
      type: 'webcam',
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      firebase_image_url: imageUrl,
    };
    
    // Insert a record with status "unauthorized"
    const { error } = await supabase
      .from('attendance_records')
      .insert({
        user_id: null, // No user associated
        status: 'unauthorized',
        device_info: deviceInfo,
        image_url: imageUrl,
      });
    
    if (error) {
      console.error('Error storing unrecognized face:', error);
    } else {
      console.log('Unrecognized face stored successfully');
    }
  } catch (error) {
    console.error('Failed to store unrecognized face:', error);
  }
};
