import fs from 'node:fs';
import path from 'node:path';
import { Client, Storage, Query } from 'node-appwrite';

try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) {
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {}

const APPWRITE_ENDPOINT = process.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.VITE_APPWRITE_PROJECT_ID || '6accbd5d00053c5c1ac2';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const storage = new Storage(appwrite);

async function verify() {
  console.log('🔍 Verifying Appwrite Storage Buckets and File Counts...\n');
  const buckets = await storage.listBuckets();
  
  let totalAllFiles = 0;
  for (const b of buckets.buckets) {
    const list = await storage.listFiles(b.$id, [Query.limit(5)]);
    console.log(`📦 Bucket: "${b.name}" (ID: ${b.$id})`);
    console.log(`   - Total files: ${list.total}`);
    console.log(`   - Security disabled (Public read): ${!b.fileSecurity}`);
    console.log(`   - Sample files:`);
    for (const f of list.files) {
      console.log(`     * ID: ${f.$id} | Name: ${f.name} | Size: ${f.sizeOriginal} bytes | Type: ${f.mimeType}`);
    }
    console.log('');
    totalAllFiles += list.total;
  }

  console.log(`🎉 VERIFICATION RESULT: Total ${totalAllFiles} files active across all ${buckets.total} Appwrite storage buckets!`);
}

verify().catch(console.error);
