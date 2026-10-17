const fs = require('fs');
const path = require('path');
const sdk = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');

const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const storage = new sdk.Storage(client);

const filesToUpload = [
  'kvs-logo.png',
  'kvs-logo.jpg',
  'principal-photo.jpg',
  'principal-dr-gaya-ravidas.jpg',
  'gaurav-photo.png',
  'jatin-dhama.jpg',
  'swami-anant-vyas.png',
  'team-rca.jpg',
  'logo.png',
  'student-campus-banner.jpg',
  'placeholder.svg',
  'favicon.png',
  'app-icon-192.png',
  'app-icon-512.png',
  'og-image.png'
];

async function uploadPublicAssets() {
  console.log('Uploading public assets to face-images bucket...');
  const publicDir = path.join(__dirname, '..', 'public');

  for (const fileName of filesToUpload) {
    const fullPath = path.join(publicDir, fileName);
    if (!fs.existsSync(fullPath)) {
      console.log(`Skipping missing file: ${fileName}`);
      continue;
    }

    const fileBuffer = fs.readFileSync(fullPath);
    // Sanitize file ID for Appwrite (a-zA-Z0-9._-, max 36 chars)
    const fileId = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);

    try {
      // Check if already exists
      try {
        await storage.getFile('face-images', fileId);
        console.log(`  File ${fileId} already exists in face-images.`);
        continue;
      } catch (err) {
        // Not found, proceed to create
      }

      await storage.createFile(
        'face-images',
        fileId,
        InputFile.fromBuffer(fileBuffer, fileName),
        [
          sdk.Permission.read(sdk.Role.any()),
          sdk.Permission.update(sdk.Role.any()),
          sdk.Permission.delete(sdk.Role.any())
        ]
      );
      console.log(`  Uploaded ${fileName} as ID: ${fileId}`);
    } catch (err) {
      console.warn(`  Failed ${fileName}:`, err.message);
    }
  }

  // Also upload kvs-emblem.png as alias to kvs-logo.png if needed
  try {
    const kvsPath = path.join(publicDir, 'kvs-logo.png');
    if (fs.existsSync(kvsPath)) {
      const buf = fs.readFileSync(kvsPath);
      await storage.createFile(
        'face-images',
        'kvs-emblem.png',
        InputFile.fromBuffer(buf, 'kvs-emblem.png'),
        [sdk.Permission.read(sdk.Role.any())]
      );
      console.log('  Uploaded kvs-emblem.png alias');
    }
  } catch (e) {
    // Already exists or ignore
  }

  const list = await storage.listFiles('face-images');
  console.log(`Total files in face-images now: ${list.total}`);
}

uploadPublicAssets().catch(console.error);
