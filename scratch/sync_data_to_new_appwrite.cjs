const sdk = require('node-appwrite');

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';

const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const databases = new sdk.Databases(client);
const DB_ID = 'presences_db';

async function fetchFromSupabase(table, offset = 0, limit = 100) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${table}: ${res.statusText}`);
  }
  return await res.json();
}

async function fetchAllFromSupabase(table, maxRecords = 5000) {
  let records = [];
  let offset = 0;
  const limit = 100;
  while (offset < maxRecords) {
    const chunk = await fetchFromSupabase(table, offset, limit);
    if (!chunk || chunk.length === 0) break;
    records = records.concat(chunk);
    if (chunk.length < limit) break;
    offset += limit;
  }
  return records;
}

function sanitizeId(id) {
  if (!id) return sdk.ID.unique();
  const clean = String(id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36);
  return clean || sdk.ID.unique();
}

async function migrateCollection(collectionId, allowedAttrs) {
  console.log(`\n================ Migrating ${collectionId} ================`);
  const records = await fetchAllFromSupabase(collectionId, collectionId === 'attendance_records' ? 300 : 2000);
  console.log(`Fetched ${records.length} records from Supabase for ${collectionId}`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const docId = sanitizeId(r.id);

    // Build payload matching allowed attributes only
    const payload = {};
    for (const attr of allowedAttrs) {
      if (r[attr] !== undefined && r[attr] !== null) {
        if (typeof r[attr] === 'object') {
          payload[attr] = JSON.stringify(r[attr]);
        } else {
          payload[attr] = r[attr];
        }
      }
    }

    try {
      await databases.createDocument(DB_ID, collectionId, docId, payload);
      success++;
    } catch (e) {
      if (e.code === 409) {
        // Document already exists
        skipped++;
      } else {
        // Try with ID.unique() in case docId had forbidden characters
        try {
          await databases.createDocument(DB_ID, collectionId, sdk.ID.unique(), payload);
          success++;
        } catch (e2) {
          failed++;
          if (failed <= 3) {
            console.error(`  Error inserting record ${r.id}:`, e2.message);
          }
        }
      }
    }

    if ((i + 1) % 25 === 0 || i === records.length - 1) {
      console.log(`  Processed ${i + 1}/${records.length} (${success} added, ${skipped} skipped, ${failed} failed)`);
    }
  }

  console.log(`Done ${collectionId}: ${success} inserted, ${skipped} existing, ${failed} failed.`);
}

async function run() {
  // 1. Get schema for each collection
  const cols = await databases.listCollections(DB_ID);
  const schemaMap = {};
  for (const c of cols.collections) {
    const attrs = await databases.listAttributes(DB_ID, c.$id);
    schemaMap[c.$id] = attrs.attributes.map(a => a.key);
  }

  // 2. Migrate in priority order
  const order = [
    'attendance_settings',
    'timetable',
    'emergency_events',
    'profiles',
    'face_descriptors',
    'attendance_records'
  ];

  for (const col of order) {
    if (schemaMap[col]) {
      await migrateCollection(col, schemaMap[col]);
    }
  }

  console.log('\nMigration complete! Verifying counts...');
  for (const col of order) {
    const list = await databases.listDocuments(DB_ID, col, [sdk.Query.limit(1)]);
    console.log(`  ${col}: ${list.total} documents in Appwrite`);
  }
}

run().catch(console.error);
