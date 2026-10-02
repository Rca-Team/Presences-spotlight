import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Query } from 'node-appwrite';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

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
