import fs from 'fs';
import { Client, Databases, Query } from 'node-appwrite';

const env = fs.readFileSync('.env.local', 'utf8');
const keyMatch = env.match(/APPWRITE_API_KEY=(.+)/);
const apiKey = keyMatch[1].trim();

const client = new Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6abfd34f000604fcf074')
  .setKey(apiKey);

const db = new Databases(client);

async function run() {
  const p1 = await db.listDocuments('presences_db', 'profiles', [Query.limit(25), Query.offset(0)]);
  const p2 = await db.listDocuments('presences_db', 'profiles', [Query.limit(25), Query.offset(25)]);
  const all = [...p1.documents, ...p2.documents];
  console.log('Profiles total in Appwrite:', p1.total, 'fetched:', all.length);
  const classes = {};
  const roles = {};
  all.forEach(p => {
    const cls = p.class || (p.department ? `Dept: ${p.department}` : 'Unassigned');
    const sec = p.section || 'A';
    if (!classes[cls]) classes[cls] = {};
    classes[cls][sec] = (classes[cls][sec] || 0) + 1;
    const r = p.role || 'student';
    roles[r] = (roles[r] || 0) + 1;
  });
  console.log('Classes breakdown across all 47:', JSON.stringify(classes, null, 2));
  console.log('Roles breakdown across all 47:', JSON.stringify(roles, null, 2));
}

run().catch(console.error);
