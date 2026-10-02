import { Client, Storage } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

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
