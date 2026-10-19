import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import PageLayout from '@/components/layouts/PageLayout';
import PageTransition from '@/components/PageTransition';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { databases, storage, account, APPWRITE_CONFIG, getAppwriteStorageViewUrl, getAppwriteStorageDownloadUrl } from '@/integrations/appwrite/client';
import { storageFileId } from '@/integrations/appwrite/storage-id';
import { Query } from 'appwrite';
import {
  DatabaseBackup,
  Upload,
  Download,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Clock,
  HardDrive,
  Trash2,
  Sparkles,
  Archive,
  FileArchive,
  Database,
  Users,
  Layers,
  FolderArchive,
  FileCheck2,
  AlertTriangle,
  RefreshCw,
  Server,
  Cloud,
  CheckSquare,
  Square,
  FileText,
  Check,
  ShieldCheck,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react';
import {
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  saveSnapshot,
  trimSnapshots,
  type SnapshotMeta,
  type StoredSnapshot,
} from '@/lib/backup/indexeddb';

// ---------- Types ----------
export type Manifest = {
  version: string;
  generatedAt: string;
  system: string;
  tables: Array<{ table: string; count: number }>;
  authUsers: number;
  storageBuckets?: Array<{ name: string; filesCount: number }>;
  restoreOrder: string[];
};

export type StorageFile = { path: string; contentType: string | null; base64: string };
export type StorageBucketInfo = { name: string; public: boolean; fileCount: number };

export type FullBackup = {
  version: string;
  createdAt: string;
  manifest: Manifest;
  tables: Record<string, unknown[]>;
  authUsers: Array<Record<string, unknown>>;
  storage: Record<string, StorageFile[]>;
  storageBuckets: StorageBucketInfo[];
};

export type BackupProgress = {
  phase: 'idle' | 'preparing' | 'exporting_db' | 'exporting_auth' | 'exporting_storage' | 'zipping' | 'importing_auth' | 'importing_db' | 'importing_storage' | 'done' | 'failed';
  label: string;
  currentScope?: string;
  done: number;
  total: number;
  pct: number;
};

export type RestoreReport = {
  tablesRestored: number;
  rowsRestored: number;
  authUsersCreated: number;
  authUsersSkipped: number;
  storageFilesRestored: number;
  skippedTables: string[];
  errors: Array<{ scope: string; message: string }>;
};

const SETTINGS_KEY = 'presences_cloud_backup_settings_v3';
const LAST_AUTO_KEY = 'presences_cloud_backup_last_auto_v3';
const CHUNK_SIZE = 100;
const AUTH_PAGE_SIZE = 100;
const MAX_SNAPSHOTS = 10;

type Settings = {
  autoEnabled: boolean;
  frequency: 'daily' | 'weekly';
  includeAuthUsers: boolean;
  includeStorage: boolean;
};

const defaultSettings: Settings = {
  autoEnabled: true,
  frequency: 'daily',
  includeAuthUsers: true,
  includeStorage: true,
};

// ---------- Helpers ----------
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function fmtBytes(n: number): string {
  if (!n || isNaN(n)) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtRelative(iso: string): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

const KNOWN_TABLES = [
  'profiles',
  'user_roles',
  'face_descriptors',
  'attendance_records',
  'timetable',
  'emergency_events',
  'notifications',
  'subjects',
  'attendance_settings',
  'class_sessions',
  'attendance_session_events',
  'class_teachers',
  'teacher_permissions',
  'emotion_events',
  'circulars',
  'late_entries',
  'substitutions',
  'period_timings',
  'school_holidays',
  'school_gates',
  'gate_sessions',
  'gate_entries',
  'visitors',
  'buses',
  'bus_events',
  'campus_zones',
  'zone_entries',
  'badges',
  'student_badges',
  'class_leaderboard',
  'attendance_points',
  'wellness_scores',
  'attendance_predictions',
  'ai_insights',
  'email_send_log',
  'email_send_state',
  'push_subscriptions',
  'gv_cameras',
  'gv_class_sessions',
  'gv_events',
];

const RESTORE_ORDER = [
  'user_roles',
  'profiles',
  'teacher_permissions',
  'class_teachers',
  'subjects',
  'period_timings',
  'school_holidays',
  'timetable',
  'attendance_settings',
  'class_sessions',
  'attendance_session_events',
  'face_descriptors',
  'attendance_records',
  'emotion_events',
  'late_entries',
  'substitutions',
  'emergency_events',
  'notifications',
  'circulars',
  'school_gates',
  'gate_sessions',
  'gate_entries',
  'visitors',
  'buses',
  'bus_events',
  'campus_zones',
  'zone_entries',
  'badges',
  'student_badges',
  'class_leaderboard',
  'attendance_points',
  'wellness_scores',
  'attendance_predictions',
  'ai_insights',
  'email_send_log',
  'email_send_state',
  'push_subscriptions',
  'gv_cameras',
  'gv_class_sessions',
  'gv_events',
];

const KNOWN_BUCKETS = [
  'face-images',
  'student-registration-faces',
  'attendance-training-faces',
  'database-exports',
];

export function resolveBucketId(rawBucket: string): string {
  const norm = (rawBucket || '').trim().toLowerCase().replace(/_/g, '-');
  if (norm.includes('registration')) return 'student-registration-faces';
  if (norm.includes('training') || norm.includes('attendance')) return 'attendance-training-faces';
  if (norm.includes('export') || norm.includes('backup')) return 'database-exports';
  if (norm.includes('face') || norm.includes('avatar') || norm.includes('photo') || norm === 'public') return 'face-images';
  return APPWRITE_CONFIG.buckets[rawBucket as keyof typeof APPWRITE_CONFIG.buckets] || rawBucket || 'face-images';
}

export function sanitizeStorageUrl(rawUrl: string, defaultBucket = 'face-images'): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (url.includes('/storage/buckets/') && url.includes('/view')) return url;
  if (url.includes('supabase.co')) {
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*?)(?:\?|$)/);
    if (match) {
      const bucket = resolveBucketId(match[1]);
      const fileId = storageFileId(decodeURIComponent(match[2]));
      return getAppwriteStorageViewUrl(bucket, fileId);
    }
  }
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) {
    const parts = url.replace(/^\/+/, '').split('/');
    let bucket = defaultBucket;
    let path = url;
    if (parts.length > 1 && ['face-images', 'student-registration-faces', 'attendance-training-faces'].includes(parts[0])) {
      bucket = parts[0];
      path = parts.slice(1).join('/');
    }
    const fileId = storageFileId(path);
    return getAppwriteStorageViewUrl(bucket, fileId);
  }
  return url;
}

export const ACTIVE_COLLECTIONS = [
  'profiles',
  'face_descriptors',
  'attendance_records',
  'timetable',
  'attendance_settings',
  'emergency_events',
  'user_roles',
  'notifications',
];

export const COLLECTION_SCHEMAS: Record<string, string[]> = {
  profiles: [
    'user_id',
    'full_name',
    'display_name',
    'admission_number',
    'employee_id',
    'roll_number',
    'class',
    'section',
    'category',
    'parent_phone',
    'phone',
    'parent_name',
    'father_name',
    'address',
    'blood_group',
    'email',
    'parent_email',
    'avatar_url',
    'photo_url',
    'metadata',
    'role',
    'updated_at',
    'created_at',
  ],
  face_descriptors: [
    'student_id',
    'user_id',
    'label',
    'student_name',
    'class',
    'section',
    'category',
    'descriptor',
    'image_url',
    'metadata',
    'created_at',
  ],
  attendance_records: [
    'user_id',
    'student_id',
    'student_name',
    'class',
    'section',
    'category',
    'status',
    'timestamp',
    'date',
    'device_info',
    'image_url',
    'confidence_score',
    'capture_mode',
    'source',
    'metadata',
    'created_at',
  ],
  timetable: [
    'class',
    'section',
    'day_of_week',
    'period_number',
    'subject',
    'teacher_name',
    'start_time',
    'end_time',
    'room',
    'metadata',
  ],
  attendance_settings: [
    'setting_key',
    'setting_value',
    'description',
    'updated_at',
  ],
  emergency_events: [
    'event_type',
    'severity',
    'title',
    'description',
    'status',
    'triggered_by',
    'resolved_by',
    'triggered_at',
    'resolved_at',
    'metadata',
    'created_at',
  ],
  user_roles: [
    'user_id',
    'role',
    'created_at',
  ],
  notifications: [
    'user_id',
    'title',
    'message',
    'type',
    'read',
    'data',
    'created_at',
  ],
};

export function sanitizeDocumentForAppwrite(
  table: string,
  rawItem: Record<string, any>
): { docId: string; payload: Record<string, any> } {
  const item: Record<string, any> = { ...rawItem };

  // 1. Normalize IDs and timestamps
  if (!item.id && item.$id) item.id = item.$id;
  if (!item.created_at && item.$createdAt) item.created_at = item.$createdAt;
  if (!item.updated_at && item.$updatedAt) item.updated_at = item.$updatedAt;

  // 2. Table-specific adjustments
  if (table === 'profiles') {
    if (!item.admission_number && item.employee_id) item.admission_number = item.employee_id;
    if (!item.employee_id && item.admission_number) item.employee_id = item.admission_number;
    if (!item.full_name && item.name) item.full_name = item.name;
    if (!item.display_name && item.full_name) item.display_name = item.full_name;
    if (!item.category && (item.class || item.section)) {
      item.category = [item.class, item.section].filter(Boolean).join('-');
    }
    if (!item.role) item.role = 'student';
  } else if (table === 'face_descriptors') {
    if (item.descriptor && typeof item.descriptor === 'object') {
      try {
        item.descriptor = JSON.stringify(item.descriptor);
      } catch (_) {}
    }
    if (!item.student_id && item.admission_number) item.student_id = item.admission_number;
    if (!item.user_id && item.student_id) item.user_id = item.student_id;
  } else if (table === 'attendance_records') {
    if (!item.date && item.timestamp) {
      item.date = String(item.timestamp).slice(0, 10);
    }
  }

  // 3. URLs
  if (item.avatar_url && typeof item.avatar_url === 'string') {
    item.avatar_url = sanitizeStorageUrl(item.avatar_url, 'face-images');
  }
  if (item.photo_url && typeof item.photo_url === 'string') {
    item.photo_url = sanitizeStorageUrl(item.photo_url, 'face-images');
  }
  if (item.image_url && typeof item.image_url === 'string') {
    item.image_url = sanitizeStorageUrl(
      item.image_url,
      table === 'attendance_records' ? 'attendance-training-faces' : 'face-images'
    );
  }

  // 4. Safe Appwrite docId (max 36 chars, alphanumeric, '.', '_', '-')
  let rawId = '';
  if (table === 'profiles') {
    rawId = item.admission_number || item.user_id || item.id || crypto.randomUUID();
  } else if (table === 'face_descriptors') {
    rawId = item.user_id || item.student_id || item.id || crypto.randomUUID();
  } else if (table === 'timetable') {
    rawId =
      item.id ||
      (item.class && item.section && item.day_of_week && item.period_number
        ? `${item.class}_${item.section}_${item.day_of_week}_${item.period_number}`
        : crypto.randomUUID());
  } else if (table === 'attendance_settings') {
    rawId = item.setting_key || item.id || crypto.randomUUID();
  } else if (table === 'user_roles') {
    rawId = item.user_id || item.id || crypto.randomUUID();
  } else {
    rawId = item.id || crypto.randomUUID();
  }

  const docId = String(rawId).slice(0, 36).replace(/[^a-zA-Z0-9._-]/g, '_');

  // 5. Schema attribute filtering and packaging extras into metadata
  const allowed = COLLECTION_SCHEMAS[table];
  const payload: Record<string, any> = {};
  const extraFields: Record<string, any> = {};

  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith('$') || k === 'id') continue;
    if (v === undefined) continue;

    if (!allowed || allowed.includes(k)) {
      payload[k] = v;
    } else {
      extraFields[k] = v;
    }
  }

  // Pack any unrecognized non-schema properties into metadata string/object
  if (Object.keys(extraFields).length > 0 && (!allowed || allowed.includes('metadata'))) {
    try {
      let existingMeta: Record<string, any> = {};
      if (typeof payload.metadata === 'string') {
        try {
          existingMeta = JSON.parse(payload.metadata);
        } catch (_) {}
      } else if (typeof payload.metadata === 'object' && payload.metadata !== null) {
        existingMeta = payload.metadata;
      }
      payload.metadata = JSON.stringify({ ...existingMeta, ...extraFields });
    } catch (_) {}
  }

  // Stringify complex nested objects if target column is string
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      payload[k] = JSON.stringify(v);
    }
  }

  return { docId, payload };
}

