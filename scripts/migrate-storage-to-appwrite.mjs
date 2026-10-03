import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Databases, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import crypto from 'crypto';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = 'presences_db';

const CONCURRENCY = 25;

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const storage = new Storage(appwrite);
const databases = new Databases(appwrite);

// Valid Appwrite file ID generator (deterministic MD5 hash for nested paths, or original if simple)
export function getAppwriteFileId(path) {
  const normalized = path.replace(/^\/+/, '').trim();
  if (!normalized.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(normalized)) {
    return normalized;
  }
  return crypto.createHash('md5').update(normalized).digest('hex');
}

// Parallel runner
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

// Ensure Bucket exists in Appwrite with public read permissions
async function ensureAppwriteBucket(bucketId, bucketName) {
  try {
    const b = await storage.getBucket(bucketId);
    console.log(`✓ Bucket "${bucketId}" (${b.name}) verified.`);
    try {
      await storage.updateBucket(
        bucketId,
        bucketName,
        [
          Permission.read(Role.any()),
          Permission.create(Role.any()),
          Permission.update(Role.any()),
          Permission.delete(Role.any())
        ],
        false, // fileSecurity = false for direct public viewing
        true,
        100 * 1024 * 1024,
        []
      );
    } catch (e) {}
  } catch (err) {
    console.log(`⚙️ Creating Appwrite Bucket "${bucketId}" (${bucketName})...`);
    await storage.createBucket(
      bucketId,
      bucketName,
      [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any())
      ],
      false,
      true,
      100 * 1024 * 1024,
      []
    );
    console.log(`✓ Created Bucket "${bucketId}" successfully.`);
  }
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
          files.push({
            bucket: bucketName,
            path: fullPath,
            name: item.name,
            size: item.metadata?.size || 0,
            mimetype: item.metadata?.mimetype || 'image/jpeg'
          });
        }
      }
    }, 15);
  }

  return files;
}

// Helper to determine mime-type from filename if missing
function getMimeType(filename, defaultMime = 'image/jpeg') {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'json') return 'application/json';
  if (ext === 'backup' || ext === 'sql') return 'application/octet-stream';
  return defaultMime;
}

// Migrate all files for a bucket
async function migrateBucketFiles(supabaseBucketName, appwriteBucketId) {
  const files = await crawlBucket(supabaseBucketName);
  console.log(`  📁 Bucket "${supabaseBucketName}": Found ${files.length} files.`);
  if (files.length === 0) {
    return { transferred: 0, skipped: 0, failed: 0, total: 0 };
  }

  console.log(`  🚀 Uploading ${files.length} files to Appwrite "${appwriteBucketId}" in ${CONCURRENCY} parallel streams...`);

  let transferred = 0;
  let skipped = 0;
  let failed = 0;

  await runInParallel(files, async (fileInfo) => {
    const fileId = getAppwriteFileId(fileInfo.path);

    // Download from Supabase
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(supabaseBucketName).download(fileInfo.path);
      if (dlErr || !blob) {
        console.warn(`    ⚠️ Download error ${fileInfo.path}:`, dlErr?.message);
        failed++;
        return;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const mime = getMimeType(fileInfo.name, fileInfo.mimetype);
      const inputFile = InputFile.fromBuffer(buffer, fileInfo.name);

      // Upload with deterministic fileId
      try {
        await storage.createFile(appwriteBucketId, fileId, inputFile, [
          Permission.read(Role.any()),
          Permission.write(Role.any()),
          Permission.delete(Role.any())
        ]);
        transferred++;
      } catch (err) {
        if (err.code === 409) {
          skipped++;
        } else {
          console.warn(`    ⚠️ Upload error ${fileInfo.path} (ID: ${fileId}):`, err.message);
          failed++;
        }
      }

      // Also create legacy alias (truncated ID) if different, so old links continue to work
      const legacyId = fileInfo.path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
      if (legacyId !== fileId && /^[a-zA-Z0-9._-]+$/.test(legacyId)) {
        try {
          const aliasFile = InputFile.fromBuffer(buffer, fileInfo.name);
          await storage.createFile(appwriteBucketId, legacyId, aliasFile, [
            Permission.read(Role.any()),
            Permission.write(Role.any()),
            Permission.delete(Role.any())
          ]);
        } catch (e) {
          // ignore 409
        }
      }

      const currentTotal = transferred + skipped;
      if (currentTotal % 50 === 0 || currentTotal === files.length) {
        console.log(`    ⚡ [${appwriteBucketId}] Progress: ${currentTotal}/${files.length} files processed...`);
      }
    } catch (err) {
      console.warn(`    ⚠️ Unexpected failure for ${fileInfo.path}:`, err.message);
      failed++;
    }
  }, CONCURRENCY);

  console.log(`  ✅ Done "${supabaseBucketName}" -> "${appwriteBucketId}": +${transferred} transferred, ${skipped} existing, ${failed} failed.\n`);
  return { transferred, skipped, failed, total: files.length };
}

async function main() {
  const startTime = Date.now();
  console.log('===============================================================');
  console.log('🌟 COMPLETE STORAGE MIGRATION TO APPWRITE');
  console.log('===============================================================\n');

  const bucketMappings = [
    { supabase: 'face-images', appwrite: 'face-images', name: 'Face Images' },
    { supabase: 'student-registration-faces', appwrite: 'student-registration-faces', name: 'Student Registration Faces' },
    { supabase: 'attendance-training-faces', appwrite: 'attendance-training-faces', name: 'Attendance Training Faces' },
    { supabase: 'database_export_01_08_26', appwrite: 'database-exports', name: 'Database Exports' },
    { supabase: 'database_export_10_08_26', appwrite: 'database-exports', name: 'Database Exports' },
    { supabase: 'database_export_13_08_26', appwrite: 'database-exports', name: 'Database Exports' }
  ];

  // 1. Ensure all Appwrite Buckets exist
  console.log('📦 Step 1: Setting up Appwrite Storage Buckets...');
  const appwriteBuckets = new Set(bucketMappings.map(m => m.appwrite));
  for (const bId of appwriteBuckets) {
    const match = bucketMappings.find(m => m.appwrite === bId);
    await ensureAppwriteBucket(bId, match?.name || bId);
  }

  // 2. Transfer files for all buckets
  console.log('\n📥 Step 2: Crawling & Migrating all storage files...');
  let grandTotalTransferred = 0;
  let grandTotalSkipped = 0;
  let grandTotalFailed = 0;
  let grandTotalFiles = 0;

  for (const mapping of bucketMappings) {
    const res = await migrateBucketFiles(mapping.supabase, mapping.appwrite);
    grandTotalTransferred += res.transferred;
    grandTotalSkipped += res.skipped;
    grandTotalFailed += res.failed;
    grandTotalFiles += res.total;
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('===============================================================');
  console.log(`🎉 100% STORAGE MIGRATION FINISHED IN ${durationSec}s!`);
  console.log(`  📊 Total Supabase Files Discovered: ${grandTotalFiles}`);
  console.log(`  ✅ Successfully Transferred: ${grandTotalTransferred}`);
  console.log(`  ℹ️ Already Existing / Synced: ${grandTotalSkipped}`);
  console.log(`  ⚠️ Failed: ${grandTotalFailed}`);
  console.log(`  🔥 Total Active in Appwrite: ${grandTotalTransferred + grandTotalSkipped}`);
  console.log('===============================================================\n');
}

main().catch(console.error);
