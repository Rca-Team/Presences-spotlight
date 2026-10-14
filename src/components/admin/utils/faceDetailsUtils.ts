import { supabase } from '@/integrations/supabase/client';
import { FaceInfo } from './types';
import { getCachedUnifiedStudentSnapshot } from '@/utils/attendanceStatsHelper';

// Fetch face details from memory snapshot, profiles, and attendance_records
export const fetchSelectedFace = async (
  faceId: string,
  fallbackStudent?: Partial<FaceInfo> | null
): Promise<FaceInfo> => {
  try {
    if (!faceId) {
      return {
        recordId: '',
        name: 'Student',
        employee_id: '',
        department: 'N/A',
        position: 'Student',
      };
    }

    // 1. Check in-memory unified snapshot first for instantaneous 0ms resolution
    const snapshot = getCachedUnifiedStudentSnapshot();
    const roster = snapshot?.roster || snapshot?.students || [];
    const matched = roster.find(
      (s) =>
        s.id === faceId ||
        s.employee_id === faceId ||
        s.admission_number === faceId ||
        s.user_id === faceId
    );

    let base: FaceInfo = {
      recordId: matched?.id || fallbackStudent?.recordId || faceId,
      user_id: matched?.user_id || fallbackStudent?.user_id || undefined,
      name: matched?.name || fallbackStudent?.name || '',
      employee_id: matched?.admission_number || matched?.employee_id || fallbackStudent?.employee_id || '',
      admission_number: matched?.admission_number || matched?.employee_id || fallbackStudent?.admission_number || '',
      class: matched?.class || fallbackStudent?.class || '',
      section: matched?.section || fallbackStudent?.section || '',
      department: matched?.category || matched?.department || fallbackStudent?.department || 'N/A',
      position: matched?.role === 'teacher' ? 'Teacher' : 'Student',
      image_url: matched?.image_url || fallbackStudent?.image_url || undefined,
      roll_number: matched?.roll_number || fallbackStudent?.roll_number || '',
      parent_name: matched?.parent_name || fallbackStudent?.parent_name || '',
      parent_phone: matched?.parent_phone || matched?.phone || fallbackStudent?.parent_phone || '',
      parent_email: matched?.parent_email || fallbackStudent?.parent_email || '',
      address: fallbackStudent?.address || '',
      blood_group: fallbackStudent?.blood_group || '',
      date_of_birth: fallbackStudent?.date_of_birth || '',
      gender: fallbackStudent?.gender || '',
      transport_mode: fallbackStudent?.transport_mode || '',
    };

    // 2. Query profiles collection directly (id maps to Appwrite $id)
    let profileData: any = null;
    try {
      const { data: byId } = await supabase.from('profiles').select('*').eq('id', faceId).maybeSingle();
      if (byId) {
        profileData = byId;
      } else {
        const { data: byAdm } = await supabase.from('profiles').select('*').eq('admission_number', faceId).maybeSingle();
        if (byAdm) {
          profileData = byAdm;
        } else {
          const { data: byEmp } = await supabase.from('profiles').select('*').eq('employee_id', faceId).maybeSingle();
          if (byEmp) {
            profileData = byEmp;
          } else {
            const { data: byUid } = await supabase.from('profiles').select('*').eq('user_id', faceId).maybeSingle();
            profileData = byUid;
          }
        }
      }
    } catch (e) {
      console.warn('[faceDetailsUtils] profiles query error:', e);
    }

    // 3. Parse profile metadata JSON if present (stores mother_name, verified phones, etc.)
    let meta: any = {};
    if (profileData?.metadata) {
      if (typeof profileData.metadata === 'string') {
        try {
          meta = JSON.parse(profileData.metadata);
        } catch {}
      } else if (typeof profileData.metadata === 'object') {
        meta = profileData.metadata;
      }
    }

    if (profileData) {
      const cls = profileData.class || meta.class || base.class;
      const sec = profileData.section || meta.section || base.section;
      const adm = profileData.admission_number || profileData.employee_id || meta.admission_number || base.admission_number;
      const name = profileData.full_name || profileData.display_name || meta.name || base.name || 'Student';

      base = {
        ...base,
        recordId: profileData.id || profileData.$id || base.recordId,
        user_id: profileData.user_id || base.user_id,
        name,
        employee_id: adm,
        admission_number: adm,
        class: cls,
        section: sec ? sec.toUpperCase() : '',
        department: profileData.category || (cls && sec ? `${cls}-${sec.toUpperCase()}` : cls) || base.department,
        roll_number: profileData.roll_number || meta.roll_number || base.roll_number,
        blood_group: profileData.blood_group || meta.blood_group || base.blood_group,
        date_of_birth: profileData.date_of_birth || meta.date_of_birth || base.date_of_birth,
        gender: profileData.gender || meta.gender || base.gender,
        parent_name: profileData.parent_name || profileData.father_name || meta.parent_name || meta.father_name || base.parent_name,
        parent_phone: profileData.parent_phone || profileData.phone || meta.parent_phone || meta.phone || base.parent_phone,
        parent_email: profileData.parent_email || profileData.email || meta.parent_email || base.parent_email,
        address: profileData.address || meta.address || base.address,
        image_url: profileData.avatar_url || profileData.photo_url || meta.avatar_url || meta.photo_url || base.image_url,
      };
    }

    // 4. Also check attendance_records for any extra details / device metadata
    const targetAdm = base.admission_number || base.employee_id || faceId;
    const targetUid = base.user_id || faceId;
    try {
      const { data: attList } = await supabase
        .from('attendance_records')
        .select('device_info, image_url, category, timestamp')
        .or(`student_id.eq.${targetAdm},user_id.eq.${targetUid}`)
        .order('timestamp', { ascending: false })
        .limit(1);

      if (attList && attList[0]) {
        const att = attList[0];
        const di = att.device_info as any;
        const diMeta = di?.metadata || di;
        if (!base.image_url && att.image_url) {
          base.image_url = att.image_url;
        }
        if (!base.name && diMeta?.name) {
          base.name = diMeta.name;
        }
      }
    } catch {}

    // Guarantee that employee_id & admission_number are never set to raw document id when admission is known
    if (base.recordId && base.employee_id === base.recordId && base.admission_number && base.admission_number !== base.recordId) {
      base.employee_id = base.admission_number;
    }

    if (!base.name) {
      base.name = 'Student';
    }

    return base;
  } catch (error) {
    console.error('Error fetching face details:', error);
    return {
      recordId: faceId,
      name: fallbackStudent?.name || 'Student',
      employee_id: fallbackStudent?.employee_id || faceId,
      admission_number: fallbackStudent?.admission_number || '',
      department: fallbackStudent?.department || 'N/A',
      position: 'Student',
      ...fallbackStudent,
    };
  }
};