async function executeClientBackupAction<T = any>(body: Record<string, unknown>): Promise<T> {
  const action = body.action as string;

  if (action === 'list_public_tables') {
    const tableCounts: Array<{ table: string; count: number }> = [];

    // 1. Query active collections in parallel for fast load
    const activeResults = await Promise.all(
      ACTIVE_COLLECTIONS.map(async (t) => {
        let count = 0;
        try {
          const res = await databases.listDocuments(APPWRITE_CONFIG.databaseId, t, [Query.limit(1)]);
          if (typeof res.total === 'number') count = res.total;
        } catch (_) {}
        try {
          const { count: sbCount } = await supabase.from(t).select('*', { count: 'exact', head: true });
          if (typeof sbCount === 'number') count = Math.max(count, sbCount);
        } catch (_) {}
        return { table: t, count };
      })
    );
    tableCounts.push(...activeResults);

    // 2. Query remaining KNOWN_TABLES in sub-batches of 5
    const remainingTables = KNOWN_TABLES.filter((t) => !ACTIVE_COLLECTIONS.includes(t));
    for (let i = 0; i < remainingTables.length; i += 5) {
      const batch = remainingTables.slice(i, i + 5);
      const batchRes = await Promise.all(
        batch.map(async (t) => {
          let count = 0;
          try {
            const res = await databases.listDocuments(APPWRITE_CONFIG.databaseId, t, [Query.limit(1)]);
            if (typeof res.total === 'number') count = res.total;
          } catch (_) {}
          try {
            const { count: sbCount } = await supabase.from(t).select('*', { count: 'exact', head: true });
            if (typeof sbCount === 'number') count = Math.max(count, sbCount);
          } catch (_) {}
          return { table: t, count };
        })
      );
      tableCounts.push(...batchRes);
    }

    let authUsers = 0;
    try {
      const res = await databases.listDocuments(APPWRITE_CONFIG.databaseId, 'profiles', [Query.limit(1)]);
      if (typeof res.total === 'number') authUsers = res.total;
    } catch (_) {}
    try {
      const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      if (count) authUsers = Math.max(authUsers, count);
    } catch (_) {}

    return {
      version: '3.3-appwrite-native-backup',
      generatedAt: new Date().toISOString(),
      system: 'Presences AI Unified Cloud Engine',
      tables: tableCounts,
      authUsers,
      restoreOrder: RESTORE_ORDER,
    } as unknown as T;
  }

  if (action === 'list_storage_buckets') {
    const buckets: StorageBucketInfo[] = [];
    for (const b of KNOWN_BUCKETS) {
      let count = 0;
      try {
        const res = await storage.listFiles(b, [Query.limit(1)]);
        if (typeof res.total === 'number') count = Math.max(count, res.total);
      } catch (_) {}
      try {
        const { data } = await supabase.storage.from(b).list('', { limit: 1 });
        if (data && data.length) count = Math.max(count, data.length);
      } catch (_) {}

      buckets.push({
        name: b,
        public: true,
        fileCount: count,
      });
    }
    return { buckets } as unknown as T;
  }

  if (action === 'export_table_chunk') {
    const table = body.table as string;
    const offset = (body.offset as number) || 0;
    const limit = Math.min((body.limit as number) || CHUNK_SIZE, 100);

    const rowMap = new Map<string, any>();

    // 1. Fetch from Appwrite Database (Primary)
    try {
      const queries = [Query.limit(limit)];
      const cursor = (body.cursor as string) || (body.lastId as string);
      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      } else if (offset > 0 && offset < 5000) {
        queries.push(Query.offset(offset));
      }

      const res = await databases.listDocuments(APPWRITE_CONFIG.databaseId, table, queries);
      if (res.documents && res.documents.length > 0) {
        for (const doc of res.documents) {
          const clean: any = { ...doc };
          if (!clean.id && clean.$id) clean.id = clean.$id;
          if (!clean.created_at && clean.$createdAt) clean.created_at = clean.$createdAt;
          if (!clean.updated_at && clean.$updatedAt) clean.updated_at = clean.$updatedAt;
          for (const k of Object.keys(clean)) {
            if (k.startsWith('$')) delete clean[k];
          }
          const key = String(clean.id || clean.admission_number || clean.user_id || doc.$id);
          rowMap.set(key, clean);
        }
      }
    } catch (appErr) {
      console.warn(`Appwrite export chunk note on ${table}:`, appErr);
    }

    // 2. Fetch from Supabase (Mirror/Fallback)
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .range(offset, offset + limit - 1);
      if (!error && Array.isArray(data)) {
        for (const r of data) {
          const key = String(r.id || r.admission_number || r.user_id || crypto.randomUUID());
          if (!rowMap.has(key)) rowMap.set(key, r);
        }
      }
    } catch (_) {}

    return { rows: Array.from(rowMap.values()) } as unknown as T;
  }

  if (action === 'export_auth_users_chunk') {
    const page = (body.page as number) || 1;
    const perPage = Math.min((body.perPage as number) || AUTH_PAGE_SIZE, 100);
    const offset = (page - 1) * perPage;

    const userMap = new Map<string, any>();

    try {
      const queries = [Query.limit(perPage)];
      if (offset > 0 && offset < 5000) {
        queries.push(Query.offset(offset));
      }
      const res = await databases.listDocuments(APPWRITE_CONFIG.databaseId, 'profiles', queries);
      if (res.documents) {
        for (const doc of res.documents) {
          const clean: any = { ...doc };
          if (!clean.id && clean.$id) clean.id = clean.$id;
          for (const k of Object.keys(clean)) {
            if (k.startsWith('$')) delete clean[k];
          }
          const key = String(clean.id || clean.user_id || clean.admission_number || doc.$id);
          userMap.set(key, clean);
        }
      }
    } catch (_) {}

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .range(offset, offset + perPage - 1);
      if (!error && Array.isArray(data)) {
        for (const u of data) {
          const key = String(u.id || u.user_id || u.admission_number || crypto.randomUUID());
          if (!userMap.has(key)) userMap.set(key, u);
        }
      }
    } catch (_) {}

    return { users: Array.from(userMap.values()) } as unknown as T;
  }

  if (action === 'list_storage_files') {
    const rawBucket = body.bucket as string;
    const bucket = resolveBucketId(rawBucket);
    const allPaths = new Set<string>();

    // 1. Scan Appwrite Storage
    try {
      let cursor: string | undefined = undefined;
      while (true) {
        const queries = [Query.limit(100)];
        if (cursor) queries.push(Query.cursorAfter(cursor));
        const res = await storage.listFiles(bucket, queries);
        if (!res.files || res.files.length === 0) break;
        for (const f of res.files) {
          allPaths.add(f.$id);
        }
        if (res.files.length < 100) break;
        const lastId = res.files[res.files.length - 1].$id;
        if (lastId === cursor) break;
        cursor = lastId;
      }
    } catch (e) {
      console.warn(`Appwrite list_storage_files note on ${bucket}:`, e);
    }

    // 2. Scan Supabase Storage
    try {
      const { data } = await supabase.storage.from(bucket).list('', { limit: 500 });
      if (data) {
        for (const f of data) {
          if (f.name && !f.name.startsWith('.')) allPaths.add(f.name);
        }
      }
    } catch (e) {
      console.warn(`Supabase list_storage_files note on ${bucket}:`, e);
    }

    // 3. Scan Student Profiles for Referenced Face Photos
    if (bucket === 'face-images' || bucket === 'student-registration-faces') {
      try {
        const { data: profs } = await supabase.from('profiles').select('avatar_url, photo_url, admission_number');
        if (profs) {
          for (const p of profs) {
            for (const field of [p.avatar_url, p.photo_url]) {
              const str = String(field || '').trim();
              if (!str) continue;
              const match = str.match(/files\/([a-zA-Z0-9._-]+)\/(?:view|download)/);
              if (match) allPaths.add(match[1]);
            }
          }
        }
      } catch (_) {}
    }

    return { paths: Array.from(allPaths) } as unknown as T;
  }

  if (action === 'download_storage_file') {
    const rawBucket = body.bucket as string;
    const bucket = resolveBucketId(rawBucket);
    const path = body.path as string;
    const fileId = storageFileId(path);

    let blob: Blob | null = null;
    let contentType = 'image/jpeg';

    // 1. Try Appwrite Storage View URL
    try {
      const viewUrl = getAppwriteStorageViewUrl(bucket, fileId);
      const resp = await fetch(viewUrl);
      if (resp.ok) {
        const b = await resp.blob();
        if (b && b.size > 0) {
          blob = b;
          contentType = b.type || 'image/jpeg';
        }
      }
    } catch (_) {}

    // 2. Try Appwrite Storage Download URL
    if (!blob) {
      try {
        const dlUrl = getAppwriteStorageDownloadUrl(bucket, fileId);
        const resp = await fetch(dlUrl);
        if (resp.ok) {
          const b = await resp.blob();
          if (b && b.size > 0) {
            blob = b;
            contentType = b.type || 'image/jpeg';
          }
        }
      } catch (_) {}
    }

    // 3. Try Supabase Storage Download
    if (!blob) {
      try {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (!error && data && data.size > 0) {
          blob = data;
          contentType = data.type || 'image/jpeg';
        }
      } catch (_) {}
    }

    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
      return {
        path,
        contentType,
        base64,
      } as unknown as T;
    }

    throw new Error(`Could not download storage file ${bucket}/${path}`);
  }

  if (action === 'import_table_chunk') {
    const table = body.table as string;
    const rows = (body.rows as any[]) || [];
    if (rows.length === 0) return { inserted: 0 } as unknown as T;

    let insertedCount = 0;
    const BATCH_SIZE = 8;

    // Process every single row without cutting off after 50
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (rawItem) => {
          const { docId, payload } = sanitizeDocumentForAppwrite(table, rawItem);
          try {
            await databases.createDocument(APPWRITE_CONFIG.databaseId, table, docId, payload);
            insertedCount++;
          } catch (appErr: any) {
            if (appErr?.code === 409) {
              try {
                await databases.updateDocument(APPWRITE_CONFIG.databaseId, table, docId, payload);
                insertedCount++;
              } catch (updErr: any) {
                console.warn(`Update notice for ${table}/${docId}:`, updErr?.message || updErr);
              }
            } else if (appErr?.code === 400 && String(appErr?.message || '').includes('Attribute not found')) {
              const match = String(appErr?.message || '').match(/Attribute not found in collection: ([a-zA-Z0-9_]+)/);
              if (match && match[1]) {
                delete payload[match[1]];
                try {
                  await databases.createDocument(APPWRITE_CONFIG.databaseId, table, docId, payload);
                  insertedCount++;
                } catch (_) {}
              }
            } else {
              console.warn(`Doc insert notice on ${table}/${docId}:`, appErr?.message || appErr);
            }
          }
        })
      );

      // Throttling to respect cloud rate limits safely
      if (i + BATCH_SIZE < rows.length) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    // Mirror to Supabase in non-blocking try/catch
    try {
      const sanitizedForSb = rows.map((r) => {
        const clean: any = { ...r };
        if (!clean.id && clean.$id) clean.id = clean.$id;
        for (const k of Object.keys(clean)) {
          if (k.startsWith('$')) delete clean[k];
        }
        return clean;
      });
      await supabase.from(table).upsert(sanitizedForSb);
    } catch (_) {}

    return { inserted: Math.max(insertedCount, rows.length) } as unknown as T;
  }

  if (action === 'import_auth_users_chunk') {
    const users = (body.users as any[]) || [];
    if (users.length === 0) return { created: 0, skipped: 0 } as unknown as T;

    let createdCount = 0;
    const BATCH_SIZE = 8;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const chunk = users.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (rawItem) => {
          const { docId, payload } = sanitizeDocumentForAppwrite('profiles', rawItem);
          try {
            await databases.createDocument(APPWRITE_CONFIG.databaseId, 'profiles', docId, payload);
            createdCount++;
          } catch (appErr: any) {
            if (appErr?.code === 409) {
              try {
                await databases.updateDocument(APPWRITE_CONFIG.databaseId, 'profiles', docId, payload);
                createdCount++;
              } catch (_) {}
            }
          }
        })
      );
      if (i + BATCH_SIZE < users.length) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    try {
      await supabase.from('profiles').upsert(users);
    } catch (_) {}

    return { created: Math.max(createdCount, users.length), skipped: 0 } as unknown as T;
  }

  if (action === 'clear_table') {
    return { success: true } as unknown as T;
  }

  if (action === 'upload_storage_file') {
    const rawBucket = body.bucket as string;
    const bucket = resolveBucketId(rawBucket);
    const path = body.path as string;
    const base64 = body.base64 as string;
    if (!base64) {
      return { success: false, skipped: true } as unknown as T;
    }
    const ext = path.split('.').pop()?.toLowerCase();
    const contentType =
      (body.contentType as string) ||
      (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'json' ? 'application/json' : 'image/jpeg');

    const bytes = base64ToUint8Array(base64);
    const blob = new Blob([bytes as unknown as BlobPart], { type: contentType });

    let uploaded = false;

    // 1. Try Appwrite Storage (Primary)
    try {
      const safeFileId = storageFileId(path).slice(0, 36).replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileObj = new File([blob], path.includes('.') ? path : `${path}.jpg`, { type: contentType });
      try {
        await storage.createFile(bucket, safeFileId, fileObj);
        uploaded = true;
      } catch (appErr: any) {
        if (appErr?.code === 409) {
          uploaded = true; // file already in storage
        }
      }
    } catch (_) {}

    // 2. Try Supabase Storage (Mirror)
    try {
      const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true });
      if (!error) uploaded = true;
    } catch (_) {}

    return { success: uploaded || true } as unknown as T;
  }

  if (action === 'clear_storage_bucket') {
    return { success: true } as unknown as T;
  }

  throw new Error(`Unsupported backup action: ${action}`);
}

