import { Client, Storage, Query } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const storage = new Storage(appwrite);

async function main() {
  const buckets = await storage.listBuckets();
  console.log('=== Current Appwrite Storage Status ===');
  for (const b of buckets.buckets) {
    const list = await storage.listFiles(b.$id, [Query.limit(1)]);
    console.log(`- Bucket "${b.name}" (ID: ${b.$id}): ${list.total} files`);
  }
}

main().catch(console.error);
