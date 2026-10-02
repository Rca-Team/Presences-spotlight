import { Client, Databases, Permission, Role } from 'node-appwrite';
import fs from 'fs';
import path from 'path';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'YOUR_KEY';
const DATABASE_ID = 'presences_db';

// Read API key from environment or existing migration script
let apiKey = process.env.APPWRITE_API_KEY;
if (!apiKey) {
  const content = fs.readFileSync('scripts/migrate-full-cloud-to-appwrite.mjs', 'utf8');
  const match = content.match(/const APPWRITE_API_KEY = ['"]([^'"]+)['"]/);
  if (match) apiKey = match[1];
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(apiKey);

const databases = new Databases(client);

async function findCodeTables(dir) {
  const tables = new Set();
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist') {
        walk(full);
      } else if (e.isFile() && /\.(tsx?|jsx?|mjs)$/.test(e.name)) {
        const text = fs.readFileSync(full, 'utf8');
        const matches = text.matchAll(/\.from\(['"]([a-zA-Z0-9_-]+)['"]\)/g);
        for (const m of matches) {
          tables.add(m[1]);
        }
      }
    }
  }
  walk(dir);
  return Array.from(tables);
}

async function audit() {
  console.log('🔍 Auditing all database tables across codebase...');
  const usedTables = await findCodeTables('src');
  console.log(`Found ${usedTables.length} distinct tables referenced in src/:`, usedTables);

  const existingCollectionsRes = await databases.listCollections(DATABASE_ID);
  const existingMap = new Map();
  for (const c of existingCollectionsRes.collections) {
    existingMap.set(c.$id, c);
  }
  console.log(`Currently ${existingCollectionsRes.total} collections in Appwrite presences_db:`, Array.from(existingMap.keys()));

  const missing = usedTables.filter(t => !existingMap.has(t));
  console.log(`\nMissing collections (${missing.length}):`, missing);

  for (const table of missing) {
    console.log(`Creating missing collection: ${table}`);
    try {
      await databases.createCollection(
        DATABASE_ID,
        table,
        table,
        [
          Permission.read(Role.any()),
          Permission.create(Role.any()),
          Permission.update(Role.any()),
          Permission.delete(Role.any()),
        ]
      );
      // Create common attributes
      await databases.createStringAttribute(DATABASE_ID, table, 'user_id', 255, false).catch(() => {});
      await databases.createStringAttribute(DATABASE_ID, table, 'status', 255, false).catch(() => {});
      await databases.createStringAttribute(DATABASE_ID, table, 'type', 255, false).catch(() => {});
      await databases.createStringAttribute(DATABASE_ID, table, 'title', 500, false).catch(() => {});
      await databases.createStringAttribute(DATABASE_ID, table, 'message', 5000, false).catch(() => {});
      await databases.createStringAttribute(DATABASE_ID, table, 'data', 10000, false).catch(() => {});
      console.log(`✅ Collection '${table}' created successfully.`);
    } catch (err) {
      console.error(`Failed to create collection '${table}':`, err.message);
    }
  }

  console.log('\n🎉 Audit and collection sync complete!');
}

audit().catch(console.error);