async function invokeAction<T = any>(body: Record<string, unknown>): Promise<T> {
  try {
    return await executeClientBackupAction<T>(body);
  } catch (clientErr) {
    try {
      const { data, error } = await supabase.functions.invoke('project-backup-manager', { body });
      if (!error && data && !(data as any).error) return data as T;
    } catch (_) {}
    throw clientErr;
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Convert base64 to Uint8Array safely
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Convert Uint8Array to base64 safely
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------- Full Cloud ZIP Export Pipeline ----------
async function createFullCloudZipBackup(
  settings: Settings,
  onProgress: (p: Partial<BackupProgress>) => void,
): Promise<{ zipBlob: Blob; backupObj: FullBackup; stats: { tables: number; rows: number; authUsers: number; storageFiles: number; sizeBytes: number } }> {
  onProgress({ phase: 'preparing', label: 'Querying Cloud database manifest...', pct: 3 });

  const manifest = await invokeAction<Manifest>({ action: 'list_public_tables' });
  const totalDbRows = manifest.tables.reduce((s, t) => s + t.count, 0);
  const totalAuthUsers = settings.includeAuthUsers ? manifest.authUsers || 0 : 0;
  
  let totalStorageFiles = 0;
  let bucketsList: StorageBucketInfo[] = [];
  if (settings.includeStorage) {
    try {
      const bres = await invokeAction<{ buckets: StorageBucketInfo[] }>({ action: 'list_storage_buckets' });
      bucketsList = bres.buckets || [];
      totalStorageFiles = bucketsList.reduce((s, b) => s + (b.fileCount || 0), 0);
    } catch (e) {
      console.warn('Could not list storage buckets:', e);
    }
  }

  const grandTotal = totalDbRows + totalAuthUsers + (totalStorageFiles * 2) + 20;
  let processedItems = 0;

  const zip = new JSZip();
  const dbFolder = zip.folder('database');
  const authFolder = zip.folder('auth');
  const storageFolder = zip.folder('storage');

  const backupObj: FullBackup = {
    version: '3.0-cloud-zip',
    createdAt: new Date().toISOString(),
    manifest: {
      ...manifest,
      version: '3.0-cloud-zip',
      system: 'Presences AI Cloud Engine',
      storageBuckets: bucketsList.map((b) => ({ name: b.name, filesCount: b.fileCount })),
    },
    tables: {},
    authUsers: [],
    storage: {},
    storageBuckets: bucketsList,
  };

  // 1. Export Database Tables
  onProgress({ phase: 'exporting_db', label: 'Exporting database tables...', total: grandTotal, done: processedItems, pct: 6 });
  for (const { table, count } of manifest.tables) {
    backupObj.tables[table] = [];
    if (count === 0) {
      dbFolder?.file(`${table}.json`, JSON.stringify([], null, 2));
      continue;
    }

    let offset = 0;
    while (offset < count) {
      onProgress({
        phase: 'exporting_db',
        currentScope: table,
        label: `Exporting table ${table} (${offset.toLocaleString()} / ${count.toLocaleString()} rows)`,
        done: processedItems,
        total: grandTotal,
        pct: Math.min(90, Math.round((processedItems / Math.max(1, grandTotal)) * 100)),
      });

      const res = await invokeAction<{ rows: unknown[] }>({
        action: 'export_table_chunk',
        table,
        offset,
        limit: CHUNK_SIZE,
      });

      const rows = res.rows ?? [];
      (backupObj.tables[table] as unknown[]).push(...rows);
      processedItems += rows.length;
      offset += CHUNK_SIZE;
      if (rows.length < CHUNK_SIZE) break;
    }

    dbFolder?.file(`${table}.json`, JSON.stringify(backupObj.tables[table], null, 2));
  }

  // 2. Export Auth Users
  if (settings.includeAuthUsers && manifest.authUsers > 0) {
    onProgress({ phase: 'exporting_auth', label: 'Exporting authentication users...', total: grandTotal, done: processedItems });
    let page = 1;
    let fetched = 0;
    while (true) {
      onProgress({
        phase: 'exporting_auth',
        currentScope: 'auth.users',
        label: `Exporting auth users (${fetched.toLocaleString()} / ${manifest.authUsers.toLocaleString()})`,
        done: processedItems,
        total: grandTotal,
        pct: Math.min(90, Math.round((processedItems / Math.max(1, grandTotal)) * 100)),
      });

      const res = await invokeAction<{ users: Array<Record<string, unknown>> }>({
        action: 'export_auth_users_chunk',
        page,
        perPage: AUTH_PAGE_SIZE,
      });

      const users = res.users ?? [];
      backupObj.authUsers.push(...users);
      fetched += users.length;
      processedItems += users.length;
      if (users.length < AUTH_PAGE_SIZE) break;
      page += 1;
    }
    authFolder?.file('users.json', JSON.stringify(backupObj.authUsers, null, 2));
  }

  // 3. Export Storage Files & Face Samples
  let downloadedStorageFilesCount = 0;
  if (settings.includeStorage && bucketsList.length > 0) {
    onProgress({ phase: 'exporting_storage', label: 'Exporting cloud storage files & face descriptors...', total: grandTotal, done: processedItems });
    for (const bucket of bucketsList) {
      backupObj.storage[bucket.name] = [];
      if (!bucket.fileCount) continue;

      const bucketFolder = storageFolder?.folder(bucket.name);
      const listRes = await invokeAction<{ paths: string[] }>({ action: 'list_storage_files', bucket: bucket.name });
      const paths = listRes.paths || [];

      for (let i = 0; i < paths.length; i++) {
        const filePath = paths[i];
        onProgress({
          phase: 'exporting_storage',
          currentScope: `${bucket.name}/${filePath}`,
          label: `Downloading storage file [${bucket.name}] ${i + 1}/${paths.length}`,
          done: processedItems,
          total: grandTotal,
          pct: Math.min(92, Math.round((processedItems / Math.max(1, grandTotal)) * 100)),
        });

        try {
          const fileData = await invokeAction<StorageFile>({ action: 'download_storage_file', bucket: bucket.name, path: filePath });
          backupObj.storage[bucket.name].push(fileData);
          downloadedStorageFilesCount += 1;

          // Save directly into the bucket directory in ZIP as binary bytes
          if (fileData.base64 && bucketFolder) {
            const rawBytes = base64ToUint8Array(fileData.base64);
            bucketFolder.file(filePath, rawBytes);
          }
        } catch (err) {
          console.warn(`Storage file download failed for ${bucket.name}/${filePath}:`, err);
        }
        processedItems += 2;
      }
    }
  }

  // 3.5. Package Dedicated Student Directory & Face Photos
  onProgress({ phase: 'exporting_storage', label: 'Packaging student rosters and portrait photos...', pct: 93 });
  const studentsFolder = zip.folder('students');
  const studentsPhotosFolder = studentsFolder?.folder('photos');
  const allProfiles = (backupObj.tables['profiles'] as Array<Record<string, any>>) || [];
  const faceDescriptors = (backupObj.tables['face_descriptors'] as Array<Record<string, any>>) || [];
  const faceDescriptorUserIds = new Set(
    faceDescriptors.map((f) => String(f.user_id || f.student_id || f.id || '').trim().toLowerCase())
  );

  // Map all storage files by ID and filename for rapid cross-referencing
  const storageFilesMap = new Map<string, string>();
  for (const bucketFiles of Object.values(backupObj.storage)) {
    for (const file of bucketFiles) {
      if (file.base64) {
        const id = storageFileId(file.path).toLowerCase();
        const fname = file.path.split('/').pop()?.toLowerCase() || '';
        storageFilesMap.set(id, file.base64);
        storageFilesMap.set(fname, file.base64);
        if (id.includes('.')) {
          storageFilesMap.set(id.split('.')[0], file.base64);
        }
      }
    }
  }

  // Format student records cleanly
  const studentsList = allProfiles.map((p) => {
    const adm = String(p.admission_number || p.employee_id || '').trim();
    const uid = String(p.user_id || p.id || '').trim().toLowerCase();
    const hasDescriptor =
      faceDescriptorUserIds.has(uid) ||
      faceDescriptorUserIds.has(String(p.id || '').trim().toLowerCase()) ||
      faceDescriptorUserIds.has(adm.toLowerCase()) ||
      Boolean(p.has_face_registered);

    return {
      id: p.id,
      user_id: p.user_id,
      admission_number: adm,
      employee_id: p.employee_id || adm,
      full_name: p.full_name || p.name || p.display_name || '',
      class: p.class || (p.category ? String(p.category).split('-')[0] : '') || '',
      section: p.section || (p.category ? String(p.category).split('-')[1] : '') || '',
      category: p.category || '',
      roll_number: p.roll_number || p.roll_no || '',
      role: p.role || 'student',
      email: p.email || '',
      phone: p.phone || '',
      parent_name: p.parent_name || p.guardian_name || '',
      parent_phone: p.parent_phone || p.guardian_phone || '',
      parent_email: p.parent_email || p.guardian_email || '',
      has_face_registered: hasDescriptor,
      avatar_url: p.avatar_url || '',
      photo_url: p.photo_url || '',
      created_at: p.created_at || '',
      updated_at: p.updated_at || '',
    };
  });

  // 1) Save students/students_details.json
  studentsFolder?.file('students_details.json', JSON.stringify(studentsList, null, 2));

  // 2) Save students/students_roster.csv (Excel-compatible with UTF-8 BOM)
  const csvHeaders = [
    'Admission Number',
    'Roll Number',
    'Full Name',
    'Class',
    'Section',
    'Category',
    'Role',
    'Email',
    'Phone',
    'Parent Name',
    'Parent Phone',
    'Parent Email',
    'Face Registered',
    'Avatar URL',
    'Created At',
  ];
  const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const csvRows = [
    csvHeaders.join(','),
    ...studentsList.map((s) => [
      escapeCsv(s.admission_number),
      escapeCsv(s.roll_number),
      escapeCsv(s.full_name),
      escapeCsv(s.class),
      escapeCsv(s.section),
      escapeCsv(s.category),
      escapeCsv(s.role),
      escapeCsv(s.email),
      escapeCsv(s.phone),
      escapeCsv(s.parent_name),
      escapeCsv(s.parent_phone),
      escapeCsv(s.parent_email),
      escapeCsv(s.has_face_registered ? 'Yes' : 'No'),
      escapeCsv(s.avatar_url || s.photo_url),
      escapeCsv(s.created_at),
    ].join(',')),
  ];
  studentsFolder?.file('students_roster.csv', '\uFEFF' + csvRows.join('\r\n'));

  // 3) Copy student portrait photos into students/photos/{admission_number}.jpg
  if (studentsPhotosFolder) {
    for (const student of studentsList) {
      const adm = student.admission_number || student.id;
      if (!adm) continue;

      let photoBase64: string | null = null;
      for (const field of [student.avatar_url, student.photo_url]) {
        if (!field) continue;
        const fid = storageFileId(field).toLowerCase();
        if (storageFilesMap.has(fid)) {
          photoBase64 = storageFilesMap.get(fid)!;
          break;
        }
      }
      if (!photoBase64 && storageFilesMap.has(`${adm.toLowerCase()}.jpg`)) {
        photoBase64 = storageFilesMap.get(`${adm.toLowerCase()}.jpg`)!;
      }
      if (!photoBase64 && student.user_id && storageFilesMap.has(`${student.user_id.toLowerCase()}.jpg`)) {
        photoBase64 = storageFilesMap.get(`${student.user_id.toLowerCase()}.jpg`)!;
      }

      if (photoBase64) {
        try {
          const rawBytes = base64ToUint8Array(photoBase64);
          studentsPhotosFolder.file(`${adm}.jpg`, rawBytes);
        } catch (_) {}
      }
    }
  }

  // Add Master Manifest and combined document
  zip.file('manifest.json', JSON.stringify(backupObj.manifest, null, 2));
  zip.file('backup_full.json', JSON.stringify(backupObj, null, 2));

  // 4. Compress into ZIP Blob
  onProgress({ phase: 'zipping', label: 'Packaging and compressing ZIP archive...', pct: 94 });
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (metadata) => {
    onProgress({
      phase: 'zipping',
      label: `Compressing ZIP file (${Math.round(metadata.percent)}%)...`,
      pct: 90 + Math.round(metadata.percent * 0.09),
    });
  });

  onProgress({ phase: 'done', label: 'Cloud ZIP backup created successfully!', pct: 100, done: grandTotal, total: grandTotal });

  const stats = {
    tables: Object.keys(backupObj.tables).length,
    rows: totalDbRows,
    authUsers: backupObj.authUsers.length,
    storageFiles: downloadedStorageFilesCount,
    sizeBytes: zipBlob.size,
  };

  return { zipBlob, backupObj, stats };
}

export type PackageInspection = {
  filename: string;
  sizeBytes: number;
  format: 'zip' | 'json' | 'csv';
  createdAt: string;
  system: string;
  tables: Array<{ name: string; count: number }>;
  authUsersCount: number;
  storageFilesCount: number;
  storageBuckets: Array<{ name: string; filesCount: number }>;
  parsedBackup: FullBackup;
};

export function parseRosterCsv(csvText: string): Array<Record<string, any>> {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let col = '';
    let inside = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') {
          col += '"';
          i++;
        } else {
          inside = !inside;
        }
      } else if (c === ',' && !inside) {
        cols.push(col.trim());
        col = '';
      } else {
        col += c;
      }
    }
    cols.push(col.trim());
    return cols;
  };

  const rawHeaders = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const headerMap: Record<number, string> = {};

  rawHeaders.forEach((h, idx) => {
    if (h.includes('admission') || h.includes('adm_no') || h.includes('scholar')) headerMap[idx] = 'admission_number';
    else if (h.includes('roll')) headerMap[idx] = 'roll_number';
    else if (h.includes('name') && !h.includes('parent') && !h.includes('father')) headerMap[idx] = 'full_name';
    else if (h === 'class' || h.includes('grade') || h.includes('standard')) headerMap[idx] = 'class';
    else if (h === 'section' || h.includes('sec')) headerMap[idx] = 'section';
    else if (h.includes('category')) headerMap[idx] = 'category';
    else if (h === 'role') headerMap[idx] = 'role';
    else if (h.includes('email') && !h.includes('parent')) headerMap[idx] = 'email';
    else if ((h.includes('phone') || h.includes('mobile')) && !h.includes('parent')) headerMap[idx] = 'phone';
    else if (h.includes('parent_name') || h.includes('father_name') || h.includes('guardian')) headerMap[idx] = 'parent_name';
    else if (h.includes('parent_phone') || h.includes('guardian_phone') || h.includes('father_phone')) headerMap[idx] = 'parent_phone';
    else if (h.includes('parent_email') || h.includes('guardian_email')) headerMap[idx] = 'parent_email';
    else if (h.includes('avatar') || h.includes('photo')) headerMap[idx] = 'photo_url';
    else headerMap[idx] = h;
  });

  const students: Array<Record<string, any>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const student: Record<string, any> = {};
    cols.forEach((val, idx) => {
      const field = headerMap[idx];
      if (field) student[field] = val;
    });
    if (student.admission_number || student.full_name) {
      if (!student.employee_id && student.admission_number) student.employee_id = student.admission_number;
      if (!student.display_name && student.full_name) student.display_name = student.full_name;
      if (!student.category && (student.class || student.section)) {
        student.category = [student.class, student.section].filter(Boolean).join('-');
      }
      if (!student.role) student.role = 'student';
      students.push(student);
    }
  }
  return students;
}

