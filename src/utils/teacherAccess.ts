import { supabase } from '@/integrations/supabase/client';
import { CLASSES, SECTIONS, ALL_CLASS_SECTIONS, type ClassSection } from '@/constants/schoolConfig';

const CLASS_ACCESS_PREFIX = 'class_access:';

export interface TeacherPermissions {
  can_take_attendance: boolean;
  can_edit_timetable: boolean;
  can_export_reports: boolean;
  can_manage_students: boolean;
  can_send_notifications: boolean;
  can_verify_leaves: boolean;
  can_view_analytics: boolean;
}

export const DEFAULT_TEACHER_PERMISSIONS: TeacherPermissions = {
  can_take_attendance: true,
  can_edit_timetable: true,
  can_export_reports: true,
  can_manage_students: true,
  can_send_notifications: false,
  can_verify_leaves: true,
  can_view_analytics: true,
};

export interface ClassTeacherAssignment {
  id: string;
  category: string;
  class: string;
  section: string;
  teacher_id: string;
  teacher_name: string;
  teacher_email?: string;
  role: 'class_teacher' | 'co_teacher' | 'subject_teacher' | string;
  created_at?: string;
}

export interface ClassMatrixSlot {
  category: string;
  class: string;
  section: string;
  wing: 'Primary' | 'Middle' | 'Secondary' | 'Senior Secondary';
  primaryTeacher: ClassTeacherAssignment | null;
  coTeachers: ClassTeacherAssignment[];
  isAssigned: boolean;
}

export const getWingForClass = (cls: string | number): 'Primary' | 'Middle' | 'Secondary' | 'Senior Secondary' => {
  const num = parseInt(String(cls), 10);
  if (num <= 5) return 'Primary';
  if (num <= 8) return 'Middle';
  if (num <= 10) return 'Secondary';
  return 'Senior Secondary';
};

export const normalizeCategory = (value: string): string | null => {
  let raw = (value || '').trim();
  if (!raw) return null;

  // Strip duplicate section suffix (e.g., "11-A-A", "11-A:A", "Class 11-A-A", "11-A - A")
  raw = raw
    .replace(/^class\s+/i, '')
    .replace(/^(\d+|[IVXLCDM]+)[-_ ]*([A-Za-z])(?:[-_ ]+[A-Za-z])+$/i, '$1-$2')
    .trim();

  // Handle standard "6-A", "10-B"
  const directMatch = raw.match(/^(\d+)-([A-Z])$/i);
  if (directMatch) {
    return `${directMatch[1]}-${directMatch[2].toUpperCase()}`;
  }

  // Handle fuzzy formats like "6th A", "6th-A", "6 A", "Class 6 Section A", "Class 6-A", "Class 6 A", "6th_A", "6A", "VI-A", "VI A", "10th B", etc.
  const cleaned = raw.replace(/^class\s+/i, '').replace(/section\s+/i, '').trim();

  // Roman numerals mapping
  const romanMap: Record<string, string> = {
    i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12'
  };

  const match = cleaned.match(/^(\d+|[IVXLCDM]+)(?:st|nd|rd|th)?[\s\-_:]*([A-Z])$/i);
  if (match) {
    let cls = match[1].toLowerCase();
    if (romanMap[cls]) cls = romanMap[cls];
    const sec = match[2].toUpperCase();
    return `${cls}-${sec}`;
  }

  const fuzzyNumberMatch = raw.match(/(\d+)\s*(?:st|nd|rd|th)?[\s\-_:]*([A-Z])/i);
  if (fuzzyNumberMatch) {
    return `${fuzzyNumberMatch[1]}-${fuzzyNumberMatch[2].toUpperCase()}`;
  }

  return null;
};

export const parseClassSection = (category: string): { className: string; section: string } | null => {
  const normalized = normalizeCategory(category);
  if (!normalized) return null;
  const [className, section] = normalized.split('-');
  return { className, section };
};

