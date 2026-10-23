const sdk = require('node-appwrite');
const fs = require('fs');
const path = require('path');

const client = new sdk.Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');
const databases = new sdk.Databases(client);

async function dumpAll() {
  console.log('--- Starting Complete Database Backup ---');
  const collections = [
    'attendance_settings',
    'profiles',
    'face_descriptors',
    'attendance_records',
    'timetable',
    'emergency_events',
    'user_roles',
    'notifications'
  ];

  const fullBackup = {
    exportedAt: new Date().toISOString(),
    databaseId: 'presences_db',
    collections: {}
  };

  for (const coll of collections) {
    console.log(`Exporting ${coll}...`);
    let allDocs = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await databases.listDocuments('presences_db', coll, [
        sdk.Query.limit(limit),
        sdk.Query.offset(offset)
      ]);
      allDocs.push(...res.documents);
      offset += limit;
      if (allDocs.length >= res.total || res.documents.length === 0) break;
    }
    fullBackup.collections[coll] = allDocs;
    console.log(`✓ ${coll}: ${allDocs.length} documents backed up.`);
  }

  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, `presences_full_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(fullBackup, null, 2), 'utf8');
  console.log(`\n🎉 Full Database Backup safely written to:\n${backupFile}`);
}

dumpAll().catch(console.error);
