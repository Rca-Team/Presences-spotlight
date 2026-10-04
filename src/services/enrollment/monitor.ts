import { enrollmentApi } from './api';
import type { StudentDetails } from './types';
import { supabase } from '@/integrations/supabase/client';
import { normalizeClassSection } from '@/utils/studentIdentityResolver';

export type MonitorStatus = 'not_started' | 'failed' | 'verified' | 'capturing' | 'completed';

export interface MonitorSample { pose: string; glasses: 'with' | 'without'; fileId: string; brightness: number; sharpness: number }

export interface MonitorStudent {
  admission_number: string;
  name: string;
  class: string;
  section: string;
  category: string;
  parent_phone: string;
  hasPhone: boolean;
  hasDob: boolean;
  hasFather: boolean;
  status: MonitorStatus;
  imported: boolean;
  portrait: boolean;
  faceOnFile: boolean;
  samples: MonitorSample[];
  method: string;
  verifiedAt: number;
  completedAt: number;
  failures: number;
  correction: string | null;
  lastActivity: number;
  inProgress?: { samples: string[]; expires: number };
  avatarUrl?: string;
}

export interface MonitorActivity { event: string; student: string; name: string; category: string; method: string; at: number }

export interface MonitorCorrection {
  id: string;
  student: string;
  name: string;
  category: string;
  original: StudentDetails;
  changes: Partial<StudentDetails>;
  status: 'pending' | 'approved' | 'rejected';
  at: number;
}

export interface MonitorOverview {
  scope: { all: boolean; classes: string[] };
  generatedAt: number;
  students: MonitorStudent[];
  activity: MonitorActivity[];
  corrections: MonitorCorrection[];
  canManage: boolean;
}