export const matchesClassAndSection = (
  item: { class?: string | number | null; section?: string | null; category?: string | null; department?: string | null; device_info?: any },
  targetClass: string | number,
  targetSection: string
): boolean => {
  const targetNorm = normalizeCategory(`${targetClass}-${targetSection}`);
  if (!targetNorm) return false;
  const [tClass, tSec] = targetNorm.split('-');

  const romanMap: Record<string, string> = {
    i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12'
  };

  // 1. Direct category match
  if (item.category) {
    const itemNorm = normalizeCategory(item.category);
    if (itemNorm === targetNorm) return true;
  }

  // 2. Department match
  if (item.department) {
    const deptNorm = normalizeCategory(item.department);
    if (deptNorm === targetNorm) return true;
  }

  // 3. Nested device_info metadata match
  const meta = (item as any)?.device_info?.metadata;
  if (meta) {
    if (meta.category && normalizeCategory(meta.category) === targetNorm) return true;
    if (meta.department && normalizeCategory(meta.department) === targetNorm) return true;
  }

  // 4. Class + Section match
  const rawCls = item.class ?? meta?.class;
  const rawSec = item.section ?? meta?.section;

  if (rawCls !== undefined && rawCls !== null) {
    const rawClsStr = String(rawCls).trim();
    const parsedClsCat = normalizeCategory(rawClsStr);
    if (parsedClsCat === targetNorm) return true;

    const lowerCls = rawClsStr.toLowerCase().replace(/^class\s+/i, '').trim();
    const cleanCls = romanMap[lowerCls] || rawClsStr.replace(/[^0-9]/g, '');

    let cleanSec = '';
    if (rawSec) {
      const sStr = String(rawSec).trim().replace(/^sec(?:tion)?\s+/i, '');
      const secMatch = sStr.match(/([A-Za-z])$/);
      cleanSec = secMatch ? secMatch[1].toUpperCase() : sStr.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
    }

    if (rawSec) {
      const rawCat = `${rawCls}-${rawSec}`;
      const norm = normalizeCategory(rawCat);
      if (norm === targetNorm) return true;
    }

    if (cleanCls === tClass && (!rawSec || cleanSec === tSec)) {
      return cleanSec === tSec;
    }
  }

  return false;
};

export const categoryFromPermissionKey = (key: string): string | null => {
  const raw = (key || '').trim();
  if (!raw) return null;
  if (raw.startsWith(CLASS_ACCESS_PREFIX)) {
    return normalizeCategory(raw.slice(CLASS_ACCESS_PREFIX.length));
  }
  return normalizeCategory(raw);
};

export const toClassAccessPermission = (category: string) => `${CLASS_ACCESS_PREFIX}${category}`;

/**
 * Fetch all categories / classes assigned to a teacher
 */
export async function fetchTeacherCategories(userId: string): Promise<string[]> {
  const db = supabase as any;
  const categories = new Set<string>();

  const addFromRow = (row: any) => {
    const direct = normalizeCategory(String(row?.category || ''));
    if (direct) {
      categories.add(direct);
      return;
    }
    const cls = String(row?.class || '').trim();
    const sec = String(row?.section || '').trim();
    const combined = normalizeCategory(`${cls}-${sec}`);
    if (combined) categories.add(combined);
  };

  try {
    const res1 = await db.from('teacher_permissions').select('*').eq('user_id', userId);
    if (!res1.error && Array.isArray(res1.data)) {
      res1.data.forEach(addFromRow);
    }
    const res2 = await db.from('teacher_permissions').select('*').eq('teacher_id', userId);
    if (!res2.error && Array.isArray(res2.data)) {
      res2.data.forEach(addFromRow);
    }
  } catch (e) {
    console.warn('Could not read teacher_permissions:', e);
  }

  try {
    const classRows = await db
      .from('class_teachers')
      .select('*')
      .eq('teacher_id', userId);

    if (!classRows.error && Array.isArray(classRows.data)) {
      classRows.data.forEach(addFromRow);
    }
  } catch (e) {
    console.warn('Could not read class_teachers:', e);
  }

  return [...categories];
}

/**
 * Fetch granular permission flags for a teacher
 */
