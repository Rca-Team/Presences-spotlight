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

async function main() {
  const { data: supaBuckets } = await supabase.storage.listBuckets();
  console.log('=== Supabase Buckets ===');
  for (const b of supaBuckets || []) {
    const { data: files } = await supabase.storage.from(b.name).list('', { limit: 100 });
    console.log(`- Bucket: ${b.name} (id: ${b.id}, public: ${b.public})`);
    console.log(`  Top level files/folders count: ${(files || []).length}`);
    for (const f of (files || []).slice(0, 5)) {
      console.log(`    * ${f.name} (id: ${f.id}, metadata: ${JSON.stringify(f.metadata)})`);
    }
  }

  console.log('\n=== Appwrite Buckets ===');
  const appBuckets = await storage.listBuckets();
  for (const b of appBuckets.buckets) {
    const files = await storage.listFiles(b.$id);
    console.log(`- Bucket: ${b.name} (id: ${b.$id}, fileSecurity: ${b.fileSecurity}, totalFiles: ${files.total})`);
    for (const f of files.files.slice(0, 5)) {
      console.log(`    * ${f.name} (id: ${f.$id}, mimeType: ${f.mimeType}, size: ${f.sizeOriginal})`);
    }
  }
}

main().catch(console.error);
