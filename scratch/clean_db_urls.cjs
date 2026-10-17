const sdk = require('node-appwrite');

const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const databases = new sdk.Databases(client);
const DB_ID = 'presences_db';
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = '6ad309e200176195d398';

function sanitizePathToFileId(raw) {
  if (!raw) return '';
  const clean = String(raw).replace(/^\/+/, '').split('?')[0];
  return clean.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
}

function convertToAppwriteUrl(rawUrl, defaultBucket = 'face-images') {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  if (trimmed.includes('appwrite.io') && trimmed.includes('/storage/buckets/')) {
    // If it has old project ID, replace it
    return trimmed
      .replace(/6abfd34f000604fcf074/g, PROJECT_ID)
      .replace(/6accbd5d00053c5c1ac2/g, PROJECT_ID);
  }

  let bucket = defaultBucket;
  let filePath = trimmed;

  if (trimmed.includes('supabase.co')) {
    const match = trimmed.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*?)(?:\?|$)/);
    if (match) {
      bucket = match[1];
      filePath = decodeURIComponent(match[2]);
    }
  }

  const fileId = sanitizePathToFileId(filePath);
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucket}/files/${fileId}/view?project=${PROJECT_ID}`;
}

async function cleanCollectionUrls(collectionId, fields) {
  console.log(`\nScanning ${collectionId}...`);
  let offset = 0;
  const limit = 100;
  let updatedCount = 0;

  while (true) {
    const res = await databases.listDocuments(DB_ID, collectionId, [
      sdk.Query.limit(limit),
      sdk.Query.offset(offset)
    ]);
    if (res.documents.length === 0) break;

    for (const doc of res.documents) {
      let needsUpdate = false;
      const updates = {};

      for (const f of fields) {
        if (doc[f] && typeof doc[f] === 'string' && (doc[f].includes('supabase.co') || doc[f].includes('6accbd5d00053c5c1ac2') || doc[f].includes('6abfd34f000604fcf074'))) {
          updates[f] = convertToAppwriteUrl(doc[f], f.includes('registration') ? 'student-registration-faces' : 'face-images');
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        try {
          await databases.updateDocument(DB_ID, collectionId, doc.$id, updates);
          updatedCount++;
        } catch (e) {
          // Ignore
        }
      }
    }

    if (res.documents.length < limit) break;
    offset += limit;
  }

  console.log(`Cleaned ${updatedCount} documents in ${collectionId}`);
}

async function run() {
  await cleanCollectionUrls('profiles', ['photo_url', 'avatar_url']);
  await cleanCollectionUrls('face_descriptors', ['image_url']);
  await cleanCollectionUrls('attendance_records', ['image_url']);
  console.log('\nAll image paths updated across database collections!');
}

run().catch(console.error);
