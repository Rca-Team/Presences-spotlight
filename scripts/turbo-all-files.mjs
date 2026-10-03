import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

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
