import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage } from 'node-appwrite';

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
  async function crawl(folder = '') {
    const { data: items, error } = await supabase.storage.from(bucketName).list(folder, { limit: 1000 });
    if (error || !items) return;
    for (const item of items) {
      if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null || !item.metadata) {
        await crawl(fullPath);
      } else {
        files.push({ path: fullPath, name: item.name, metadata: item.metadata });
      }
    }
  }
  await crawl();
  return files;
}

async function main() {
  console.log('=== Crawling Supabase Storage ===');
  const { data: buckets } = await supabase.storage.listBuckets();
  for (const b of buckets || []) {
    const files = await crawlBucket(b.name);
    console.log(`Bucket: "${b.name}" -> ${files.length} total files`);
    for (const f of files.slice(0, 3)) {
      console.log(`   Sample: ${f.path} (${f.metadata?.size} bytes, ${f.metadata?.mimetype})`);
    }
  }

  console.log('\n=== Appwrite Storage Buckets ===');
  const appBuckets = await storage.listBuckets();
  for (const b of appBuckets.buckets) {
    console.log(`Bucket: "${b.name}" (ID: ${b.$id}, permissions: ${JSON.stringify(b.$permissions)}, fileSecurity: ${b.fileSecurity})`);
  }
}

main().catch(console.error);
