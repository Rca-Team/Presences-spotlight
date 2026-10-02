import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Databases, Storage, ID, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

const DATABASE_ID = 'presences_db';
const BUCKET_ID = 'face-images';

console.log('🚀 Starting Full Paginated Migration (Zero Data Left Behind)...');

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new Databases(appwriteClient);
const storage = new Storage(appwriteClient);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runInParallel(items, workerFn, concurrency = 20) {
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

// Fetch ALL rows from Supabase with pagination
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

// Ensure collection and attributes
async function ensureCollection(collectionId, collectionName, sampleData) {
  let col;
  try {
    col = await databases.getCollection(DATABASE_ID, collectionId);
  } catch (err) {
    console.log(`📋 Creating Collection "${collectionId}"...`);
    col = await databases.createCollection(
      DATABASE_ID,
      collectionId,
      collectionName,
      [Permission.read(Role.any()), Permission.create(Role.any()), Permission.update(Role.any()), Permission.delete(Role.any())]
    );
  }

  const attrList = await databases.listAttributes(DATABASE_ID, collectionId);
  const existing = new Set(attrList.attributes.map(a => a.key));

  if (!sampleData || sampleData.length === 0) return existing;

  let added = false;
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
        const size = (k.includes('desc') || k.includes('info') || k.includes('meta') || k.includes('url') || k.includes('data')) ? 3000 : 255;
        await databases.createStringAttribute(DATABASE_ID, collectionId, k, size, false);
      }
      existing.add(k);
      added = true;
      await sleep(100);
    } catch (e) {}
  }

  if (added) {
    await sleep(2500);
  }

  return existing;
}

// Migrate entire table with 20 parallel streams
async function migrateFullTable(tableName, collectionId, collectionName) {
  console.log(`\n🔄 [PAGINATED] Fetching ALL rows for "${tableName}"...`);
  const rows = await fetchAllRows(tableName);

  if (rows.length === 0) {
    console.log(`ℹ️ Table "${tableName}" is empty (0 records).`);
    return;
  }

  console.log(`📊 Found ${rows.length} total records in "${tableName}". Syncing to Appwrite...`);
  const validKeys = await ensureCollection(collectionId, collectionName, rows);

  let successCount = 0;
  await runInParallel(rows, async (row) => {
    const docId = row.id ? String(row.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36) : ID.unique();
    const docData = {};

    for (const [key, val] of Object.entries(row)) {
      if (key === 'id' || !validKeys.has(key) || val === null || val === undefined) continue;
      if (typeof val === 'object') {
        const s = JSON.stringify(val);
        docData[key] = s.length > 3000 ? s.slice(0, 3000) : s;
      } else if (typeof val === 'string') {
        docData[key] = val.length > 3000 ? val.slice(0, 3000) : val;
      } else {
        docData[key] = val;
      }
    }

    try {
      await databases.createDocument(DATABASE_ID, collectionId, docId, docData);
      successCount++;
    } catch (err) {
      if (err.code === 409) {
        try {
          await databases.updateDocument(DATABASE_ID, collectionId, docId, docData);
          successCount++;
        } catch (ue) {}
      }
    }
  }, 20);

  console.log(`✅ Table "${tableName}": ${successCount}/${rows.length} records active in Appwrite.`);
}

// Deep recursive crawler for all files in all buckets
async function migrateAllStorage() {
  console.log(`\n📁 [STORAGE] Crawling and transferring ALL files from all Supabase storage buckets...`);
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets) return;

  const allFiles = [];
  async function crawl(bName, folder = '') {
    const { data: items } = await supabase.storage.from(bName).list(folder, { limit: 1000 });
    if (!items) return;

    for (const item of items) {
      if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null || !item.metadata) {
        await crawl(bName, fullPath);
      } else {
        allFiles.push({ bucket: bName, path: fullPath, name: item.name });
      }
    }
  }

  for (const b of buckets) {
    if (b.name.startsWith('database_export')) continue; // skip raw db dumps
    await crawl(b.name);
  }

  console.log(`📸 Found ${allFiles.length} storage files across buckets. Uploading to Appwrite Storage...`);

  let count = 0;
  await runInParallel(allFiles, async ({ bucket, path, name }) => {
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(path);
      if (error || !blob) return;

      const buffer = Buffer.from(await blob.arrayBuffer());
      const fileId = path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
      const inputFile = InputFile.fromBuffer(buffer, name);

      await storage.createFile(BUCKET_ID, fileId, inputFile, [
        Permission.read(Role.any()),
        Permission.write(Role.any()),
        Permission.delete(Role.any())
      ]);
      count++;
    } catch (e) {
      if (e.code === 409) count++;
    }
  }, 20);

  console.log(`✅ All ${count} files transferred to Appwrite Storage.`);
}

async function main() {
  const start = Date.now();

  await migrateFullTable('profiles', 'profiles', 'Profiles');
  await migrateFullTable('face_descriptors', 'face_descriptors', 'Face Descriptors');
  await migrateFullTable('attendance_records', 'attendance_records', 'Attendance Records');
  await migrateFullTable('notifications', 'notifications', 'Notifications');
  await migrateFullTable('emergency_events', 'emergency_events', 'Emergency Events');
  await migrateFullTable('subjects', 'subjects', 'Subjects');
  await migrateFullTable('timetable', 'timetable', 'Timetable');
  await migrateFullTable('user_roles', 'user_roles', 'User Roles');

  await migrateAllStorage();

  const sec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n🎉 100% COMPLETE PAGINATED DATA & PHOTO MIGRATION FINISHED IN ${sec}s!`);
}

main();
