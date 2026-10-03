import { Client, Storage } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
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
    const list = await storage.listFiles(b.$id, [], 5);
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
