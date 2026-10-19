// Verification test for Presences AI upgraded backup and restore engine
const https = require('https');

// 1. Test CSV Parser
const sampleCsv = `Admission Number,Roll Number,Full Name,Class,Section,Role,Email,Phone
1001,1,Aarav Sharma,10,A,student,aarav@school.edu,9876543210
1002,2,Diya Patel,10,A,student,diya@school.edu,9876543211
1003,3,"Kumar, Rohan",10,B,student,rohan@school.edu,9876543212
`;

function parseRosterCsv(csvText) {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const cols = [];
    let col = '';
    let inside = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') {
          col += '"';
          i++;
        } else {
          inside = !inside;
        }
      } else if (c === ',' && !inside) {
        cols.push(col.trim());
        col = '';
      } else {
        col += c;
      }
    }
    cols.push(col.trim());
    return cols;
  };

  const rawHeaders = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const headerMap = {};

  rawHeaders.forEach((h, idx) => {
    if (h.includes('admission') || h.includes('adm_no') || h.includes('scholar')) headerMap[idx] = 'admission_number';
    else if (h.includes('roll')) headerMap[idx] = 'roll_number';
    else if (h.includes('name') && !h.includes('parent') && !h.includes('father')) headerMap[idx] = 'full_name';
    else if (h === 'class' || h.includes('grade') || h.includes('standard')) headerMap[idx] = 'class';
    else if (h === 'section' || h.includes('sec')) headerMap[idx] = 'section';
    else if (h.includes('category')) headerMap[idx] = 'category';
    else if (h === 'role') headerMap[idx] = 'role';
    else if (h.includes('email') && !h.includes('parent')) headerMap[idx] = 'email';
    else if ((h.includes('phone') || h.includes('mobile')) && !h.includes('parent')) headerMap[idx] = 'phone';
    else if (h.includes('parent_name') || h.includes('father_name') || h.includes('guardian')) headerMap[idx] = 'parent_name';
    else if (h.includes('parent_phone') || h.includes('guardian_phone') || h.includes('father_phone')) headerMap[idx] = 'parent_phone';
    else if (h.includes('parent_email') || h.includes('guardian_email')) headerMap[idx] = 'parent_email';
    else if (h.includes('avatar') || h.includes('photo')) headerMap[idx] = 'photo_url';
    else headerMap[idx] = h;
  });

  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const student = {};
    cols.forEach((val, idx) => {
      const field = headerMap[idx];
      if (field) student[field] = val;
    });
    if (student.admission_number || student.full_name) {
      if (!student.employee_id && student.admission_number) student.employee_id = student.admission_number;
      if (!student.display_name && student.full_name) student.display_name = student.full_name;
      if (!student.category && (student.class || student.section)) {
        student.category = [student.class, student.section].filter(Boolean).join('-');
      }
      if (!student.role) student.role = 'student';
      students.push(student);
    }
  }
  return students;
}

const parsed = parseRosterCsv(sampleCsv);
console.log('✓ parseRosterCsv parsed count:', parsed.length);
console.log('Sample parsed student:', parsed[2]);
if (parsed.length === 3 && parsed[2].full_name === 'Kumar, Rohan') {
  console.log('✓ CSV Parser passed with commas in quotes handling!');
} else {
  console.error('✗ CSV Parser test failed');
}

// 2. Test Document Sanitizer
const COLLECTION_SCHEMAS = {
  profiles: ['user_id','full_name','display_name','admission_number','employee_id','roll_number','class','section','category','parent_phone','phone','parent_name','father_name','address','blood_group','email','parent_email','avatar_url','photo_url','metadata','role','updated_at','created_at'],
};

function sanitizeDocumentForAppwrite(table, rawItem) {
  const item = { ...rawItem };
  if (!item.id && item.$id) item.id = item.$id;
  if (!item.created_at && item.$createdAt) item.created_at = item.$createdAt;
  if (!item.updated_at && item.$updatedAt) item.updated_at = item.$updatedAt;

  if (table === 'profiles') {
    if (!item.admission_number && item.employee_id) item.admission_number = item.employee_id;
    if (!item.employee_id && item.admission_number) item.employee_id = item.admission_number;
    if (!item.full_name && item.name) item.full_name = item.name;
    if (!item.display_name && item.full_name) item.display_name = item.full_name;
    if (!item.category && (item.class || item.section)) {
      item.category = [item.class, item.section].filter(Boolean).join('-');
    }
    if (!item.role) item.role = 'student';
  }

  const rawId = item.admission_number || item.user_id || item.id || 'random_id';
  const docId = String(rawId).slice(0, 36).replace(/[^a-zA-Z0-9._-]/g, '_');

  const allowed = COLLECTION_SCHEMAS[table];
  const payload = {};
  const extraFields = {};

  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith('$') || k === 'id') continue;
    if (v === undefined) continue;
    if (!allowed || allowed.includes(k)) {
      payload[k] = v;
    } else {
      extraFields[k] = v;
    }
  }

  if (Object.keys(extraFields).length > 0 && (!allowed || allowed.includes('metadata'))) {
    let existingMeta = {};
    if (typeof payload.metadata === 'string') {
      try { existingMeta = JSON.parse(payload.metadata); } catch (_) {}
    } else if (typeof payload.metadata === 'object' && payload.metadata !== null) {
      existingMeta = payload.metadata;
    }
    payload.metadata = JSON.stringify({ ...existingMeta, ...extraFields });
  }

  return { docId, payload };
}

const testDoc = {
  $id: 'doc_123',
  $createdAt: '2026-01-01T00:00:00Z',
  admission_number: 'ADM-9999',
  name: 'Test Student',
  class: '10',
  section: 'C',
  unknown_column_abc: 12345,
  legacy_flag: true
};

const sanitized = sanitizeDocumentForAppwrite('profiles', testDoc);
console.log('✓ Sanitized docId:', sanitized.docId);
console.log('✓ Sanitized payload keys:', Object.keys(sanitized.payload));
console.log('✓ Extra attributes stored in metadata:', sanitized.payload.metadata);

if (sanitized.docId === 'ADM-9999' && !('unknown_column_abc' in sanitized.payload) && sanitized.payload.full_name === 'Test Student' && sanitized.payload.category === '10-C') {
  console.log('✓ Document Sanitizer passed all tests!');
} else {
  console.error('✗ Document Sanitizer test failed');
}
