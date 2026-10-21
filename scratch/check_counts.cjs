const sdk = require('node-appwrite');

const client = new sdk.Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const databases = new sdk.Databases(client);

async function run() {
  const [attRes, descRes, profRes] = await Promise.all([
    databases.listDocuments('presences_db', 'attendance_records', [sdk.Query.equal('status', 'registered'), sdk.Query.limit(100)]),
    databases.listDocuments('presences_db', 'face_descriptors', [sdk.Query.limit(100)]),
    databases.listDocuments('presences_db', 'profiles', [sdk.Query.limit(100)])
  ]);

  console.log('Registered attendance:', attRes.total);
  console.log('Descriptors:', descRes.total);
  console.log('Profiles:', profRes.total);
}
run();
