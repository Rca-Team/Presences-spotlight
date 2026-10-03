
import { supabase } from '@/integrations/supabase/client';
import { FaceInfo } from './types';

// Fetch face details from Supabase
export const fetchSelectedFace = async (faceId: string): Promise<FaceInfo> => {
  try {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('device_info, user_id, image_url, category')
      .eq('id', faceId)
      .single();
        
    if (error) {
      console.error('Error fetching face details from attendance_records:', error);
      
      const { data: userData, error: userError } = await supabase
        .from('attendance_records')
        .select('device_info, image_url, category')
        .eq('user_id', faceId)
        .single();
        
      if (userError) {
        console.error('Error fetching face details by user_id:', userError);
        
        return {
          recordId: faceId,
          name: 'Unknown Student',
          employee_id: faceId,
          department: 'N/A',
          position: 'Student'
        };
      }
      
      if (userData) {
        const deviceInfo = userData.device_info as any;
        const metadata = deviceInfo && typeof deviceInfo === 'object' && !Array.isArray(deviceInfo)
          ? deviceInfo.metadata || deviceInfo
          : {};

        const deptStr = String(metadata.department || metadata.class_section || userData.category || '');
        const deptMatch = deptStr.match(/^(\d{1,2})\s*[-/]?\s*([A-Za-z])$/);

        const imgCandidate = metadata?.face_model?.id_card_photo_url ||
          metadata?.id_card_photo_url ||
          metadata?.firebase_image_url ||
          metadata?.avatar_url ||
          metadata?.photo_url ||
          userData.image_url ||
          undefined;
        
        return {
          recordId: faceId,
          user_id: faceId,
          name: metadata.name || 'Unknown Student',
          class: metadata.class || (deptMatch ? deptMatch[1] : ''),
          section: metadata.section || (deptMatch ? deptMatch[2].toUpperCase() : ''),
          employee_id: metadata.employee_id || faceId,
          department: metadata.department || userData.category || 'N/A',
          position: metadata.position || 'Student',
          image_url: imgCandidate,
          roll_number: metadata.roll_number || '',
          blood_group: metadata.blood_group || '',
          parent_name: metadata.parent_name || '',
          parent_phone: metadata.parent_phone || metadata.phone || '',
          parent_email: metadata.parent_email || '',
          transport_mode: metadata.transport_mode || '',
          address: metadata.address || '',
        };
      }
      
      return {
        recordId: faceId,
        name: 'Unknown Student',
        employee_id: faceId,
        department: 'N/A',
        position: 'Student'
      };
    }

    if (data) {
      const deviceInfo = data.device_info as any;
      const metadata = deviceInfo && typeof deviceInfo === 'object' && !Array.isArray(deviceInfo)
        ? deviceInfo.metadata || deviceInfo
        : {};

      let profileData: any = null;
      const profileKey = data?.user_id || faceId;
      if (profileKey) {
        const { data: profRow } = await supabase
          .from('profiles')
          .select('full_name, display_name, class, section, roll_number, admission_number, parent_name, parent_phone, parent_email, blood_group, address, date_of_birth, gender, avatar_url, photo_url, employee_id')
          .or(`user_id.eq.${profileKey},id.eq.${profileKey},employee_id.eq.${profileKey},admission_number.eq.${profileKey}`)
          .maybeSingle();
        profileData = profRow;
      }

      const deptStr = String(metadata.department || metadata.class_section || data.category || profileData?.class || '');
      const deptMatch = deptStr.match(/^(\d{1,2})\s*[-/]?\s*([A-Za-z])$/);

      const resolvedPhoto = profileData?.avatar_url ||
        profileData?.photo_url ||
        metadata?.face_model?.id_card_photo_url ||
        metadata?.id_card_photo_url ||
        metadata?.firebase_image_url ||
        metadata?.avatar_url ||
        metadata?.photo_url ||
        data.image_url ||
        undefined;
      
      return {
        recordId: faceId,
        user_id: data.user_id || profileKey,
        name: profileData?.full_name || profileData?.display_name || metadata.name || 'Unknown Student',
        class: profileData?.class || metadata.class || (deptMatch ? deptMatch[1] : ''),
        section: profileData?.section || metadata.section || (deptMatch ? deptMatch[2].toUpperCase() : ''),
        employee_id: profileData?.admission_number || profileData?.employee_id || metadata.employee_id || data.user_id || faceId,
        admission_number: profileData?.admission_number || metadata.admission_number || metadata.admission_no || '',
        department: metadata.department || data.category || (profileData?.class ? `${profileData.class}-${profileData?.section || 'A'}` : 'N/A'),
        position: metadata.position || 'Student',
        image_url: resolvedPhoto,
        roll_number: profileData?.roll_number || metadata.roll_number || '',
        blood_group: profileData?.blood_group || metadata.blood_group || '',
        parent_name: profileData?.parent_name || metadata.parent_name || '',
        parent_phone: profileData?.parent_phone || metadata.parent_phone || metadata.phone || '',
        parent_email: profileData?.parent_email || metadata.parent_email || '',
        transport_mode: metadata.transport_mode || '',
        address: profileData?.address || metadata.address || '',
        date_of_birth: profileData?.date_of_birth || '',
        gender: profileData?.gender || '',
      };
    }
    
    // Fallback: Check profiles table directly if attendance record wasn't found
    const { data: directProfile } = await supabase
      .from('profiles')
      .select('id, user_id, full_name, display_name, class, section, roll_number, admission_number, parent_name, parent_phone, parent_email, blood_group, address, date_of_birth, gender, avatar_url, photo_url, employee_id')
      .or(`id.eq.${faceId},user_id.eq.${faceId},admission_number.eq.${faceId},employee_id.eq.${faceId}`)
      .maybeSingle();

    if (directProfile) {
      return {
        recordId: directProfile.id || faceId,
        user_id: directProfile.user_id || directProfile.id,
        name: directProfile.full_name || directProfile.display_name || 'Student',
        class: directProfile.class || '',
        section: directProfile.section || '',
        employee_id: directProfile.admission_number || directProfile.employee_id || faceId,
        admission_number: directProfile.admission_number || directProfile.employee_id || '',
        department: directProfile.class ? `${directProfile.class}-${directProfile.section || 'A'}` : 'N/A',
        position: 'Student',
        image_url: directProfile.avatar_url || directProfile.photo_url || undefined,
        roll_number: directProfile.roll_number || '',
        blood_group: directProfile.blood_group || '',
        parent_name: directProfile.parent_name || '',
        parent_phone: directProfile.parent_phone || '',
        parent_email: directProfile.parent_email || '',
        transport_mode: '',
        address: directProfile.address || '',
        date_of_birth: directProfile.date_of_birth || '',
        gender: directProfile.gender || '',
      };
    }

    return {
      recordId: faceId,
      name: 'Unknown Student',
      employee_id: faceId,
      department: 'N/A',
      position: 'Student'
    };
  } catch (error) {
    console.error('Error fetching face details:', error);
    
    return {
      recordId: faceId,
      name: 'Unknown Student',
      employee_id: faceId,
      department: 'N/A',
      position: 'Student'
    };
  }
};
