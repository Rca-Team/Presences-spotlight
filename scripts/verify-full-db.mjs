import fs from 'node:fs';
import path from 'node:path';
import { Client, Databases, Users } from 'node-appwrite';

try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) {
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {}

const APPWRITE_ENDPOINT = process.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.VITE_APPWRITE_PROJECT_ID || '6accbd5d00053c5c1ac2';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.VITE_APPWRITE_DATABASE_ID || 'presences_db';

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const databases = new Databases(appwrite);
const users = new Users(appwrite);

async function main() {
  console.log('=== Verifying Appwrite Database Collections & Counts ===\n');
  const cols = await databases.listCollections(DATABASE_ID);
  console.log(`Total Collections in "${DATABASE_ID}": ${cols.total}\n`);

  for (const c of cols.collections) {
    const list = await databases.listDocuments(DATABASE_ID, c.$id, []);
    console.log(`- Collection: "${c.name}" (ID: ${c.$id}) -> ${list.total} documents active`);
  }

  console.log('\n=== Verifying Appwrite Auth Users ===');
  const userList = await users.list();
  console.log(`Total Appwrite Auth Users: ${userList.total}`);
  for (const u of userList.users) {
    console.log(`- User: ${u.email} (ID: ${u.$id}, name: ${u.name}, emailVerification: ${u.emailVerification})`);
  }
}

main().catch(console.error);
