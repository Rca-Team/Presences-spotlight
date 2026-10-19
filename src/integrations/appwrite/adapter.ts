import { storageFileId } from './storage-id';
import { canMakeCloudRequest, triggerCloudCooldown, isCloudInCooldown } from '@/services/cloud-safety/CloudQuotaGuard';
import { Query, ID, OAuthProvider, Permission, Role, Channel } from 'appwrite';
import {
  appwriteClient,
  databases,
  account,
  storage,
  functions,
  realtime,
  APPWRITE_CONFIG,
  getAppwriteStorageViewUrl,
  getAppwriteStorageDownloadUrl,
  getAppwriteStoragePreviewUrl,
  type ImageTransformOptions
} from './client';

const DATABASE_ID = APPWRITE_CONFIG.databaseId;

// Sanitize legacy URLs
function sanitizeImageUrl(url: any): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.includes('supabase.co')) {
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*?)(?:\?|$)/);
    if (match) {
      const bucket = match[1];
      const fileId = storageFileId(decodeURIComponent(match[2]));
      return getAppwriteStorageViewUrl(bucket, fileId, APPWRITE_CONFIG.projectId);
    }
  }
  if (url.includes('6abfd34f000604fcf074') || url.includes('6accbd5d00053c5c1ac2')) {
    return url
      .replace(/6abfd34f000604fcf074/g, APPWRITE_CONFIG.projectId)
      .replace(/6accbd5d00053c5c1ac2/g, APPWRITE_CONFIG.projectId);
  }
  return url;
}

// Document normalization helper
function normalizeDoc(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;
  const normalized = { ...doc };
  if (normalized.$id && !normalized.id) {
    normalized.id = normalized.$id;
  }
  normalized.created_at ??= normalized.$createdAt;
  normalized.updated_at ??= normalized.$updatedAt;
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string' && /^[\[{]/.test(value)) {
      try { normalized[key] = JSON.parse(value); } catch {}
    }
  }
  if (normalized.avatar_url) normalized.avatar_url = sanitizeImageUrl(normalized.avatar_url);
  if (normalized.image_url) normalized.image_url = sanitizeImageUrl(normalized.image_url);
  if (normalized.photo_url) normalized.photo_url = sanitizeImageUrl(normalized.photo_url);

  // Parse JSON strings if necessary
  if (typeof normalized.device_info === 'string') {
    try { normalized.device_info = JSON.parse(normalized.device_info); } catch (_) {}
  }
  if (normalized.device_info?.metadata && typeof normalized.device_info.metadata === 'object') {
    const metadata = { ...normalized.device_info.metadata };
    for (const key of ['firebase_image_url', 'avatar_url', 'photo_url', 'id_card_photo_url', 'primary_photo_url']) {
      if (metadata[key]) metadata[key] = sanitizeImageUrl(metadata[key]);
    }
    if (metadata.face_model && typeof metadata.face_model === 'object') {
      metadata.face_model = { ...metadata.face_model };
      if (metadata.face_model.id_card_photo_url) metadata.face_model.id_card_photo_url = sanitizeImageUrl(metadata.face_model.id_card_photo_url);
    }
    normalized.device_info = { ...normalized.device_info, metadata };
  }
  if (typeof normalized.descriptor === 'string' && (normalized.descriptor.startsWith('[') || normalized.descriptor.startsWith('{'))) {
    try {
      normalized.descriptor = JSON.parse(normalized.descriptor);
    } catch (_) {}
  }
  if (typeof normalized.metadata === 'string' && (normalized.metadata.startsWith('{') || normalized.metadata.startsWith('['))) {
    try {
      normalized.metadata = JSON.parse(normalized.metadata);
    } catch (_) {}
  }
  return normalized;
}

// Convert column name if needed ($id <-> id)
function mapColumnName(col: string): string {
  if (col === 'id') return '$id';
  return col;
}

function sanitizeDocForSave(data: any): any {
  const clean = { ...data };
  delete clean.id;
  delete clean.$id;
  delete clean.$createdAt;
  delete clean.$updatedAt;
  delete clean.$permissions;
  delete clean.$databaseId;
  delete clean.$collectionId;
  for (const [key, value] of Object.entries(clean)) {
    if (value !== null && typeof value === 'object') clean[key] = JSON.stringify(value);
  }
  return clean;
}

interface CacheEntry {
  data: { documents: any[]; total: number };
  expiresAt: number;
}

const queryCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<{ documents: any[]; total: number }>>();
const supabaseFallbackCache = new Map<string, { rows: any[]; expiresAt: number }>();
const supabaseFallbackInFlight = new Map<string, Promise<any[]>>();
let appwriteReadQuotaCooldownUntil = 0;
const QUOTA_STORAGE_KEY = 'presences_appwrite_quota_frozen_until';

// Clear legacy quota locks on startup to ensure active Appwrite Cloud Education plan is used directly
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(QUOTA_STORAGE_KEY);
    sessionStorage.removeItem(QUOTA_STORAGE_KEY);
  }
} catch {}

export function getAppwriteQuotaCooldownUntil(): number {
  return appwriteReadQuotaCooldownUntil;
}

export function setAppwriteQuotaCooldown(durationMs = 8 * 1000) {
  const safeDuration = Math.min(Math.max(1000, durationMs), 15000);
  const until = Date.now() + safeDuration;
  appwriteReadQuotaCooldownUntil = until;
}

export function isAppwriteQuotaLimitError(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    err?.code === 402 ||
    err?.status === 402 ||
    err?.type === 'limit_databases_reads_exceeded' ||
    err?.type === 'billing_limit_exceeded' ||
    err?.type === 'general_plan_limit_exceeded' ||
    msg.includes('Database reads limit') ||
    msg.includes('billing cycle') ||
    msg.includes('budget cap') ||
    msg.includes('Resource limit') ||
    msg.includes('Payment Required')
  );
}

function getSupabaseFallbackConfig(): { url: string; key: string } {
  let url = 'https://cvdcbcsonlianbfeessy.supabase.co';
  let key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';
  try {
    const getMetaEnv = new Function('try { return import.meta.env; } catch(e) { return null; }');
    const env = getMetaEnv();
    if (env?.VITE_SUPABASE_URL) url = env.VITE_SUPABASE_URL;
    if (env?.VITE_SUPABASE_ANON_KEY) key = env.VITE_SUPABASE_ANON_KEY;
  } catch {}
  return { url: url.replace(/\/$/, ''), key };
}

function resolveStorageUrlOrPath(rawUrl: any, defaultBucket = 'face-images'): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.includes('appwrite.io') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.includes('supabase.co')) {
    return sanitizeImageUrl(trimmed);
  }
  if (trimmed.startsWith('faces/') || trimmed.startsWith('attendance/') || trimmed.startsWith('public/')) {
    return getAppwriteStorageViewUrl(defaultBucket, storageFileId(trimmed));
  }
  return trimmed;
}

function loadLocalOverlayDocs(collectionName: string): Record<string, any> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`presences_fallback_docs_${collectionName}`);
      if (raw) return JSON.parse(raw) || {};
    }
  } catch {}
  return {};
}

function saveLocalOverlayDoc(collectionName: string, id: string, doc: any | null) {
  try {
    if (typeof localStorage !== 'undefined') {
      const map = loadLocalOverlayDocs(collectionName);
      if (doc === null) {
        map[id] = { __deleted: true };
      } else {
        map[id] = { ...(map[id] || {}), ...doc, $id: id, id };
      }
      localStorage.setItem(`presences_fallback_docs_${collectionName}`, JSON.stringify(map));
    }
  } catch {}
}

const SUPABASE_MIRROR_TABLES = new Set([
  'profiles',
  'face_descriptors',
  'attendance_records',
  'timetable',
  'attendance_settings',
  'emergency_events',
  'user_roles',
  'notifications',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractUnknownAttrFromError(err: any): string | null {
  const msg = String(err?.message || '');
  const m = msg.match(/Unknown attribute:\s*"?([a-zA-Z0-9_]+)"?/i);
  if (m?.[1]) return m[1];
  const m2 = msg.match(/Attribute\s+"?([a-zA-Z0-9_]+)"?\s+has invalid/i);
  if (m2?.[1]) return m2[1];
  return null;
}

async function createDocumentWithSchemaRetry(collectionName: string, docId: string, initialPayload: Record<string, any>): Promise<any> {
  const payload = { ...initialPayload };
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await databases.createDocument(DATABASE_ID, collectionName, docId, payload);
    } catch (err: any) {
      const unknownAttr = extractUnknownAttrFromError(err);
      if (unknownAttr && unknownAttr in payload) {
        delete payload[unknownAttr];
        continue;
      }
      throw err;
    }
  }
  return await databases.createDocument(DATABASE_ID, collectionName, docId, payload);
}

async function updateDocumentWithSchemaRetry(collectionName: string, docId: string, initialPayload: Record<string, any>): Promise<any> {
  const payload = { ...initialPayload };
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await databases.updateDocument(DATABASE_ID, collectionName, docId, payload);
    } catch (err: any) {
      const unknownAttr = extractUnknownAttrFromError(err);
      if (unknownAttr && unknownAttr in payload) {
        delete payload[unknownAttr];
        continue;
      }
      throw err;
    }
  }
  return await databases.updateDocument(DATABASE_ID, collectionName, docId, payload);
}

function prepareSupabaseMirrorRow(collectionName: string, raw: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('$') || v === undefined) continue;
    if (k === 'id' && !UUID_REGEX.test(String(v || ''))) continue;
    if (k === 'user_id' && !UUID_REGEX.test(String(v || ''))) continue;
    if ((k === 'metadata' || k === 'device_info') && typeof v === 'string') {
      try {
        row[k] = JSON.parse(v);
        continue;
      } catch {}
    }
    row[k] = v;
  }
  if (collectionName === 'face_descriptors' && row.descriptor && typeof row.descriptor !== 'string') {
    row.descriptor = JSON.stringify(row.descriptor);
  }
  return row;
}

