import fs from 'fs';
import https from 'https';

const env = fs.readFileSync('.env.local', 'utf8');
const keyMatch = env.match(/APPWRITE_API_KEY=(.+)/);
const apiKey = keyMatch[1].trim();

const endpoint = 'https://sgp.cloud.appwrite.io/v1';
const projectId = '6abfd34f000604fcf074';

function request(p) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + p);
    const req = https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const att = await request('/databases/presences_db/collections/attendance_records/documents');
  console.log('Attendance response keys:', Object.keys(att), 'total:', att.total, 'documents count:', att.documents?.length);
  if (att.documents?.[0]) {
    console.log('Sample record 0:', JSON.stringify(att.documents[0], null, 2));
  }
  const prof = await request('/databases/presences_db/collections/profiles/documents');
  console.log('Profiles total:', prof.total, 'documents count:', prof.documents?.length);
  if (prof.documents?.[0]) {
    console.log('Sample profile 0:', JSON.stringify(prof.documents[0], null, 2));
  }
}

run().catch(console.error);