export const fetchMonitor = async (): Promise<MonitorOverview> => {
  const fetchProfiles = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, display_name, admission_number, employee_id, roll_number, class, section, category, parent_phone, phone, parent_name, date_of_birth, father_name, avatar_url, photo_url, role, updated_at, created_at');
      return (data || []) as any[];
    } catch (err) {
      console.warn('[EnrollmentMonitor] Profiles fetch fallback:', err);
      return [] as any[];
    }
  };

  const fetchDescriptors = async () => {
    try {
      const { data } = await supabase
        .from('face_descriptors')
        .select('student_id, user_id, label, image_url, created_at');
      return (data || []) as any[];
    } catch (err) {
      console.warn('[EnrollmentMonitor] Descriptors fetch fallback:', err);
      return [] as any[];
    }
  };

  const [backendResult, rawProfiles, rawDescriptors] = await Promise.all([
    enrollmentApi<MonitorOverview>('staff.monitor').catch((err) => {
      console.warn('[EnrollmentMonitor] Backend monitor API note:', err?.message || err);
      return null;
    }),
    fetchProfiles(),
    fetchDescriptors(),
  ]);

  const descriptorKeys = new Set<string>();
  const descriptorPhotos = new Map<string, string>();
  for (const d of rawDescriptors) {
    const sId = (d.student_id || '').trim().toLowerCase();
    const uId = (d.user_id || '').trim();
    if (sId) descriptorKeys.add(sId);
    if (uId) descriptorKeys.add(uId);
    const img = (d.image_url || '').trim();
    if (img) {
      if (sId && !descriptorPhotos.has(sId)) descriptorPhotos.set(sId, img);
      if (uId && !descriptorPhotos.has(uId)) descriptorPhotos.set(uId, img);
    }
  }

  const baseOverview: MonitorOverview = backendResult
    ? { ...backendResult, students: [...backendResult.students] }
    : {
        scope: { all: true, classes: [] },
        generatedAt: Date.now(),
        students: [],
        activity: [],
        corrections: [],
        canManage: true,
      };

  const studentMap = new Map<string, MonitorStudent>();
  for (const s of baseOverview.students) {
    const key = (s.admission_number || '').trim().toLowerCase();
    if (key) studentMap.set(key, s);
  }

  for (const p of rawProfiles) {
    if (p.role && p.role !== 'student') continue;
    const admission = String(p.admission_number || p.employee_id || p.roll_number || p.id || '').trim();
    if (!admission) continue;

    const lowerAdm = admission.toLowerCase();
    const existing = studentMap.get(lowerAdm);
    const category = normalizeClassSection(p.class, p.section, p.category) || 'Unassigned';
    const avatar = p.photo_url || p.avatar_url || descriptorPhotos.get(lowerAdm) || (p.user_id ? descriptorPhotos.get(p.user_id) : undefined);
    const hasFace = descriptorKeys.has(lowerAdm) || (p.user_id ? descriptorKeys.has(p.user_id) : false) || Boolean(p.avatar_url || p.photo_url);

    if (existing) {
      if (!existing.class && p.class) existing.class = p.class;
      if (!existing.section && p.section) existing.section = p.section;
      if (!existing.category || existing.category === 'Unassigned') existing.category = category;
      if (p.parent_phone && !existing.parent_phone) {
        existing.parent_phone = '•••• ' + String(p.parent_phone).slice(-4);
        existing.hasPhone = true;
      }
      if (p.date_of_birth) existing.hasDob = true;
      if (p.father_name) existing.hasFather = true;
      if (avatar && !existing.avatarUrl) existing.avatarUrl = avatar;
      if (hasFace) {
        existing.faceOnFile = true;
        if (existing.status === 'not_started') {
          existing.status = 'completed';
        }
      }
    } else {
      const newStudent: MonitorStudent = {
        admission_number: admission,
        name: p.full_name || p.display_name || admission,
        class: p.class || '',
        section: p.section || '',
        category,
        parent_phone: p.parent_phone ? '•••• ' + String(p.parent_phone).slice(-4) : '',
        hasPhone: Boolean(p.parent_phone || p.phone),
        hasDob: Boolean(p.date_of_birth),
        hasFather: Boolean(p.father_name || p.parent_name),
        status: hasFace ? 'completed' : 'not_started',
        imported: false,
        portrait: Boolean(avatar),
        faceOnFile: hasFace,
        samples: [],
        method: hasFace ? 'staff' : '',
        verifiedAt: 0,
        completedAt: 0,
        failures: 0,
        correction: null,
        lastActivity: Date.parse(p.updated_at || p.created_at || '') || 0,
        avatarUrl: avatar,
      };
      studentMap.set(lowerAdm, newStudent);
      baseOverview.students.push(newStudent);
    }
  }

  for (const d of rawDescriptors) {
    const sId = (d.student_id || '').trim();
    if (!sId || sId.length > 36 || sId.startsWith('unknown')) continue;
    const lower = sId.toLowerCase();
    if (!studentMap.has(lower)) {
      const name = d.label && d.label !== 'Trained Student' ? d.label : sId;
      const newStudent: MonitorStudent = {
        admission_number: sId,
        name,
        class: '',
        section: '',
        category: 'Unassigned',
        parent_phone: '',
        hasPhone: false,
        hasDob: false,
        hasFather: false,
        status: 'completed',
        imported: false,
        portrait: Boolean(d.image_url),
        faceOnFile: true,
        samples: [],
        method: 'staff',
        verifiedAt: 0,
        completedAt: Date.parse(d.created_at || '') || 0,
        failures: 0,
        correction: null,
        lastActivity: Date.parse(d.created_at || '') || 0,
        avatarUrl: d.image_url,
      };
      studentMap.set(lower, newStudent);
      baseOverview.students.push(newStudent);
    }
  }

  const allDiscoveredCategories = Array.from(
    new Set(baseOverview.students.map((s) => s.category).filter(Boolean))
  ).sort();
  if (baseOverview.scope.all || baseOverview.scope.classes.length === 0) {
    baseOverview.scope = { all: true, classes: allDiscoveredCategories };
  }

  return baseOverview;
};
export const fetchMonitorPhoto = (admission: string, fileId: string) =>
  enrollmentApi<{ image: string }>('staff.photo', { admission, fileId }).then(r => r.image);
export const reviewCorrection = (id: string, approve: boolean) => enrollmentApi('staff.review', { id, approve });

export const statusMeta: Record<MonitorStatus, { label: string; tone: string; dot: string }> = {
  completed: { label: 'Face enrolled', tone: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-500' },
  capturing: { label: 'Capturing', tone: 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-500' },
  verified: { label: 'Verified', tone: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/20', dot: 'bg-indigo-500' },
  failed: { label: 'Verification failed', tone: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-500' },
  not_started: { label: 'Not started', tone: 'text-muted-foreground bg-muted/60 border-border', dot: 'bg-slate-400' },
};

export const eventLabels: Record<string, string> = {
  imported: 'Record imported',
  verified: 'Parent verified',
  'verification-failed': 'Verification failed',
  'enrollment-completed': 'Face enrollment completed',
  'correction-reviewed': 'Correction reviewed',
};

export const methodLabels: Record<string, string> = {
  otp: 'SMS code',
  'verify-otp': 'SMS code',
  'father-name': "Father's name + DOB",
  'verify-father': "Father's name + DOB",
  staff: 'At school (staff)',
};

export const REQUIRED_POSES = ['front', 'left', 'right', 'up', 'down'];
