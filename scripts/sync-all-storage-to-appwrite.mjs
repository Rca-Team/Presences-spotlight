import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client, Storage, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

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