export async function fetchTeacherPermissions(userId: string): Promise<TeacherPermissions> {
  const db = supabase as any;
  try {
    let rows: any[] | null = null;

    const res1 = await db
      .from('teacher_permissions')
      .select('*')
      .eq('user_id', userId)
      .limit(1);

    if (!res1.error && res1.data && res1.data.length > 0) {
      rows = res1.data;
    } else {
      const res2 = await db
        .from('teacher_permissions')
        .select('*')
        .eq('teacher_id', userId)
        .limit(1);
      if (!res2.error && res2.data && res2.data.length > 0) {
        rows = res2.data;
      }
    }

    if (!rows || rows.length === 0) {
      return DEFAULT_TEACHER_PERMISSIONS;
    }

    const row = rows[0];
    const meta = (row.metadata || {}) as any;

    return {
      can_take_attendance: row.can_take_attendance ?? meta.can_take_attendance ?? DEFAULT_TEACHER_PERMISSIONS.can_take_attendance,
      can_edit_timetable: row.can_edit_timetable ?? meta.can_edit_timetable ?? DEFAULT_TEACHER_PERMISSIONS.can_edit_timetable,
      can_export_reports: row.can_export_reports ?? meta.can_export_reports ?? DEFAULT_TEACHER_PERMISSIONS.can_export_reports,
      can_manage_students: meta.can_manage_students ?? DEFAULT_TEACHER_PERMISSIONS.can_manage_students,
      can_send_notifications: meta.can_send_notifications ?? DEFAULT_TEACHER_PERMISSIONS.can_send_notifications,
      can_verify_leaves: meta.can_verify_leaves ?? DEFAULT_TEACHER_PERMISSIONS.can_verify_leaves,
      can_view_analytics: meta.can_view_analytics ?? DEFAULT_TEACHER_PERMISSIONS.can_view_analytics,
    };
  } catch {
    return DEFAULT_TEACHER_PERMISSIONS;
  }
}

export interface BatchTeacherData {
  categoriesByUser: Map<string, string[]>;
  permissionsByUser: Map<string, TeacherPermissions>;
  classTeachersRows: any[];
}

/**
 * High-performance batch fetch for all teacher assignments and permissions in a single round-trip.
 * Completely eliminates N+1 query loops.
 */
export async function fetchAllTeacherDataBatch(): Promise<BatchTeacherData> {
  const db = supabase as any;
  const categoriesByUser = new Map<string, Set<string>>();
  const permissionsByUser = new Map<string, TeacherPermissions>();

  const [permRes, classTeachersRes] = await Promise.all([
    db.from('teacher_permissions').select('*'),
    db.from('class_teachers').select('*'),
  ]);

  const addCategory = (userId: string, row: any) => {
    if (!userId) return;
    let set = categoriesByUser.get(userId);
    if (!set) {
      set = new Set<string>();
      categoriesByUser.set(userId, set);
    }
    const direct = normalizeCategory(String(row?.category || ''));
    if (direct) {
      set.add(direct);
      return;
    }
    const cls = String(row?.class || '').trim();
    const sec = String(row?.section || '').trim();
    const combined = normalizeCategory(`${cls}-${sec}`);
    if (combined) set.add(combined);
  };

  const permRows = (!permRes.error && Array.isArray(permRes.data)) ? permRes.data : [];
  permRows.forEach((row: any) => {
    const uId = row.user_id || row.teacher_id;
    if (uId) {
      addCategory(uId, row);
      if (row.teacher_id && row.teacher_id !== row.user_id) {
        addCategory(row.teacher_id, row);
      }

      if (!permissionsByUser.has(uId)) {
        const meta = (row.metadata || {}) as any;
        permissionsByUser.set(uId, {
          can_take_attendance: row.can_take_attendance ?? meta.can_take_attendance ?? DEFAULT_TEACHER_PERMISSIONS.can_take_attendance,
          can_edit_timetable: row.can_edit_timetable ?? meta.can_edit_timetable ?? DEFAULT_TEACHER_PERMISSIONS.can_edit_timetable,
          can_export_reports: row.can_export_reports ?? meta.can_export_reports ?? DEFAULT_TEACHER_PERMISSIONS.can_export_reports,
          can_manage_students: meta.can_manage_students ?? DEFAULT_TEACHER_PERMISSIONS.can_manage_students,
          can_send_notifications: meta.can_send_notifications ?? DEFAULT_TEACHER_PERMISSIONS.can_send_notifications,
          can_verify_leaves: meta.can_verify_leaves ?? DEFAULT_TEACHER_PERMISSIONS.can_verify_leaves,
          can_view_analytics: meta.can_view_analytics ?? DEFAULT_TEACHER_PERMISSIONS.can_view_analytics,
        });
      }
    }
  });

  const ctRows = (!classTeachersRes.error && Array.isArray(classTeachersRes.data)) ? classTeachersRes.data : [];
  ctRows.forEach((row: any) => {
    const uId = row.teacher_id;
    if (uId) {
      addCategory(uId, row);
    }
  });

  const finalizedCategories = new Map<string, string[]>();
  categoriesByUser.forEach((set, uId) => {
    finalizedCategories.set(uId, [...set]);
  });

  return {
    categoriesByUser: finalizedCategories,
    permissionsByUser,
    classTeachersRows: ctRows,
  };
}