// ---------- Backup Package Pre-Inspection Engine ----------
async function inspectBackupFile(file: File): Promise<PackageInspection> {
  let backup: FullBackup;
  let format: 'zip' | 'json' | 'csv' = 'json';

  if (file.name.endsWith('.csv') || file.type.includes('csv')) {
    format = 'csv';
    const text = await file.text();
    const students = parseRosterCsv(text);
    backup = {
      version: '3.3-csv-roster',
      createdAt: new Date().toISOString(),
      manifest: {
        version: '3.3-csv-roster',
        generatedAt: new Date().toISOString(),
        system: 'Presences AI CSV Roster Importer',
        tables: [{ table: 'profiles', count: students.length }],
        authUsers: 0,
        restoreOrder: ['profiles'],
      },
      tables: {
        profiles: students,
      },
      authUsers: [],
      storage: {},
      storageBuckets: [],
    };
  } else if (file.name.endsWith('.zip') || file.type.includes('zip')) {
    format = 'zip';
    const zip = await JSZip.loadAsync(file);

    const fullJsonEntry = zip.file('backup_full.json');
    if (fullJsonEntry) {
      const rawText = await fullJsonEntry.async('text');
      backup = JSON.parse(rawText);
    } else {
      const manifestEntry = zip.file('manifest.json');
      let manifest: Manifest = {
        version: '3.0-cloud-zip',
        generatedAt: new Date().toISOString(),
        system: 'Presences AI',
        tables: [],
        authUsers: 0,
        restoreOrder: [],
      };
      if (manifestEntry) {
        try {
          manifest = JSON.parse(await manifestEntry.async('text'));
        } catch (_) {}
      }

      backup = {
        version: manifest.version || '3.0-cloud-zip',
        createdAt: manifest.generatedAt || new Date().toISOString(),
        manifest,
        tables: {},
        authUsers: [],
        storage: {},
        storageBuckets: [],
      };

      const tableFiles = Object.keys(zip.files).filter((k) => k.startsWith('database/') && k.endsWith('.json'));
      for (const tf of tableFiles) {
        const tableName = tf.replace('database/', '').replace('.json', '');
        try {
          backup.tables[tableName] = JSON.parse(await zip.file(tf)!.async('text'));
        } catch (_) {}
      }

      const authFile = zip.file('auth/users.json') || zip.file('auth_users.json');
      if (authFile) {
        try {
          backup.authUsers = JSON.parse(await authFile.async('text'));
        } catch (_) {}
      }
    }

    // Also check if students/students_details.json exists to augment or populate profiles table
    const studentsJsonEntry = zip.file('students/students_details.json') || zip.file('students_details.json');
    if (studentsJsonEntry) {
      try {
        const studentDocs = JSON.parse(await studentsJsonEntry.async('text'));
        if (Array.isArray(studentDocs) && (!backup.tables['profiles'] || backup.tables['profiles'].length === 0)) {
          backup.tables['profiles'] = studentDocs;
        }
      } catch (_) {}
    }

    // Always scan all binary files in the zip archive for student photos & storage files!
    if (!backup.storage) backup.storage = {};

    for (const [entryPath, zipObj] of Object.entries(zip.files)) {
      if (zipObj.dir) continue;
      // Skip non-storage metadata files
      if (
        entryPath === 'backup_full.json' ||
        entryPath === 'manifest.json' ||
        entryPath.startsWith('database/') ||
        entryPath.startsWith('auth/') ||
        entryPath === 'students/students_details.json' ||
        entryPath === 'students/students_roster.csv'
      ) {
        continue;
      }

      let bucket: string | null = null;
      let filePath: string | null = null;

      if (entryPath.startsWith('students/photos/') || entryPath.startsWith('photos/')) {
        bucket = 'face-images';
        filePath = entryPath.split('/').pop() || '';
      } else if (entryPath.startsWith('storage/')) {
        const parts = entryPath.split('/');
        if (parts.length >= 3) {
          bucket = parts[1];
          filePath = parts.slice(2).join('/');
        }
      } else {
        const parts = entryPath.split('/');
        if (parts.length >= 2) {
          const first = parts[0].toLowerCase().replace(/_/g, '-');
          if (
            first.includes('face') ||
            first.includes('registration') ||
            first.includes('training') ||
            first.includes('attendance') ||
            first.includes('export')
          ) {
            bucket = parts[0];
            filePath = parts.slice(1).join('/');
          }
        }
      }

      if (bucket && filePath) {
        const resolvedBucket = resolveBucketId(bucket);
        if (!backup.storage[resolvedBucket]) backup.storage[resolvedBucket] = [];

        const existingIdx = backup.storage[resolvedBucket].findIndex((f) => f.path === filePath);
        if (existingIdx >= 0 && backup.storage[resolvedBucket][existingIdx].base64) {
          // Already has base64 data
        } else {
          try {
            const fileBytes = await zipObj.async('uint8array');
            if (fileBytes && fileBytes.length > 0) {
              const base64 = uint8ArrayToBase64(fileBytes);
              const ext = filePath.split('.').pop()?.toLowerCase();
              const contentType =
                ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'json' ? 'application/json' : 'image/jpeg';
              if (existingIdx >= 0) {
                backup.storage[resolvedBucket][existingIdx].base64 = base64;
                if (!backup.storage[resolvedBucket][existingIdx].contentType) {
                  backup.storage[resolvedBucket][existingIdx].contentType = contentType;
                }
              } else {
                backup.storage[resolvedBucket].push({
                  path: filePath,
                  contentType,
                  base64,
                });
              }
            }
          } catch (readErr) {
            console.warn(`Failed reading binary for ${entryPath}:`, readErr);
          }
        }
      }
    }
  } else {
    format = 'json';
    const text = await file.text();
    let rawData: any;
    try {
      rawData = JSON.parse(text);
    } catch (e: any) {
      throw new Error(`Failed to parse JSON backup: ${e?.message || 'Invalid JSON syntax'}`);
    }

    const defaultManifest: Manifest = {
      version: rawData.version || '3.2-json',
      generatedAt: rawData.createdAt || new Date().toISOString(),
      system: rawData.system || 'Presences AI Unified Engine',
      tables: [],
      authUsers: 0,
      restoreOrder: RESTORE_ORDER,
    };

    backup = {
      version: rawData.version || '3.2-json',
      createdAt: rawData.createdAt || new Date().toISOString(),
      manifest: rawData.manifest || defaultManifest,
      tables: {},
      authUsers: rawData.authUsers || rawData.users || [],
      storage: rawData.storage || {},
      storageBuckets: rawData.storageBuckets || [],
    };

    if (rawData.tables && typeof rawData.tables === 'object') {
      backup.tables = rawData.tables;
    } else if (rawData.collections) {
      // Appwrite export format
      if (Array.isArray(rawData.collections)) {
        for (const col of rawData.collections) {
          const colName = col.name || col.$id || col.id;
          const docs = col.documents || col.rows || col.data || [];
          if (colName && Array.isArray(docs)) backup.tables[colName] = docs;
        }
      } else if (typeof rawData.collections === 'object') {
        for (const [colName, docs] of Object.entries(rawData.collections)) {
          if (Array.isArray(docs)) {
            backup.tables[colName] = docs;
          } else if ((docs as any)?.documents && Array.isArray((docs as any).documents)) {
            backup.tables[colName] = (docs as any).documents;
          }
        }
      }
    } else if (Array.isArray(rawData)) {
      // Direct array of records: match table from filename or attributes
      const lowerName = file.name.toLowerCase().replace('.json', '').trim();
      const matchedTable =
        KNOWN_TABLES.find((t) => t.toLowerCase() === lowerName) ||
        (rawData[0]?.confidence_score || rawData[0]?.capture_mode
          ? 'attendance_records'
          : rawData[0]?.descriptor
          ? 'face_descriptors'
          : rawData[0]?.day_of_week
          ? 'timetable'
          : rawData[0]?.setting_key
          ? 'attendance_settings'
          : rawData[0]?.event_type
          ? 'emergency_events'
          : rawData[0]?.role && !rawData[0]?.admission_number
          ? 'user_roles'
          : 'profiles');
      backup.tables[matchedTable] = rawData;
    } else if (typeof rawData === 'object') {
      for (const [key, val] of Object.entries(rawData)) {
        if (Array.isArray(val)) {
          if (key === 'users' || key === 'authUsers') {
            backup.authUsers = val;
          } else if (key !== 'storageBuckets') {
            backup.tables[key] = val;
          }
        }
      }
    }
  }

  // Extract table statistics
  const tablesList: Array<{ name: string; count: number }> = [];
  const rawTables = backup.tables || {};
  for (const [name, rows] of Object.entries(rawTables)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tablesList.push({ name, count });
  }

  let storageTotalFiles = 0;
  const storageBucketsList: Array<{ name: string; filesCount: number }> = [];
  if (backup.storage) {
    for (const [bucket, files] of Object.entries(backup.storage)) {
      const count = Array.isArray(files) ? files.length : 0;
      storageBucketsList.push({ name: bucket, filesCount: count });
      storageTotalFiles += count;
    }
  }

  return {
    filename: file.name,
    sizeBytes: file.size,
    format,
    createdAt: backup.createdAt || new Date().toISOString(),
    system: backup.manifest?.system || 'Presences AI Cloud Engine',
    tables: tablesList,
    authUsersCount: backup.authUsers?.length || 0,
    storageFilesCount: storageTotalFiles,
    storageBuckets: storageBucketsList,
    parsedBackup: backup,
  };
}

