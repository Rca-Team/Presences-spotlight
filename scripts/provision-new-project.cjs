const https = require('https');

const endpoint = 'https://sgp.cloud.appwrite.io/v1';
const projectId = '6ad309e200176195d398';
const apiKey = 'standard_feb1c088e82baf2076bb0090bea83fbc9cdbf1a13c5c491ac9399786b0fa90019820a7b0beeea92f96d88c88f34dbf484f6c0065217280020203b2b77f3629de5a24fd517708c8bcea6dc4983bd5578a773441fa27d5174b1b3122fd9dc493098274bcf1d1ba53d42fef3c2354f9984cfb15aa1d23f425d040aaa6e06652fad1';
const dbId = 'presences_db';

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

const buckets = [
  'face-images',
  'student-registration-faces',
  'attendance-training-faces',
  'database-exports'
];

const requiredCollections = [
  {
    id: 'profiles',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'full_name', type: 'string', size: 255, required: false },
      { key: 'display_name', type: 'string', size: 255, required: false },
      { key: 'admission_number', type: 'string', size: 100, required: false },
      { key: 'employee_id', type: 'string', size: 100, required: false },
      { key: 'roll_number', type: 'string', size: 50, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'category', type: 'string', size: 100, required: false },
      { key: 'parent_phone', type: 'string', size: 50, required: false },
      { key: 'phone', type: 'string', size: 50, required: false },
      { key: 'parent_name', type: 'string', size: 255, required: false },
      { key: 'father_name', type: 'string', size: 255, required: false },
      { key: 'address', type: 'string', size: 1000, required: false },
      { key: 'blood_group', type: 'string', size: 20, required: false },
      { key: 'email', type: 'string', size: 255, required: false },
      { key: 'parent_email', type: 'string', size: 255, required: false },
      { key: 'avatar_url', type: 'string', size: 2000, required: false },
      { key: 'photo_url', type: 'string', size: 2000, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'role', type: 'string', size: 50, required: false },
      { key: 'updated_at', type: 'string', size: 100, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_admission_number', type: 'key', attributes: ['admission_number'] },
      { key: 'idx_category', type: 'key', attributes: ['category'] }
    ]
  },
  {
    id: 'face_descriptors',
    attributes: [
      { key: 'student_id', type: 'string', size: 255, required: false },
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'label', type: 'string', size: 255, required: false },
      { key: 'student_name', type: 'string', size: 255, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'category', type: 'string', size: 100, required: false },
      { key: 'descriptor', type: 'string', size: 5000, required: false },
      { key: 'image_url', type: 'string', size: 2000, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] },
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_category', type: 'key', attributes: ['category'] }
    ]
  },
  {
    id: 'attendance_records',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'student_id', type: 'string', size: 255, required: false },
      { key: 'student_name', type: 'string', size: 255, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'category', type: 'string', size: 100, required: false },
      { key: 'status', type: 'string', size: 50, required: false },
      { key: 'timestamp', type: 'string', size: 100, required: false },
      { key: 'date', type: 'string', size: 50, required: false },
      { key: 'device_info', type: 'string', size: 5000, required: false },
      { key: 'image_url', type: 'string', size: 2000, required: false },
      { key: 'confidence_score', type: 'float', required: false },
      { key: 'capture_mode', type: 'string', size: 50, required: false },
      { key: 'source', type: 'string', size: 50, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_timestamp', type: 'key', attributes: ['timestamp'], orders: ['DESC'] },
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] },
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_status', type: 'key', attributes: ['status'] }
    ]
  },
  {
    id: 'timetable',
    attributes: [
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'day_of_week', type: 'integer', required: false },
      { key: 'period_number', type: 'integer', required: false },
      { key: 'subject', type: 'string', size: 100, required: false },
      { key: 'teacher_name', type: 'string', size: 255, required: false },
      { key: 'start_time', type: 'string', size: 20, required: false },
      { key: 'end_time', type: 'string', size: 20, required: false },
      { key: 'room', type: 'string', size: 50, required: false },
      { key: 'metadata', type: 'string', size: 2000, required: false }
    ]
  },
  {
    id: 'attendance_settings',
    attributes: [
      { key: 'setting_key', type: 'string', size: 100, required: false },
      { key: 'setting_value', type: 'string', size: 2000, required: false },
      { key: 'description', type: 'string', size: 500, required: false },
      { key: 'updated_at', type: 'string', size: 100, required: false }
    ]
  },
  {
    id: 'emergency_events',
    attributes: [
      { key: 'event_type', type: 'string', size: 50, required: false },
      { key: 'severity', type: 'string', size: 50, required: false },
      { key: 'title', type: 'string', size: 255, required: false },
      { key: 'description', type: 'string', size: 2000, required: false },
      { key: 'status', type: 'string', size: 50, required: false },
      { key: 'triggered_by', type: 'string', size: 255, required: false },
      { key: 'resolved_by', type: 'string', size: 255, required: false },
      { key: 'triggered_at', type: 'string', size: 100, required: false },
      { key: 'resolved_at', type: 'string', size: 100, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_status', type: 'key', attributes: ['status'] },
      { key: 'idx_created_at', type: 'key', attributes: ['created_at'], orders: ['DESC'] }
    ]
  },
  {
    id: 'user_roles',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'role', type: 'string', size: 50, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ]
  },
  {
    id: 'notifications',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'title', type: 'string', size: 255, required: false },
      { key: 'message', type: 'string', size: 2000, required: false },
      { key: 'type', type: 'string', size: 50, required: false },
      { key: 'read', type: 'boolean', required: false },
      { key: 'data', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ]
  },
  {
    id: 'realtime_messages',
    attributes: [
      { key: 'channel', type: 'string', size: 255, required: false },
      { key: 'event', type: 'string', size: 255, required: false },
      { key: 'payload', type: 'string', size: 5000, required: false },
      { key: 'expires_at', type: 'string', size: 100, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ]
  }
];