async function mirrorMutationToSupabase(
  collectionName: string,
  kind: 'insert' | 'upsert' | 'update' | 'delete',
  docOrId: any,
  patchData?: Record<string, any>
): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  if ((import.meta as any)?.env?.VITE_ENABLE_SUPABASE_MIRROR !== 'true') return;
  if (!SUPABASE_MIRROR_TABLES.has(collectionName)) return;
  const { url, key } = getSupabaseFallbackConfig();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  try {
    if (kind === 'insert' || kind === 'upsert') {
      const row = prepareSupabaseMirrorRow(collectionName, docOrId);
      if (Object.keys(row).length === 0) return;
      await fetch(`${url}/rest/v1/${collectionName}`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
      });
    } else if (kind === 'update') {
      const row = prepareSupabaseMirrorRow(collectionName, patchData || docOrId);
      delete row.id;
      if (Object.keys(row).length === 0) return;
      const docId = String(docOrId?.id || docOrId?.$id || '');
      const adm = String(docOrId?.admission_number || docOrId?.employee_id || '').trim();
      if (UUID_REGEX.test(docId)) {
        await fetch(`${url}/rest/v1/${collectionName}?id=eq.${encodeURIComponent(docId)}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(row),
        });
      } else if (collectionName === 'profiles' && adm) {
        await fetch(`${url}/rest/v1/profiles?or=(admission_number.eq.${encodeURIComponent(adm)},employee_id.eq.${encodeURIComponent(adm)})`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(row),
        });
      }
    } else if (kind === 'delete') {
      const docId = String(docOrId?.id || docOrId?.$id || docOrId || '');
      const studentId = String(docOrId?.student_id || '').trim();
      if (UUID_REGEX.test(docId)) {
        await fetch(`${url}/rest/v1/${collectionName}?id=eq.${encodeURIComponent(docId)}`, {
          method: 'DELETE',
          headers,
        });
      } else if (collectionName === 'face_descriptors' && studentId) {
        await fetch(`${url}/rest/v1/face_descriptors?student_id=eq.${encodeURIComponent(studentId)}`, {
          method: 'DELETE',
          headers,
        });
      }
    }
  } catch {
    // Non-blocking cloud mirror
  }
}

function enrichSupabaseProfileDoc(raw: any): any {
  const doc = normalizeDoc(raw);
  const meta = (doc.metadata && typeof doc.metadata === 'object') ? doc.metadata : {};
  doc.$id ??= doc.id || doc.user_id;
  doc.id ??= doc.$id;
  doc.full_name ??= doc.display_name || meta.name || meta.full_name || null;
  doc.display_name ??= doc.full_name || null;
  doc.roll_number ??= meta.roll_number || meta.position || doc.position || null;
  doc.employee_id ??= meta.employee_id || meta.admission_number || doc.admission_number || doc.roll_number || null;
  doc.admission_number ??= doc.employee_id || meta.admission_number || meta.employee_id || doc.roll_number || null;
  doc.parent_phone ??= meta.parent_phone || doc.phone || meta.phone || null;
  doc.phone ??= doc.parent_phone;
  doc.parent_name ??= meta.parent_name || doc.father_name || meta.father_name || null;
  doc.father_name ??= doc.parent_name;
  doc.address ??= meta.address || null;
  doc.email ??= meta.student_email || doc.parent_email || meta.parent_email || null;
  if (!doc.class && meta.class_section) {
    const parts = String(meta.class_section).split('-');
    doc.class = parts[0] || null;
    doc.section ??= parts[1] || null;
  }
  doc.category ??= meta.class_section || meta.department || (doc.class && doc.section ? `${doc.class}-${doc.section}` : doc.class || null);
  doc.avatar_url = resolveStorageUrlOrPath(doc.avatar_url || doc.photo_url || meta.avatar_url || meta.photo_url);
  doc.photo_url ??= doc.avatar_url;
  return doc;
}

async function fetchSupabaseTableRaw(tableName: string, queryParams = 'select=*&limit=2000'): Promise<any[]> {
  if (typeof fetch !== 'function') return [];
  const { url, key } = getSupabaseFallbackConfig();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/${tableName}?${queryParams}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } catch {
      // Retry once on transient network error
    }
  }
  return [];
}

async function fetchSupabaseFallbackCollection(collectionName: string): Promise<any[]> {
  const cached = supabaseFallbackCache.get(collectionName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }
  if (supabaseFallbackInFlight.has(collectionName)) {
    return supabaseFallbackInFlight.get(collectionName)!;
  }

  const promise = (async () => {
    try {
      let rows: any[] = [];
      if (collectionName === 'profiles') {
        const [rawProfiles, rawAtt] = await Promise.all([
          fetchSupabaseTableRaw('profiles', 'select=*&limit=500'),
          fetchSupabaseTableRaw('attendance_records', 'select=*&status=eq.registered&limit=500'),
        ]);
        const byKey = new Map<string, any>();
        for (const p of rawProfiles) {
          const enriched = enrichSupabaseProfileDoc(p);
          const key = String(enriched.admission_number || enriched.user_id || enriched.id || '').trim().toLowerCase();
          if (key) byKey.set(key, enriched);
          rows.push(enriched);
        }
        for (const r of rawAtt) {
          if (r.status !== 'registered') continue;
          const normR = normalizeDoc(r);
          const meta = normR.device_info?.metadata || {};
          const empId = String(meta.employee_id || meta.admission_number || normR.student_id || meta.roll_number || '').trim();
          const name = String(meta.name || meta.full_name || empId || '').trim();
          if (!empId && !name) continue;
          const clsSec = String(meta.class_section || meta.department || normR.category || '').trim();
          const [cls, sec] = clsSec.includes('-') ? clsSec.split('-') : [meta.class || clsSec, meta.section || ''];
          const primaryPhoto = meta.training_registration_path
            ? getAppwriteStorageViewUrl('student-registration-faces', storageFileId(meta.training_registration_path))
            : resolveStorageUrlOrPath(normR.image_url || meta.firebase_image_url || meta.face_model?.id_card_photo_url);
          const existing = (empId && byKey.get(empId.toLowerCase())) || (normR.user_id && byKey.get(String(normR.user_id).toLowerCase()));
          if (existing) {
            existing.full_name ??= name || null;
            existing.display_name ??= name || null;
            existing.admission_number ??= empId || null;
            existing.employee_id ??= empId || null;
            existing.roll_number ??= meta.roll_number || meta.position || empId || null;
            existing.class ??= cls || null;
            existing.section ??= sec || null;
            existing.category ??= clsSec || null;
            existing.parent_phone ??= meta.parent_phone || meta.phone || null;
            existing.phone ??= existing.parent_phone;
            existing.parent_name ??= meta.parent_name || null;
            existing.father_name ??= meta.parent_name || null;
            existing.address ??= meta.address || null;
            existing.blood_group ??= meta.blood_group || null;
            existing.avatar_url ??= primaryPhoto || null;
            existing.photo_url ??= resolveStorageUrlOrPath(meta.face_model?.id_card_photo_url) || primaryPhoto || null;
            existing.role ??= 'student';
          } else {
            const synthId = normR.user_id || normR.id || empId;
            const synth = enrichSupabaseProfileDoc({
              $id: synthId,
              id: synthId,
              user_id: normR.user_id || synthId,
              full_name: name,
              display_name: name,
              admission_number: empId,
              employee_id: empId,
              roll_number: meta.roll_number || meta.position || empId,
              class: cls || '',
              section: sec || '',
              category: clsSec || '',
              parent_name: meta.parent_name || '',
              father_name: meta.parent_name || '',
              parent_phone: meta.parent_phone || meta.phone || '',
              phone: meta.parent_phone || meta.phone || '',
              parent_email: meta.parent_email || meta.student_email || '',
              email: meta.student_email || meta.parent_email || '',
              address: meta.address || '',
              blood_group: meta.blood_group || '',
              role: 'student',
              avatar_url: primaryPhoto,
              photo_url: resolveStorageUrlOrPath(meta.face_model?.id_card_photo_url) || primaryPhoto,
              metadata: meta,
              created_at: normR.created_at,
              updated_at: normR.updated_at || normR.created_at,
            });
            if (empId) byKey.set(empId.toLowerCase(), synth);
            rows.push(synth);
          }
        }
      } else if (collectionName === 'face_descriptors') {
        const [rawDesc, mergedProfiles] = await Promise.all([
          fetchSupabaseTableRaw('face_descriptors'),
          fetchSupabaseFallbackCollection('profiles'),
        ]);
        const userToStudentId = new Map<string, string>();
        const nameToStudentId = new Map<string, string>();
        for (const p of mergedProfiles) {
          const adm = String(p.admission_number || p.employee_id || '').trim();
          if (adm) {
            if (p.user_id) userToStudentId.set(String(p.user_id).trim(), adm);
            if (p.id) userToStudentId.set(String(p.id).trim(), adm);
            if (p.full_name) nameToStudentId.set(String(p.full_name).trim().toLowerCase(), adm);
          }
        }
        rows = rawDesc.map(d => {
          const norm = normalizeDoc(d);
          norm.$id ??= norm.id;
          norm.image_url = resolveStorageUrlOrPath(norm.image_url);
          norm.student_id ??=
            (norm.user_id ? userToStudentId.get(String(norm.user_id).trim()) : undefined) ||
            (norm.label ? nameToStudentId.get(String(norm.label).trim().toLowerCase()) : undefined) ||
            null;
          return norm;
        });
      } else {
        const rawRows = await fetchSupabaseTableRaw(collectionName);
        rows = rawRows.map(r => {
          const norm = normalizeDoc(r);
          norm.$id ??= norm.id;
          if (norm.image_url) norm.image_url = resolveStorageUrlOrPath(norm.image_url);
          if (norm.avatar_url) norm.avatar_url = resolveStorageUrlOrPath(norm.avatar_url);
          if (norm.photo_url) norm.photo_url = resolveStorageUrlOrPath(norm.photo_url);
          return norm;
        });
      }

      // Apply local mutation overlay
      const overlay = loadLocalOverlayDocs(collectionName);
      if (Object.keys(overlay).length > 0) {
        const map = new Map<string, any>();
        for (const r of rows) {
          const id = String(r.$id || r.id || '');
          if (id) map.set(id, r);
        }
        for (const [id, item] of Object.entries(overlay)) {
          if (item?.__deleted) {
            map.delete(id);
          } else {
            const existing = map.get(id) || {};
            map.set(id, normalizeDoc({ ...existing, ...item, $id: id, id }));
          }
        }
        rows = Array.from(map.values());
      }

      if (rows.length > 0) {
        supabaseFallbackCache.set(collectionName, { rows, expiresAt: Date.now() + 20000 });
      }
      return rows;
    } finally {
      supabaseFallbackInFlight.delete(collectionName);
    }
  })();

  supabaseFallbackInFlight.set(collectionName, promise);
  return promise;
}

function getDocFieldValue(doc: any, attr: string): any {
  if (!doc || typeof doc !== 'object') return undefined;
  if (attr === '$id' || attr === 'id') return doc.$id ?? doc.id;
  if (attr === '$createdAt' || attr === 'created_at') return doc.created_at ?? doc.$createdAt;
  if (attr === '$updatedAt' || attr === 'updated_at') return doc.updated_at ?? doc.$updatedAt;
  return doc[attr];
}

function matchesParsedQuery(doc: any, q: any): boolean {
  if (!q || typeof q !== 'object') return true;
  const method = q.method;
  const attr = q.attribute;
  const values: any[] = Array.isArray(q.values) ? q.values : [];
  const val = attr ? getDocFieldValue(doc, attr) : undefined;

  if (method === 'equal') {
    return values.some(v => {
      if (val === v) return true;
      if (val !== null && val !== undefined && v !== null && v !== undefined) {
        return String(val).trim().toLowerCase() === String(v).trim().toLowerCase();
      }
      return false;
    });
  }
  if (method === 'notEqual') {
    return !values.some(v => val === v || (val != null && v != null && String(val).trim().toLowerCase() === String(v).trim().toLowerCase()));
  }
  if (method === 'isNull') return val === null || val === undefined || val === '';
  if (method === 'isNotNull') return val !== null && val !== undefined && val !== '';
  if (method === 'greaterThan') return val != null && val > values[0];
  if (method === 'greaterThanEqual') return val != null && val >= values[0];
  if (method === 'lessThan') return val != null && val < values[0];
  if (method === 'lessThanEqual') return val != null && val <= values[0];
  if (method === 'search' || method === 'contains') {
    const hay = typeof val === 'object' ? JSON.stringify(val || '').toLowerCase() : String(val ?? '').toLowerCase();
    return values.some(v => hay.includes(String(v ?? '').toLowerCase()));
  }
  if (method === 'or') {
    return values.some(sub => {
      const parsedSub = typeof sub === 'string' ? JSON.parse(sub) : sub;
      return matchesParsedQuery(doc, parsedSub);
    });
  }
  if (method === 'and') {
    return values.every(sub => {
      const parsedSub = typeof sub === 'string' ? JSON.parse(sub) : sub;
      return matchesParsedQuery(doc, parsedSub);
    });
  }
  return true;
}

async function querySupabaseFallback(collectionName: string, queries: string[], all: boolean): Promise<{ documents: any[]; total: number }> {
  const allRows = await fetchSupabaseFallbackCollection(collectionName);
  const parsedQueries = queries.map(q => {
    try { return typeof q === 'string' ? JSON.parse(q) : q; } catch { return null; }
  }).filter(Boolean);

  let matched = allRows.filter(doc => parsedQueries.every(q => matchesParsedQuery(doc, q)));

  const orderQueries = parsedQueries.filter(q => q.method === 'orderAsc' || q.method === 'orderDesc');
  if (orderQueries.length > 0) {
    matched = [...matched].sort((a, b) => {
      for (const oq of orderQueries) {
        const av = getDocFieldValue(a, oq.attribute) ?? '';
        const bv = getDocFieldValue(b, oq.attribute) ?? '';
        if (av < bv) return oq.method === 'orderAsc' ? -1 : 1;
        if (av > bv) return oq.method === 'orderAsc' ? 1 : -1;
      }
      return 0;
    });
  }

  const total = matched.length;
  if (all) {
    return { documents: matched, total };
  }

  const offsetQ = parsedQueries.find(q => q.method === 'offset');
  const limitQ = parsedQueries.find(q => q.method === 'limit');
  const offset = offsetQ?.values?.[0] || 0;
  const limit = limitQ?.values?.[0] ?? 100;

  return {
    documents: matched.slice(offset, offset + limit),
    total,
  };
}

export function invalidateCollectionCache(collectionName?: string) {
  if (!collectionName) {
    queryCache.clear();
    supabaseFallbackCache.clear();
    return;
  }
  supabaseFallbackCache.delete(collectionName);
  for (const key of queryCache.keys()) {
    if (key.startsWith(`${collectionName}:`)) {
      queryCache.delete(key);
    }
  }
}

export class AppwriteQueryBuilder<T = any> implements PromiseLike<{ data: T | null; error: any; count?: number }> {
  private collectionName: string;
  private queries: string[] = [];
  private isSingle = false;
  private isMaybeSingle = false;
  private countMode: 'exact' | 'planned' | 'estimated' | null = null;
  private selectedFields: string[] = [];
  private emptyResult = false;
  private headOnly = false;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  select(fields = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    this.headOnly = options?.head ?? false;
    if (fields && fields !== '*') {
      const fieldList = fields.split(',').map(f => f.trim().replace(/:.*/, ''));
      const validFields = fieldList.filter(f => f && !f.includes('(') && !f.includes(')'));
      if (validFields.length > 0) {
        this.selectedFields = validFields;
      }
    }
    if (options?.count) {
      this.countMode = options.count;
    }
    return this;
  }

  eq(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null || value === undefined) {
      this.queries.push(Query.isNull(col));
    } else {
      this.queries.push(Query.equal(col, value));
    }
    return this;
  }

  neq(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null || value === undefined) {
      this.queries.push(Query.isNotNull(col));
    } else {
      this.queries.push(Query.notEqual(col, value));
    }
    return this;
  }

  gt(column: string, value: any): this {
    this.queries.push(Query.greaterThan(mapColumnName(column), value));
    return this;
  }

  gte(column: string, value: any): this {
    this.queries.push(Query.greaterThanEqual(mapColumnName(column), value));
    return this;
  }

  lt(column: string, value: any): this {
    this.queries.push(Query.lessThan(mapColumnName(column), value));
    return this;
  }

  lte(column: string, value: any): this {
    this.queries.push(Query.lessThanEqual(mapColumnName(column), value));
    return this;
  }

  in(column: string, values: any[]): this {
    if (Array.isArray(values) && values.length > 0) {
      this.queries.push(Query.equal(mapColumnName(column), values));
    } else this.emptyResult = true;
    return this;
  }

  contains(column: string, values: any): this {
    const mappedCol = mapColumnName(column);
    const rawList = Array.isArray(values) ? values : [values];
    const cleanList: (string | number | boolean)[] = [];
    let extractedUserId: string | null = null;

    for (const val of rawList) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        cleanList.push(val);
      } else if (val && typeof val === 'object') {
        const candidate = (val as any).employee_id || (val as any).student_id || (val as any).user_id || (val as any).metadata?.employee_id || (val as any).metadata?.student_id;
        if (candidate && typeof candidate === 'string') {
          extractedUserId = candidate;
        }
      }
    }

    if (mappedCol === 'device_info' && extractedUserId) {
      // In Appwrite, device_info string column cannot be queried with contains(). Route to user_id equal query.
      this.queries.push(Query.equal('user_id', extractedUserId));
    } else if (cleanList.length > 0 && mappedCol !== 'device_info') {
      this.queries.push(Query.contains(mappedCol, cleanList as any));
    }
    return this;
  }

  containedBy(column: string, values: any): this {
    return this.contains(column, values);
  }

  like(column: string, pattern: string): this {
    if (!pattern.includes('%')) {
      return this.eq(column, pattern);
    }
    const clean = pattern.replace(/%/g, '');
    this.queries.push(Query.search(mapColumnName(column), clean));
    return this;
  }

  ilike(column: string, pattern: string): this {
    return this.like(column, pattern);
  }

  is(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null) {
      this.queries.push(Query.isNull(col));
    } else if (value === false) {
      this.queries.push(Query.equal(col, false));
    } else if (value === true) {
      this.queries.push(Query.equal(col, true));
    }
    return this;
  }

  not(column: string, operator: string, value: any): this {
    const col = mapColumnName(column);
    const op = (operator || '').toLowerCase();
    if (op === 'is' || op === 'eq') {
      if (value === null || value === undefined || value === 'null') {
        this.queries.push(Query.isNotNull(col));
      } else {
        this.queries.push(Query.notEqual(col, value));
      }
    } else if (op === 'in') {
      if (Array.isArray(value)) {
        value.forEach(v => this.queries.push(Query.notEqual(col, v)));
      } else if (typeof value === 'string') {
        const parsed = value.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        parsed.forEach(v => this.queries.push(Query.notEqual(col, v)));
      }
    } else {
      this.queries.push(Query.notEqual(col, value));
    }
    return this;
  }

  filter(column: string, operator: string, value: any): this {
    const op = (operator || '').toLowerCase();
    if (op === 'eq') return this.eq(column, value);
    if (op === 'neq') return this.neq(column, value);
    if (op === 'gt') return this.gt(column, value);
    if (op === 'gte') return this.gte(column, value);
    if (op === 'lt') return this.lt(column, value);
    if (op === 'lte') return this.lte(column, value);
    if (op === 'in') return this.in(column, Array.isArray(value) ? value : [value]);
    if (op === 'is') return this.is(column, value);
    if (op === 'like' || op === 'ilike') return this.like(column, value);
    if (op === 'contains') return this.contains(column, value);
    return this.eq(column, value);
  }

  match(query: Record<string, any>): this {
    if (query && typeof query === 'object') {
      for (const [key, val] of Object.entries(query)) {
        this.eq(key, val);
      }
    }
    return this;
  }

  or(filters: string): this {
    try {
      if (typeof (Query as any).or === 'function') {
        const parts = filters.split(',').map(f => f.trim());
        const subQueries: string[] = [];
        for (const part of parts) {
          const match = part.match(/^([^.]+)\.([^.]+)\.(.+)$/);
          if (match) {
            const [, col, op, val] = match;
            const cleanCol = mapColumnName(col);
            if (op === 'eq') subQueries.push(Query.equal(cleanCol, val));
            else if (op === 'neq') subQueries.push(Query.notEqual(cleanCol, val));
            else if (op === 'is') {
              if (val === 'null') subQueries.push(Query.isNull(cleanCol));
              else if (val === 'true') subQueries.push(Query.equal(cleanCol, true));
              else if (val === 'false') subQueries.push(Query.equal(cleanCol, false));
            } else if (op === 'not') {
              if (val === 'is.null' || val === 'eq.null') subQueries.push(Query.isNotNull(cleanCol));
              else if (val.startsWith('eq.')) subQueries.push(Query.notEqual(cleanCol, val.slice(3)));
            } else if (op === 'gt') subQueries.push(Query.greaterThan(cleanCol, val));
            else if (op === 'gte') subQueries.push(Query.greaterThanEqual(cleanCol, val));
            else if (op === 'lt') subQueries.push(Query.lessThan(cleanCol, val));
            else if (op === 'lte') subQueries.push(Query.lessThanEqual(cleanCol, val));
            else if (op === 'like' || op === 'ilike') {
              if (val.includes('%')) subQueries.push(Query.search(cleanCol, val.replace(/%/g, '')));
              else subQueries.push(Query.equal(cleanCol, val));
            }
          }
        }
        if (subQueries.length > 0) {
          this.queries.push((Query as any).or(subQueries));
          return this;
        }
      }
    } catch (_) {}
    this.emptyResult = true;
    return this;
  }

  textSearch(column: string, query: string, _options?: any): this {
    return this.like(column, query);
  }

  overlaps(column: string, values: any): this {
    return this.contains(column, values);
  }

  abortSignal(_signal?: AbortSignal): this {
    return this;
  }

  returns<NewResult = any>(): AppwriteQueryBuilder<NewResult> {
    return this as any;
  }

  csv(): this {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const col = mapColumnName(column);
    if (options?.ascending !== false) {
      this.queries.push(Query.orderAsc(col));
    } else {
      this.queries.push(Query.orderDesc(col));
    }
    return this;
  }

  private requestedLimit: number | null = null;

  limit(count: number): this {
    const rawCount = Math.max(1, Number(count) || 25);
    this.requestedLimit = rawCount;
    // Appwrite Cloud strictly caps single query limit to 100. Queries with limit > 100 trigger 400 Bad Request.
    const safeCount = Math.min(rawCount, 100);
    try {
      this.queries = this.queries.filter(q => {
        try {
          const parsed = typeof q === 'string' ? JSON.parse(q) : q;
          return parsed.method !== 'limit';
        } catch {
          return true;
        }
      });
    } catch (_) {}
    this.queries.push(Query.limit(safeCount));
    return this;
  }

  range(from: number, to: number): this {
    const limit = Math.max(1, Math.min(to - from + 1, 100));
    try {
      this.queries = this.queries.filter(q => {
        try {
          const parsed = typeof q === 'string' ? JSON.parse(q) : q;
          return !['limit', 'offset'].includes(parsed.method);
        } catch {
          return true;
        }
      });
    } catch (_) {}
    this.queries.push(Query.limit(limit));
    this.queries.push(Query.offset(Math.max(0, from)));
    return this;
  }

  single(): this {
    this.isSingle = true;

    return this;
  }

  maybeSingle(): this {
    this.isMaybeSingle = true;

    return this;
  }

  private mutation: { kind: 'insert' | 'upsert' | 'update' | 'delete'; data?: any; options?: { onConflict?: string } } | null = null;
  private resultPromise: Promise<any> | null = null;

  insert(data: any, options?: any): this { this.mutation = { kind: 'insert', data, options }; return this; }
  upsert(data: any, options?: any): this { this.mutation = { kind: 'upsert', data, options }; return this; }
  update(data: any): this { this.mutation = { kind: 'update', data }; return this; }
  delete(): this { this.mutation = { kind: 'delete' }; return this; }

  private async readDocuments(all = false): Promise<{ documents: any[]; total: number }> {
    if (this.emptyResult) return { documents: [], total: 0 };
    if (this.headOnly && !this.mutation) {
      const headQueries = [...this.queries.filter(q => { try { return !['limit', 'offset'].includes(JSON.parse(q).method); } catch { return true; } }), Query.limit(1)];
      if (!canMakeCloudRequest() || Date.now() < appwriteReadQuotaCooldownUntil) {
        const fb = await querySupabaseFallback(this.collectionName, headQueries, false);
        return { documents: [], total: fb.total };
      }
      try {
        const response = await databases.listDocuments(DATABASE_ID, this.collectionName, headQueries);
        return { documents: [], total: response.total };
      } catch (err: any) {
        if (err?.code === 404 || err?.message?.includes('could not be found') || err?.message?.includes('Collection with the requested ID')) {
          return { documents: [], total: 0 };
        }
        if (isAppwriteQuotaLimitError(err)) {
          triggerCloudCooldown('Appwrite quota on headOnly', 8000);
          setAppwriteQuotaCooldown(8000);
          const fb = await querySupabaseFallback(this.collectionName, headQueries, false);
          return { documents: [], total: fb.total };
        }
        throw err;
      }
    }
    // Filter out any select query from network calls to avoid Appwrite 400 schema errors on 'id'
    const queries = this.queries.filter(q => {
      try {
        const parsed = typeof q === 'string' && q.startsWith('{') ? JSON.parse(q) : null;
        if (parsed && parsed.method === 'select') return false;
      } catch (_) {}
      return true;
    });

    const hasLimit = queries.some(q => {
      try { return JSON.parse(q).method === 'limit'; } catch { return false; }
    });
    const boundedSingleRead = !all && !this.mutation && (this.isSingle || this.isMaybeSingle);
    if (!hasLimit) queries.push(Query.limit(boundedSingleRead ? 2 : 100));

    const shouldPaginate =
      !boundedSingleRead &&
      !queries.some(q => { try { return JSON.parse(q).method === 'offset'; } catch { return false; } }) &&
      (all || this.requestedLimit === null || this.requestedLimit > 100);

    const canCache = !this.mutation && (!boundedSingleRead || queries.length > 1);
    const cacheKey = `${this.collectionName}:${JSON.stringify(queries)}:${boundedSingleRead ? 'single' : 'list'}:max=${all ? 'all' : (this.requestedLimit ?? 'unbounded')}`;
    if (canCache) {
      const cached = queryCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return { documents: [...cached.data.documents], total: cached.data.total };
      }
      if (inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
      }
    }

    const fetchPromise = (async () => {
      if (!canMakeCloudRequest() || Date.now() < getAppwriteQuotaCooldownUntil()) {
        const cached = queryCache.get(cacheKey);
        if (cached && cached.data.documents.length > 0) {
          return { documents: [...cached.data.documents], total: cached.data.total };
        }
        const fbResult = await querySupabaseFallback(this.collectionName, queries, shouldPaginate || (!hasLimit && !boundedSingleRead));
        if (canCache && fbResult.documents.length > 0) {
          queryCache.set(cacheKey, { data: fbResult, expiresAt: Date.now() + 20000 });
        }
        return fbResult;
      }
      try {
        const response = await databases.listDocuments(DATABASE_ID, this.collectionName, queries);
        const documents = [...response.documents];
        if (shouldPaginate && response.total > documents.length) {
          const targetTotal = (all || this.requestedLimit === null)
            ? Math.min(response.total, 5000)
            : Math.min(response.total, this.requestedLimit || 100);
          const baseQueries = queries.filter(q => {
            try { return !['limit', 'offset'].includes(JSON.parse(q).method); } catch { return true; }
          });
          const offsets: number[] = [];
          for (let offset = documents.length; offset < targetTotal; offset += 100) {
            offsets.push(offset);
          }
          const PAGE_CONCURRENCY = 6;
          for (let i = 0; i < offsets.length; i += PAGE_CONCURRENCY) {
            const chunk = offsets.slice(i, i + PAGE_CONCURRENCY);
            const pages = await Promise.all(
              chunk.map(offset =>
                databases.listDocuments(DATABASE_ID, this.collectionName, [
                  ...baseQueries,
                  Query.limit(Math.min(100, targetTotal - offset)),
                  Query.offset(offset),
                ])
              )
            );
            for (const page of pages) {
              if (page.documents?.length) {
                documents.push(...page.documents);
              }
            }
          }
        }
        const result = { documents, total: response.total };
        if (canCache && (!boundedSingleRead || documents.length <= 1)) {
          const fastChanging = ['attendance_records', 'gate_entries', 'notifications', 'emergency_events'];
          const ttl = fastChanging.includes(this.collectionName)
            ? 15000
            : (['profiles', 'face_descriptors'].includes(this.collectionName) ? 25000 : 45000);
          queryCache.set(cacheKey, { data: result, expiresAt: Date.now() + ttl });
        }
        return result;
      } catch (err: any) {
        if (err?.code === 404 || err?.message?.includes('could not be found') || err?.message?.includes('Collection with the requested ID')) {
          return { documents: [], total: 0 };
        }
        if (isAppwriteQuotaLimitError(err)) {
          triggerCloudCooldown(`Appwrite 402/quota on ${this.collectionName}`, 8000);
          setAppwriteQuotaCooldown(8000);
          console.warn(`[AppwriteAdapter] Appwrite rate/quota response on "${this.collectionName}". Checking resilient cache & failover.`);
          const cached = queryCache.get(cacheKey);
          if (cached && cached.data.documents.length > 0) {
            return { documents: [...cached.data.documents], total: cached.data.total };
          }
          const fbResult = await querySupabaseFallback(this.collectionName, queries, all || (!hasLimit && !boundedSingleRead));
          if (fbResult.documents.length > 0) {
            if (canCache) {
              queryCache.set(cacheKey, { data: fbResult, expiresAt: Date.now() + 20000 });
            }
            return fbResult;
          }
          if (cached) return { documents: [...cached.data.documents], total: cached.data.total };
          return fbResult;
        }
        throw err;
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    })();

    if (canCache) {
      inFlightRequests.set(cacheKey, fetchPromise);
    }

    return fetchPromise;
  }

  private async run(): Promise<{ data: any; error: any; count?: number }> {
    try {
      let docs: any[];
      let count: number;
      if (!this.mutation) {
        const response = await this.readDocuments();
        docs = response.documents; count = response.total;
      } else {
        const { kind, data, options } = this.mutation;
        docs = [];
        if (kind === 'insert' || kind === 'upsert') {
          const rawList = Array.isArray(data) ? data : [data];
          const conflictFields = (kind === 'upsert' && options?.onConflict)
            ? String(options.onConflict).split(',').map((f: string) => f.trim()).filter(Boolean)
            : [];

          // Batch pre-fetch conflict IDs when upserting multiple rows on a single conflict column
          const batchConflictMap = new Map<string, string>();
          if (kind === 'upsert' && conflictFields.length === 1 && rawList.length > 1) {
            const field = conflictFields[0];
            const mappedCol = mapColumnName(field);
            const values = Array.from(new Set(rawList.map(r => r?.[field]).filter(v => v !== undefined && v !== null && v !== '')));
            const LOOKUP_CHUNK = 50;
            for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
              const slice = values.slice(i, i + LOOKUP_CHUNK);
              const q = [Query.equal(mappedCol, slice), Query.limit(Math.min(100, slice.length * 2))];
              try {
                const existing = Date.now() < appwriteReadQuotaCooldownUntil
                  ? await querySupabaseFallback(this.collectionName, q, false)
                  : await databases.listDocuments(DATABASE_ID, this.collectionName, q);
                for (const doc of existing.documents || []) {
                  const keyVal = String(doc[mappedCol] ?? doc[field] ?? '').toLowerCase();
                  const docId = doc.$id || doc.id;
                  if (keyVal && docId) batchConflictMap.set(keyVal, docId);
                }
              } catch (confErr: any) {
                if (isAppwriteQuotaLimitError(confErr)) {
                  setAppwriteQuotaCooldown(8000);
                }
              }
            }
          }

          const processSingleItem = async (rawItem: any) => {
            const item = { ...rawItem };
            if (this.collectionName === 'push_subscriptions') {
              if (!item.subscription && (item.endpoint || item.keys_p256dh || item.keys_auth)) {
                item.subscription = JSON.stringify({
                  endpoint: item.endpoint,
                  keys: {
                    p256dh: item.keys_p256dh,
                    auth: item.keys_auth,
                  },
                });
                delete item.endpoint;
                delete item.keys_p256dh;
                delete item.keys_auth;
                delete item.updated_at;
              }
            }
            let id = item.id || item.$id;
            if (kind === 'upsert' && !id && conflictFields.length === 1) {
              const val = String(item[conflictFields[0]] ?? '').toLowerCase();
              if (val && batchConflictMap.has(val)) {
                id = batchConflictMap.get(val);
              }
            }
            if (kind === 'upsert' && !id && conflictFields.length > 0 && rawList.length === 1) {
              const conflictQueries = [...conflictFields.map((f: string) => Query.equal(mapColumnName(f), item[f])), Query.limit(2)];
              try {
                if (Date.now() < appwriteReadQuotaCooldownUntil) {
                  const existing = await querySupabaseFallback(this.collectionName, conflictQueries, false);
                  id = existing.documents[0]?.$id || existing.documents[0]?.id;
                } else {
                  const existing = await databases.listDocuments(DATABASE_ID, this.collectionName, conflictQueries);
                  if (existing.total > 1) throw new Error('Conflict columns match multiple records');
                  id = existing.documents[0]?.$id;
                }
              } catch (confErr: any) {
                if (isAppwriteQuotaLimitError(confErr)) {
                  setAppwriteQuotaCooldown(8000);
                  try {
                    const existing = await querySupabaseFallback(this.collectionName, conflictQueries, false);
                    id = existing.documents[0]?.$id || existing.documents[0]?.id;
                  } catch {}
                }
              }
            }
            const payload = sanitizeDocForSave(item);
            const targetId = id || ID.unique();
            if (kind === 'upsert' && id) {
              try {
                const updated = await updateDocumentWithSchemaRetry(this.collectionName, id, payload);
                const fullDoc = { ...item, ...updated, $id: id, id };
                saveLocalOverlayDoc(this.collectionName, id, fullDoc);
                void mirrorMutationToSupabase(this.collectionName, 'upsert', fullDoc);
                return fullDoc;
              } catch (error: any) {
                if (isAppwriteQuotaLimitError(error)) {
                  const localDoc = { ...item, ...payload, $id: id, id, updated_at: new Date().toISOString() };
                  saveLocalOverlayDoc(this.collectionName, id, localDoc);
                  void mirrorMutationToSupabase(this.collectionName, 'upsert', localDoc);
                  return localDoc;
                }
                if (error.code !== 404) throw error;
              }
            }
            try {
              const created = await createDocumentWithSchemaRetry(this.collectionName, targetId, payload);
              const createdId = created.$id || targetId;
              const fullDoc = { ...item, ...created, $id: createdId, id: createdId };
              saveLocalOverlayDoc(this.collectionName, createdId, fullDoc);
              void mirrorMutationToSupabase(this.collectionName, kind, fullDoc);
              return fullDoc;
            } catch (createErr: any) {
              if (isAppwriteQuotaLimitError(createErr)) {
                const localDoc = { ...item, ...payload, $id: targetId, id: targetId, created_at: new Date().toISOString() };
                saveLocalOverlayDoc(this.collectionName, targetId, localDoc);
                void mirrorMutationToSupabase(this.collectionName, kind, localDoc);
                return localDoc;
              }
              throw createErr;
            }
          };

          const WRITE_CONCURRENCY = 10;
          for (let i = 0; i < rawList.length; i += WRITE_CONCURRENCY) {
            const batch = rawList.slice(i, i + WRITE_CONCURRENCY);
            const batchDocs = await Promise.all(batch.map(processSingleItem));
            docs.push(...batchDocs);
          }
        } else {
          // Critical safety check: Refuse to update or delete without any query filters!
          if ((kind === 'update' || kind === 'delete') && this.queries.length === 0) {
            console.error(`[AppwriteAdapter] Blocked dangerous unfiltered ${kind} on "${this.collectionName}"!`);
            return { data: [], error: new Error(`Unfiltered bulk ${kind} is blocked for database safety.`), count: 0 };
          }
          const matched = await this.readDocuments(true);
          const MUTATION_CONCURRENCY = 10;
          for (let i = 0; i < matched.documents.length; i += MUTATION_CONCURRENCY) {
            const batch = matched.documents.slice(i, i + MUTATION_CONCURRENCY);
            const batchResults = await Promise.all(
              batch.map(async (doc) => {
                const docId = doc.$id || doc.id;
                if (kind === 'update') {
                  try {
                    const updated = await updateDocumentWithSchemaRetry(this.collectionName, docId, sanitizeDocForSave(data));
                    const fullDoc = { ...doc, ...data, ...updated, $id: docId, id: docId };
                    saveLocalOverlayDoc(this.collectionName, docId, fullDoc);
                    void mirrorMutationToSupabase(this.collectionName, 'update', fullDoc, data);
                    return fullDoc;
                  } catch (updErr: any) {
                    if (isAppwriteQuotaLimitError(updErr) || updErr?.code === 404) {
                      const localDoc = { ...doc, ...data, $id: docId, id: docId, updated_at: new Date().toISOString() };
                      saveLocalOverlayDoc(this.collectionName, docId, localDoc);
                      void mirrorMutationToSupabase(this.collectionName, 'update', localDoc, data);
                      return localDoc;
                    }
                    throw updErr;
                  }
                } else {
                  try {
                    await databases.deleteDocument(DATABASE_ID, this.collectionName, docId);
                  } catch (delErr: any) {
                    if (!isAppwriteQuotaLimitError(delErr) && delErr?.code !== 404) throw delErr;
                  }
                  saveLocalOverlayDoc(this.collectionName, docId, null);
                  void mirrorMutationToSupabase(this.collectionName, 'delete', doc);
                  return doc;
                }
              })
            );
            docs.push(...batchResults);
          }
        }
        count = docs.length;
        invalidateCollectionCache(this.collectionName);
      }
      docs = docs.map(normalizeDoc);
      if (this.headOnly && !this.mutation) return { data: null, error: null, count };
      if (this.isSingle || this.isMaybeSingle) {
        if (docs.length > 1 || (this.isSingle && !docs.length))
          return { data: null, error: { code: 'PGRST116', message: 'Expected exactly one matching record' }, count };
        return { data: docs[0] || null, error: null, count };
      }
      return { data: docs, error: null, count };
    } catch (error: any) { return { data: null, error }; }
  }

  private execute(): Promise<any> {
    this.resultPromise ??= this.run();
    return this.resultPromise;
  }

  then<TResult1 = { data: T | null; error: any; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: T | null; error: any; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// Resilient Auth Client
class AppwriteAuthClient {
  private authListeners: Set<(event: string, session: any) => void> = new Set();
  private cachedUser: any = null;
  private userRequest: Promise<any> | null = null;
  private last401Time = 0;
  private lastValidatedTime = 0;

  private getAccount(): Promise<any> {
    if (Date.now() < getAppwriteQuotaCooldownUntil()) {
      const local = this.loadLocalAuth();
      if (local) return Promise.resolve(local);
      return Promise.reject({ code: 401, message: 'Unauthenticated session' });
    }
    // If recently verified unauthenticated (within 20 seconds), skip redundant 401 network requests across the globe
    if (Date.now() - this.last401Time < 20000) {
      return Promise.reject({ code: 401, message: 'Unauthenticated session' });
    }
    // All mounted listeners share the same in-flight account request.
    if (!this.userRequest) {
      this.userRequest = account.get()
        .then((u) => {
          this.last401Time = 0;
          return u;
        })
        .catch((err) => {
          if (isAppwriteQuotaLimitError(err)) {
            setAppwriteQuotaCooldown();
            const local = this.loadLocalAuth();
            if (local) return local;
          }
          if (err?.code === 401 || err?.message?.includes('missing scope') || err?.message?.includes('unauthorized')) {
            this.last401Time = Date.now();
          }
          throw err;
        })
        .finally(() => {
          this.userRequest = null;
        });
    }
    return this.userRequest;
  }

  constructor() {
    this.cachedUser = this.loadLocalAuth();
    if (this.cachedUser) {
      this.lastValidatedTime = Date.now();
    }
    this.initSessionCheck();
  }

  private async initSessionCheck() {
    try {
      const u = await this.getAccount();
      this.cachedUser = this.formatUser(u);
      this.lastValidatedTime = Date.now();
      this.saveLocalAuth(this.cachedUser);
    } catch (err: any) {
      if (isAppwriteQuotaLimitError(err)) {
        const local = this.loadLocalAuth();
        if (local) {
          this.cachedUser = local;
          return;
        }
      }
      if (err?.code === 401) {
        this.cachedUser = null;
        this.saveLocalAuth(null);
      }
    }
  }

  private loadLocalAuth(): any {
    try {
      if (typeof localStorage !== 'undefined') {
        const item = localStorage.getItem('presences_auth_user');
        return item ? JSON.parse(item) : null;
      }
    } catch {
      // Safe fallback
    }
    return null;
  }

  private saveLocalAuth(user: any) {
    try {
      if (typeof localStorage !== 'undefined') {
        if (user) localStorage.setItem('presences_auth_user', JSON.stringify(user));
        else localStorage.removeItem('presences_auth_user');
      }
    } catch {
      // Safe fallback
    }
  }

  private formatUser(u: any): any {
    if (!u) return null;
    const email = String(u.email || '').toLowerCase().trim();
    const isSuperAdmin = (u.labels || []).includes('admin') || (u.labels || []).includes('superadmin') || email === 'atl@gmail.com';
    return {
      id: u.$id || u.id || 'admin_user',
      email: u.email || 'admin@presences.dev',
      phone: u.phone,
      email_confirmed_at: u.emailVerification ? u.$updatedAt : new Date().toISOString(),
      user_metadata: {
        name: u.name || (email === 'atl@gmail.com' ? 'ATL Superadmin' : 'School Principal'),
        ...(u.prefs || {}),
        role: isSuperAdmin ? 'admin' : 'user',
      },
      app_metadata: {
        role: isSuperAdmin ? 'admin' : 'user',
        labels: isSuperAdmin ? ['admin', 'principal', 'superadmin', 'teacher', 'enroller'] : (u.labels || [])
      },
      created_at: u.$createdAt || new Date().toISOString(),
      updated_at: u.$updatedAt || new Date().toISOString()
    };
  }

  async getUser(): Promise<{ data: { user: any }; error: any }> {
    // Instant response if user session was validated within the last 60 seconds
    if (this.cachedUser && Date.now() - this.lastValidatedTime < 60000) {
      return { data: { user: this.cachedUser }, error: null };
    }
    // If recently verified unauthenticated (within 20s) and no cachedUser, return null instantly without network roundtrip
    if (!this.cachedUser && Date.now() - this.last401Time < 20000) {
      return { data: { user: null }, error: null };
    }
    try {
      const u = await this.getAccount();
      this.cachedUser = this.formatUser(u);
      this.lastValidatedTime = Date.now();
      this.saveLocalAuth(this.cachedUser);
      return { data: { user: this.cachedUser }, error: null };
    } catch (err: any) {
      this.cachedUser = null;
      this.saveLocalAuth(null);
      return { data: { user: null }, error: err.code === 401 ? null : err };
    }
  }

  async getSession(): Promise<{ data: { session: any }; error: any }> {
    if (this.cachedUser && Date.now() - this.lastValidatedTime < 60000) {
      return {
        data: {
          session: { user: this.cachedUser, access_token: 'appwrite-active-session', expires_at: 9999999999 }
        },
        error: null
      };
    }
    if (!this.cachedUser && Date.now() - this.last401Time < 20000) {
      return { data: { session: null }, error: null };
    }
    try {
      const u = await this.getAccount();
      const user = this.formatUser(u);
      this.cachedUser = user;
      this.lastValidatedTime = Date.now();
      this.saveLocalAuth(user);
      return {
        data: {
          session: user ? { user, access_token: 'appwrite-active-session', expires_at: 9999999999 } : null
        },
        error: null
      };
    } catch (error: any) {
      this.cachedUser = null;
      this.saveLocalAuth(null);
      return { data: { session: null }, error: error.code === 401 ? null : error };
    }
  }

  private async signInWithSupabasePassword(email: string, password: string): Promise<{ data: any; error: any }> {
    try {
      const { url, key } = getSupabaseFallbackConfig();
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = json.msg || json.error_description || json.message || 'Invalid login credentials';
        return {
          data: null,
          error: {
            message: errorMsg,
            msg: errorMsg,
            code: res.status,
            status: res.status,
            type: json.error_code || 'invalid_credentials',
          },
        };
      }
      const supaUser = json.user || {};
      const user = this.formatUser({
        $id: supaUser.id,
        id: supaUser.id,
        email: supaUser.email,
        phone: supaUser.phone,
        name: supaUser.user_metadata?.name || supaUser.user_metadata?.full_name || email.split('@')[0],
        emailVerification: Boolean(supaUser.email_confirmed_at),
        labels: [supaUser.user_metadata?.role || 'admin', 'principal', 'superadmin'],
        prefs: supaUser.user_metadata || {},
        $createdAt: supaUser.created_at,
        $updatedAt: supaUser.updated_at,
      });
      this.cachedUser = user;
      this.lastValidatedTime = Date.now();
      this.last401Time = 0;
      this.saveLocalAuth(user);
      const session = {
        user,
        access_token: json.access_token || 'supabase-session-token',
        refresh_token: json.refresh_token,
        expires_at: json.expires_at || 9999999999,
      };
      this.notifyListeners('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    } catch (supaErr: any) {
      const msg = supaErr?.message || 'Authentication service temporarily unavailable';
      return { data: null, error: { message: msg, code: 500 } };
    }
  }

  private async signUpWithSupabase({ email, password, options }: { email: string; password: string; options?: any }): Promise<{ data: any; error: any }> {
    try {
      const { url, key } = getSupabaseFallbackConfig();
      const res = await fetch(`${url}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, data: options?.data || {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = json.msg || json.error_description || json.message || 'Registration failed';
        return { data: null, error: { message: errorMsg, code: res.status } };
      }
      if (json.session) {
        const supaUser = json.user || {};
        const user = this.formatUser({
          $id: supaUser.id,
          id: supaUser.id,
          email: supaUser.email,
          phone: supaUser.phone,
          name: supaUser.user_metadata?.name || supaUser.user_metadata?.full_name || email.split('@')[0],
          emailVerification: Boolean(supaUser.email_confirmed_at),
          labels: [supaUser.user_metadata?.role || 'admin', 'principal', 'superadmin'],
          prefs: supaUser.user_metadata || {},
          $createdAt: supaUser.created_at,
          $updatedAt: supaUser.updated_at,
        });
        this.cachedUser = user;
        this.lastValidatedTime = Date.now();
        this.last401Time = 0;
        this.saveLocalAuth(user);
        const session = {
          user,
          access_token: json.session.access_token || 'supabase-session-token',
          refresh_token: json.session.refresh_token,
          expires_at: json.session.expires_at || 9999999999,
        };
        this.notifyListeners('SIGNED_IN', session);
        return { data: { user, session }, error: null };
      }
      return { data: { user: json.user, session: null }, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message || 'Registration error', code: 500 } };
    }
  }

  async signInWithPassword({ email, password }: { email: string; password: string }): Promise<{ data: any; error: any }> {
    this.last401Time = 0;
    this.userRequest = null;
    const cleanEmail = email.trim().toLowerCase();

    // Clear any stale quota freeze flag on intentional sign-in
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(QUOTA_STORAGE_KEY);
      }
    } catch {}
    appwriteReadQuotaCooldownUntil = 0;

    try {
      try {
        await account.createEmailPasswordSession(cleanEmail, password);
      } catch (sessionErr: any) {
        if (isAppwriteQuotaLimitError(sessionErr)) {
          setAppwriteQuotaCooldown();
          return this.signInWithSupabasePassword(cleanEmail, password);
        }
        const errType = String(sessionErr?.type || '').toLowerCase();
        const errMsg = String(sessionErr?.message || '').toLowerCase();
        if (
          errType === 'user_session_already_exists' ||
          errMsg.includes('session is active') ||
          errMsg.includes('already exists')
        ) {
          try {
            await account.deleteSessions();
          } catch {
            try {
              await account.deleteSession('current');
            } catch {}
          }
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('cookieFallback');
            }
          } catch {}
          await account.createEmailPasswordSession(cleanEmail, password);
        } else {
          throw sessionErr;
        }
      }

      this.last401Time = 0;
      this.userRequest = null;
      const rawAccount = await account.get();
      const user = this.formatUser(rawAccount);
      this.cachedUser = user;
      this.lastValidatedTime = Date.now();
      this.last401Time = 0;
      this.saveLocalAuth(user);
      const session = { user, access_token: 'appwrite-active-session', expires_at: 9999999999 };
      this.notifyListeners('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    } catch (error: any) {
      if (isAppwriteQuotaLimitError(error)) {
        setAppwriteQuotaCooldown();
        return this.signInWithSupabasePassword(cleanEmail, password);
      }
      return { data: null, error };
    }
  }

  signInWithOAuth = async (
    paramsOrProvider: string | { provider: string; options?: { redirectTo?: string; queryParams?: any } },
    maybeOptions?: { redirectTo?: string; queryParams?: any }
  ): Promise<{ data: { url: string } | null; error: any }> => {
    this.last401Time = 0;
    try {
      let providerName: string;
      let options: { redirectTo?: string; queryParams?: any } | undefined;

      if (typeof paramsOrProvider === 'object' && paramsOrProvider !== null && 'provider' in paramsOrProvider) {
        providerName = paramsOrProvider.provider;
        options = paramsOrProvider.options;
      } else {
        providerName = String(paramsOrProvider || 'google');
        options = maybeOptions;
      }

      const supported: Record<string, OAuthProvider> = {
        google: OAuthProvider.Google,
        github: OAuthProvider.Github,
        apple: OAuthProvider.Apple,
        azure: OAuthProvider.Microsoft,
        microsoft: OAuthProvider.Microsoft,
        facebook: OAuthProvider.Facebook,
      };
      const selected = supported[providerName?.toLowerCase()] || (providerName as any) || OAuthProvider.Google;
      const redirect = options?.redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/login` : '');
      await account.createOAuth2Session(selected, redirect, redirect);
      return { data: { url: redirect }, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  async signUp({ email, password, options }: { email: string; password: string; options?: any }): Promise<{ data: any; error: any }> {
    this.last401Time = 0;
    if (Date.now() < getAppwriteQuotaCooldownUntil()) {
      return this.signUpWithSupabase({ email, password, options });
    }
    try {
      await account.create(ID.unique(), email.trim(), password, options?.data?.name || options?.data?.full_name || email.split('@')[0]);
      return this.signInWithPassword({ email, password });
    } catch (error: any) {
      if (isAppwriteQuotaLimitError(error)) {
        setAppwriteQuotaCooldown();
        return this.signUpWithSupabase({ email, password, options });
      }
      return { data: null, error };
    }
  }

  async signOut(_options?: any): Promise<{ error: any }> {
    try {
      await account.deleteSession('current');
    } catch {
      // Ignore 401 or network error when clearing session
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('cookieFallback');
      }
    } catch {
      // Ignore storage error
    }
    this.cachedUser = null;
    this.lastValidatedTime = 0;
    this.last401Time = Date.now();
    this.userRequest = null;
    this.saveLocalAuth(null);
    this.notifyListeners('SIGNED_OUT', null);
    return { error: null };
  }

  async refreshSession(): Promise<{ data: { session: any }; error: any }> {
    return this.getSession();
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this.authListeners.add(callback);
    this.getSession().then(({ data }) => {
      if (this.authListeners.has(callback)) callback('INITIAL_SESSION', data.session);
    });
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.authListeners.delete(callback);
          }
        }
      }
    };
  }

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ data: any; error: any }> {
    try {
      const redirect = options?.redirectTo || (typeof window !== 'undefined' ? window.location.origin : '');
      const res = await account.createRecovery(email, redirect);
      return { data: res, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async updateUser(attributes: any): Promise<{ data: { user: any }; error: any }> {
    try {
      if (attributes.data?.name) {
        await account.updateName(attributes.data.name);
      }
      const u = await account.get();
      this.cachedUser = this.formatUser(u);
      this.saveLocalAuth(this.cachedUser);
      return { data: { user: this.cachedUser }, error: null };
    } catch (err: any) {
      return { data: { user: null }, error: err };
    }
  }

  private notifyListeners(event: string, session: any) {
    this.authListeners.forEach(cb => {
      try {
        cb(event, session);
      } catch (err) {
        console.error('[AppwriteAuth] listener error:', err);
      }
    });
  }
}

// Storage Bridge Implementation
class AppwriteStorageBucketClient {
  private bucketId: string;

  constructor(bucketId: string) {
    this.bucketId = bucketId;
  }

  getPublicUrl(path: string, options?: { transform?: ImageTransformOptions }): { data: { publicUrl: string } } {
    const fileId = storageFileId(path);
    if (options?.transform) {
      return {
        data: {
          publicUrl: getAppwriteStoragePreviewUrl(this.bucketId, fileId, options.transform)
        }
      };
    }
    return {
      data: {
        publicUrl: getAppwriteStorageViewUrl(this.bucketId, fileId)
      }
    };
  }

  async createSignedUrl(path: string, _expiresIn = 3600, options?: { transform?: ImageTransformOptions }): Promise<{ data: { signedUrl: string } | null; error: any }> {
    const fileId = storageFileId(path);
    if (options?.transform) {
      return {
        data: {
          signedUrl: getAppwriteStoragePreviewUrl(this.bucketId, fileId, options.transform)
        },
        error: null
      };
    }
    return {
      data: {
        signedUrl: getAppwriteStorageViewUrl(this.bucketId, fileId)
      },
      error: null
    };
  }

  async upload(path: string, fileBody: File | Blob | ArrayBuffer, _options?: any): Promise<{ data: any; error: any }> {
    try {
      const fileId = storageFileId(path) || ID.unique();
      let file: File;
      if (fileBody instanceof File) {
        file = fileBody;
      } else if (fileBody instanceof Blob) {
        file = new File([fileBody], path.split('/').pop() || 'upload.bin', { type: fileBody.type || 'image/jpeg' });
      } else {
        file = new File([fileBody], path.split('/').pop() || 'upload.bin', { type: 'image/jpeg' });
      }

      const permissions = [
        Permission.read(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any())
      ];

      try {
        const res = await storage.createFile(
          this.bucketId,
          fileId,
          file,
          permissions
        );
        return { data: { ...res, id: res.$id, path }, error: null };
      } catch (createErr: any) {
        if (createErr?.code === 409) {
          // File already exists with identical ID
          if (_options?.upsert) {
            try {
              await storage.deleteFile(this.bucketId, fileId);
              const res = await storage.createFile(this.bucketId, fileId, file, permissions);
              return { data: { ...res, id: res.$id, path }, error: null };
            } catch (_) {}
          }
          return { data: { id: fileId, path, $id: fileId }, error: null };
        }
        throw createErr;
      }
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async download(path: string): Promise<{ data: Blob | null; error: any }> {
    try {
      const fileId = storageFileId(path);
      const url = getAppwriteStorageDownloadUrl(this.bucketId, fileId);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Storage download failed: ' + res.status);
      const blob = await res.blob();
      return { data: blob, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message } };
    }
  }

  async remove(paths: string[]): Promise<{ data: any; error: any }> {
    try {
      for (const path of paths) {
        const fileId = storageFileId(path);
        try {
          await storage.deleteFile(this.bucketId, fileId);
        } catch (error: any) {
          if (error?.code !== 404) throw error;
        }
      }
      return { data: paths, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message } };
    }
  }
}

class AppwriteStorageClient {
  from(bucketId: string) {
    const raw = (bucketId || '').trim();
    const norm = raw.toLowerCase().replace(/_/g, '-');
    let target = APPWRITE_CONFIG.buckets[raw as keyof typeof APPWRITE_CONFIG.buckets] || raw;
    if (norm.includes('registration')) target = 'student-registration-faces';
    else if (norm.includes('training') || norm.includes('attendance')) target = 'attendance-training-faces';
    else if (norm.includes('export') || norm.includes('backup')) target = 'database-exports';
    else if (norm.includes('face') || norm.includes('avatar') || norm.includes('photo') || norm === 'public') target = 'face-images';
    return new AppwriteStorageBucketClient(target);
  }
}

// Global Shared Realtime Subscription Multiplexer
// Prevents exhausting Appwrite's 500 concurrent connection limit by sharing 1 connection per topic across all components and tabs
type RealtimeCallback = (response: any) => void;
const sharedTopicListeners = new Map<string, Set<RealtimeCallback>>();
const activeTopicUnsubs = new Map<string, () => void>();

function subscribeSharedTopic(topic: string, callback: RealtimeCallback): () => void {
  let listeners = sharedTopicListeners.get(topic);
  if (!listeners) {
    listeners = new Set<RealtimeCallback>();
    sharedTopicListeners.set(topic, listeners);
  }
  listeners.add(callback);

  if (!activeTopicUnsubs.has(topic)) {
    try {
      const unsub = appwriteClient.subscribe(topic, (response) => {
        const currentListeners = sharedTopicListeners.get(topic);
        if (currentListeners && currentListeners.size > 0) {
          for (const cb of currentListeners) {
            try {
              cb(response);
            } catch (_) {}
          }
        }
      });
      activeTopicUnsubs.set(topic, unsub);
    } catch (err) {
      // Safe silent failover
    }
  }

  return () => {
    const currentListeners = sharedTopicListeners.get(topic);
    if (currentListeners) {
      currentListeners.delete(callback);
      if (currentListeners.size === 0) {
        sharedTopicListeners.delete(topic);
        const appwriteUnsub = activeTopicUnsubs.get(topic);
        if (appwriteUnsub) {
          try {
            appwriteUnsub();
          } catch (_) {}
          activeTopicUnsubs.delete(topic);
        }
      }
    }
  };
}

// Realtime Channel Bridge
class AppwriteRealtimeChannel {
  private channelName: string;
  private unsubscribeFns: Array<() => void> = [];
  private presenceListeners: Array<{ event: string; callback: (payload: any) => void }> = [];
  private presences: Record<string, any[]> = {};
  private presenceId = '';
  private presencePayload: Record<string, any> = {};
  private presenceSubscription: Promise<any> | null = null;
  private disposed = false;

  constructor(channelName: string) {
    this.channelName = channelName;
  }

  on(event: string, filter: any, callback: (payload: any) => void): this {
    if (event === 'broadcast') {
      const unsubscribe = subscribeSharedTopic(`databases.${DATABASE_ID}.collections.realtime_messages.documents`, response => {
        const message = normalizeDoc(response.payload);
        if (this.disposed || message.channel !== this.channelName || message.event !== filter?.event) return;
        if (response.events.some(e => e.endsWith('.delete')) || Date.parse(message.expires_at) < Date.now()) return;
        callback({ type: 'broadcast', event: message.event, payload: message.payload });
      });
      this.unsubscribeFns.push(unsubscribe);
      return this;
    }
    if (event === 'presence') {
      this.presenceListeners.push({ event: filter?.event || 'sync', callback });
      if (!this.presenceSubscription) {
        this.presenceSubscription = realtime.subscribe(Channel.presences(), response => {
          const record = response.payload;
          if (this.disposed || record.metadata?.channel !== this.channelName) return;
          const key = record.$id;
          const previous = this.presences[key];
          const removed = response.events.some(e => e.endsWith('.delete')) || record.status === 'offline';
          if (removed) delete this.presences[key];
          else this.presences[key] = [record.metadata?.payload || {}];
          for (const listener of this.presenceListeners) {
            if (listener.event === 'sync') listener.callback({});
            if (!previous && !removed && listener.event === 'join') listener.callback({ key, newPresences: this.presences[key] });
            if (previous && removed && listener.event === 'leave') listener.callback({ key, leftPresences: previous });
          }
        }).then(subscription => {
          if (this.disposed) void subscription.unsubscribe();
          else this.unsubscribeFns.push(() => { void subscription.unsubscribe(); });
          return subscription;
        });
        this.presenceSubscription.catch(error => console.warn('[Realtime] Presence unavailable:', error?.message));
      }
      return this;
    }
    if (event === 'postgres_changes' || event === 'system') {
      const table = filter?.table || '*';
      const channelTopic = table === '*'
        ? `databases.${DATABASE_ID}.collections`
        : `databases.${DATABASE_ID}.collections.${table}.documents`;

      const unsub = subscribeSharedTopic(channelTopic, (response) => {
        const payload = {
          schema: 'public',
          table: table,
          commit_timestamp: new Date().toISOString(),
          eventType: response.events.some(e => e.includes('.create')) ? 'INSERT'
            : response.events.some(e => e.includes('.update')) ? 'UPDATE' : 'DELETE',
          new: normalizeDoc(response.payload),
          old: normalizeDoc(response.payload),
          errors: null
        };
        if (filter?.event && filter.event !== '*' && filter.event !== payload.eventType) return;
        if (filter?.filter) {
          const match = String(filter.filter).match(/^([^.]+)=eq\.(.+)$/);
          if (match && String(payload.new?.[match[1]]) !== match[2]) return;
        }
        invalidateCollectionCache(table === '*' ? undefined : table);
        callback(payload);
      });
      this.unsubscribeFns.push(unsub);
    }
    return this;
  }

  subscribe(statusCallback?: (status: string) => void): this {
    this.disposed = false;
    if (statusCallback) {
      if (this.presenceSubscription) {
        this.presenceSubscription.then(() => { if (!this.disposed) return statusCallback('SUBSCRIBED'); })
          .catch(() => { if (!this.disposed) statusCallback('CHANNEL_ERROR'); });
      } else setTimeout(() => { if (!this.disposed) statusCallback('SUBSCRIBED'); }, 50);
    }
    return this;
  }

  presenceState<T = any>(): Record<string, T[]> { return { ...this.presences }; }

  async track(payload: Record<string, any>): Promise<void> {
    try {
      const { data } = await appwriteUnifiedClient.auth.getUser();
      const userId = data?.user?.id || data?.user?.$id;
      if (!userId) return;
      if (!this.presenceId) this.presenceId = storageFileId(this.channelName + '/' + crypto.randomUUID());
      this.presencePayload = { ...this.presencePayload, ...payload };
      await realtime.upsertPresence({
        presenceId: this.presenceId,
        status: 'online',
        permissions: [Permission.read(Role.user(userId)), Permission.read(Role.label('admin')), Permission.read(Role.label('principal'))],
        metadata: { channel: this.channelName, payload: this.presencePayload },
      });
    } catch {
      // Graceful fallback when unauthenticated
    }
  }

  async untrack(): Promise<void> {
    if (this.presenceId) await realtime.upsertPresence({ presenceId: this.presenceId, status: 'offline', metadata: { channel: this.channelName } });
  }

  async send(message: { type: string; event: string; payload: any }): Promise<string> {
    const result = await new AppwriteFunctionsBridge().invoke('presences-backend', { body: { action: 'realtime.send', channel: this.channelName, ...message } });
    if (result.error) throw result.error;
    return 'ok';
  }

  unsubscribe(): void {
    this.disposed = true;
    void this.untrack().catch(() => {});
    this.unsubscribeFns.forEach(unsub => {
      try {
        unsub();
      } catch (_) {}
    });
    this.unsubscribeFns = [];
  }
}

// Functions Invocation Bridge
class AppwriteFunctionsBridge {
  async invoke(functionName: string, options?: { body?: any; headers?: Record<string, string> }): Promise<{ data: any; error: any }> {
    try {
      // 1. Client-Side Fast Path for extract-pdf-users
      if (functionName === 'extract-pdf-users') {
        try {
          const { extractPdfUsers } = await import('@/services/enrollment/extractPdfUsers');
          let body: any = options?.body ?? {};
          if (typeof body === 'string') {
            try {
              body = JSON.parse(body);
            } catch {
              return { data: null, error: { message: 'Choose a PDF or ID-card image and try again.' } };
            }
          }
          if (body?.file || body?.fileData) {
            const clientResult = await extractPdfUsers(body || {});
            if (clientResult && Array.isArray(clientResult.users) && clientResult.users.length > 0) {
              return { data: clientResult, error: null };
            }
          }
        } catch (failure: any) {
          if (failure?.name === 'AbortError') return { data: null, error: { message: 'Extraction cancelled.' } };
          console.warn('[FunctionsBridge] Client PDF extraction attempt notice:', failure?.message);
        }
      }

      const bodyStr = typeof options?.body === 'string' ? options.body : JSON.stringify(options?.body || {});

      // 2. Try Supabase Edge Function Endpoint
      let supaUrl = 'https://cvdcbcsonlianbfeessy.supabase.co';
      let supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';
      try {
        if (typeof process !== 'undefined' && process?.env?.VITE_SUPABASE_URL) {
          supaUrl = process.env.VITE_SUPABASE_URL;
        }
        if (typeof process !== 'undefined' && process?.env?.VITE_SUPABASE_ANON_KEY) {
          supaKey = process.env.VITE_SUPABASE_ANON_KEY;
        }
      } catch {}
      try {
        const getMetaEnv = new Function('try { return import.meta.env; } catch(e) { return null; }');
        const env = getMetaEnv();
        if (env?.VITE_SUPABASE_URL) supaUrl = env.VITE_SUPABASE_URL;
        if (env?.VITE_SUPABASE_ANON_KEY) supaKey = env.VITE_SUPABASE_ANON_KEY;
      } catch {}
      supaUrl = supaUrl.replace(/\/$/, '');

      if (supaUrl && supaKey) {
        try {
          let jwtStr: string | null = null;
          try {
            const jwtRes = await account.createJWT();
            jwtStr = jwtRes?.jwt || null;
          } catch {
            // Guest or public session
          }

          const supaHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            apikey: supaKey,
            Authorization: `Bearer ${supaKey}`,
            ...(jwtStr ? { 'x-appwrite-user-jwt': jwtStr } : {}),
            ...(options?.headers || {}),
          };

          const supaResponse = await fetch(`${supaUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: supaHeaders,
            body: bodyStr,
          });

          // Successful execution from Supabase Edge Functions
          if (supaResponse.ok) {
            let data: any;
            try {
              data = await supaResponse.json();
            } catch {
              data = await supaResponse.text();
            }
            return { data, error: null };
          }

          // If the edge function returned an application response (e.g. auth required, validation error)
          if (supaResponse.status !== 404 && supaResponse.status !== 502 && supaResponse.status !== 503) {
            let errData: any;
            try {
              errData = await supaResponse.json();
            } catch {
              errData = { message: await supaResponse.text() };
            }
            return {
              data: null,
              error: {
                message: errData?.error || errData?.message || `Function ${functionName} returned status ${supaResponse.status}`,
                status: supaResponse.status,
              },
            };
          }
        } catch (supaErr: any) {
          console.warn(`[FunctionsBridge] Supabase edge call for ${functionName} note:`, supaErr?.message);
        }
      }

      // 3. Fallback to Appwrite Functions Execution
      try {
        const safeHeaders: Record<string, string> = {};
        if (options?.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            if (!k.toLowerCase().startsWith('x-appwrite')) {
              safeHeaders[k] = v;
            }
          }
        }
        const execution = await functions.createExecution(
          functionName,
          bodyStr,
          false,
          '/',
          'POST' as any,
          safeHeaders
        );
        if (execution.status === 'failed' || execution.responseStatusCode >= 400) {
          return { data: null, error: { message: execution.responseBody || 'Function execution failed', code: execution.responseStatusCode } };
        }
        let responseBody = execution.responseBody;
        try {
          responseBody = JSON.parse(responseBody);
        } catch (_) {}
        return { data: responseBody, error: null };
      } catch (appwriteErr: any) {
        return { data: null, error: { message: appwriteErr?.message || 'Function execution unavailable.' } };
      }
    } catch (err: any) {
      return { data: null, error: err };
    }
  }
}

