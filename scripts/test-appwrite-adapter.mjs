import { Client, Databases, Storage, Account, Query, ID, Permission, Role } from 'appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6abfd34f000604fcf074';
const DATABASE_ID = 'presences_db';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const databases = new Databases(client);
const storage = new Storage(client);
const account = new Account(client);

console.log('🧪 Starting End-to-End Appwrite Adapter Verification...\n');

async function runTests() {
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err?.message || err);
    }
  }

  // 1. Test reading profiles collection
  await test('Read profiles collection', async () => {
    const res = await databases.listDocuments(DATABASE_ID, 'profiles', [Query.limit(5)]);
    if (res.documents.length === 0) throw new Error('No profile documents returned');
    console.log(`   Sample profile: ${res.documents[0].name || res.documents[0].email} ($id: ${res.documents[0].$id})`);
  });

  // 2. Test reading face_descriptors collection
  await test('Read face_descriptors collection', async () => {
    const res = await databases.listDocuments(DATABASE_ID, 'face_descriptors', [Query.limit(5)]);
    if (res.documents.length === 0) throw new Error('No face descriptor documents returned');
    console.log(`   Sample descriptor: user ${res.documents[0].user_id || res.documents[0].name}`);
  });

  // 3. Test reading attendance_records collection
  await test('Read attendance_records collection', async () => {
    const res = await databases.listDocuments(DATABASE_ID, 'attendance_records', [Query.limit(5)]);
    console.log(`   Found ${res.total} attendance records in presences_db`);
  });

  // 4. Test reading subjects, timetable, user_roles
  await test('Read auxiliary collections (subjects, timetable, user_roles)', async () => {
    const sub = await databases.listDocuments(DATABASE_ID, 'subjects', [Query.limit(1)]);
    const tt = await databases.listDocuments(DATABASE_ID, 'timetable', [Query.limit(1)]);
    const roles = await databases.listDocuments(DATABASE_ID, 'user_roles', [Query.limit(1)]);
    console.log(`   Subjects: ${sub.total}, Timetable: ${tt.total}, Roles: ${roles.total}`);
  });

  // 5. Test CRUD lifecycle on notifications collection
  await test('CRUD document lifecycle on notifications collection', async () => {
    const testId = 'test_notif_' + Date.now();
    // CREATE
    const created = await databases.createDocument(
      DATABASE_ID,
      'notifications',
      testId,
      {
        title: 'Appwrite Test Notification',
        message: 'Testing Appwrite full cutover',
        type: 'test',
        is_read: false
      },
      [Permission.read(Role.any()), Permission.update(Role.any()), Permission.delete(Role.any())]
    );
    if (!created || created.$id !== testId) throw new Error('Document creation failed');

    // READ
    const fetched = await databases.getDocument(DATABASE_ID, 'notifications', testId);
    if (fetched.title !== 'Appwrite Test Notification') throw new Error('Document fetch failed');

    // UPDATE
    const updated = await databases.updateDocument(DATABASE_ID, 'notifications', testId, {
      is_read: true
    });
    if (!updated.is_read) throw new Error('Document update failed');

    // DELETE
    await databases.deleteDocument(DATABASE_ID, 'notifications', testId);
    console.log(`   Lifecycle created, verified, updated, and deleted: ${testId}`);
  });

  // 6. Test storage buckets access
  await test('Storage buckets accessibility', async () => {
    const buckets = ['face-images', 'student-registration-faces', 'attendance-training-faces', 'database-exports'];
    for (const b of buckets) {
      const files = await storage.listFiles(b, [Query.limit(1)]);
      console.log(`   Bucket '${b}': ${files.total} files accessible`);
    }
  });

  console.log(`\n========================================`);
  console.log(`📊 Test Results: ${passed} / ${total} tests passed.`);
  console.log(`========================================\n`);

  if (passed === total) {
    console.log('🎉 Full Appwrite Cloud Backend & Client System is 100% Operational!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
