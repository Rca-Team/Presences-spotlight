import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY0NDkwNywiZXhwIjoyMTAzMjIwOTA3fQ.tdJw7UsAe1zSgettFQO-HVxGftgWM3f0j9tqgqeMZ3U';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

const BUCKET_ID = 'face-images';

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const storage = new Storage(appwriteClient);

async function crawlAndUpload(bucketName, folderPath = '') {
  const { data: items, error } = await supabase.storage.from(bucketName).list(folderPath, { limit: 1000 });
  if (error || !items) return;

  for (const item of items) {
    if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
    const fullPath = folderPath ? `${folderPath}/${item.name}` : item.name;

    if (item.id === null || !item.metadata) {
      // It's a folder, crawl recursively
      await crawlAndUpload(bucketName, fullPath);
    } else {
      // It's a file, download and upload to Appwrite
      try {
        const { data: blob, error: dlErr } = await supabase.storage.from(bucketName).download(fullPath);
        if (dlErr || !blob) continue;

        const buffer = Buffer.from(await blob.arrayBuffer());
        // Clean ID for Appwrite (max 36 chars, valid chars)
        const fileId = fullPath.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
        const inputFile = InputFile.fromBuffer(buffer, item.name);

        await storage.createFile(BUCKET_ID, fileId, inputFile, [
          Permission.read(Role.any()),
          Permission.write(Role.any()),
          Permission.delete(Role.any())
        ]);
        console.log(`  ✅ Transferred: ${fullPath} -> (ID: ${fileId})`);
      } catch (err) {
        if (err.code === 409) {
          console.log(`  ℹ️ Already exists: ${fullPath}`);
        } else {
          console.warn(`  ⚠️ Failed ${fullPath}:`, err.message);
        }
      }
    }
  }
}

async function run() {
  console.log('📸 Syncing all student photos and storage folders to Appwrite Storage...');
  await crawlAndUpload('face-images');
  await crawlAndUpload('student-registration-faces');
  await crawlAndUpload('attendance-training-faces');
  console.log('🎉 All face image files synced to Appwrite Storage!');
}

run();
