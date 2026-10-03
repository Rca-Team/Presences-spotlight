import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Query } from 'node-appwrite';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const storage = new Storage(appwrite);

async function crawlBucket(bucketName) {
  const files = [];
  let foldersToVisit = [''];

  while (foldersToVisit.length > 0) {
    const currentBatch = foldersToVisit;
    foldersToVisit = [];

    for (const folder of currentBatch) {
      const { data: items } = await supabase.storage.from(bucketName).list(folder, { limit: 1000 });
      if (!items) continue;

      for (const item of items) {
        if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
        const fullPath = folder ? `${folder}/${item.name}` : item.name;
        if (item.id === null || !item.metadata) {
          foldersToVisit.push(fullPath);
        } else {
          files.push({ path: fullPath, name: item.name, size: item.metadata?.size || 0 });
        }
      }
    }
  }
  return files;
}

async function countAppwrite(bucketId) {
  let total = 0;
  let offset = 0;
  while (true) {
    const res = await storage.listFiles(bucketId, [Query.limit(100), Query.offset(offset)]);
    total += res.files.length;
    if (res.files.length < 100) break;
    offset += 100;
  }
  return total;
}

async function main() {
  console.log('=== Comparing Supabase vs Appwrite Files ===\n');

  const buckets = [
    { supa: 'face-images', app: 'face-images' },
    { supa: 'student-registration-faces', app: 'student-registration-faces' },
    { supa: 'attendance-training-faces', app: 'attendance-training-faces' },
    { supa: 'database_export_01_08_26', app: 'database-exports' },
    { supa: 'database_export_10_08_26', app: 'database-exports' },
    { supa: 'database_export_13_08_26', app: 'database-exports' }
  ];

  for (const b of buckets) {
    const supaFiles = await crawlBucket(b.supa);
    console.log(`Supabase "${b.supa}": ${supaFiles.length} files`);
  }

  console.log('\n--- Appwrite Buckets ---');
  const appBuckets = ['face-images', 'student-registration-faces', 'attendance-training-faces', 'database-exports'];
  for (const ab of appBuckets) {
    const cnt = await countAppwrite(ab);
    console.log(`Appwrite "${ab}": ${cnt} files`);
  }
}

main().catch(console.error);
