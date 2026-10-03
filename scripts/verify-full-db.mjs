import { Client, Databases, Users } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = 'presences_db';

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