// Unified Client Instance
export class AppwriteUnifiedClient {
  public auth = new AppwriteAuthClient();
  public storage = new AppwriteStorageClient();
  public functions = new AppwriteFunctionsBridge();
  public signInWithOAuth = (paramsOrProvider: any, options?: any) => this.auth.signInWithOAuth(paramsOrProvider, options);
  private channels = new Map<string, AppwriteRealtimeChannel>();

  from<T = any>(collectionName: string): AppwriteQueryBuilder<T> {
    return new AppwriteQueryBuilder<T>(collectionName);
  }

  channel(channelName: string, _opts?: any): AppwriteRealtimeChannel {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, new AppwriteRealtimeChannel(channelName));
    }
    return this.channels.get(channelName)!;
  }

  removeChannel(channel: any): void {
    if (channel && typeof channel.unsubscribe === 'function') {
      channel.unsubscribe();
      for (const [name, registered] of this.channels) if (registered === channel) this.channels.delete(name);
    }
  }

  getChannels(): any[] {
    return Array.from(this.channels.values());
  }

  async rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    if (['upsert_class_attendance_event', 'get_all_auth_users', 'trigger_auto_backup'].includes(fnName)) {
      return this.functions.invoke('presences-backend', { body: { action: fnName, ...params } });
    }
    return this.functions.invoke(fnName, { body: params });
  }
}

export const appwriteUnifiedClient = new AppwriteUnifiedClient();
export default appwriteUnifiedClient;
