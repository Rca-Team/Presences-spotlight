const sdk = require('node-appwrite');

const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398')
  .setKey('standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1');

const users = new sdk.Users(client);

async function setupUser() {
  const userList = await users.list();
  console.log('Existing users count:', userList.total);
  for (const u of userList.users) {
    console.log(`User: ${u.$id}, email: ${u.email}, labels: ${JSON.stringify(u.labels)}`);
  }

  let atlUser = userList.users.find(u => u.email.toLowerCase() === 'atl@gmail.com');

  if (atlUser) {
    console.log(`Updating password for ${atlUser.email}...`);
    await users.updatePassword(atlUser.$id, 'Kvatl@123');
    console.log(`Updating labels for ${atlUser.email}...`);
    await users.updateLabels(atlUser.$id, ['admin', 'principal', 'superadmin', 'teacher']);
    console.log('User updated successfully!');
  } else {
    console.log('Creating user atl@gmail.com...');
    atlUser = await users.create(
      sdk.ID.unique(),
      'atl@gmail.com',
      undefined,
      'Kvatl@123',
      'ATL Superadmin'
    );
    await users.updateLabels(atlUser.$id, ['admin', 'principal', 'superadmin', 'teacher']);
    console.log('User created successfully with ID:', atlUser.$id);
  }

  // Also verify user_roles collection in presences_db
  const databases = new sdk.Databases(client);
  const roles = await databases.listDocuments('presences_db', 'user_roles', [
    sdk.Query.equal('role', 'admin')
  ]);
  console.log('Admin user roles count in DB:', roles.total);

  // Check if atl@gmail.com is in profiles
  const profiles = await databases.listDocuments('presences_db', 'profiles', [
    sdk.Query.equal('email', 'atl@gmail.com')
  ]);
  console.log('Profile for atl@gmail.com:', profiles.total);
  if (profiles.total === 0) {
    console.log('Creating profile for atl@gmail.com...');
    await databases.createDocument('presences_db', 'profiles', atlUser.$id, {
      user_id: atlUser.$id,
      email: 'atl@gmail.com',
      full_name: 'ATL Admin',
      display_name: 'ATL Admin',
      role: 'admin',
      created_at: new Date().toISOString()
    });
    console.log('Profile created in database!');
  } else {
    console.log('Updating profile role to admin...');
    await databases.updateDocument('presences_db', 'profiles', profiles.documents[0].$id, {
      role: 'admin'
    });
  }

  // Also add to user_roles
  const roleDocs = await databases.listDocuments('presences_db', 'user_roles', [
    sdk.Query.equal('user_id', atlUser.$id)
  ]);
  if (roleDocs.total === 0) {
    await databases.createDocument('presences_db', 'user_roles', sdk.ID.unique(), {
      user_id: atlUser.$id,
      role: 'admin',
      created_at: new Date().toISOString()
    });
    console.log('Created admin role document in user_roles!');
  }
}

setupUser().catch(console.error);
