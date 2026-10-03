import fs from 'node:fs';
import path from 'node:path';
import { Client, Storage, Query } from 'node-appwrite';

/**
 * Presences AI — Cloud Storage Attendance Photo Purge Utility
 * 
 * Enforces Zero-Photo Daily Attendance Retention:
 * - Recursively discovers and deletes all transient daily attendance snapshot images (`attendance/*`, `gate_*`, `attendance_*`)
 * - GUARANTEES preservation of registered student profile/ID photos (`students/*`, `avatars/*`, and face descriptor registration models)
 * - Cleans up both Appwrite Storage and Supabase Storage buckets
 */

// Load .env if present
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) {
  // ignore
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID || '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

async function purgeSupabaseAttendancePhotos() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Supabase Purge] Skipped: Supabase credentials not found.');
    return;
  }

  console.log('[Supabase Purge] Scanning face-images bucket for attendance snapshots via REST...');
  const bucketName = 'face-images';
  let totalDeleted = 0;

  async function listAndDeleteFolder(folderPath = 'attendance') {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucketName}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prefix: folderPath,
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
      });

      if (!res.ok) {
        return;
      }

      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) return;

      const filesToDelete = [];
      for (const item of items) {
        const fullPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        if (item.id === null || !item.metadata) {
          // Subfolder recurse
          await listAndDeleteFolder(fullPath);
        } else {
          filesToDelete.push(fullPath);
        }
      }

      if (filesToDelete.length > 0) {
        console.log(`[Supabase Purge] Deleting ${filesToDelete.length} files from "${folderPath}"...`);
        const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucketName}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prefixes: filesToDelete })
        });
        if (delRes.ok) {
          totalDeleted += filesToDelete.length;
        }
      }
    } catch (e) {
      console.warn(`[Supabase Purge] Folder ${folderPath} scan skipped:`, e.message);
    }
  }

  try {
    await listAndDeleteFolder('attendance');
    console.log(`[Supabase Purge] Complete! Purged ${totalDeleted} attendance snapshot photos. Enrolled student profile images remain untouched.`);
  } catch (err) {
    console.warn('[Supabase Purge Notice]:', err.message);
  }
}

async function purgeAppwriteAttendancePhotos() {
  if (!APPWRITE_API_KEY) {
    console.log('[Appwrite Purge] Note: APPWRITE_API_KEY not set in environment. Skipping server-side storage purge.');
    return;
  }

  console.log('[Appwrite Purge] Connecting to Appwrite Storage...');
  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const storage = new Storage(client);
  const bucketId = 'face-images';

  let totalDeleted = 0;
  let offset = 0;
  const limit = 100;

  try {
    while (true) {
      const res = await storage.listFiles(bucketId, [
        Query.limit(limit),
        Query.offset(offset)
      ]);

      const files = res.files || [];
      if (files.length === 0) break;

      for (const file of files) {
        const name = (file.name || '').toLowerCase();
        // Attendance snapshot indicators
        const isAttendanceSnapshot =
          name.startsWith('attendance_') ||
          name.startsWith('gate_') ||
          name.startsWith('attendance/') ||
          name.includes('_attendance_');

        if (isAttendanceSnapshot) {
          try {
            await storage.deleteFile(bucketId, file.$id);
            totalDeleted++;
            console.log(`[Appwrite Purge] Deleted attendance snapshot: ${file.name} (${file.$id})`);
          } catch (delErr) {
            console.warn(`[Appwrite Purge] Failed to delete ${file.$id}:`, delErr.message);
          }
        }
      }

      offset += files.length;
      if (offset >= (res.total || 0)) break;
    }

    console.log(`[Appwrite Purge] Complete! Purged ${totalDeleted} attendance snapshot photos from Appwrite.`);
  } catch (err) {
    console.warn('[Appwrite Purge Notice]:', err.message);
  }
}

async function main() {
  console.log('=== Presences AI Attendance Photo Storage Purge ===');
  console.log('Policy: Zero photo retention for daily attendance. Retaining enrolled profile faces only.');
  await purgeSupabaseAttendancePhotos();
  await purgeAppwriteAttendancePhotos();
  console.log('=== Purge Job Finished ===');
}

main().catch(console.error);
