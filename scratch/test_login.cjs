const sdk = require('node-appwrite');
const client = new sdk.Client();
client
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6ad309e200176195d398');

const account = new sdk.Account(client);

async function testLogin() {
  try {
    const session = await account.createEmailPasswordSession('atl@gmail.com', 'Kvatl@123');
    console.log('Login SUCCESS! Session ID:', session.$id, 'User ID:', session.userId);
  } catch (e) {
    console.error('Login ERROR:', e.message, e.code, e.type);
  }
}
testLogin();
