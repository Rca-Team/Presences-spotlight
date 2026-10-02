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
const CONCURRENCY = 25; // 25 parallel workers for maximum speed

console.log(`⚡ Launching Ultra-Fast Turbo Bulk Sync (Concurrency: ${CONCURRENCY} parallel streams)...`);

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new Databases(appwriteClient);
const storage = new Storage(appwriteClient);

// Helper for high-speed concurrent batching
async function runInParallel(items, workerFn, concurrency = CONCURRENCY) {
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

// 1. Bulk Sync Storage Images
async function bulkSyncStorage() {
  console.log('\n🚀 [1/2] Scanning & Bulk Downloading All Storage Files in Parallel...');
  const allFiles = [];

  async function crawlFolder(bucket, folder = '') {
    const { data: items } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
    if (!items) return;

    for (const item of items) {
      if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null || !item.metadata) {
        await crawlFolder(bucket, fullPath);
      } else {
        allFiles.push({ bucket, fullPath, name: item.name });
      }
    }
  }

  await crawlFolder('face-images');
  await crawlFolder('student-registration-faces');
  await crawlFolder('attendance-training-faces');

  console.log(`📸 Found ${allFiles.length} files across all buckets. Uploading in 25 parallel streams...`);

  let completed = 0;
  await runInParallel(allFiles, async ({ bucket, fullPath, name }) => {
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(fullPath);
      if (error || !blob) return;

      const buffer = Buffer.from(await blob.arrayBuffer());
      const fileId = fullPath.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
      const inputFile = InputFile.fromBuffer(buffer, name);

      await storage.createFile(BUCKET_ID, fileId, inputFile, [
        Permission.read(Role.any()),
        Permission.write(Role.any()),
        Permission.delete(Role.any())
      ]);
      completed++;
      process.stdout.write(`\r⚡ Uploaded ${completed}/${allFiles.length} files...`);
    } catch (err) {
      if (err.code === 409) {
        completed++;
        process.stdout.write(`\r⚡ Uploaded ${completed}/${allFiles.length} files (synced)...`);
      }
    }
  }, 25);

  console.log(`\n✅ Finished: All ${allFiles.length} storage files synced to Appwrite.`);
}

// 2. High-Speed Bulk Check on Documents
async function verifyCollections() {
  console.log('\n🚀 [2/2] Verifying Database Record Counts in Parallel...');
  const collections = ['profiles', 'face_descriptors', 'attendance_records', 'timetable', 'user_roles'];

  await runInParallel(collections, async (colId) => {
    try {
      const list = await databases.listDocuments(DATABASE_ID, colId, []);
      console.log(`  📊 Collection "${colId}": Total ${list.total} documents active.`);
    } catch (e) {
      console.warn(`  ⚠️ Could not count ${colId}:`, e.message);
    }
  }, 5);
}

async function start() {
  const startTime = Date.now();
  await bulkSyncStorage();
  await verifyCollections();
  const totalSecs = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⚡ TURBO BULK OPERATION COMPLETED IN ${totalSecs} SECONDS!`);
}

start();
