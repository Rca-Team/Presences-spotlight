const https = require('https');

const endpoint = 'https://sgp.cloud.appwrite.io/v1';
const projectId = '6abfd34f000604fcf074';
const apiKey = process.env.APPWRITE_API_KEY;
const userId = '07c295a7-384a-494c-853c-3c0db74fdef4';

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + path);
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('1. Updating password to jairca...');
  const passRes = await request('/users/' + userId + '/password', 'PATCH', { password: 'jairca' });
  console.log('Password update status:', passRes.status, passRes.data);

  console.log('2. Updating name...');
  const nameRes = await request('/users/' + userId + '/name', 'PATCH', { name: 'ATL Super Admin' });
  console.log('Name update status:', nameRes.status, nameRes.data);

  console.log('3. Updating email verification...');
  const verifyRes = await request('/users/' + userId + '/verification', 'PATCH', { emailVerification: true });
  console.log('Verification update status:', verifyRes.status, verifyRes.data);

  console.log('4. Updating labels...');
  const labelRes = await request('/users/' + userId + '/labels', 'PUT', { labels: ['admin', 'superadmin', 'principal'] });
  console.log('Label update status:', labelRes.status, labelRes.data);

  console.log('5. Updating prefs...');
  const prefsRes = await request('/users/' + userId + '/prefs', 'PATCH', { prefs: { role: 'admin', is_admin: true, superadmin: true } });
  console.log('Prefs update status:', prefsRes.status, prefsRes.data);

  console.log('6. Checking / creating database records...');
  const dbId = 'presences_db';
  
  // Try inserting/updating user_roles
  try {
    const roleDocRes = await request('/databases/' + dbId + '/collections/user_roles/documents', 'POST', {
      documentId: 'role_' + userId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30),
      data: {
        user_id: userId,
        role: 'admin'
      },
      permissions: ['read("any")', 'update("any")', 'delete("any")']
    });
    console.log('user_roles doc res:', roleDocRes.status, roleDocRes.data);
  } catch (err) {
    console.log('user_roles err:', err);
  }

  // Try inserting/updating profiles
  try {
    const profileDocRes = await request('/databases/' + dbId + '/collections/profiles/documents', 'POST', {
      documentId: userId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30),
      data: {
        id: userId,
        user_id: userId,
        full_name: 'ATL Super Admin',
        role: 'admin',
        email: 'atl@gmail.com'
      },
      permissions: ['read("any")', 'update("any")', 'delete("any")']
    });
    console.log('profiles doc res:', profileDocRes.status, profileDocRes.data);
  } catch (err) {
    console.log('profiles err:', err);
  }

  console.log('All updates complete for atl@gmail.com!');
}

run().catch(console.error);
