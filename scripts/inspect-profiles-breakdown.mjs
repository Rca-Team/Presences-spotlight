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
  const prof1 = await request('/databases/presences_db/collections/profiles/documents');
  console.log('Total profiles:', prof1.total);
  const classBreakdown = {};
  const roles = {};
  (prof1.documents || []).forEach(p => {
    const cls = p.class || 'Unknown';
    const sec = p.section || '';
    const key = `${cls}-${sec}`.replace(/-$/, '');
    classBreakdown[key] = (classBreakdown[key] || 0) + 1;
    const r = p.role || 'no-role';
    roles[r] = (roles[r] || 0) + 1;
  });
  console.log('Class breakdown in profiles:', classBreakdown);
  console.log('Roles breakdown in profiles:', roles);

  const regRecords = await request('/databases/presences_db/collections/attendance_records/documents');
  console.log('Total attendance records:', regRecords.total);
  const regBreakdown = {};
  (regRecords.documents || []).forEach(r => {
    if (r.status === 'registered') {
      const cat = r.category || 'no-cat';
      regBreakdown[cat] = (regBreakdown[cat] || 0) + 1;
    }
  });
  console.log('Attendance registered breakdown by category:', regBreakdown);
  console.log('Sample profiles:', prof1.documents?.slice(0, 5).map(p => ({
    name: p.display_name || p.full_name,
    class: p.class,
    section: p.section,
    role: p.role,
    dept: p.department
  })));
}

run().catch(console.error);