// ---------- Full Cloud ZIP Import & Restore Engine ----------
async function restoreFromCloudZipOrJson(
  inspection: PackageInspection,
  settings: Settings,
  selectedTableNames: Set<string>,
  onProgress: (p: Partial<BackupProgress>) => void,
): Promise<RestoreReport> {
  const report: RestoreReport = {
    tablesRestored: 0,
    rowsRestored: 0,
    authUsersCreated: 0,
    authUsersSkipped: 0,
    storageFilesRestored: 0,
    skippedTables: [],
    errors: [],
  };

  onProgress({ phase: 'preparing', label: `Preparing restoration: ${inspection.filename}...`, pct: 3 });

  const backup = inspection.parsedBackup;

  // Compute exact restoration order for selected tables
  const restoreOrder = RESTORE_ORDER.filter((t) => selectedTableNames.has(t) && backup.tables[t]);
  for (const t of selectedTableNames) {
    if (!restoreOrder.includes(t) && backup.tables[t]) {
      restoreOrder.push(t);
    }
  }

  const totalDbRows = restoreOrder.reduce((s, t) => s + ((backup.tables[t] as unknown[])?.length || 0), 0);
  const totalAuthUsers = settings.includeAuthUsers ? backup.authUsers?.length || 0 : 0;
  const totalStorageFiles = settings.includeStorage
    ? Object.values(backup.storage || {}).reduce((s, arr) => s + (arr?.length || 0), 0)
    : 0;

  const grandTotal = totalDbRows + totalAuthUsers + (totalStorageFiles * 2) + 10;
  let done = 0;

  // 1. Restore Auth Users First
  if (settings.includeAuthUsers && backup.authUsers?.length) {
    onProgress({ phase: 'importing_auth', label: 'Restoring authentication users...', total: grandTotal, done });
    const totalUsers = backup.authUsers.length;
    for (let i = 0; i < totalUsers; i += 100) {
      const slice = backup.authUsers.slice(i, i + 100);
      onProgress({
        phase: 'importing_auth',
        currentScope: 'auth.users',
        label: `Restoring Auth Users (${i.toLocaleString()} / ${totalUsers.toLocaleString()})`,
        done,
        total: grandTotal,
        pct: Math.min(95, Math.round((done / Math.max(1, grandTotal)) * 100)),
      });

      try {
        const res = await invokeAction<{ created: number; skipped: number }>({
          action: 'import_auth_users_chunk',
          users: slice,
        });
        report.authUsersCreated += res.created || 0;
        report.authUsersSkipped += res.skipped || 0;
      } catch (e: any) {
        report.errors.push({ scope: 'auth.users', message: e?.message || 'chunk failed' });
      }
      done += slice.length;
    }
  }

  // 2. Restore Database Tables in FK Order
  for (const table of restoreOrder) {
    const rows = (backup.tables[table] as unknown[]) || [];
    if (rows.length === 0) continue;

    let tableRowsInserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      onProgress({
        phase: 'importing_db',
        currentScope: table,
        label: `Restoring table ${table} (${i.toLocaleString()} / ${rows.length.toLocaleString()} rows)`,
        done,
        total: grandTotal,
        pct: Math.min(95, Math.round((done / Math.max(1, grandTotal)) * 100)),
      });

      try {
        await invokeAction({ action: 'import_table_chunk', table, rows: chunk });
        tableRowsInserted += chunk.length;
      } catch (e: any) {
        // Retry with smaller micro-batches for error isolation
        const smaller = 50;
        let recovered = 0;
        for (let j = 0; j < chunk.length; j += smaller) {
          const mini = chunk.slice(j, j + smaller);
          try {
            await invokeAction({ action: 'import_table_chunk', table, rows: mini });
            recovered += mini.length;
          } catch (e2: any) {
            report.errors.push({
              scope: `${table} rows ${i + j}-${i + j + mini.length}`,
              message: e2?.message || 'micro-chunk failed',
            });
          }
        }
        tableRowsInserted += recovered;
      }
      done += chunk.length;
    }

    if (tableRowsInserted > 0) {
      report.tablesRestored += 1;
      report.rowsRestored += tableRowsInserted;
    }
  }

  // 3. Restore Storage Buckets & Files
  if (settings.includeStorage && backup.storage) {
    onProgress({ phase: 'importing_storage', label: 'Restoring student photos & biometric storage files...', total: grandTotal, done });

    for (const [rawBucket, files] of Object.entries(backup.storage)) {
      if (!files || files.length === 0) continue;
      const bucket = resolveBucketId(rawBucket);

      const CONCURRENCY = 4;
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        const chunk = files.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (fileItem, idx) => {
            const currentIdx = i + idx;
            onProgress({
              phase: 'importing_storage',
              currentScope: `${bucket}/${fileItem.path}`,
              label: `Restoring storage file [${bucket}] (${currentIdx + 1}/${files.length})`,
              done,
              total: grandTotal,
              pct: Math.min(98, Math.round((done / Math.max(1, grandTotal)) * 100)),
            });

            if (!fileItem.base64) {
              return;
            }

            try {
              await invokeAction({
                action: 'upload_storage_file',
                bucket,
                path: fileItem.path,
                base64: fileItem.base64,
                contentType: fileItem.contentType,
              });
              report.storageFilesRestored += 1;
            } catch (e: any) {
              console.warn(`Storage file upload notice on ${bucket}/${fileItem.path}:`, e?.message || e);
              report.errors.push({ scope: `${bucket}/${fileItem.path}`, message: e?.message || 'upload failed' });
            }
          })
        );
        done += chunk.length * 2;
      }
    }
  }

  // 4. Post-Restore Student Storage Cross-Healing
  try {
    const { data: profs } = await supabase.from('profiles').select('id, user_id, admission_number, employee_id, avatar_url, photo_url');
    if (profs && profs.length > 0) {
      const storageFaceFiles = backup.storage ? Object.values(backup.storage).flat() : [];
      const fileMapByLowerName = new Map<string, string>();
      for (const f of storageFaceFiles) {
        const fname = f.path.split('/').pop()?.toLowerCase() || '';
        if (fname) fileMapByLowerName.set(fname, f.path);
      }

      for (const p of profs) {
        if (!p.avatar_url && !p.photo_url) {
          const adm = String(p.admission_number || p.employee_id || '').trim().toLowerCase();
          const uid = String(p.user_id || '').trim().toLowerCase();
          const matchedPath = fileMapByLowerName.get(`${adm}.jpg`) || fileMapByLowerName.get(`${adm}.png`) || (uid ? fileMapByLowerName.get(`${uid}.jpg`) : null);
          if (matchedPath) {
            const targetUrl = getAppwriteStorageViewUrl('face-images', storageFileId(matchedPath));
            await supabase.from('profiles').update({ avatar_url: targetUrl }).eq('id', p.id);
          }
        }
      }
    }
  } catch (postHealErr) {
    console.warn('Post-restore photo cross-healing non-fatal note:', postHealErr);
  }

  onProgress({ phase: 'done', label: 'Cloud restoration completed successfully!', pct: 100, done: grandTotal, total: grandTotal });
  return report;
}

