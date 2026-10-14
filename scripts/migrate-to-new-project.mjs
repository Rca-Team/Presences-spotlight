import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { Client, Storage, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const OLD_PROJECT_ID = '6accbd5d00053c5c1ac2';
const OLD_API_KEY = 'standard_4bf0986e64d5637e3f782be33109e2c7a6250778f88380038c7e8ec0b43ef731c7175ce054d74ff7425441f4eb4737c22d19c6101797ce0449499c2f8ca7ac1328137167b2433566034b91e4273f0f356d26cbe797c4c78f36d4ac295ef28fd6acf7e6406bcd5259ec66eacad83720d27067869c0dcc9213aec711227276bb89';

const NEW_PROJECT_ID = '6accbd5d00053c5c1ac2';
const NEW_API_KEY = 'standard_55bab39a3e91d92a3e3a23486379c4e42e910ad194f438a60a1c6a5f5863da755e5ce018722c52afc8f7cba9a55c15a311885b5a464594902faa3c9a875fe01a0d38bfddbcc428da6564044525dc674eea4632a18faf296feb7e17cc95cf2567be465521bd068332f87740dc879b200964f79de960ca2a4c31e183cc72671958';

const SUPABASE_URL = 'https://cvdcbcsonlianbfeessy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';

const DATABASE_ID = 'presences_db';

const agent = new https.Agent({ keepAlive: true, maxSockets: 25, timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appwriteRequest(projectId, apiKey, path, method = 'GET', body = null, isBinary = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT + path);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      agent,
      timeout: 25000,
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (isBinary) {
          resolve({ status: res.statusCode, data: buf });
          return;
        }
        const text = buf.toString('utf8');
        try {
          resolve({ status: res.statusCode, data: text ? JSON.parse(text) : {} });
        } catch {
          resolve({ status: res.statusCode, data: text });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function reqNew(path, method = 'GET', body = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await appwriteRequest(NEW_PROJECT_ID, NEW_API_KEY, path, method, body);
      if (res.status >= 500 && attempt < 3) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

async function reqOld(path, method = 'GET', body = null, isBinary = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await appwriteRequest(OLD_PROJECT_ID, OLD_API_KEY, path, method, body, isBinary);
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

async function runInParallel(items, workerFn, concurrency = 15) {
  let idx = 0;
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => workerFn(item, idx++));
    results.push(p);
    if (concurrency <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

function getAppwriteFileId(rawPath) {
  const normalized = String(rawPath || '').replace(/^\/+/, '').trim();
  if (!normalized.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(normalized)) {
    return normalized;
  }
  return crypto.createHash('md5').update(normalized).digest('hex');
}

function resolveToAppwriteUrl(rawUrl, defaultBucket = 'face-images') {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return rawUrl;
  if (trimmed.includes('appwrite.io') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  let bucket = defaultBucket;
  let cleanPath = trimmed;
  if (trimmed.includes('/storage/v1/object/')) {
    const match = trimmed.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/i);
    if (match) {
      bucket = match[1];
      cleanPath = decodeURIComponent(match[2]).split('?')[0];
    }
  } else if (trimmed.startsWith('faces/') || trimmed.startsWith('attendance/') || trimmed.startsWith('public/')) {
    bucket = 'face-images';
  }
  const fileId = getAppwriteFileId(cleanPath);
  const projId = bucket === 'student-registration-faces' ? NEW_PROJECT_ID : OLD_PROJECT_ID;
  return `${ENDPOINT}/storage/buckets/${bucket}/files/${fileId}/view?project=${projId}`;
}

async function fetchSupabaseAll(tableName) {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=${limit}&offset=${offset}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

// 1. Copy 146 registration files cleanly
async function syncRegistrationFiles() {
  console.log('\n[1/4] Syncing "student-registration-faces" files to new project...');
  const newClient = new Client().setEndpoint(ENDPOINT).setProject(NEW_PROJECT_ID).setKey(NEW_API_KEY);
  const newStorage = new Storage(newClient);

  const listRes = await reqOld('/storage/buckets/student-registration-faces/files?queries[]=' + encodeURIComponent(JSON.stringify({ method: 'limit', values: [100] })));
  const listRes2 = await reqOld('/storage/buckets/student-registration-faces/files?queries[]=' + encodeURIComponent(JSON.stringify({ method: 'limit', values: [100] })) + '&queries[]=' + encodeURIComponent(JSON.stringify({ method: 'offset', values: [100] })));
  const allFiles = [...(listRes.data.files || []), ...(listRes2.data.files || [])];

  const filePerms = [
    Permission.read(Role.any()),
    Permission.update(Role.any()),
    Permission.delete(Role.any())
  ];

  let synced = 0;
  await runInParallel(allFiles, async (file) => {
    const check = await reqNew(`/storage/buckets/student-registration-faces/files/${file.$id}`);
    if (check.status === 200) {
      synced++;
      return;
    }
    try {
      const dl = await reqOld(`/storage/buckets/student-registration-faces/files/${file.$id}/download`, 'GET', null, true);
      if (dl.status === 200 && Buffer.isBuffer(dl.data)) {
        await newStorage.createFile(
          'student-registration-faces',
          file.$id,
          InputFile.fromBuffer(dl.data, file.name),
          filePerms
        );
        synced++;
      }
    } catch (e) {
      if (e.code === 409) synced++;
      else console.warn(`  ⚠️ File copy warning (${file.$id}):`, e.message);
    }
  }, 10);

  console.log(`  ✅ Synced ${synced}/${allFiles.length} registration face assets.`);
}

// 2. Provision All Collections, Attributes & Indexes using off-row MEDIUMTEXT (size 60000) for JSON fields
async function setupCollections() {
  console.log('\n[2/4] Provisioning Collections, Attributes & Indexes...');

  // Reset broken partial profiles collection if needed so all attributes fit cleanly
  const profAttrs = await reqNew(`/databases/${DATABASE_ID}/collections/profiles/attributes`);
  if (profAttrs.status === 200 && !(profAttrs.data.attributes || []).some(a => a.key === 'metadata')) {
    console.log('  🔄 Recreating "profiles" collection with off-row MEDIUMTEXT for large fields...');
    await reqNew(`/databases/${DATABASE_ID}/collections/profiles`, 'DELETE');
    await sleep(1500);
  }

  const auditText = fs.readFileSync('appwrite-audit.txt', 'utf8').split('FUNCTIONS [')[0].trim();
  const auditJson = JSON.parse(auditText);

  // Authoritative extra attributes & indexes
  const extraAttrsByCol = {
    profiles: [
      { key: 'position', type: 'string', size: 100 },
      { key: 'status', type: 'string', size: 50 },
      { key: 'is_active', type: 'boolean' }
    ],
    face_descriptors: [
      { key: 'confidence', type: 'double' },
      { key: 'sample_type', type: 'string', size: 100 }
    ],
    attendance_records: [
      { key: 'notes', type: 'string', size: 1000 }
    ],
    attendance_settings: [
      { key: 'key', type: 'string', size: 255 },
      { key: 'value', type: 'string', size: 60000 }
    ]
  };

  const indexesByCol = {
    profiles: [
      { key: 'idx_user_id', attributes: ['user_id'] },
      { key: 'idx_admission_number', attributes: ['admission_number'] },
      { key: 'idx_employee_id', attributes: ['employee_id'] },
      { key: 'idx_email', attributes: ['email'] },
      { key: 'idx_role', attributes: ['role'] }
    ],
    face_descriptors: [
      { key: 'idx_user_id', attributes: ['user_id'] },
      { key: 'idx_student_id', attributes: ['student_id'] },
      { key: 'idx_label', attributes: ['label'] }
    ],
    attendance_records: [
      { key: 'idx_status', attributes: ['status'] },
      { key: 'idx_timestamp', attributes: ['timestamp'], orders: ['DESC'] },
      { key: 'idx_user_id', attributes: ['user_id'] },
      { key: 'idx_student_id', attributes: ['student_id'] },
      { key: 'idx_category', attributes: ['category'] }
    ],
    user_roles: [
      { key: 'idx_user_id', attributes: ['user_id'] },
      { key: 'idx_role', attributes: ['role'] }
    ],
    attendance_settings: [
      { key: 'idx_key', attributes: ['key'] }
    ],
    emergency_events: [
      { key: 'idx_status', attributes: ['status'] }
    ],
    gate_entries: [
      { key: 'idx_entry_time', attributes: ['entry_time'], orders: ['DESC'] },
      { key: 'idx_student_id', attributes: ['student_id'] }
    ]
  };

  function getOptimalAttrSize(colId, key) {
    if (['metadata', 'device_info', 'descriptor', 'descriptors', 'face_descriptor', 'payload', 'value', 'subscription'].includes(key)) {
      return 60000; // Stored as off-row MEDIUMTEXT in MariaDB!
    }
    if (key.includes('url') || key.includes('message') || key.includes('description') || key.includes('notes') || key.includes('address')) {
      return 1024;
    }
    return 255;
  }

  const allCols = [...auditJson.collections];
  if (!allCols.some(c => c.id === 'student_enrollment')) {
    allCols.push({
      id: 'student_enrollment',
      serverOnly: true,
      attributes: [
        { key: 'kind', type: 'string', size: 24, required: true },
        { key: 'expires', type: 'double', required: true },
        { key: 'payload', type: 'string', size: 60000, required: true }
      ]
    });
  }
  if (!allCols.some(c => c.id === 'realtime_messages')) {
    allCols.push({
      id: 'realtime_messages',
      attributes: [
        { key: 'channel', type: 'string', size: 255 },
        { key: 'event', type: 'string', size: 128 },
        { key: 'payload', type: 'string', size: 60000 },
        { key: 'sender_id', type: 'string', size: 64 },
        { key: 'sent_at', type: 'string', size: 64 },
        { key: 'expires_at', type: 'string', size: 64 }
      ]
    });
  }

  const existingRes = await reqNew(`/databases/${DATABASE_ID}/collections?queries[]=` + encodeURIComponent(JSON.stringify({ method: 'limit', values: [100] })));
  const existingCols = new Set((existingRes.data.collections || []).map(c => c.$id));

  for (const col of allCols) {
    if (!existingCols.has(col.id)) {
      const perms = col.id === 'student_enrollment' ? [] : ['read("any")', 'create("any")', 'update("any")', 'delete("any")'];
      const cRes = await reqNew(`/databases/${DATABASE_ID}/collections`, 'POST', {
        collectionId: col.id,
        name: col.id,
        permissions: perms,
        documentSecurity: col.id === 'student_enrollment'
      });
      if (cRes.status === 201) {
        console.log(`  ✅ Created collection "${col.id}"`);
      }
    }

    const mergedAttrs = [...(col.attributes || []), ...(extraAttrsByCol[col.id] || [])];
    if (mergedAttrs.length === 0) continue;

    const curAttrRes = await reqNew(`/databases/${DATABASE_ID}/collections/${col.id}/attributes`);
    const existingKeys = new Set((curAttrRes.data.attributes || []).map(a => a.key));
    let createdCount = 0;

    for (const attr of mergedAttrs) {
      if (existingKeys.has(attr.key)) continue;
      existingKeys.add(attr.key);

      let endpointType = 'string';
      const body = { key: attr.key, required: Boolean(attr.required) };
      if (attr.type === 'boolean') {
        endpointType = 'boolean';
      } else if (attr.type === 'double' || attr.type === 'float') {
        endpointType = 'float';
      } else if (attr.type === 'integer') {
        endpointType = 'integer';
      } else {
        endpointType = 'string';
        body.size = attr.size || getOptimalAttrSize(col.id, attr.key);
      }

      const aRes = await reqNew(`/databases/${DATABASE_ID}/collections/${col.id}/attributes/${endpointType}`, 'POST', body);
      if (aRes.status === 202 || aRes.status === 201) {
        createdCount++;
      } else if (aRes.status !== 409) {
        console.warn(`    ⚠️ Attr ${col.id}.${attr.key} (${aRes.status}):`, aRes.data?.message);
      }
    }

    if (createdCount > 0 && ['profiles', 'face_descriptors', 'attendance_records', 'timetable', 'user_roles', 'attendance_settings', 'emergency_events', 'student_enrollment'].includes(col.id)) {
      for (let w = 0; w < 25; w++) {
        await sleep(700);
        const chk = await reqNew(`/databases/${DATABASE_ID}/collections/${col.id}/attributes`);
        const list = chk.data?.attributes || [];
        if (list.length > 0 && list.every(a => a.status === 'available')) break;
      }
    }

    const colIndexes = indexesByCol[col.id] || (col.id === 'student_enrollment' ? [{ key: 'kind', attributes: ['kind'] }, { key: 'expires', attributes: ['expires'] }] : []);
    if (colIndexes.length > 0) {
      const idxRes = await reqNew(`/databases/${DATABASE_ID}/collections/${col.id}/indexes`);
      const existingIdx = new Set((idxRes.data?.indexes || []).map(i => i.key));
      for (const idx of colIndexes) {
        if (existingIdx.has(idx.key)) continue;
        await reqNew(`/databases/${DATABASE_ID}/collections/${col.id}/indexes`, 'POST', {
          key: idx.key,
          type: 'key',
          attributes: idx.attributes,
          orders: idx.orders || ['ASC']
        });
      }
    }
  }
  console.log(`  ✅ All ${allCols.length} collections, attributes & indexes provisioned.`);
}

// 3. Migrate All Documents
async function migrateAllData() {
  console.log('\n[3/4] Migrating All Database Documents...');

  const repairedMap = new Map();
  if (fs.existsSync('.vercel/registration-metadata-backup.json')) {
    try {
      const repairs = JSON.parse(fs.readFileSync('.vercel/registration-metadata-backup.json', 'utf8'));
      for (const r of repairs) {
        if (r.id && r.repaired) repairedMap.set(r.id, r.repaired);
      }
    } catch {}
  }

  const [rawProfiles, rawAttendance, rawDescriptors, rawTimetable, rawEmergency, rawSettings] = await Promise.all([
    fetchSupabaseAll('profiles'),
    fetchSupabaseAll('attendance_records'),
    fetchSupabaseAll('face_descriptors'),
    fetchSupabaseAll('timetable'),
    fetchSupabaseAll('emergency_events'),
    fetchSupabaseAll('attendance_settings')
  ]);

  const profilesByKey = new Map();
  const unifiedProfiles = [];

  for (const p of rawProfiles) {
    const meta = (typeof p.metadata === 'object' && p.metadata) ? p.metadata : {};
    const adm = String(p.admission_number || p.employee_id || meta.admission_number || meta.employee_id || p.roll_number || meta.roll_number || '').trim();
    const clsSec = String(meta.class_section || p.category || '').trim();
    const [cls, sec] = (!p.class && clsSec.includes('-')) ? clsSec.split('-') : [p.class || clsSec || '', p.section || ''];
    const avatarUrl = resolveToAppwriteUrl(p.avatar_url || p.photo_url || meta.avatar_url || meta.photo_url);

    const doc = {
      id: p.id,
      user_id: p.user_id || p.id,
      full_name: p.full_name || p.display_name || meta.name || meta.full_name || '',
      display_name: p.display_name || p.full_name || meta.name || meta.full_name || '',
      username: p.username || '',
      email: p.email || meta.student_email || p.parent_email || meta.parent_email || '',
      roll_number: String(p.roll_number || meta.roll_number || meta.position || p.position || adm || ''),
      admission_number: adm,
      employee_id: adm,
      class: cls,
      section: sec,
      category: p.category || clsSec || (cls && sec ? `${cls}-${sec}` : cls),
      department: p.department || meta.department || clsSec || '',
      position: String(p.position || meta.position || ''),
      gender: p.gender || meta.gender || '',
      blood_group: p.blood_group || meta.blood_group || '',
      parent_name: p.parent_name || p.father_name || meta.parent_name || meta.father_name || '',
      father_name: p.father_name || p.parent_name || meta.parent_name || '',
      parent_email: p.parent_email || meta.parent_email || '',
      parent_phone: p.parent_phone || p.phone || meta.parent_phone || meta.phone || '',
      phone: p.phone || p.parent_phone || meta.parent_phone || meta.phone || '',
      address: p.address || meta.address || '',
      avatar_url: avatarUrl || '',
      photo_url: resolveToAppwriteUrl(p.photo_url || meta.face_model?.id_card_photo_url) || avatarUrl || '',
      role: p.role || 'student',
      metadata: JSON.stringify(meta),
      created_at: p.created_at || new Date().toISOString(),
      updated_at: p.updated_at || p.created_at || new Date().toISOString()
    };

    if (adm) profilesByKey.set(adm.toLowerCase(), doc);
    if (doc.user_id) profilesByKey.set(String(doc.user_id).toLowerCase(), doc);
    unifiedProfiles.push(doc);
  }

  for (const r of rawAttendance) {
    if (r.status !== 'registered') continue;
    let devInfo = r.device_info;
    if (repairedMap.has(r.id)) {
      try { devInfo = JSON.parse(repairedMap.get(r.id)); } catch {}
    } else if (typeof devInfo === 'string') {
      try { devInfo = JSON.parse(devInfo); } catch {}
    }
    const meta = devInfo?.metadata || {};
    const empId = String(meta.employee_id || meta.admission_number || r.student_id || meta.roll_number || '').trim();
    const name = String(meta.name || meta.full_name || empId || '').trim();
    if (!empId && !name) continue;
    const clsSec = String(meta.class_section || meta.department || r.category || '').trim();
    const [cls, sec] = clsSec.includes('-') ? clsSec.split('-') : [meta.class || clsSec || '', meta.section || ''];
    const primaryPhoto = meta.training_registration_path
      ? `${ENDPOINT}/storage/buckets/student-registration-faces/files/${getAppwriteFileId(meta.training_registration_path)}/view?project=${NEW_PROJECT_ID}`
      : resolveToAppwriteUrl(r.image_url || meta.firebase_image_url || meta.face_model?.id_card_photo_url);

    const existing = (empId && profilesByKey.get(empId.toLowerCase())) || (r.user_id && profilesByKey.get(String(r.user_id).toLowerCase()));
    if (existing) {
      if (!existing.full_name && name) existing.full_name = name;
      if (!existing.display_name && name) existing.display_name = name;
      if (!existing.admission_number && empId) existing.admission_number = empId;
      if (!existing.employee_id && empId) existing.employee_id = empId;
      if (!existing.class && cls) existing.class = cls;
      if (!existing.section && sec) existing.section = sec;
      if (!existing.category && clsSec) existing.category = clsSec;
      if (!existing.parent_phone && (meta.parent_phone || meta.phone)) existing.parent_phone = meta.parent_phone || meta.phone;
      if (!existing.phone && existing.parent_phone) existing.phone = existing.parent_phone;
      if (!existing.parent_name && meta.parent_name) existing.parent_name = meta.parent_name;
      if (!existing.father_name && meta.parent_name) existing.father_name = meta.parent_name;
      if (!existing.address && meta.address) existing.address = meta.address;
      if (!existing.blood_group && meta.blood_group) existing.blood_group = meta.blood_group;
      if (!existing.avatar_url && primaryPhoto) existing.avatar_url = primaryPhoto;
      if (!existing.photo_url && primaryPhoto) existing.photo_url = resolveToAppwriteUrl(meta.face_model?.id_card_photo_url) || primaryPhoto;
    } else {
      const synthId = r.user_id || r.id || empId;
      const synth = {
        id: synthId,
        user_id: r.user_id || synthId,
        full_name: name,
        display_name: name,
        username: '',
        email: meta.student_email || meta.parent_email || '',
        roll_number: String(meta.roll_number || meta.position || empId || ''),
        admission_number: empId,
        employee_id: empId,
        class: cls || '',
        section: sec || '',
        category: clsSec || '',
        department: clsSec || '',
        position: String(meta.position || meta.roll_number || ''),
        gender: meta.gender || '',
        blood_group: meta.blood_group || '',
        parent_name: meta.parent_name || '',
        father_name: meta.parent_name || '',
        parent_email: meta.parent_email || '',
        parent_phone: meta.parent_phone || meta.phone || '',
        phone: meta.parent_phone || meta.phone || '',
        address: meta.address || '',
        avatar_url: primaryPhoto || '',
        photo_url: resolveToAppwriteUrl(meta.face_model?.id_card_photo_url) || primaryPhoto || '',
        role: 'student',
        metadata: JSON.stringify(meta),
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || r.created_at || new Date().toISOString()
      };
      if (empId) profilesByKey.set(empId.toLowerCase(), synth);
      unifiedProfiles.push(synth);
    }
  }

  const userToStudentId = new Map();
  const nameToStudentId = new Map();
  for (const p of unifiedProfiles) {
    const adm = String(p.admission_number || p.employee_id || '').trim();
    if (adm) {
      if (p.user_id) userToStudentId.set(String(p.user_id).trim(), adm);
      if (p.id) userToStudentId.set(String(p.id).trim(), adm);
      if (p.full_name) nameToStudentId.set(String(p.full_name).trim().toLowerCase(), adm);
    }
  }

  async function upsertCollectionDocs(collectionId, rows, transformFn) {
    const attrRes = await reqNew(`/databases/${DATABASE_ID}/collections/${collectionId}/attributes`);
    const attrs = attrRes.data?.attributes || [];
    const validKeys = new Set(attrs.filter(a => a.status === 'available').map(a => a.key));
    const sizeMap = new Map(attrs.map(a => [a.key, a.size || 255]));
    let synced = 0;

    await runInParallel(rows, async (rawRow) => {
      const row = transformFn ? transformFn(rawRow) : rawRow;
      const docId = String(row.id || row.$id || crypto.randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 36);
      const data = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'id' || k.startsWith('$') || !validKeys.has(k) || v === null || v === undefined) continue;
        const maxLen = sizeMap.get(k) || 255;
        if (typeof v === 'object') {
          const s = JSON.stringify(v);
          data[k] = s.length > maxLen ? s.slice(0, maxLen) : s;
        } else if (typeof v === 'string') {
          data[k] = v.length > maxLen ? v.slice(0, maxLen) : v;
        } else {
          data[k] = v;
        }
      }

      const res = await reqNew(`/databases/${DATABASE_ID}/collections/${collectionId}/documents`, 'POST', {
        documentId: docId,
        data
      });
      if (res.status === 201 || res.status === 409) {
        if (res.status === 409) {
          await reqNew(`/databases/${DATABASE_ID}/collections/${collectionId}/documents/${docId}`, 'PATCH', { data });
        }
        synced++;
      } else {
        console.warn(`    ⚠️ Doc warning ${collectionId}/${docId} (${res.status}):`, res.data?.message);
      }
    }, 20);

    console.log(`  ✅ Synced ${synced}/${rows.length} documents into "${collectionId}"`);
  }

  await upsertCollectionDocs('profiles', unifiedProfiles);

  await upsertCollectionDocs('face_descriptors', rawDescriptors, (d) => {
    const studentId = d.student_id ||
      (d.user_id ? userToStudentId.get(String(d.user_id).trim()) : undefined) ||
      (d.label ? nameToStudentId.get(String(d.label).trim().toLowerCase()) : undefined) ||
      '';
    const matchedProfile = studentId ? profilesByKey.get(String(studentId).toLowerCase()) : undefined;
    return {
      ...d,
      student_id: studentId,
      student_name: d.student_name || d.label || matchedProfile?.full_name || '',
      class: d.class || matchedProfile?.class || '',
      section: d.section || matchedProfile?.section || '',
      image_url: resolveToAppwriteUrl(d.image_url) || '',
      descriptor: typeof d.descriptor === 'object' ? JSON.stringify(d.descriptor) : d.descriptor
    };
  });

  await upsertCollectionDocs('attendance_records', rawAttendance, (r) => {
    let devInfoStr = typeof r.device_info === 'object' ? JSON.stringify(r.device_info) : String(r.device_info || '');
    if (repairedMap.has(r.id)) {
      devInfoStr = repairedMap.get(r.id);
    }
    return {
      ...r,
      image_url: resolveToAppwriteUrl(r.image_url) || '',
      device_info: devInfoStr
    };
  });

  await upsertCollectionDocs('timetable', rawTimetable);
  await upsertCollectionDocs('emergency_events', rawEmergency);
  await upsertCollectionDocs('attendance_settings', rawSettings);

  const uListRes = await reqOld('/users?queries[]=' + encodeURIComponent(JSON.stringify({ method: 'limit', values: [100] })));
  const roleRows = [];
  for (const u of (uListRes.data?.users || [])) {
    if ((u.labels || []).includes('admin') || (u.labels || []).includes('superadmin') || u.email === 'atl@gmail.com') {
      roleRows.push({
        id: u.$id,
        user_id: u.$id,
        role: 'admin',
        created_at: u.$createdAt || new Date().toISOString()
      });
    }
  }
  await upsertCollectionDocs('user_roles', roleRows);
}

async function main() {
  const start = Date.now();
  console.log('================================================================');
  console.log('🚀 RESILIENT MIGRATION TO NEW APPWRITE PROJECT:', NEW_PROJECT_ID);
  console.log('================================================================');

  await syncRegistrationFiles();
  await setupCollections();
  await migrateAllData();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n================================================================');
  console.log(`🎉 ALL DATA & COLLECTIONS MIGRATED IN ${elapsed}s!`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
