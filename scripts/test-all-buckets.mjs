import { Client, Storage } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const storage = new Storage(appwrite);

async function testAll() {
  const buckets = ['face-images', 'student-registration-faces', 'attendance-training-faces', 'database-exports'];
  for (const b of buckets) {
    const list = await storage.listFiles(b, [], 3);
    console.log(`\nTesting Bucket "${b}":`);
    for (const f of list.files) {
      const url = `${APPWRITE_ENDPOINT}/storage/buckets/${b}/files/${f.$id}/view?project=${APPWRITE_PROJECT_ID}`;
      const res = await fetch(url);
      console.log(`  File: ${f.name} (ID: ${f.$id}) -> Status: ${res.status}, Type: ${res.headers.get('content-type')}, Size: ${res.headers.get('content-length')}`);
    }
  }
}

testAll().catch(console.error);
