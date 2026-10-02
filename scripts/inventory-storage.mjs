import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage } from 'node-appwrite';

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