/**
 * Fetch full class-section assignment matrix for the school.
 * Optionally reuses pre-fetched class_teachers rows to avoid duplicate network queries.
 */
export async function fetchClassTeacherMatrix(existingRows?: any[]): Promise<ClassMatrixSlot[]> {
  const db = supabase as any;
  let ctRows = existingRows;
  if (!ctRows) {
    const res = await db.from('class_teachers').select('*');
    ctRows = res.data || [];
  }

  const assignmentsByCategory = new Map<string, ClassTeacherAssignment[]>();

  (ctRows || []).forEach((row: any) => {
    const directCat = normalizeCategory(row.category || `${row.class}-${row.section}`);
    if (!directCat) return;

    const assignment: ClassTeacherAssignment = {
      id: row.id,
      category: directCat,
      class: row.class || directCat.split('-')[0],
      section: row.section || directCat.split('-')[1],
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name || 'Teacher',
      teacher_email: row.teacher_email || undefined,
      role: row.role || 'class_teacher',
      created_at: row.created_at,
    };

    const existing = assignmentsByCategory.get(directCat) || [];
    assignmentsByCategory.set(directCat, [...existing, assignment]);
  });

  // Build matrix for ALL_CLASS_SECTIONS
  return ALL_CLASS_SECTIONS.map((category) => {
    const parsed = parseClassSection(category)!;
    const list = assignmentsByCategory.get(category) || [];
    const primary = list.find((a) => a.role === 'class_teacher') || list[0] || null;
    const coTeachers = list.filter((a) => a !== primary);

    return {
      category,
      class: parsed.className,
      section: parsed.section,
      wing: getWingForClass(parsed.className),
      primaryTeacher: primary,
      coTeachers,
      isAssigned: !!primary,
    };
  });
}

export interface UnifiedTeacher {
  id: string;
  user_id?: string;
  name: string;
  email?: string;
  employee_id?: string;
  avatar_url?: string;
  role: string;
  assignedClasses: string[];
}

/**
 * Fetch all authentic teachers in the school, merging profiles, user_roles,
 * and biometric attendance records to ensure zero missing teachers across the app.
 */
