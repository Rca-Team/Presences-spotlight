import { Client, Functions } from 'node-appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

const appwrite = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const functions = new Functions(appwrite);

async function main() {
  try {
    const list = await functions.list();
    console.log('Appwrite Functions:', list.functions.map(f => ({ id: f.$id, name: f.name, runtime: f.runtime })));
  } catch (err) {
    console.error('Appwrite Functions Error:', err);
  }
}

main();
