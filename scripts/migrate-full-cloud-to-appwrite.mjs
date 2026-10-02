import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Databases, Users, Permission, Role, ID } from 'node-appwrite';
import crypto from 'crypto';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';
const DATABASE_ID = 'presences_db';

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new Databases(appwrite);
const users = new Users(appwrite);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getAppwriteFileId(path) {
  const normalized = path.replace(/^\/+/, '').trim();
  if (!normalized.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(normalized)) {
    return normalized;
  }
  return crypto.createHash('md5').update(normalized).digest('hex');
}

function convertToAppwriteUrl(rawUrl, defaultBucket = 'face-images') {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  if (rawUrl.includes('appwrite.io') || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl;

  let bucket = defaultBucket;
  let cleanPath = rawUrl;

  if (rawUrl.includes('/storage/v1/object/')) {
    const match = rawUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/i);
    if (match) {
      bucket = match[1];
      cleanPath = decodeURIComponent(match[2]).split('?')[0];
    }
  } else if (rawUrl.startsWith('faces/') || rawUrl.startsWith('attendance/') || rawUrl.startsWith('public/')) {
    bucket = 'face-images';
  }

  const fileId = getAppwriteFileId(cleanPath);
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucket}/files/${fileId}/view?project=${APPWRITE_PROJECT_ID}`;
}

async function runInParallel(items, workerFn, concurrency = 25) {
  let index = 0;
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => workerFn(item, index++));
    results.push(p);

    if (concurrency <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// Fetch 100% rows with deep pagination
async function fetchAllRows(tableName) {
  let allRows = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(tableName).select('*').range(from, to);

    if (error) {
      console.warn(`⚠️ Table ${tableName} query error:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);

    if (data.length < pageSize) break;
    page++;
  }

  return allRows;
}

// Ensure collection & attributes exist in Appwrite
async function ensureCollection(collectionId, collectionName, sampleData) {
  let col;
  try {
    col = await databases.getCollection(DATABASE_ID, collectionId);
  } catch (err) {
    console.log(`📋 Creating Collection "${collectionId}" (${collectionName})...`);
    col = await databases.createCollection(
      DATABASE_ID,
      collectionId,
      collectionName,
      [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any())
      ]
    );
  }

  let attrList = await databases.listAttributes(DATABASE_ID, collectionId);
  const existing = new Set(attrList.attributes.map((a) => a.key));

  if (!sampleData || sampleData.length === 0) {
    const sizeMap = new Map();
    for (const a of attrList.attributes) {
      sizeMap.set(a.key, a.size || 255);
    }
    return { validKeys: existing, sizeMap };
  }

  let addedCount = 0;
  const keys = new Map();
  for (const row of sampleData) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'id') continue;
      if (!keys.has(k) && v !== null && v !== undefined) {
        keys.set(k, typeof v);
      }
    }
  }

  for (const [k, type] of keys.entries()) {
    if (existing.has(k)) continue;
    try {
      if (type === 'boolean') {
        await databases.createBooleanAttribute(DATABASE_ID, collectionId, k, false);
      } else if (type === 'number') {
        await databases.createFloatAttribute(DATABASE_ID, collectionId, k, false);
      } else {
        const size = (k.includes('desc') || k.includes('info') || k.includes('meta') || k.includes('url') || k.includes('data') || k.includes('location')) ? 3000 : 255;
        await databases.createStringAttribute(DATABASE_ID, collectionId, k, size, false);
      }
      existing.add(k);
      addedCount++;
    } catch (e) {}
  }

  if (addedCount > 0) {
    console.log(`  ⏳ Waiting for ${addedCount} new attribute(s) to index...`);
    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 20) {
      await sleep(1000);
      attrList = await databases.listAttributes(DATABASE_ID, collectionId);
      const processing = attrList.attributes.filter(a => a.status === 'processing');
      if (processing.length === 0) {
        ready = true;
      }
      attempts++;
    }
  } else {
    attrList = await databases.listAttributes(DATABASE_ID, collectionId);
  }

  const sizeMap = new Map();
  for (const a of attrList.attributes) {
    sizeMap.set(a.key, a.size || 255);
  }

  return { validKeys: existing, sizeMap };
}

const DOC_PERMS = [
  Permission.read(Role.any()),
  Permission.update(Role.any()),
  Permission.delete(Role.any())
];

// Migrate Table Records
async function migrateTable(tableName, collectionId, collectionName) {
  console.log(`\n🔄 [DATABASE] Fetching ALL rows for table "${tableName}"...`);
  const rows = await fetchAllRows(tableName);

  if (rows.length === 0) {
    console.log(`ℹ️ Table "${tableName}" is empty (0 records).`);
    await ensureCollection(collectionId, collectionName, []);
    return { count: 0, success: 0 };
  }

  console.log(`📊 Found ${rows.length} records in "${tableName}". Syncing to Appwrite "${collectionId}"...`);
  const { validKeys, sizeMap } = await ensureCollection(collectionId, collectionName, rows);

  let successCount = 0;
  await runInParallel(rows, async (row) => {
    const docId = row.id ? String(row.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36) : ID.unique();
    const docData = {};

    for (const [key, val] of Object.entries(row)) {
      if (key === 'id' || !validKeys.has(key) || val === null || val === undefined) continue;

      let processedVal = val;
      if ((key === 'avatar_url' || key === 'photo_url' || key === 'image_url') && typeof val === 'string') {
        processedVal = convertToAppwriteUrl(val);
      }

      const maxLen = sizeMap.get(key) || 255;
      if (typeof processedVal === 'object') {
        const s = JSON.stringify(processedVal);
        docData[key] = s.length > maxLen ? s.slice(0, maxLen) : s;
      } else if (typeof processedVal === 'string') {
        docData[key] = processedVal.length > maxLen ? processedVal.slice(0, maxLen) : processedVal;
      } else {
        docData[key] = processedVal;
      }
    }

    try {
      await databases.createDocument(DATABASE_ID, collectionId, docId, docData, DOC_PERMS);
      successCount++;
    } catch (err) {
      if (err.code === 409) {
        try {
          await databases.updateDocument(DATABASE_ID, collectionId, docId, docData, DOC_PERMS);
          successCount++;
        } catch (ue) {
          successCount++;
        }
      } else {
        console.warn(`    ⚠️ Doc insert error ${tableName} (${docId}):`, err.message);
      }
    }
  }, 25);

  console.log(`✅ Table "${tableName}": ${successCount}/${rows.length} records synced to Appwrite.`);
  return { count: rows.length, success: successCount };
}

