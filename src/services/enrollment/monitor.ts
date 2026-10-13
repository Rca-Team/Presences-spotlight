import { enrollmentApi } from './api';
import type { StudentDetails } from './types';
import { supabase } from '@/integrations/supabase/client';
import { invalidateCollectionCache } from '@/integrations/appwrite/adapter';
import { normalizeClassSection } from '@/utils/studentIdentityResolver';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';

export type MonitorStatus = 'not_started' | 'failed' | 'verified' | 'capturing' | 'completed';

export interface MonitorSample {
  pose: string;
  glasses: 'with' | 'without';
  fileId: string;
  brightness: number;
  sharpness: number;
  imageUrl?: string;
}

export interface MonitorStudent {
  id?: string;
  userId?: string;
  admission_number: string;
  student_id_kv?: string;
  roll_number?: string;
  pen_number?: string;
  blood_group?: string;
  name: string;
  class: string;
  section: string;
  category: string;
  father_name?: string;
  mother_name?: string;
  date_of_birth?: string;
  address?: string;
  parent_phone: string;
  parent_phone_full?: string;
  email?: string;
  hasPhone: boolean;
  hasDob: boolean;
  hasFather: boolean;
  hasMother?: boolean;
  hasAddress?: boolean;
  status: MonitorStatus;
  imported: boolean;
  portrait: boolean;
  faceOnFile: boolean;
  vectorCount?: number;
  samples: MonitorSample[];
  method: string;
  verifiedAt: number;
  completedAt: number;
  failures: number;
  correction: string | null;
  lastActivity: number;
  inProgress?: { samples: string[]; expires: number };
  avatarUrl?: string;
  primaryPhotoUrl?: string;
  profilePhotoUrl?: string;
  modelPath?: string;
}

export interface MonitorActivity {
  event: string;
  student: string;
  name: string;
  category: string;
  method: string;
  at: number;
}

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

let inMemoryOverviewCache: MonitorOverview | null = null;
const CACHE_STORAGE_KEY = 'presences:enrollment_monitor_cache_v3';

