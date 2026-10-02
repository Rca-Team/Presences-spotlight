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
