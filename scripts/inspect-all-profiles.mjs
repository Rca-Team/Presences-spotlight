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
  const p1 = await request('/databases/presences_db/collections/profiles/documents?queries%5B0%5D=limit(100)');
  console.log('Page 1 total:', p1.total, 'docs:', p1.documents?.length);

  const all = p1.documents || [];
  const classes = {};
  const roles = {};
  all.forEach(p => {
    const cls = p.class || 'Unassigned';
    const sec = p.section || 'General';
    if (!classes[cls]) classes[cls] = {};
    classes[cls][sec] = (classes[cls][sec] || 0) + 1;
    roles[p.role || 'none'] = (roles[p.role || 'none'] || 0) + 1;
  });
  console.log('All classes & sections:', JSON.stringify(classes, null, 2));
  console.log('Roles:', JSON.stringify(roles, null, 2));
}

run().catch(console.error);