export function getCachedMonitorOverview(): MonitorOverview | null {
  if (inMemoryOverviewCache) return inMemoryOverviewCache;
  try {
    const raw =
      sessionStorage.getItem(CACHE_STORAGE_KEY) ||
      localStorage.getItem(CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MonitorOverview;
      if (parsed && Array.isArray(parsed.students) && parsed.students.length > 0) {
        inMemoryOverviewCache = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function saveCachedMonitorOverview(data: MonitorOverview) {
  inMemoryOverviewCache = data;
  try {
    const serialized = JSON.stringify(data);
    sessionStorage.setItem(CACHE_STORAGE_KEY, serialized);
    localStorage.setItem(CACHE_STORAGE_KEY, serialized);
  } catch {}
}

export function removeStudentFromMonitorCache(admissionNumber: string) {
  const clean = String(admissionNumber || '').trim().toLowerCase();
  if (!clean) return;

  if (inMemoryOverviewCache) {
    inMemoryOverviewCache = {
      ...inMemoryOverviewCache,
      students: inMemoryOverviewCache.students.filter(
        (s) => s.admission_number.trim().toLowerCase() !== clean
      ),
    };
  }

  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MonitorOverview;
        if (parsed && Array.isArray(parsed.students)) {
          parsed.students = parsed.students.filter(
            (s) => s.admission_number.trim().toLowerCase() !== clean
          );
          store.setItem(CACHE_STORAGE_KEY, JSON.stringify(parsed));
        }
      }
    } catch {}
  }
}

export function clearMonitorCache() {
  inMemoryOverviewCache = null;
  invalidateCollectionCache('profiles');
  invalidateCollectionCache('face_descriptors');
  try {
    sessionStorage.removeItem(CACHE_STORAGE_KEY);
    localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {}
}

let backendUnavailableCooldownUntil = 0;
let lastBackendFetchAt = 0;
let cachedBackendOverview: MonitorOverview | null = null;
let inFlightMonitorRequest: Promise<MonitorOverview> | null = null;

function parseMetadataObject(rawMeta: unknown): Record<string, any> {
  if (!rawMeta) return {};
  if (typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    return rawMeta as Record<string, any>;
  }
  if (typeof rawMeta === 'string') {
    try {
      const parsed = JSON.parse(rawMeta);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export const fetchMonitor = async (force = false): Promise<MonitorOverview> => {
  if (force) {
    invalidateCollectionCache('profiles');
    invalidateCollectionCache('face_descriptors');
  } else if (inMemoryOverviewCache && Date.now() - inMemoryOverviewCache.generatedAt < 20000) {
    return inMemoryOverviewCache;
  }
  if (inFlightMonitorRequest) {
    return inFlightMonitorRequest;
  }

  const runFetch = async (): Promise<MonitorOverview> => {
    const fetchProfiles = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select(
            'id, user_id, full_name, display_name, admission_number, employee_id, roll_number, class, section, category, parent_phone, phone, parent_name, father_name, address, blood_group, email, parent_email, avatar_url, photo_url, metadata, role, updated_at, created_at'
          )
          .limit(5000);
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
          .select('id, student_id, user_id, label, student_name, class, section, category, image_url, metadata, created_at')
          .limit(5000);
        return (data || []) as any[];
      } catch (err) {
        console.warn('[EnrollmentMonitor] Descriptors fetch fallback:', err);
        return [] as any[];
      }
    };

    const triggerBackgroundBackendSync = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (Date.now() < backendUnavailableCooldownUntil) return;
      if (!force && cachedBackendOverview && Date.now() - lastBackendFetchAt < 300000) {
        return;
      }
      lastBackendFetchAt = Date.now();
      void enrollmentApi<MonitorOverview>('staff.monitor')
        .then((res) => {
          if (res && Array.isArray(res.students)) {
            cachedBackendOverview = res;
          }
        })
        .catch(() => {
          backendUnavailableCooldownUntil = Date.now() + 10 * 60 * 1000;
        });
    };

    // Trigger non-blocking cloud function sync for corrections/activity while resolving profiles + descriptors immediately (~200ms)
    triggerBackgroundBackendSync();

    const [rawProfiles, rawDescriptors] = await Promise.all([
      fetchProfiles(),
      fetchDescriptors(),
    ]);

    // Index descriptors by student_id and user_id
    const descriptorCountMap = new Map<string, number>();
    const descriptorPhotos = new Map<string, string>();
    const descriptorSamplesMap = new Map<string, MonitorSample[]>();
    const descriptorLatestAt = new Map<string, number>();

    const addDescriptorRef = (key: string, row: any) => {
      if (!key) return;
      const k = key.trim().toLowerCase();
      if (!k) return;
      descriptorCountMap.set(k, (descriptorCountMap.get(k) || 0) + 1);
      const img = String(row.image_url || '').trim();
      if (img && !descriptorPhotos.has(k)) {
        descriptorPhotos.set(k, img);
      }
      const createdMs = Date.parse(row.created_at || '') || 0;
      if (createdMs > (descriptorLatestAt.get(k) || 0)) {
        descriptorLatestAt.set(k, createdMs);
      }
      const meta = parseMetadataObject(row.metadata);
      const poseLabel = String(meta.pose || row.label || `angle_${(descriptorSamplesMap.get(k)?.length || 0) + 1}`);
      const list = descriptorSamplesMap.get(k) || [];
      if (list.length < 15 && img) {
        list.push({
          pose: poseLabel,
          glasses: meta.glasses === 'with' ? 'with' : 'without',
          fileId: String(row.id || `${k}_${list.length}`),
          brightness: Number(meta.brightness) || 85,
          sharpness: Number(meta.sharpness) || 90,
          imageUrl: img,
        });
        descriptorSamplesMap.set(k, list);
      }
    };

    for (const d of rawDescriptors) {
      if (d.student_id) addDescriptorRef(String(d.student_id), d);
      if (d.user_id) addDescriptorRef(String(d.user_id), d);
    }

    // Index any auxiliary state from cachedBackendOverview (such as pending corrections, active sessions, or samples)
    // WITHOUT injecting deleted/stale students into the roster
    const backendStudentAuxMap = new Map<string, MonitorStudent>();
    if (cachedBackendOverview?.students) {
      for (const s of cachedBackendOverview.students) {
        const key = (s.admission_number || '').trim().toLowerCase();
        if (key) backendStudentAuxMap.set(key, s);
      }
    }

    const baseOverview: MonitorOverview = {
      scope: cachedBackendOverview?.scope || { all: true, classes: [] },
      generatedAt: Date.now(),
      students: [],
      activity: Array.isArray(cachedBackendOverview?.activity) ? [...cachedBackendOverview!.activity] : [],
      corrections: Array.isArray(cachedBackendOverview?.corrections) ? [...cachedBackendOverview!.corrections] : [],
      canManage: cachedBackendOverview?.canManage ?? true,
    };

    const studentMap = new Map<string, MonitorStudent>();

    for (const p of rawProfiles) {
      if (p.role && p.role !== 'student') continue;
      const meta = parseMetadataObject(p.metadata);
      const admission = String(
        p.admission_number ||
          p.employee_id ||
          meta.admission_number ||
          meta.employee_id ||
          meta.student_id_kv ||
          p.roll_number ||
          p.id ||
          ''
      ).trim();
      if (!admission) continue;

      const lowerAdm = admission.toLowerCase();
      const lowerUid = String(p.user_id || p.id || '').trim().toLowerCase();
      const lowerKvId = String(meta.student_id_kv || '').trim().toLowerCase();

      const existing = studentMap.get(lowerAdm);
      const rawClass = String(p.class || meta.class || '').trim();
      const rawSection = String(p.section || meta.section || '').trim();
      const rawCategory = String(p.category || meta.class_section || meta.category || '').trim();
      const category = normalizeClassSection(rawClass, rawSection, rawCategory) || 'Unassigned';

      const fullPhone = String(
        p.parent_phone || p.phone || meta.verified_parent_phone || meta.parent_phone || meta.phone || ''
      ).trim();
      const fatherName = String(p.father_name || p.parent_name || meta.father_name || meta.parent_name || '').trim();
      const motherName = String(meta.mother_name || p.mother_name || '').trim();
      const dob = String(p.date_of_birth || meta.date_of_birth || meta.dob || '').trim();
      const address = String(p.address || meta.address || '').trim();
      const rollNo = String(p.roll_number || meta.roll_number || '').trim();
      const studentIdKv = String(meta.student_id_kv || '').trim();
      const penNumber = String(meta.pen_number || '').trim();
      const bloodGroup = String(p.blood_group || meta.blood_group || '').trim();
      const email = String(p.email || p.parent_email || meta.student_email || meta.parent_email || '').trim();

      const bioSummary = meta.biometric_summary;
      const bioSampleCount = Number(bioSummary?.sample_count) || 0;
      const descCount =
        (descriptorCountMap.get(lowerAdm) || 0) ||
        (lowerUid ? descriptorCountMap.get(lowerUid) || 0 : 0) ||
        (lowerKvId ? descriptorCountMap.get(lowerKvId) || 0 : 0) ||
        bioSampleCount;

      const hasFace =
        descCount > 0 ||
        Boolean(bioSummary?.centroid_descriptor) ||
        Boolean(meta.face_enrolled);

      const avatar =
        p.photo_url ||
        p.avatar_url ||
        meta.photo_url ||
        meta.avatar_url ||
        descriptorPhotos.get(lowerAdm) ||
        (lowerUid ? descriptorPhotos.get(lowerUid) : undefined) ||
        (lowerKvId ? descriptorPhotos.get(lowerKvId) : undefined);

      const fallbackSamples =
        descriptorSamplesMap.get(lowerAdm) ||
        (lowerUid ? descriptorSamplesMap.get(lowerUid) : undefined) ||
        (lowerKvId ? descriptorSamplesMap.get(lowerKvId) : undefined) ||
        [];

      const completedTimestamp =
        descriptorLatestAt.get(lowerAdm) ||
        (lowerUid ? descriptorLatestAt.get(lowerUid) : 0) ||
        (bioSummary?.updated_at ? Date.parse(bioSummary.updated_at) : 0) ||
        0;

      const isImported = Boolean(
        meta.imported_from_pdf ||
          meta.source === 'pdf_upload' ||
          meta.source === 'bulk_id_card'
      );

      if (existing) {
        existing.id = p.id || p.$id || existing.id;
        existing.userId = p.user_id || existing.userId;
        existing.name = p.full_name || p.display_name || meta.name || existing.name || admission;
        existing.class = rawClass || existing.class || (category !== 'Unassigned' ? category.split('-')[0] || '' : '');
        existing.section = rawSection || existing.section || (category.includes('-') ? category.split('-')[1] || '' : '');
        if (!existing.category || existing.category === 'Unassigned') existing.category = category;
        existing.father_name = fatherName || existing.father_name;
        existing.mother_name = motherName || existing.mother_name;
        existing.date_of_birth = dob || existing.date_of_birth;
        existing.address = address || existing.address;
        existing.roll_number = rollNo || existing.roll_number;
        existing.student_id_kv = studentIdKv || existing.student_id_kv;
        existing.pen_number = penNumber || existing.pen_number;
        existing.blood_group = bloodGroup || existing.blood_group;
        existing.email = email || existing.email;
        if (fullPhone) {
          existing.parent_phone_full = fullPhone;
          existing.parent_phone = fullPhone;
          existing.hasPhone = true;
        }
        if (dob) existing.hasDob = true;
        if (fatherName) existing.hasFather = true;
        if (motherName) existing.hasMother = true;
        if (address) existing.hasAddress = true;
        if (isImported) existing.imported = true;
        if (avatar && !existing.avatarUrl) existing.avatarUrl = avatar;
        if (avatar) existing.portrait = true;
        if (!existing.samples?.length && fallbackSamples.length) {
          existing.samples = fallbackSamples;
        }
        existing.vectorCount = Math.max(descCount, existing.samples?.length || 0);
        if (hasFace || existing.completedAt > 0 || existing.samples.length > 0) {
          existing.faceOnFile = true;
          if (existing.status === 'not_started' || existing.status === 'failed') {
            existing.status = 'completed';
          }
          if (!existing.completedAt && completedTimestamp) {
            existing.completedAt = completedTimestamp;
          }
        }
      } else {
        const backendAux = backendStudentAuxMap.get(lowerAdm);
        const mergedSamples = fallbackSamples.length
          ? fallbackSamples
          : backendAux?.samples || [];
        const effectiveFace = hasFace || Boolean(backendAux?.faceOnFile) || mergedSamples.length > 0;
        const effectiveStatus: MonitorStatus = effectiveFace
          ? 'completed'
          : backendAux?.status && backendAux.status !== 'completed'
          ? backendAux.status
          : 'not_started';

        const newStudent: MonitorStudent = {
          id: p.id || p.$id,
          userId: p.user_id || p.id || p.$id,
          admission_number: admission,
          student_id_kv: studentIdKv,
          roll_number: rollNo,
          pen_number: penNumber,
          blood_group: bloodGroup,
          name: p.full_name || p.display_name || meta.name || backendAux?.name || admission,
          class: rawClass || (category !== 'Unassigned' ? category.split('-')[0] || '' : ''),
          section: rawSection || (category.includes('-') ? category.split('-')[1] || '' : ''),
          category,
          father_name: fatherName || backendAux?.father_name || '',
          mother_name: motherName || backendAux?.mother_name || '',
          date_of_birth: dob || backendAux?.date_of_birth || '',
          address: address || backendAux?.address || '',
          parent_phone: fullPhone || backendAux?.parent_phone_full || backendAux?.parent_phone || '',
          parent_phone_full: fullPhone || backendAux?.parent_phone_full || '',
          email,
          hasPhone: Boolean(fullPhone || backendAux?.hasPhone),
          hasDob: Boolean(dob || backendAux?.hasDob),
          hasFather: Boolean(fatherName || backendAux?.hasFather),
          hasMother: Boolean(motherName),
          hasAddress: Boolean(address),
          status: effectiveStatus,
          imported: isImported || Boolean(backendAux?.imported),
          portrait: Boolean(avatar || backendAux?.portrait),
          faceOnFile: effectiveFace,
          vectorCount: Math.max(descCount, mergedSamples.length),
          samples: mergedSamples,
          method: backendAux?.method || (effectiveFace ? 'staff' : ''),
          verifiedAt: completedTimestamp || backendAux?.verifiedAt || 0,
          completedAt: completedTimestamp || backendAux?.completedAt || 0,
          failures: backendAux?.failures || 0,
          correction: backendAux?.correction || null,
          inProgress: backendAux?.inProgress,
          lastActivity:
            Date.parse(p.updated_at || p.created_at || '') ||
            completedTimestamp ||
            backendAux?.lastActivity ||
            0,
          avatarUrl: avatar || backendAux?.avatarUrl,
          profilePhotoUrl: p.photo_url || p.avatar_url || undefined,
        };
        studentMap.set(lowerAdm, newStudent);
        baseOverview.students.push(newStudent);
      }
    }

    // Include any students present in face_descriptors whose profile wasn't matched by admission_number
    const knownUserIds = new Set(
      baseOverview.students.map((s) => (s.userId || '').toLowerCase()).filter(Boolean)
    );
    for (const d of rawDescriptors) {
      const sId = String(d.student_id || '').trim();
      const uId = String(d.user_id || '').trim().toLowerCase();
      if (!sId || sId.length > 36 || sId.startsWith('unknown')) continue;
      const lower = sId.toLowerCase();
      if (studentMap.has(lower) || (uId && knownUserIds.has(uId))) {
        const student = studentMap.get(lower);
        if (student) {
          student.faceOnFile = true;
          if (student.status === 'not_started' || student.status === 'failed') {
            student.status = 'completed';
          }
          if (!student.completedAt) student.completedAt = Date.parse(d.created_at || '') || 0;
          if (!student.avatarUrl && d.image_url) student.avatarUrl = d.image_url;
        }
      } else {
        const name = d.student_name || (d.label && d.label !== 'Trained Student' ? d.label : sId);
        const category = normalizeClassSection(d.class, d.section, d.category) || 'Unassigned';
        const fallbackSamples = descriptorSamplesMap.get(lower) || [];
        const newStudent: MonitorStudent = {
          userId: d.user_id,
          admission_number: sId,
          name,
          class: d.class || '',
          section: d.section || '',
          category,
          parent_phone: '',
          hasPhone: false,
          hasDob: false,
          hasFather: false,
          status: 'completed',
          imported: false,
          portrait: Boolean(d.image_url),
          faceOnFile: true,
          vectorCount: descriptorCountMap.get(lower) || 1,
          samples: fallbackSamples,
          method: 'staff',
          verifiedAt: Date.parse(d.created_at || '') || 0,
          completedAt: Date.parse(d.created_at || '') || 0,
          failures: 0,
          correction: null,
          lastActivity: Date.parse(d.created_at || '') || 0,
          avatarUrl: d.image_url,
        };
        studentMap.set(lower, newStudent);
        if (uId) knownUserIds.add(uId);
        baseOverview.students.push(newStudent);
      }
    }

    // Resolve any relative storage paths to full URLs
    await Promise.all(
      baseOverview.students.map(async (student) => {
        for (const field of ['avatarUrl', 'primaryPhotoUrl', 'profilePhotoUrl'] as const) {
          const val = student[field];
          if (val && !val.startsWith('http') && !val.startsWith('data:')) {
            student[field] = await resolveStudentPhotoUrl(val);
          }
        }
      })
    );

    const allDiscoveredCategories = Array.from(
      new Set(baseOverview.students.map((s) => s.category).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (baseOverview.scope.all || baseOverview.scope.classes.length === 0) {
      baseOverview.scope = { all: true, classes: allDiscoveredCategories };
    }
    baseOverview.generatedAt = Date.now();

    saveCachedMonitorOverview(baseOverview);
    return baseOverview;
  };

  inFlightMonitorRequest = runFetch().finally(() => {
    inFlightMonitorRequest = null;
  });
  return inFlightMonitorRequest;
};

export const fetchMonitorPhoto = async (admission: string, fileId: string): Promise<string> => {
  if (!fileId) return '';
  if (fileId.startsWith('http://') || fileId.startsWith('https://') || fileId.startsWith('data:')) {
    return fileId;
  }
  if (/^[a-f0-9]{20,36}$/i.test(fileId)) {
    const { getAppwriteStorageViewUrl, APPWRITE_CONFIG } = await import('@/integrations/appwrite/client');
    return getAppwriteStorageViewUrl(APPWRITE_CONFIG.buckets.studentRegistrationFaces, fileId);
  }
  return enrollmentApi<{ image: string }>('staff.photo', { admission, fileId }).then((r) => r.image);
};

export const reviewCorrection = (id: string, approve: boolean) =>
  enrollmentApi('staff.review', { id, approve });

export async function updateStudentProfileDetails(
  admissionNumber: string,
  updates: {
    name?: string;
    class?: string;
    section?: string;
    roll_number?: string;
    father_name?: string;
    mother_name?: string;
    date_of_birth?: string;
    parent_phone?: string;
    blood_group?: string;
    pen_number?: string;
    student_id_kv?: string;
    address?: string;
  }
): Promise<void> {
  const adm = admissionNumber.trim();
  const { data: existingRows } = await supabase
    .from('profiles')
    .select('id, metadata')
    .or(`admission_number.eq.${adm},employee_id.eq.${adm}`)
    .limit(1);

  const existingRow = existingRows?.[0];
  const prevMeta = parseMetadataObject(existingRow?.metadata);

  const cleanClass = (updates.class ?? '').trim();
  const cleanSection = (updates.section ?? '').trim().toUpperCase();
  const category = [cleanClass, cleanSection].filter(Boolean).join('-') || null;
  const rawPhone = String(updates.parent_phone ?? '').replace(/\D/g, '');
  const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;

  const mergedMeta: Record<string, any> = {
    ...prevMeta,
    father_name: updates.father_name?.trim() ?? prevMeta.father_name ?? '',
    mother_name: updates.mother_name?.trim() ?? prevMeta.mother_name ?? '',
    date_of_birth: updates.date_of_birth?.trim() ?? prevMeta.date_of_birth ?? '',
    blood_group: updates.blood_group?.trim() ?? prevMeta.blood_group ?? '',
    pen_number: updates.pen_number?.trim() ?? prevMeta.pen_number ?? '',
    student_id_kv: updates.student_id_kv?.trim() ?? prevMeta.student_id_kv ?? '',
    roll_number: updates.roll_number?.trim() ?? prevMeta.roll_number ?? '',
    address: updates.address?.trim() ?? prevMeta.address ?? '',
    verified_parent_phone: cleanPhone || prevMeta.verified_parent_phone || '',
  };

  for (const k of Object.keys(mergedMeta)) {
    if (mergedMeta[k] === '' || mergedMeta[k] == null) delete mergedMeta[k];
  }

  const payload: Record<string, any> = {
    full_name: updates.name?.trim() || undefined,
    display_name: updates.name?.trim() || undefined,
    admission_number: adm,
    employee_id: adm,
    class: cleanClass || null,
    section: cleanSection || null,
    category,
    roll_number: updates.roll_number?.trim() || null,
    father_name: updates.father_name?.trim() || null,
    parent_name: updates.father_name?.trim() || updates.mother_name?.trim() || null,
    parent_phone: cleanPhone || null,
    phone: cleanPhone || null,
    blood_group: updates.blood_group?.trim() || null,
    address: updates.address?.trim() || null,
    role: 'student',
    metadata: JSON.stringify(mergedMeta),
    updated_at: new Date().toISOString(),
  };

  if (existingRow?.id) {
    const { error } = await supabase.from('profiles').update(payload).eq('id', existingRow.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('profiles').upsert([payload], { onConflict: 'admission_number' });
    if (error) throw error;
  }

  clearMonitorCache();
}

export const statusMeta: Record<MonitorStatus, { label: string; tone: string; dot: string }> = {
  completed: {
    label: 'Face Enrolled',
    tone: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  capturing: {
    label: 'Capturing',
    tone: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
    dot: 'bg-cyan-400',
  },
  verified: {
    label: 'Verified',
    tone: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
    dot: 'bg-indigo-400',
  },
  failed: {
    label: 'Failed Check',
    tone: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
    dot: 'bg-rose-400',
  },
  not_started: {
    label: 'Pending Scan',
    tone: 'text-amber-300/90 bg-amber-500/10 border-amber-500/25',
    dot: 'bg-amber-400',
  },
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
