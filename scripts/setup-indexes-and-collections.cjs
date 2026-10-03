const https = require('https');

const endpoint = 'https://sgp.cloud.appwrite.io/v1';
const projectId = '6abfd34f000604fcf074';
const apiKey = process.env.APPWRITE_API_KEY;
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

const requiredCollections = [
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
      { key: 'idx_status', type: 'key', attributes: ['status'] },
      { key: 'idx_timestamp', type: 'key', attributes: ['timestamp'], orders: ['DESC'] },
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] },
      { key: 'idx_category', type: 'key', attributes: ['category'] }
    ]
  },
  {
    id: 'face_descriptors',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'student_id', type: 'string', size: 255, required: false },
      { key: 'student_name', type: 'string', size: 255, required: false },
      { key: 'label', type: 'string', size: 255, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'descriptor', type: 'string', size: 10000, required: false },
      { key: 'image_url', type: 'string', size: 2000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] },
      { key: 'idx_label', type: 'key', attributes: ['label'] }
    ]
  },
  {
    id: 'gate_entries',
    attributes: [
      { key: 'student_id', type: 'string', size: 255, required: false },
      { key: 'student_name', type: 'string', size: 255, required: false },
      { key: 'entry_time', type: 'string', size: 100, required: false },
      { key: 'is_recognized', type: 'boolean', required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_entry_time', type: 'key', attributes: ['entry_time'], orders: ['DESC'] },
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] },
      { key: 'idx_is_recognized', type: 'key', attributes: ['is_recognized'] }
    ]
  },
  {
    id: 'profiles',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'full_name', type: 'string', size: 255, required: false },
      { key: 'display_name', type: 'string', size: 255, required: false },
      { key: 'username', type: 'string', size: 255, required: false },
      { key: 'role', type: 'string', size: 50, required: false },
      { key: 'email', type: 'string', size: 255, required: false },
      { key: 'parent_email', type: 'string', size: 255, required: false },
      { key: 'department', type: 'string', size: 100, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'avatar_url', type: 'string', size: 2000, required: false },
      { key: 'photo_url', type: 'string', size: 2000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_email', type: 'key', attributes: ['email'] },
      { key: 'idx_role', type: 'key', attributes: ['role'] }
    ]
  },
  {
    id: 'user_roles',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'role', type: 'string', size: 50, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] },
      { key: 'idx_role', type: 'key', attributes: ['role'] }
    ]
  },
  {
    id: 'attendance_settings',
    attributes: [
      { key: 'key', type: 'string', size: 255, required: false },
      { key: 'value', type: 'string', size: 10000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_key', type: 'key', attributes: ['key'] }
    ]
  },
  {
    id: 'emergency_events',
    attributes: [
      { key: 'event_type', type: 'string', size: 100, required: false },
      { key: 'description', type: 'string', size: 2000, required: false },
      { key: 'status', type: 'string', size: 50, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false },
      { key: 'triggered_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_status', type: 'key', attributes: ['status'] }
    ]
  },
  {
    id: 'teacher_permissions',
    attributes: [
      { key: 'teacher_id', type: 'string', size: 255, required: false },
      { key: 'permission', type: 'string', size: 100, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_teacher_id', type: 'key', attributes: ['teacher_id'] }
    ]
  },
  {
    id: 'class_teachers',
    attributes: [
      { key: 'teacher_id', type: 'string', size: 255, required: false },
      { key: 'class', type: 'string', size: 50, required: false },
      { key: 'section', type: 'string', size: 50, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_teacher_id', type: 'key', attributes: ['teacher_id'] }
    ]
  },
  {
    id: 'gv_events',
    attributes: [
      { key: 'event_type', type: 'string', size: 100, required: false },
      { key: 'student_id', type: 'string', size: 255, required: false },
      { key: 'timestamp', type: 'string', size: 100, required: false },
      { key: 'metadata', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_timestamp', type: 'key', attributes: ['timestamp'], orders: ['DESC'] },
      { key: 'idx_student_id', type: 'key', attributes: ['student_id'] }
    ]
  },
  {
    id: 'push_subscriptions',
    attributes: [
      { key: 'user_id', type: 'string', size: 255, required: false },
      { key: 'subscription', type: 'string', size: 5000, required: false },
      { key: 'created_at', type: 'string', size: 100, required: false }
    ],
    indexes: [
      { key: 'idx_user_id', type: 'key', attributes: ['user_id'] }
    ]
  }
];

async function main() {
  console.log('Fetching existing collections...');
  const res = await request('/databases/' + dbId + '/collections');
  const existing = new Map((res.data?.collections || []).map(c => [c.$id, c]));

  for (const col of requiredCollections) {
    console.log(`\n=== Processing collection: ${col.id} ===`);
    if (!existing.has(col.id)) {
      console.log(`Creating collection ${col.id}...`);
      const createRes = await request('/databases/' + dbId + '/collections', 'POST', {
        collectionId: col.id,
        name: col.id,
        permissions: ['read("any")', 'create("any")', 'update("any")', 'delete("any")'],
        documentSecurity: false
      });
      console.log(`Create collection result:`, createRes.status);
    } else {
      // Update permissions to any
      await request('/databases/' + dbId + '/collections/' + col.id, 'PUT', {
        name: col.id,
        permissions: ['read("any")', 'create("any")', 'update("any")', 'delete("any")'],
        documentSecurity: false
      });
    }

    // Get current attributes
    const attrRes = await request('/databases/' + dbId + '/collections/' + col.id + '/attributes');
    const existingAttrs = new Set((attrRes.data?.attributes || []).map(a => a.key));

    for (const attr of col.attributes) {
      if (!existingAttrs.has(attr.key)) {
        console.log(`Creating attribute ${attr.key} on ${col.id}...`);
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
        const createAttrRes = await request(`/databases/${dbId}/collections/${col.id}/attributes/${attrType}`, 'POST', body);
        console.log(`Created attribute ${attr.key}:`, createAttrRes.status);
      }
    }

    // Wait a brief moment for attributes to be ready before creating indexes
    await new Promise(r => setTimeout(r, 1000));

    // Get current indexes
    const indexRes = await request('/databases/' + dbId + '/collections/' + col.id + '/indexes');
    const existingIndexes = new Set((indexRes.data?.indexes || []).map(i => i.key));

    for (const idx of col.indexes || []) {
      if (!existingIndexes.has(idx.key)) {
        console.log(`Creating index ${idx.key} on ${col.id}...`);
        const createIdxRes = await request(`/databases/${dbId}/collections/${col.id}/indexes`, 'POST', {
          key: idx.key,
          type: idx.type || 'key',
          attributes: idx.attributes,
          orders: idx.orders || ['ASC']
        });
        console.log(`Created index ${idx.key}:`, createIdxRes.status, createIdxRes.data?.message || 'OK');
      }
    }
  }

  console.log('\nAll collections, attributes, and indexes have been initialized!');
}

main().catch(console.error);
