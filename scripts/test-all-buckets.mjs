import { Client, Storage } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

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
