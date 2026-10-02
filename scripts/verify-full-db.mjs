import { Client, Databases, Users } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';
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
