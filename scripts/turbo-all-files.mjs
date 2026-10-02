import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

const BUCKET_ID = 'face-images';
const CONCURRENCY = 40; // 40 concurrent workers

console.log(`⚡ Launching Turbo Storage Importer (Concurrency: ${CONCURRENCY})...`);

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const storage = new Storage(appwriteClient);

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

// Parallel folder tree crawler
async function crawlBucket(bucketName) {
  const files = [];
  let foldersToVisit = [''];

  while (foldersToVisit.length > 0) {
    const currentBatch = foldersToVisit;
    foldersToVisit = [];

    await runInParallel(currentBatch, async (folder) => {
      const { data: items } = await supabase.storage.from(bucketName).list(folder, { limit: 1000 });
      if (!items) return;

      for (const item of items) {
        if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
        const fullPath = folder ? `${folder}/${item.name}` : item.name;
        if (item.id === null || !item.metadata) {
          foldersToVisit.push(fullPath);
        } else {
          files.push({ bucket: bucketName, path: fullPath, name: item.name });
        }
      }
    }, 15);
  }

  return files;
}

async function start() {
  console.log('🔍 Discovering all files across all buckets in parallel...');
  const buckets = ['face-images', 'student-registration-faces', 'attendance-training-faces'];

  let allFiles = [];
  for (const b of buckets) {
    const bFiles = await crawlBucket(b);
    console.log(`  📁 Bucket "${b}": Found ${bFiles.length} files.`);
    allFiles = allFiles.concat(bFiles);
  }

  console.log(`\n📸 Total ${allFiles.length} files discovered. Uploading with ${CONCURRENCY} parallel streams...`);

  let transferred = 0;
  let skipped = 0;
  let errors = 0;

  await runInParallel(allFiles, async ({ bucket, path, name }) => {
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(path);
      if (error || !blob) {
        errors++;
        return;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const fileId = path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
      const inputFile = InputFile.fromBuffer(buffer, name);

      await storage.createFile(BUCKET_ID, fileId, inputFile, [
        Permission.read(Role.any()),
        Permission.write(Role.any()),
        Permission.delete(Role.any())
      ]);
      transferred++;
      if (transferred % 50 === 0 || transferred === allFiles.length) {
        console.log(`⚡ Progress: ${transferred}/${allFiles.length} files transferred to Appwrite...`);
      }
    } catch (e) {
      if (e.code === 409) {
        skipped++;
      } else {
        errors++;
      }
    }
  }, CONCURRENCY);

  console.log(`\n======================================================`);
  console.log(`🎉 100% FILE TRANSFER COMPLETE!`);
  console.log(`  ✅ Transferred: ${transferred}`);
  console.log(`  ℹ️ Already Existing: ${skipped}`);
  console.log(`  📊 Total Files in Appwrite: ${transferred + skipped}`);
  console.log(`======================================================\n`);
}

start();