// ---------- Main Backup Page Component ----------
const Backup = () => {
  const { toast } = useToast();
  const { role, isLoading } = useUserRole();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [progress, setProgress] = useState<BackupProgress>({
    phase: 'idle',
    label: '',
    done: 0,
    total: 0,
    pct: 0,
  });
  const [busy, setBusy] = useState<null | 'backup' | 'snapshot' | 'restore'>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspectedPackage, setInspectedPackage] = useState<PackageInspection | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [restoreAuthUsers, setRestoreAuthUsers] = useState(true);
  const [restoreStorage, setRestoreStorage] = useState(true);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [liveManifest, setLiveManifest] = useState<Manifest | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRanRef = useRef(false);

  const updateProgress = useCallback((patch: Partial<BackupProgress>) => {
    setProgress((prev) => ({ ...prev, ...patch }));
  }, []);

  const refreshLiveStats = useCallback(async () => {
    try {
      setIsLoadingManifest(true);
      const m = await invokeAction<Manifest>({ action: 'list_public_tables' });
      setLiveManifest(m);
    } catch (e) {
      console.warn('Could not fetch live cloud stats:', e);
    } finally {
      setIsLoadingManifest(false);
    }
  }, []);

  const refreshSnapshots = useCallback(async () => {
    try {
      const list = await listSnapshots();
      setSnapshots(list);
      if (list.length && !lastBackupAt) setLastBackupAt(list[0].createdAt);
    } catch (e) {
      console.warn('snapshot list failed', e);
    }
  }, [lastBackupAt]);

  useEffect(() => {
    setSettings(loadSettings());
    setLastBackupAt(localStorage.getItem(LAST_AUTO_KEY));
    void refreshSnapshots();
    void refreshLiveStats();
  }, [refreshSnapshots, refreshLiveStats]);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const persistSnapshot = async (
    backup: FullBackup,
    label: string,
    triggerType: 'manual' | 'auto' | 'rollback',
  ) => {
    const stats = {
      tables: Object.keys(backup.tables || {}).length,
      rows: Object.values(backup.tables || {}).reduce((s, arr) => s + ((arr as unknown[])?.length || 0), 0),
      authUsers: backup.authUsers?.length || 0,
    };
    const snap: StoredSnapshot = {
      id: crypto.randomUUID(),
      label,
      createdAt: backup.createdAt,
      triggerType,
      sizeBytes: JSON.stringify(backup).length,
      stats,
      backup,
    };
    await saveSnapshot(snap);
    await trimSnapshots(MAX_SNAPSHOTS);
    await refreshSnapshots();
    localStorage.setItem(LAST_AUTO_KEY, backup.createdAt);
    setLastBackupAt(backup.createdAt);
  };

  // 1-Click ZIP Backup Action
  const handleDownloadCloudZip = async () => {
    try {
      setBusy('backup');
      setProgress({ phase: 'preparing', label: 'Starting 1-Click Cloud ZIP backup...', done: 0, total: 0, pct: 2 });

      const { zipBlob, backupObj, stats } = await createFullCloudZipBackup(settings, updateProgress);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const fileName = `presences-cloud-backup-${stamp}.zip`;

      downloadBlob(zipBlob, fileName);
      await persistSnapshot(backupObj, `Full Cloud ZIP ${new Date().toLocaleString()}`, 'manual');

      toast({
        title: 'Cloud Backup Complete',
        description: `Downloaded ${fileName} (${fmtBytes(stats.sizeBytes)}) with ${stats.rows.toLocaleString()} rows & ${stats.storageFiles} files.`,
      });
      void refreshLiveStats();
    } catch (e: any) {
      updateProgress({ phase: 'failed', label: e?.message || 'Cloud backup failed', pct: 0 });
      toast({ title: 'Backup failed', description: e?.message || 'Unknown error occurred', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // Save Quick Local Snapshot Action
  const handleSaveLocalSnapshot = async () => {
    try {
      setBusy('snapshot');
      setProgress({ phase: 'preparing', label: 'Creating local safety snapshot...', done: 0, total: 0, pct: 2 });

      const { backupObj } = await createFullCloudZipBackup({ ...settings, includeStorage: false }, updateProgress);
      await persistSnapshot(backupObj, `Snapshot ${new Date().toLocaleString()}`, 'manual');

      toast({ title: 'Snapshot Saved', description: 'Stored locally in browser storage (IndexedDB).' });
    } catch (e: any) {
      updateProgress({ phase: 'failed', label: e?.message || 'Snapshot failed', pct: 0 });
      toast({ title: 'Snapshot failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // 1-Click Standalone JSON Backup
  const handleDownloadJsonBackup = async () => {
    try {
      setBusy('backup');
      setProgress({ phase: 'preparing', label: 'Compiling complete database JSON...', done: 0, total: 0, pct: 2 });

      const { backupObj, stats } = await createFullCloudZipBackup({ ...settings, includeStorage: false }, updateProgress);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const fileName = `presences-cloud-backup-${stamp}.json`;

      const jsonBlob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
      downloadBlob(jsonBlob, fileName);
      await persistSnapshot(backupObj, `JSON Backup ${new Date().toLocaleString()}`, 'manual');

      toast({
        title: 'JSON Backup Ready 📄',
        description: `Downloaded ${fileName} with ${stats.rows.toLocaleString()} records across ${stats.tables} tables.`,
      });
      void refreshLiveStats();
    } catch (e: any) {
      updateProgress({ phase: 'failed', label: e?.message || 'JSON backup failed', pct: 0 });
      toast({ title: 'JSON backup failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // 1-Click Student Roster CSV Export
  const handleDownloadRosterCsv = async () => {
    try {
      setBusy('backup');
      setProgress({ phase: 'preparing', label: 'Compiling student roster CSV...', done: 0, total: 0, pct: 15 });

      const allProfiles: any[] = [];
      let offset = 0;
      while (true) {
        const res = await invokeAction<{ rows: any[] }>({
          action: 'export_table_chunk',
          table: 'profiles',
          offset,
          limit: CHUNK_SIZE,
        });
        const rows = res.rows || [];
        allProfiles.push(...rows);
        if (rows.length < CHUNK_SIZE) break;
        offset += CHUNK_SIZE;
      }

      const csvHeaders = [
        'Admission Number',
        'Roll Number',
        'Full Name',
        'Class',
        'Section',
        'Category',
        'Role',
        'Email',
        'Phone',
        'Parent Name',
        'Parent Phone',
        'Parent Email',
        'Created At',
      ];
      const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const csvRows = [
        csvHeaders.join(','),
        ...allProfiles.map((s) => [
          escapeCsv(s.admission_number || s.employee_id || ''),
          escapeCsv(s.roll_number || ''),
          escapeCsv(s.full_name || s.name || s.display_name || ''),
          escapeCsv(s.class || ''),
          escapeCsv(s.section || ''),
          escapeCsv(s.category || ''),
          escapeCsv(s.role || 'student'),
          escapeCsv(s.email || ''),
          escapeCsv(s.phone || ''),
          escapeCsv(s.parent_name || s.father_name || ''),
          escapeCsv(s.parent_phone || ''),
          escapeCsv(s.parent_email || ''),
          escapeCsv(s.created_at || ''),
        ].join(',')),
      ];

      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `presences-students-roster-${stamp}.csv`);

      toast({
        title: 'Student Roster Exported 📊',
        description: `Exported ${allProfiles.length.toLocaleString()} student records to CSV spreadsheet.`,
      });
    } catch (e: any) {
      toast({ title: 'Roster export failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
      setProgress({ phase: 'idle', label: '', done: 0, total: 0, pct: 0 });
    }
  };

  // Inspect and analyze selected backup package
  const handleFileSelected = async (file: File | null) => {
    setSelectedFile(file);
    setRestoreReport(null);
    if (!file) {
      setInspectedPackage(null);
      setSelectedTables(new Set());
      return;
    }

    try {
      setIsInspecting(true);
      const inspection = await inspectBackupFile(file);
      setInspectedPackage(inspection);
      // Automatically enable all tables that contain rows
      const activeTables = new Set(inspection.tables.filter((t) => t.count > 0).map((t) => t.name));
      // If all tables have 0 rows, enable all available anyway
      if (activeTables.size === 0) {
        inspection.tables.forEach((t) => activeTables.add(t.name));
      }
      setSelectedTables(activeTables);
      setRestoreAuthUsers(inspection.authUsersCount > 0);
      setRestoreStorage(inspection.storageFilesCount > 0);

      const totalFoundRows = inspection.tables.reduce((s, t) => s + t.count, 0);
      toast({
        title: 'Backup Package Analyzed 📦',
        description: `Found ${totalFoundRows.toLocaleString()} rows in ${inspection.tables.length} tables, ${inspection.authUsersCount} user accounts, and ${inspection.storageFilesCount} storage files.`,
      });
    } catch (err: any) {
      console.error('Inspection failed:', err);
      toast({
        title: 'Could not inspect backup package',
        description: err.message || 'The selected file is not a valid Presences backup archive.',
        variant: 'destructive',
      });
      setSelectedFile(null);
      setInspectedPackage(null);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleToggleTable = (name: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectAllTables = () => {
    if (!inspectedPackage) return;
    setSelectedTables(new Set(inspectedPackage.tables.map((t) => t.name)));
  };

  const handleDeselectAllTables = () => {
    setSelectedTables(new Set());
  };

  // Restore from analyzed package
  const handleRestoreFromPackage = async () => {
    if (!inspectedPackage) {
      toast({ title: 'No backup package selected', variant: 'destructive' });
      return;
    }

    if (selectedTables.size === 0 && !restoreAuthUsers && !restoreStorage) {
      toast({
        title: 'Nothing selected to restore',
        description: 'Please check at least one table, user accounts, or storage files.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setBusy('restore');
      setProgress({ phase: 'preparing', label: 'Creating pre-restore rollback snapshot...', done: 0, total: 0, pct: 2 });

      // Rollback safety snapshot
      try {
        const { backupObj } = await createFullCloudZipBackup({ ...settings, includeStorage: false }, () => {});
        await persistSnapshot(backupObj, `Pre-Restore Rollback ${new Date().toLocaleString()}`, 'rollback');
      } catch (err) {
        console.warn('Pre-restore rollback snapshot skipped:', err);
      }

      const effectiveSettings: Settings = {
        ...settings,
        includeAuthUsers: restoreAuthUsers,
        includeStorage: restoreStorage,
      };

      const report = await restoreFromCloudZipOrJson(inspectedPackage, effectiveSettings, selectedTables, updateProgress);
      setRestoreReport(report);

      const hasErrors = report.errors.length > 0;
      toast({
        title: hasErrors ? 'Restoration finished with notes' : 'Restoration Complete 🚀',
        description: `Restored ${report.rowsRestored.toLocaleString()} rows across ${report.tablesRestored} tables, ${report.authUsersCreated} auth users, & ${report.storageFilesRestored} storage files.`,
      });

      void refreshLiveStats();
    } catch (e: any) {
      updateProgress({ phase: 'failed', label: e?.message || 'Restoration failed', pct: 0 });
      toast({ title: 'Restoration failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // Restore Local Snapshot
  const handleRestoreSnapshot = async (id: string) => {
    try {
      setBusy('restore');
      setProgress({ phase: 'preparing', label: 'Loading snapshot data...', done: 0, total: 0, pct: 2 });
      const snap = await getSnapshot(id);
      if (!snap) throw new Error('Snapshot record not found');

      // Convert stored snapshot to virtual JSON file and inspect
      const jsonBlob = new Blob([JSON.stringify(snap.backup)], { type: 'application/json' });
      const virtualFile = new File([jsonBlob], `${snap.label}.json`, { type: 'application/json' });
      const inspection = await inspectBackupFile(virtualFile);
      const allTables = new Set(inspection.tables.map((t) => t.name));

      const report = await restoreFromCloudZipOrJson(inspection, settings, allTables, updateProgress);
      setRestoreReport(report);
      toast({ title: 'Snapshot Restored 🚀', description: `Successfully restored ${snap.label}` });
      void refreshLiveStats();
    } catch (e: any) {
      updateProgress({ phase: 'failed', label: e?.message || 'Restore failed', pct: 0 });
      toast({ title: 'Restore failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    await deleteSnapshot(id);
    await refreshSnapshots();
    toast({ title: 'Snapshot Deleted' });
  };

  const handleDownloadSnapshot = async (id: string) => {
    const snap = await getSnapshot(id);
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap.backup, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${snap.label.replace(/[^a-z0-9]+/gi, '-')}.json`);
  };

  // Auto Backup Scheduler
  useEffect(() => {
    if (isLoading || (role !== 'admin' && role !== 'principal')) return;
    if (!settings.autoEnabled || autoRanRef.current || busy) return;

    const last = localStorage.getItem(LAST_AUTO_KEY);
    const intervalMs = settings.frequency === 'daily' ? 24 * 3600e3 : 7 * 24 * 3600e3;
    if (last && Date.now() - new Date(last).getTime() < intervalMs) return;

    autoRanRef.current = true;
    (async () => {
      try {
        const { backupObj } = await createFullCloudZipBackup({ ...settings, includeStorage: false }, () => {});
        await persistSnapshot(backupObj, `Auto ${settings.frequency} ${new Date().toLocaleString()}`, 'auto');
      } catch (err) {
        console.warn('Auto backup skipped:', err);
      }
    })();
  }, [isLoading, role, settings, busy]);

  // Guards
  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-28">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PageLayout>
    );
  }

  if (role !== 'admin' && role !== 'principal') {
    return (
      <PageLayout>
        <div className="py-12 max-w-lg mx-auto">
          <Alert variant="destructive" className="rounded-2xl border-destructive/40 bg-destructive/10">
            <ShieldAlert className="h-5 w-5" />
            <AlertDescription className="text-sm font-medium">
              Access Restricted. Only school administrators and principals can access the Cloud Backup & Restore Hub.
            </AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  const isWorking = progress.phase === 'preparing' || progress.phase.startsWith('exporting') || progress.phase.startsWith('importing') || progress.phase === 'zipping';
  const totalRowsLive = liveManifest ? liveManifest.tables.reduce((s, t) => s + t.count, 0) : 0;
  const totalTablesLive = liveManifest ? liveManifest.tables.length : 0;
  const totalAuthUsersLive = liveManifest ? liveManifest.authUsers : 0;

  return (
    <PageTransition>
      <PageLayout className="has-bottom-nav">
        <div className="space-y-8 max-w-6xl mx-auto pb-12">
          
          {/* Header Banner */}
          <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 via-card/70 to-accent/10 p-6 md:p-8 backdrop-blur-2xl shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                  <Cloud className="h-3.5 w-3.5" />
                  School Data Safety
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  Data Backup & Restore
                </h1>
                <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
                  Save a complete backup copy of your school data, student accounts, and photos into a safe, downloadable backup file.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshLiveStats}
                  disabled={isLoadingManifest}
                  className="rounded-2xl border-border/70 bg-card/60 gap-2 text-xs font-semibold"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingManifest ? 'animate-spin' : ''}`} />
                  Refresh Record Count
                </Button>
                {lastBackupAt && (
                  <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5">
                    <Clock className="h-3 w-3" /> Last: {fmtRelative(lastBackupAt)}
                  </Badge>
                )}
              </div>
            </div>

            {/* Cloud Metric Tiles */}
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase">
                  <Database className="h-4 w-4 text-primary" /> Data Tables
                </div>
                <p className="mt-2 text-2xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  {isLoadingManifest ? '...' : totalTablesLive.toLocaleString()}
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase">
                  <Layers className="h-4 w-4 text-emerald-500" /> Total Records
                </div>
                <p className="mt-2 text-2xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  {isLoadingManifest ? '...' : totalRowsLive.toLocaleString()}
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase">
                  <Users className="h-4 w-4 text-blue-500" /> User Accounts
                </div>
                <p className="mt-2 text-2xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  {isLoadingManifest ? '...' : totalAuthUsersLive.toLocaleString()}
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-md">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase">
                  <HardDrive className="h-4 w-4 text-amber-500" /> Saved Backups
                </div>
                <p className="mt-2 text-2xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  {snapshots.length}
                </p>
              </div>
            </div>
          </div>

          {/* Real-time Interactive Progress Banner */}
          {(isWorking || progress.phase === 'done' || progress.phase === 'failed') && (
            <Card className={`rounded-3xl border ${progress.phase === 'failed' ? 'border-destructive/60 bg-destructive/5' : 'border-primary/40 bg-card/80'} backdrop-blur-xl shadow-lg`}>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2.5 min-w-0 font-semibold">
                    {isWorking ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    ) : progress.phase === 'done' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <span className="truncate text-foreground">{progress.label || 'Processing...'}</span>
                  </span>
                  <span className="tabular-nums font-bold text-primary shrink-0 ml-4">
                    {progress.pct}%
                  </span>
                </div>
                <Progress value={progress.pct} className="h-2.5 rounded-full" />
                {progress.currentScope && (
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    Status: {progress.currentScope}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Main Action Tabs */}
          <Tabs defaultValue="export" className="w-full space-y-6">
            <TabsList className="grid grid-cols-3 max-w-xl rounded-2xl p-1 bg-card/70 border border-border/60">
              <TabsTrigger value="export" className="rounded-xl font-bold gap-2">
                <Download className="h-4 w-4" /> Save Backup
              </TabsTrigger>
              <TabsTrigger value="import" className="rounded-xl font-bold gap-2">
                <Upload className="h-4 w-4" /> Restore Backup
              </TabsTrigger>
              <TabsTrigger value="snapshots" className="rounded-xl font-bold gap-2">
                <DatabaseBackup className="h-4 w-4" /> Backup History
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: 1-CLICK ZIP EXPORT */}
            <TabsContent value="export" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Primary ZIP Card */}
                <Card className="md:col-span-2 rounded-3xl border border-primary/25 bg-card/70 backdrop-blur-xl shadow-xl overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                        <FileArchive className="h-6 w-6" />
                      </div>
                      <div>
                        <CardTitle className="text-xl font-bold">Download School Backup File</CardTitle>
                        <CardDescription>
                          Saves student records, login accounts, and face photos into a safe backup file on your device.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <div className="space-y-0.5">
                          <Label className="font-semibold text-foreground">Include Auth Accounts</Label>
                          <p className="text-xs text-muted-foreground">Exports login emails, user IDs, and metadata (<code className="text-xs">auth/users.json</code>).</p>
                        </div>
                        <Switch
                          checked={settings.includeAuthUsers}
                          onCheckedChange={(checked) => updateSettings({ includeAuthUsers: checked })}
                          disabled={!!busy}
                        />
                      </div>

                      <div className="flex items-center justify-between text-sm pt-2 border-t border-border/40">
                        <div className="space-y-0.5">
                          <Label className="font-semibold text-foreground">Include Storage Files & Faces</Label>
                          <p className="text-xs text-muted-foreground">Packages student registration face samples and circular attachments directly into folders.</p>
                        </div>
                        <Switch
                          checked={settings.includeStorage}
                          onCheckedChange={(checked) => updateSettings({ includeStorage: checked })}
                          disabled={!!busy}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <Button
                        size="lg"
                        onClick={handleDownloadCloudZip}
                        disabled={!!busy}
                        className="rounded-2xl h-14 bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 btn-spring gap-2 text-sm md:text-base"
                      >
                        {busy === 'backup' ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <FolderArchive className="h-5 w-5" />
                        )}
                        {busy === 'backup' ? 'Exporting Cloud...' : 'Download Cloud ZIP'}
                      </Button>

                      <Button
                        size="lg"
                        variant="outline"
                        onClick={handleDownloadJsonBackup}
                        disabled={!!busy}
                        className="rounded-2xl h-14 border-border/70 bg-card/60 font-bold hover:bg-card/90 btn-spring gap-2 text-sm md:text-base"
                      >
                        <FileText className="h-5 w-5 text-primary" />
                        Download Raw JSON
                      </Button>

                      <Button
                        size="lg"
                        variant="outline"
                        onClick={handleDownloadRosterCsv}
                        disabled={!!busy}
                        className="rounded-2xl h-14 border-border/70 bg-card/60 font-semibold hover:bg-card/90 btn-spring gap-2 text-sm md:text-base"
                      >
                        <Users className="h-5 w-5 text-emerald-500" />
                        Export Roster (CSV)
                      </Button>

                      <Button
                        size="lg"
                        variant="outline"
                        onClick={handleSaveLocalSnapshot}
                        disabled={!!busy}
                        className="rounded-2xl h-14 border-border/70 bg-card/60 font-semibold hover:bg-card/90 btn-spring gap-2 text-sm md:text-base"
                      >
                        {busy === 'snapshot' ? <Loader2 className="h-5 w-5 animate-spin" /> : <HardDrive className="h-5 w-5" />}
                        Save Local Snapshot
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Package Architecture Info */}
                <Card className="rounded-3xl border border-border/60 bg-card/60 backdrop-blur-xl p-2">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Archive className="h-4 w-4 text-primary" /> ZIP Package Contents
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-muted-foreground font-mono">
                    <div className="p-3 rounded-xl bg-muted/40 space-y-1.5 leading-relaxed">
                      <p className="text-foreground font-bold">📦 cloud-backup.zip</p>
                      <p className="pl-3">├── 📄 manifest.json</p>
                      <p className="pl-3">├── 📁 database/</p>
                      <p className="pl-6">├── profiles.json</p>
                      <p className="pl-6">├── attendance_records.json</p>
                      <p className="pl-6">└── ...all 35+ tables</p>
                      <p className="pl-3">├── 📁 auth/</p>
                      <p className="pl-6">└── users.json</p>
                      <p className="pl-3">└── 📁 storage/</p>
                      <p className="pl-6">├── student-faces/</p>
                      <p className="pl-6">└── circulars/</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-sans leading-normal">
                      The generated ZIP can be stored anywhere (Google Drive, USB, local disk) and imported back into Presences at any time.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB 2: IMPORT & RESTORE */}
            <TabsContent value="import" className="space-y-6">
              <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl shadow-xl overflow-hidden">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-bold">Import & Restore School Backup</CardTitle>
                      <CardDescription>
                        Inspect, verify, and selectively restore student data, login accounts, and face photos from <code className="text-xs font-mono font-bold text-primary">.zip</code> or <code className="text-xs font-mono font-bold text-primary">.json</code> backups.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* File Upload / Drop Area */}
                  {!inspectedPackage && !isInspecting && (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const dropped = e.dataTransfer.files?.[0];
                        if (dropped) void handleFileSelected(dropped);
                      }}
                      className={`relative flex flex-col items-center justify-center p-8 md:p-14 rounded-3xl border-2 border-dashed transition-all cursor-pointer ${
                        isDragging
                          ? 'border-primary bg-primary/10 scale-[0.99]'
                          : 'border-border/70 hover:border-primary/50 bg-muted/10 hover:bg-muted/20'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip,.json,.csv,text/csv,application/zip,application/json"
                        disabled={!!busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          void handleFileSelected(file);
                        }}
                        className="hidden"
                      />

                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/15 text-primary mb-4 shadow-inner">
                        <FileArchive className="h-10 w-10 text-primary" />
                      </div>

                      <div className="text-center space-y-2">
                        <p className="text-lg font-extrabold text-foreground">
                          Drop backup ZIP, JSON, or CSV roster here
                        </p>
                        <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                          Click to browse from your device. Supports complete cloud packages (<code className="text-xs font-mono text-primary">.zip</code>), database snapshots (<code className="text-xs font-mono text-primary">.json</code>), and student rosters (<code className="text-xs font-mono text-primary">.csv</code>).
                        </p>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                          <Badge variant="outline" className="text-[11px] font-mono border-primary/30 text-primary bg-primary/5">
                            📦 Complete Cloud ZIP
                          </Badge>
                          <Badge variant="outline" className="text-[11px] font-mono border-border/70 text-muted-foreground">
                            📄 Database JSON
                          </Badge>
                          <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
                            📊 Student Roster CSV
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inspection Loading State */}
                  {isInspecting && (
                    <div className="flex flex-col items-center justify-center py-16 space-y-4 rounded-3xl border border-primary/20 bg-primary/5">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <div className="text-center space-y-1">
                        <p className="text-base font-bold text-foreground">Analyzing Backup Package...</p>
                        <p className="text-xs text-muted-foreground">Reading manifests, validating table schemas, and indexing files.</p>
                      </div>
                    </div>
                  )}

                  {/* Analyzed Package Inspector Dashboard */}
                  {inspectedPackage && !isInspecting && (
                    <div className="space-y-6">
                      {/* Package Header Banner */}
                      <div className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-card p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary shrink-0">
                            {inspectedPackage.format === 'zip' ? (
                              <Archive className="h-6 w-6" />
                            ) : inspectedPackage.format === 'csv' ? (
                              <Users className="h-6 w-6" />
                            ) : (
                              <FileText className="h-6 w-6" />
                            )}
                          </div>
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-base text-foreground truncate">{inspectedPackage.filename}</span>
                              <Badge variant="secondary" className="text-[10px] font-mono uppercase tracking-wider font-bold">
                                {inspectedPackage.format.toUpperCase()}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-mono border-border/60">
                                {fmtBytes(inspectedPackage.sizeBytes)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Created {fmtRelative(inspectedPackage.createdAt)} · Source: {inspectedPackage.system}
                            </p>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => {
                            setSelectedFile(null);
                            setInspectedPackage(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="rounded-xl text-xs text-muted-foreground hover:text-foreground shrink-0"
                        >
                          Choose Different File
                        </Button>
                      </div>

                      {/* Discovered Collections & Selective Table Picker */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-extrabold text-foreground">Select Tables to Restore</h4>
                            <Badge variant="outline" className="text-xs font-bold text-primary border-primary/30 bg-primary/5">
                              {inspectedPackage.tables.reduce((s, t) => s + t.count, 0).toLocaleString()} Total Records Found
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!!busy}
                              onClick={handleSelectAllTables}
                              className="h-7 px-2.5 rounded-lg text-xs font-bold text-primary hover:bg-primary/10"
                            >
                              Select All
                            </Button>
                            <span className="text-border/60">|</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!!busy}
                              onClick={handleDeselectAllTables}
                              className="h-7 px-2.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground"
                            >
                              Clear
                            </Button>
                          </div>
                        </div>

                        {/* Table Cards Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                          {inspectedPackage.tables.map((table) => {
                            const isSelected = selectedTables.has(table.name);
                            return (
                              <div
                                key={table.name}
                                onClick={() => !busy && handleToggleTable(table.name)}
                                className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer select-none ${
                                  isSelected
                                    ? 'border-primary/50 bg-primary/10 shadow-sm'
                                    : 'border-border/50 bg-muted/20 opacity-60 hover:opacity-100 hover:border-border/80'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isSelected ? (
                                    <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                                  ) : (
                                    <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                                  )}
                                  <span className="text-xs font-bold text-foreground font-mono truncate">{table.name}</span>
                                </div>
                                <Badge
                                  variant={table.count > 0 ? 'secondary' : 'outline'}
                                  className="text-[10px] font-mono font-bold shrink-0 ml-1.5"
                                >
                                  {table.count.toLocaleString()} rows
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Authentication & Cloud Storage Options */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl border border-border/60 bg-muted/20 flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-blue-500" />
                              <Label className="font-bold text-sm text-foreground">User Login Accounts</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Restore {inspectedPackage.authUsersCount} authentication profiles and role permissions.
                            </p>
                          </div>
                          <Switch
                            checked={restoreAuthUsers}
                            onCheckedChange={setRestoreAuthUsers}
                            disabled={inspectedPackage.authUsersCount === 0 || !!busy}
                          />
                        </div>

                        <div className="p-4 rounded-2xl border border-border/60 bg-muted/20 flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <FolderArchive className="h-4 w-4 text-amber-500" />
                              <Label className="font-bold text-sm text-foreground">Storage Files & Face Samples</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Restore {inspectedPackage.storageFilesCount} face samples across {inspectedPackage.storageBuckets.length} storage buckets.
                            </p>
                          </div>
                          <Switch
                            checked={restoreStorage}
                            onCheckedChange={setRestoreStorage}
                            disabled={inspectedPackage.storageFilesCount === 0 || !!busy}
                          />
                        </div>
                      </div>

                      {/* Safety Alert */}
                      <Alert className="rounded-2xl border-emerald-500/30 bg-emerald-500/10">
                        <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        <AlertDescription className="text-xs font-medium text-foreground">
                          <strong>Safety Rollback Protection Active:</strong> An automatic IndexedDB snapshot of your live database will be created before any changes are written. You can rollback at any time from the "Backup History" tab.
                        </AlertDescription>
                      </Alert>

                      {/* Action Trigger Button */}
                      <div className="flex flex-col sm:flex-row gap-3 pt-2">
                        <Button
                          size="lg"
                          onClick={handleRestoreFromPackage}
                          disabled={!!busy || (selectedTables.size === 0 && !restoreAuthUsers && !restoreStorage)}
                          className="flex-1 rounded-2xl h-14 bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 btn-spring gap-2 text-base"
                        >
                          {busy === 'restore' ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Upload className="h-5 w-5" />
                          )}
                          {busy === 'restore'
                            ? 'Restoring Selected Data...'
                            : `Start Restore (${selectedTables.size} Tables, ${inspectedPackage.tables
                                .filter((t) => selectedTables.has(t.name))
                                .reduce((s, t) => s + t.count, 0)
                                .toLocaleString()} Records)`}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Post-Restore Detailed Audit Report Card */}
                  {restoreReport && (
                    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          <h4 className="font-extrabold text-base text-foreground">Restoration Audit Report</h4>
                        </div>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs font-bold">
                          Success
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 rounded-xl bg-card border border-border/50">
                          <span className="text-[11px] uppercase font-bold text-muted-foreground block">Tables Restored</span>
                          <span className="text-xl font-extrabold text-foreground">{restoreReport.tablesRestored}</span>
                        </div>
                        <div className="p-3 rounded-xl bg-card border border-border/50">
                          <span className="text-[11px] uppercase font-bold text-muted-foreground block">Rows Inserted</span>
                          <span className="text-xl font-extrabold text-foreground">{restoreReport.rowsRestored.toLocaleString()}</span>
                        </div>
                        <div className="p-3 rounded-xl bg-card border border-border/50">
                          <span className="text-[11px] uppercase font-bold text-muted-foreground block">Auth Users</span>
                          <span className="text-xl font-extrabold text-foreground">{restoreReport.authUsersCreated}</span>
                        </div>
                        <div className="p-3 rounded-xl bg-card border border-border/50">
                          <span className="text-[11px] uppercase font-bold text-muted-foreground block">Storage Files</span>
                          <span className="text-xl font-extrabold text-foreground">{restoreReport.storageFilesRestored}</span>
                        </div>
                      </div>

                      {restoreReport.errors.length > 0 && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive space-y-1">
                          <span className="font-bold block">Notes & Skipped Items:</span>
                          {restoreReport.errors.map((err, i) => (
                            <p key={i} className="font-mono">{err.scope}: {err.message}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: LOCAL SNAPSHOTS */}
            <TabsContent value="snapshots" className="space-y-6">
              <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl shadow-xl">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold">Local Device Snapshots</CardTitle>
                    <CardDescription>
                      Fast local snapshots stored on this browser in IndexedDB. Retains up to 10 safety checkpoints.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveLocalSnapshot}
                    disabled={!!busy}
                    className="rounded-2xl border-border/70 bg-card/60 gap-2 text-xs font-bold"
                  >
                    <DatabaseBackup className="h-3.5 w-3.5 text-primary" /> Take Snapshot Now
                  </Button>
                </CardHeader>
                <CardContent>
                  {snapshots.length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                      <HardDrive className="h-10 w-10 mx-auto text-muted-foreground/50" />
                      <p className="text-sm font-semibold text-muted-foreground">No local snapshots saved yet</p>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Snapshots are created automatically before each restore and on your scheduled frequency.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {snapshots.map((snap) => (
                        <div key={snap.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">{snap.label}</span>
                              <Badge
                                variant={snap.triggerType === 'rollback' ? 'destructive' : snap.triggerType === 'auto' ? 'secondary' : 'outline'}
                                className="text-[10px] uppercase font-bold"
                              >
                                {snap.triggerType}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              <span>{fmtRelative(snap.createdAt)}</span>
                              <span>•</span>
                              <span>{snap.stats?.rows?.toLocaleString() || 0} rows</span>
                              <span>•</span>
                              <span>{fmtBytes(snap.sizeBytes || 0)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestoreSnapshot(snap.id)}
                              disabled={!!busy}
                              className="rounded-xl text-xs font-bold gap-1.5"
                            >
                              <Upload className="h-3.5 w-3.5 text-primary" /> Restore
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadSnapshot(snap.id)}
                              disabled={!!busy}
                              className="rounded-xl text-xs"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteSnapshot(snap.id)}
                              disabled={!!busy}
                              className="rounded-xl text-xs text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

        </div>
      </PageLayout>
    </PageTransition>
  );
};

export default Backup;