async function run() {
  console.log('1. Checking database...');
  const dbs = await request('/databases');
  const hasDb = (dbs.data?.databases || []).some(d => d.$id === dbId);
  if (!hasDb) {
    console.log('Creating database presences_db...');
    await request('/databases', 'POST', { databaseId: dbId, name: 'Presences Database' });
  } else {
    console.log('Database presences_db exists.');
  }

  console.log('\n2. Checking storage buckets...');
  const bRes = await request('/storage/buckets');
  const existingBuckets = new Set((bRes.data?.buckets || []).map(b => b.$id));
  for (const b of buckets) {
    if (!existingBuckets.has(b)) {
      console.log(`Creating bucket: ${b}...`);
      const createB = await request('/storage/buckets', 'POST', {
        bucketId: b,
        name: b,
        permissions: ['read("any")', 'create("any")', 'update("any")', 'delete("any")'],
        fileSecurity: false,
        enabled: true,
        maximumFileSize: 30000000
      });
      console.log(`Bucket ${b} result:`, createB.status);
    } else {
      console.log(`Bucket ${b} exists.`);
    }
  }

  console.log('\n3. Provisioning collections...');
  const cRes = await request('/databases/' + dbId + '/collections');
  const existingCols = new Map((cRes.data?.collections || []).map(c => [c.$id, c]));

  for (const col of requiredCollections) {
    console.log(`\n--- Collection: ${col.id} ---`);
    if (!existingCols.has(col.id)) {
      console.log(`Creating collection ${col.id}...`);
      const createRes = await request('/databases/' + dbId + '/collections', 'POST', {
        collectionId: col.id,
        name: col.id,
        permissions: ['read("any")', 'create("any")', 'update("any")', 'delete("any")'],
        documentSecurity: false
      });
      console.log(`Created ${col.id}:`, createRes.status);
    } else {
      console.log(`${col.id} already exists.`);
    }

    const attrRes = await request('/databases/' + dbId + '/collections/' + col.id + '/attributes');
    const existingAttrs = new Set((attrRes.data?.attributes || []).map(a => a.key));

    for (const attr of col.attributes) {
      if (!existingAttrs.has(attr.key)) {
        console.log(`  Adding attribute: ${attr.key}`);
        let attrType = 'string';
        let body = { key: attr.key, required: false };
        if (attr.type === 'string') {
          attrType = 'string';
          body.size = attr.size || 255;
        } else if (attr.type === 'boolean') {
          attrType = 'boolean';
        } else if (attr.type === 'float') {
          attrType = 'float';
        } else if (attr.type === 'integer') {
          attrType = 'integer';
        }
        await request(`/databases/${dbId}/collections/${col.id}/attributes/${attrType}`, 'POST', body);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (col.indexes && col.indexes.length > 0) {
      await new Promise(r => setTimeout(r, 1000));
      const idxRes = await request('/databases/' + dbId + '/collections/' + col.id + '/indexes');
      const existingIndexes = new Set((idxRes.data?.indexes || []).map(i => i.key));

      for (const idx of col.indexes) {
        if (!existingIndexes.has(idx.key)) {
          console.log(`  Adding index: ${idx.key}`);
          await request(`/databases/${dbId}/collections/${col.id}/indexes`, 'POST', {
            key: idx.key,
            type: idx.type || 'key',
            attributes: idx.attributes,
            orders: idx.orders || ['ASC']
          });
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
  }

  console.log('\n4. Creating superadmin user in new project...');
  try {
    const userRes = await request('/users', 'POST', {
      userId: 'admin_atl',
      email: 'atl@gmail.com',
      password: 'jairca',
      name: 'ATL Superadmin'
    });
    console.log('Superadmin user created:', userRes.status);
    // Add labels
    await request('/users/admin_atl/labels', 'PUT', {
      labels: ['admin', 'principal', 'superadmin', 'teacher']
    });
  } catch (uErr) {
    console.log('Admin user result:', uErr.message);
  }

  console.log('\nSUCCESS! New project 6ad309e200176195d398 is fully provisioned and ready!');
}

run().catch(console.error);
