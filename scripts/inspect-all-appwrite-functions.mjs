import { Client, Functions, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6abfd34f000604fcf074')
  .setKey(process.env.APPWRITE_API_KEY);

const functions = new Functions(client);

async function run() {
  const result = await functions.list([Query.limit(100)]);
  console.log(`Total Appwrite functions: ${result.total}`);
  for (const f of result.functions) {
    console.log(`ID: ${f.$id.padEnd(32)} Name: ${f.name.padEnd(30)} Execute: [${f.execute?.join(', ') || 'NONE'}] Deployed: ${f.deployment ? 'YES' : 'NO'}`);
  }
}

run().catch(console.error);
