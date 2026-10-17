const sdk = require('node-appwrite');
const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const databases = new sdk.Databases(client);

async function inspectUrls() {
  const profiles = await databases.listDocuments('presences_db', 'profiles', [sdk.Query.limit(20)]);
  console.log('--- PROFILES SAMPLES ---');
  for (const p of profiles.documents) {
    if (p.photo_url || p.avatar_url) {
      console.log(`${p.full_name || p.$id}: photo_url=${p.photo_url}, avatar_url=${p.avatar_url}`);
    }
  }

  const faces = await databases.listDocuments('presences_db', 'face_descriptors', [sdk.Query.limit(10)]);
  console.log('\n--- FACE DESCRIPTORS SAMPLES ---');
  for (const f of faces.documents) {
    if (f.image_url) {
      console.log(`${f.student_name || f.$id}: image_url=${f.image_url}`);
    }
  }

  const att = await databases.listDocuments('presences_db', 'attendance_records', [sdk.Query.limit(10)]);
  console.log('\n--- ATTENDANCE RECORDS SAMPLES ---');
  for (const a of att.documents) {
    if (a.image_url) {
      console.log(`${a.student_name || a.$id}: image_url=${a.image_url}`);
    }
  }
}

inspectUrls().catch(console.error);
