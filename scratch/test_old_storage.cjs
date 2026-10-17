const sdk = require('node-appwrite');
const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6accbd5d00053c5c1ac2')
  .setKey('standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89');

const storage = new sdk.Storage(client);

async function testOldStorage() {
  try {
    const buckets = await storage.listBuckets();
    console.log('Old project buckets:', buckets.buckets.map(b => b.$id));
    for (const b of buckets.buckets) {
      const files = await storage.listFiles(b.$id, [sdk.Query.limit(5)]);
      console.log(`Bucket ${b.$id}: ${files.total} total files`);
      if (files.files.length > 0) {
        console.log(`  Sample:`, files.files.map(f => f.name));
      }
    }
  } catch (e) {
    console.error('Error on old storage:', e.message, e.code);
  }
}

testOldStorage();