export async function fetchAllTeachersUnified(): Promise<UnifiedTeacher[]> {
  const db = supabase as any;
  const teacherMap = new Map<string, UnifiedTeacher>();

  try {
    const [profilesRes, attRes, rolesRes, ctRes] = await Promise.all([
      db.from('profiles').select('id, user_id, display_name, full_name, email, avatar_url, role, employee_id, department'),
      db.from('attendance_records').select('id, user_id, student_name, device_info, image_url').eq('status', 'registered').eq('category', 'Teacher'),
      db.from('user_roles').select('user_id, role').in('role', ['teacher', 'admin', 'principal', 'staff']),
      db.from('class_teachers').select('*'),
    ]);

    // 1. Process profiles table
    (profilesRes?.data || []).forEach((p: any) => {
      const roleStr = (p.role || '').toLowerCase();
      const deptStr = (p.department || '').toLowerCase();
      const isStaffOrTeacher = roleStr === 'teacher' || roleStr === 'principal' || roleStr === 'admin' || roleStr === 'staff' || deptStr.includes('teacher') || deptStr.includes('faculty');
      if (!isStaffOrTeacher) return;
      const uid = p.user_id || p.id;
      if (!uid) return;
      const name = p.display_name || p.full_name || p.email?.split('@')[0] || 'Teacher';
      teacherMap.set(uid, {
        id: uid,
        user_id: p.user_id || p.id,
        name,
        email: p.email || undefined,
        employee_id: p.employee_id || undefined,
        avatar_url: p.avatar_url || undefined,
        role: p.role || 'teacher',
        assignedClasses: [],
      });
    });

    // 2. Process user_roles table
    (rolesRes?.data || []).forEach((r: any) => {
      if (!r.user_id) return;
      const existing = teacherMap.get(r.user_id);
      if (existing) {
        existing.role = r.role || existing.role;
      } else {
        teacherMap.set(r.user_id, {
          id: r.user_id,
          user_id: r.user_id,
          name: 'Faculty Teacher',
          role: r.role || 'teacher',
          assignedClasses: [],
        });
      }
    });

    // 3. Process attendance_records table (biometrically registered teachers)
    (attRes?.data || []).forEach((rec: any) => {
      const dInfo = (rec.device_info as any) || {};
      const meta = dInfo.metadata || {};
      const name = meta.name || rec.student_name || dInfo.name || 'Teacher';
      const empId = meta.employee_id || dInfo.employee_id || '';
      const img = rec.image_url || meta.firebase_image_url || '';
      const uId = rec.user_id;

      if (uId && teacherMap.has(uId)) {
        const cur = teacherMap.get(uId)!;
        if (!cur.name || cur.name === 'Faculty Teacher' || cur.name === 'Teacher') cur.name = name;
        if (!cur.employee_id && empId) cur.employee_id = empId;
        if (!cur.avatar_url && img) cur.avatar_url = img;
      } else {
        const key = uId || rec.id;
        let matchedKey: string | null = null;
        for (const [existingId, t] of teacherMap.entries()) {
          if (t.name.toLowerCase().trim() === name.toLowerCase().trim()) {
            matchedKey = existingId;
            break;
          }
        }

        if (matchedKey) {
          const cur = teacherMap.get(matchedKey)!;
          if (!cur.employee_id && empId) cur.employee_id = empId;
          if (!cur.avatar_url && img) cur.avatar_url = img;
        } else {
          teacherMap.set(key, {
            id: key,
            user_id: uId || undefined,
            name,
            employee_id: empId || undefined,
            avatar_url: img || undefined,
            role: 'teacher',
            assignedClasses: [],
          });
        }
      }
    });

    // 4. Attach assigned classes from class_teachers
    (ctRes?.data || []).forEach((ct: any) => {
      const cat = normalizeCategory(ct.category || `${ct.class}-${ct.section}`);
      if (!cat) return;
      const tId = ct.teacher_id;
      if (tId && teacherMap.has(tId)) {
        const t = teacherMap.get(tId)!;
        if (!t.assignedClasses.includes(cat)) t.assignedClasses.push(cat);
        if (ct.teacher_name && (!t.name || t.name === 'Teacher' || t.name === 'Faculty Teacher')) {
          t.name = ct.teacher_name;
        }
      } else if (ct.teacher_name) {
        for (const t of teacherMap.values()) {
          if (t.name.toLowerCase().trim() === ct.teacher_name.toLowerCase().trim()) {
            if (!t.assignedClasses.includes(cat)) t.assignedClasses.push(cat);
            break;
          }
        }
      }
    });
  } catch (err) {
    console.warn('Error fetching unified teachers:', err);
  }

  return Array.from(teacherMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch the primary designated Class Teacher for a given category (e.g. '8-A' or 'Class 8-A')
 */
export async function fetchClassTeacherForCategory(category: string): Promise<ClassTeacherAssignment | null> {
  const normCat = normalizeCategory(category);
  if (!normCat) return null;
  const [cls, sec] = normCat.split('-');
  const db = supabase as any;

  try {
    const res = await db
      .from('class_teachers')
      .select('*')
      .or(`category.eq.${normCat},and(class.eq.${cls},section.eq.${sec})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (res?.data) {
      return {
        id: res.data.id,
        category: normCat,
        class: res.data.class || cls,
        section: res.data.section || sec,
        teacher_id: res.data.teacher_id,
        teacher_name: res.data.teacher_name || 'Class Teacher',
        teacher_email: res.data.teacher_email || undefined,
        role: res.data.role || 'class_teacher',
        created_at: res.data.created_at,
      };
    }
  } catch (err) {
    console.warn(`Error fetching class teacher for ${category}:`, err);
  }
  return null;
}

/**
 * Assign a teacher to a class-section.
 * Atomically updates class_teachers, teacher_permissions, user_roles, and profiles.
 */
export async function assignClassTeacher(
  classOrCategory: string,
  sectionOrTeacherId: string,
  teacherIdOrName: string,
  teacherNameOrEmail?: string,
  teacherEmailOrRole?: string,
  maybeRole?: 'class_teacher' | 'co_teacher'
): Promise<boolean> {
  const db = supabase as any;
  let classNum: string;
  let section: string;
  let teacherId: string;
  let teacherName: string;
  let teacherEmail: string | undefined;
  let role: 'class_teacher' | 'co_teacher' = 'class_teacher';

  const parsed = parseClassSection(classOrCategory);
  if (parsed && sectionOrTeacherId && (sectionOrTeacherId.length > 2 || sectionOrTeacherId.includes('-') || !/^[a-zA-Z]$/.test(sectionOrTeacherId))) {
    // Called with (category, teacherId, teacherName, teacherEmail?, role?)
    classNum = parsed.className;
    section = parsed.section;
    teacherId = sectionOrTeacherId;
    teacherName = teacherIdOrName || 'Teacher';
    teacherEmail = teacherNameOrEmail;
    if (teacherEmailOrRole === 'co_teacher' || teacherEmailOrRole === 'class_teacher') {
      role = teacherEmailOrRole;
    }
  } else {
    // Called with (classNum, section, teacherId, teacherName, teacherEmail?, role?)
    classNum = classOrCategory;
    section = sectionOrTeacherId;
    teacherId = teacherIdOrName;
    teacherName = teacherNameOrEmail || 'Teacher';
    teacherEmail = teacherEmailOrRole;
    if (maybeRole) {
      role = maybeRole;
    }
  }

  const category = `${classNum}-${section.toUpperCase()}`;

  try {
    // 1. If primary class teacher, remove any existing primary class teacher for this class
    if (role === 'class_teacher') {
      await db.from('class_teachers').delete().or(`category.eq.${category},and(class.eq.${classNum},section.eq.${section.toUpperCase()})`).eq('role', 'class_teacher');
    }

    // 2. Insert into class_teachers with robust fallbacks
    const payload: Record<string, any> = {
      class: classNum,
      section: section.toUpperCase(),
      category,
      teacher_id: teacherId,
      teacher_name: teacherName || 'Teacher',
      role,
    };
    if (teacherEmail) payload.teacher_email = teacherEmail;

    const { error } = await db.from('class_teachers').insert(payload);
    if (error) {
      await db.from('class_teachers').insert({
        class: classNum,
        section: section.toUpperCase(),
        category,
        teacher_id: teacherId,
        teacher_name: teacherName,
      });
    }

    // 3. Ensure teacher_permissions has this category entry
    try {
      await db.from('teacher_permissions').delete().eq('user_id', teacherId).eq('category', category);
    } catch {}

    await db.from('teacher_permissions').insert({
      teacher_id: teacherId,
      user_id: teacherId,
      class: classNum,
      section: section.toUpperCase(),
      category,
      can_take_attendance: true,
      can_edit_timetable: true,
      can_export_reports: true,
    });

    // 4. Ensure user role is elevated to 'teacher' if currently 'user'
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teacherId);
    if (isUuid) {
      try {
        const { data: currentRole } = await db.from('user_roles').select('role').eq('user_id', teacherId).maybeSingle();
        if (!currentRole || currentRole.role === 'user') {
          await db.from('user_roles').upsert({ user_id: teacherId, role: 'teacher' });
        }
        await db.from('profiles').update({ role: 'teacher', department: category }).eq('user_id', teacherId);
      } catch (roleErr) {
        console.warn('Could not update user_roles/profile during teacher assignment:', roleErr);
      }
    }

    // 5. Broadcast change event for real-time local sync across tabs & widgets
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('presences:class-teacher-changed', {
          detail: { category, teacherId, teacherName, action: 'assign' },
        })
      );
    }

    return true;
  } catch (err) {
    console.error('Failed to assign class teacher:', err);
    return false;
  }
}

/**
 * Unassign a teacher from a class-section across all tables.
 */
export async function unassignClassTeacher(category: string, teacherId?: string): Promise<void> {
  const db = supabase as any;
  const normCat = normalizeCategory(category) || category;
  const [cls, sec] = normCat.split('-');

  let query = db.from('class_teachers').delete().or(`category.eq.${normCat},and(class.eq.${cls},section.eq.${sec})`);
  if (teacherId) {
    query = query.eq('teacher_id', teacherId);
  }
  await query;

  let permQuery = db.from('teacher_permissions').delete().or(`category.eq.${normCat},and(class.eq.${cls},section.eq.${sec})`);
  if (teacherId) {
    permQuery = permQuery.or(`user_id.eq.${teacherId},teacher_id.eq.${teacherId}`);
  }
  await permQuery;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('presences:class-teacher-changed', {
        detail: { category: normCat, teacherId, action: 'unassign' },
      })
    );
  }
}

/**
 * Smart Auto-Allocation Algorithm:
 * Automatically balances workload and assigns available unassigned teachers to vacant classes
 */
export function calculateAutoAllocationPlan(
  vacantSlots: ClassMatrixSlot[],
  teachers: Array<{ id: string; user_id?: string; name: string; email?: string; currentWorkload?: number }>
): Array<{ slot: ClassMatrixSlot; teacher: { id: string; user_id?: string; name: string; email?: string } }> {
  if (vacantSlots.length === 0 || teachers.length === 0) return [];

  // Sort teachers by current workload ascending (lowest workload first)
  const sortedTeachers = [...teachers].sort((a, b) => (a.currentWorkload ?? 0) - (b.currentWorkload ?? 0));

  const plan: Array<{ slot: ClassMatrixSlot; teacher: { id: string; user_id?: string; name: string; email?: string } }> = [];
  let teacherIdx = 0;

  for (const slot of vacantSlots) {
    if (!slot.isAssigned) {
      const selectedTeacher = sortedTeachers[teacherIdx % sortedTeachers.length];
      plan.push({
        slot,
        teacher: selectedTeacher,
      });
      teacherIdx++;
    }
  }

  return plan;
}

/**
 * Atomic Swap Algorithm:
 * Swaps class assignments between two classes/sections
 */
export async function swapClassTeacherAssignments(categoryA: string, categoryB: string): Promise<void> {
  const db = supabase as any;
  const { data: rowsA } = await db.from('class_teachers').select('*').eq('category', categoryA);
  const { data: rowsB } = await db.from('class_teachers').select('*').eq('category', categoryB);

  // Clear both
  await db.from('class_teachers').delete().in('category', [categoryA, categoryB]);

  const [clsA, secA] = categoryA.split('-');
  const [clsB, secB] = categoryB.split('-');

  // Re-insert rowsA into categoryB
  for (const row of rowsA || []) {
    await db.from('class_teachers').insert({
      class: clsB,
      section: secB,
      category: categoryB,
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      teacher_email: row.teacher_email,
      role: row.role || 'class_teacher',
    });
  }

  // Re-insert rowsB into categoryA
  for (const row of rowsB || []) {
    await db.from('class_teachers').insert({
      class: clsA,
      section: secA,
      category: categoryA,
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      teacher_email: row.teacher_email,
      role: row.role || 'class_teacher',
    });
  }
}

export async function hasTeacherAccess(userId: string): Promise<boolean> {
  const db = supabase as any;
  const categories = await fetchTeacherCategories(userId);
  if (categories.length > 0) return true;

  const classTeacherRows = await db
    .from('class_teachers')
    .select('id')
    .eq('teacher_id', userId)
    .limit(1);

  if (!classTeacherRows.error && Array.isArray(classTeacherRows.data) && classTeacherRows.data.length > 0) {
    return true;
  }

  const legacyTeacherRows = await db
    .from('attendance_records')
    .select('id')
    .eq('user_id', userId)
    .eq('category', 'Teacher')
    .eq('status', 'registered')
    .limit(1);

  return !legacyTeacherRows.error && Array.isArray(legacyTeacherRows.data) && legacyTeacherRows.data.length > 0;
}

export async function saveTeacherCategories(
  userId: string,
  categories: string[],
  permissions?: Partial<TeacherPermissions>
): Promise<void> {
  const db = supabase as any;
  const normalized = [...new Set(categories.map((c) => normalizeCategory(c)).filter(Boolean))] as string[];

  // 1. Clear existing assignments safely
  try {
    await db.from('teacher_permissions').delete().or(`teacher_id.eq.${userId},user_id.eq.${userId}`);
  } catch (e) {
    console.warn('Could not clear teacher_permissions:', e);
  }

  try {
    await db.from('class_teachers').delete().eq('teacher_id', userId);
  } catch (e) {
    console.warn('Could not clear class_teachers:', e);
  }

  if (normalized.length === 0) return;

  let teacherName = '';
  let teacherEmail = '';
  try {
    const profile = await db
      .from('profiles')
      .select('display_name, full_name, email')
      .eq('user_id', userId)
      .maybeSingle();
    if (profile?.data) {
      teacherName = profile.data.display_name || profile.data.full_name || '';
      teacherEmail = profile.data.email || '';
    }
  } catch {
    // Ignore profile fetch failure
  }

  const perms = { ...DEFAULT_TEACHER_PERMISSIONS, ...(permissions || {}) };

  // 2. Insert into teacher_permissions with fallback
  for (const category of normalized) {
    const [cls, sec] = category.split('-');

    const corePermPayload: Record<string, any> = {
      teacher_id: userId,
      user_id: userId,
      class: cls,
      section: sec,
      category,
      can_take_attendance: perms.can_take_attendance,
      can_edit_timetable: perms.can_edit_timetable,
      can_export_reports: perms.can_export_reports,
      metadata: {
        can_manage_students: perms.can_manage_students,
        can_send_notifications: perms.can_send_notifications,
        can_verify_leaves: perms.can_verify_leaves,
        can_view_analytics: perms.can_view_analytics,
      },
    };

    const { error: pError } = await db.from('teacher_permissions').insert(corePermPayload);

    if (pError) {
      await db.from('teacher_permissions').insert({
        user_id: userId,
        category,
        can_take_attendance: perms.can_take_attendance,
        can_export_reports: perms.can_export_reports,
      });
    }

    // 3. Insert into class_teachers with fallback
    const ctPayload: Record<string, any> = {
      class: cls,
      section: sec,
      category,
      teacher_id: userId,
      teacher_name: teacherName || 'Teacher',
      role: 'class_teacher',
    };

    if (teacherEmail) ctPayload.teacher_email = teacherEmail;

    const { error: ctError } = await db.from('class_teachers').insert(ctPayload);

    if (ctError) {
      await db.from('class_teachers').insert({
        class: cls,
        section: sec,
        category,
        teacher_id: userId,
        teacher_name: teacherName || 'Teacher',
      });
    }
  }
}


