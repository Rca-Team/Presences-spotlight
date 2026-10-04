import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6abfd34f000604fcf074');

const db = new Databases(client);

async function getAll(collection) {
  let docs = [];
  let offset = 0;
  while (true) {
    const res = await db.listDocuments('presences_db', collection, [Query.limit(100), Query.offset(offset)]);
    docs.push(...res.documents);
    if (docs.length >= res.total || res.documents.length === 0) break;
    offset += res.documents.length;
  }
  return docs;
}

async function run() {
  console.log('Loading profiles and face descriptors from Appwrite...');
  const profiles = await getAll('profiles');
  const descriptors = await getAll('face_descriptors');

  console.log(`Found ${profiles.length} profiles and ${descriptors.length} descriptors.`);

  let restored = 0;
  for (const p of profiles) {
    const name = (p.full_name || p.display_name || '').toLowerCase().trim();
    const adm = (p.admission_number || p.employee_id || '').toLowerCase().trim();
    const uid = (p.user_id || '').toLowerCase().trim();

    // Find the student's authentic descriptor photo
    const match = descriptors.find((fd) => {
      const fdAdm = String(fd.student_id || '').toLowerCase().trim();
      const fdUid = String(fd.user_id || '').toLowerCase().trim();
      const fdName = String(fd.label || '').toLowerCase().trim();

      return (
        (adm && fdAdm === adm) ||
        (uid && fdUid === uid) ||
        (name && fdName === name && name !== 'student' && name !== 'unknown')
      );
    });

    if (match && match.image_url) {
      await db.updateDocument('presences_db', 'profiles', p.$id, {
        avatar_url: match.image_url,
      });
      restored++;
      console.log(`✓ Restored: ${p.full_name || p.display_name} (${p.admission_number || p.employee_id})`);
    } else {
      console.warn(`⚠️ No descriptor found for: ${p.full_name || p.display_name} (${p.admission_number || p.employee_id})`);
    }
  }

  console.log(`\n🎉 DONE: Successfully restored ${restored} of ${profiles.length} student cover photos!`);
}

run().catch(console.error);
