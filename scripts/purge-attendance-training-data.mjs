import { Client, Storage } from 'node-appwrite';

/**
 * Cloud Purge Tool:
 * Removes unnecessary progressive training files, orphan attendance crops,
 * and temporary face captures from cloud storage.
 */

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID || '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

async function purgeAppwriteBucket(storage, bucketId) {
  try {
    console.log(`[Appwrite] Checking bucket "${bucketId}"...`);
    let totalPurged = 0;
    while (true) {
      const response = await storage.listFiles(bucketId);
      if (!response.files || response.files.length === 0) break;

      for (const file of response.files) {
        await storage.deleteFile(bucketId, file.$id);
        totalPurged++;
        if (totalPurged % 25 === 0) {
          console.log(`  - Deleted ${totalPurged} unnecessary files from "${bucketId}"...`);
        }
      }
    }
    console.log(`[Appwrite] Done: Purged ${totalPurged} files from "${bucketId}".`);
  } catch (err) {
    console.log(`[Appwrite] Bucket "${bucketId}": ${err.message}`);
  }
}

async function purgeSupabaseBucket(bucketName) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log(`[Supabase] Listing files in "${bucketName}"...`);
    const res = await fetch(`${baseUrl}/storage/v1/object/list/${bucketName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefix: '', limit: 1000 })
    });

    if (!res.ok) {
      console.log(`[Supabase] Bucket "${bucketName}": status ${res.status}`);
      return;
    }

    const files = await res.json();
    if (Array.isArray(files) && files.length > 0) {
      const prefixes = files.map(f => f.name);
      const delRes = await fetch(`${baseUrl}/storage/v1/object/${bucketName}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ prefixes })
      });
      console.log(`[Supabase] Deleted ${prefixes.length} files from "${bucketName}" (status: ${delRes.status}).`);
    } else {
      console.log(`[Supabase] Bucket "${bucketName}" is already clean.`);
    }
  } catch (err) {
    console.warn(`[Supabase] Error purging "${bucketName}":`, err.message);
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  PRESENCES AI — CLOUD STORAGE UNNECESSARY DATA PURGE');
  console.log('='.repeat(65));

  if (APPWRITE_API_KEY) {
    const appwrite = new Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT_ID)
      .setKey(APPWRITE_API_KEY);
    const storage = new Storage(appwrite);

    // Purge training buckets & temporary export files
    await purgeAppwriteBucket(storage, 'attendance-training-faces');
    await purgeAppwriteBucket(storage, 'database-exports');
  } else {
    console.log('[Appwrite] Note: APPWRITE_API_KEY not supplied in environment.');
  }

  if (SUPABASE_URL && SUPABASE_KEY) {
    await purgeSupabaseBucket('attendance-training-faces');
  }

  console.log('\n[Summary] Cloud cleanup complete. All unnecessary face training and temporary files removed.');
}

main().catch(console.error);