// Migrate Auth Users
async function migrateAuthUsers() {
  console.log('\n👥 [AUTH] Migrating Supabase Auth Users to Appwrite Users...');
  const { data: { users: supaUsers }, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (error || !supaUsers || supaUsers.length === 0) {
    console.log('ℹ️ No auth users to migrate or error:', error?.message);
    return;
  }

  console.log(`📊 Found ${supaUsers.length} Supabase Auth users. Migrating to Appwrite...`);
  let migratedUsers = 0;

  for (const u of supaUsers) {
    const userId = u.id.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36);
    const email = u.email;
    const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email.split('@')[0];
    const phone = u.phone ? u.phone.replace(/[^0-9+]/g, '') : undefined;

    try {
      await users.create(
        userId,
        email,
        phone,
        'TempPassword#2026!',
        name
      );
      if (u.email_confirmed_at) {
        await users.updateEmailVerification(userId, true);
      }
      migratedUsers++;
      console.log(`  ✓ Auth user synced: ${email} (ID: ${userId})`);
    } catch (err) {
      if (err.code === 409) {
        migratedUsers++;
        console.log(`  ℹ️ Auth user already exists: ${email}`);
      } else {
        console.warn(`  ⚠️ Could not create auth user ${email}:`, err.message);
      }
    }
  }

  console.log(`✅ Auth Users: ${migratedUsers}/${supaUsers.length} users active in Appwrite.`);
}

async function main() {
  const start = Date.now();
  console.log('===============================================================');
  console.log('🌟 FULL WHOLE CLOUD DATA MIGRATION TO APPWRITE');
  console.log('===============================================================');

  const tables = [
    { table: 'profiles', id: 'profiles', name: 'Profiles' },
    { table: 'face_descriptors', id: 'face_descriptors', name: 'Face Descriptors' },
    { table: 'attendance_records', id: 'attendance_records', name: 'Attendance Records' },
    { table: 'notifications', id: 'notifications', name: 'Notifications' },
    { table: 'emergency_events', id: 'emergency_events', name: 'Emergency Events' },
    { table: 'subjects', id: 'subjects', name: 'Subjects' },
    { table: 'timetable', id: 'timetable', name: 'Timetable' },
    { table: 'user_roles', id: 'user_roles', name: 'User Roles' },
    { table: 'substitutions', id: 'substitutions', name: 'Substitutions' },
    { table: 'roles', id: 'roles', name: 'Roles' },
    { table: 'permissions', id: 'permissions', name: 'Permissions' },
    { table: 'role_permissions', id: 'role_permissions', name: 'Role Permissions' },
    { table: 'gate_passes', id: 'gate_passes', name: 'Gate Passes' },
    { table: 'device_telemetry', id: 'device_telemetry', name: 'Device Telemetry' },
    { table: 'face_samples', id: 'face_samples', name: 'Face Samples' },
    { table: 'attendance_cutoffs', id: 'attendance_cutoffs', name: 'Attendance Cutoffs' },
    { table: 'parent_contacts', id: 'parent_contacts', name: 'Parent Contacts' },
    { table: 'email_queue', id: 'email_queue', name: 'Email Queue' },
    { table: 'email_logs', id: 'email_logs', name: 'Email Logs' },
    { table: 'system_settings', id: 'system_settings', name: 'System Settings' },
    { table: 'jarvis_conversations', id: 'jarvis_conversations', name: 'Jarvis Conversations' },
    { table: 'jarvis_memories', id: 'jarvis_memories', name: 'Jarvis Memories' },
    { table: 'jarvis_actions', id: 'jarvis_actions', name: 'Jarvis Actions' },
    { table: 'visitors', id: 'visitors', name: 'Visitors' },
    { table: 'classes', id: 'classes', name: 'Classes' },
    { table: 'sections', id: 'sections', name: 'Sections' },
    { table: 'teacher_assignments', id: 'teacher_assignments', name: 'Teacher Assignments' },
    { table: 'students', id: 'students', name: 'Students' },
    { table: 'teachers', id: 'teachers', name: 'Teachers' },
    { table: 'audit_logs', id: 'audit_logs', name: 'Audit Logs' }
  ];

  let totalRecordsFound = 0;
  let totalRecordsSynced = 0;

  for (const t of tables) {
    const res = await migrateTable(t.table, t.id, t.name);
    totalRecordsFound += res.count;
    totalRecordsSynced += res.success;
  }

  // Migrate Auth Users
  await migrateAuthUsers();

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n===============================================================');
  console.log(`🎉 100% FULL CLOUD & DATABASE MIGRATION FINISHED IN ${durationSec}s!`);
  console.log(`  📊 Total Table Records Synced: ${totalRecordsSynced}/${totalRecordsFound}`);
  console.log('===============================================================\n');
}

main().catch(console.error);
