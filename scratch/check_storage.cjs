const sdk = require('node-appwrite');
const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const storage = new sdk.Storage(client);

async function checkStorage() {
  const buckets = await storage.listBuckets();
  for (const b of buckets.buckets) {
    const files = await storage.listFiles(b.$id, [sdk.Query.limit(5)]);
    console.log(`${b.$id} (${b.name}): files count = ${files.total}`);
    if (files.files.length > 0) {
      console.log('   Sample files:', files.files.map(f => `${f.$id}: ${f.name}`));
    }
  }
}
checkStorage().catch(console.error);
