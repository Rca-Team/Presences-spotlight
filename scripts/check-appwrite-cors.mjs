import fs from 'fs';
import https from 'https';

const env = fs.readFileSync('.env.local', 'utf8');
const keyMatch = env.match(/APPWRITE_API_KEY=(.+)/);
const apiKey = keyMatch[1].trim();

const endpoint = 'https://sgp.cloud.appwrite.io/v1';
const projectId = '6abfd34f000604fcf074';

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
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const platforms = await request(`/projects/${projectId}/platforms`);
  console.log('Platforms:', platforms.status, platforms.data);

  const buckets = await request('/storage/buckets');
  console.log('Buckets:', buckets.status, buckets.data);
}

run().catch(console.error);
