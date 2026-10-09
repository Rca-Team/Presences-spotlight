import fs from 'node:fs';
import { Client, Databases, Query } from 'node-appwrite';
const db = new Databases(new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('6abfd34f000604fcf074').setKey(process.env.APPWRITE_API_KEY));
const response = await fetch('https://cvdcbcsonlianbfeessy.supabase.co/rest/v1/attendance_records?status=eq.registered&select=id,device_info&limit=1000', { headers: { apikey: process.env.SUPABASE_STORAGE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_STORAGE_KEY } });
if (!response.ok) throw new Error('Source metadata HTTP ' + response.status);
const source = new Map((await response.json()).map(row => [row.id, row]));
const rows = []; let cursor;
while (true) {
  const page = await db.listDocuments('presences_db', 'attendance_records', [Query.equal('status', 'registered'), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
  rows.push(...page.documents);
  if (page.documents.length < 100) break;
  cursor = page.documents.at(-1).$id;
}
const broken = rows.filter(row => { try { if (typeof row.device_info === 'string') JSON.parse(row.device_info); return false; } catch { return true; } });
const repairs = broken.map(row => {
  const original = source.get(row.$id)?.device_info;
  if (!original || typeof original !== 'object') throw new Error('Missing authoritative metadata for a broken registration.');
  const text = JSON.stringify(original);
  if (text.length > 60000) throw new Error('Registration metadata exceeds the proposed field size.');
  return { id: row.$id, original: row.device_info, repaired: text };
});
console.log(JSON.stringify({ inspected: rows.length, repairable: repairs.length }));
if (!process.argv.includes('--apply')) process.exit(0);
const attribute = await db.getAttribute('presences_db', 'attendance_records', 'device_info');
if (attribute.size < 60000) await db.updateStringAttribute({ databaseId: 'presences_db', collectionId: 'attendance_records', key: 'device_info', required: attribute.required, xdefault: attribute.default ?? null, size: 60000 });
fs.writeFileSync('.vercel/registration-metadata-backup.json', JSON.stringify(repairs, null, 2));
let saved = 0;
for (const repair of repairs) {
  await db.updateDocument('presences_db', 'attendance_records', repair.id, { device_info: repair.repaired });
  const checked = await db.getDocument('presences_db', 'attendance_records', repair.id);
  JSON.parse(checked.device_info);
  if (checked.device_info !== repair.repaired) throw new Error('Metadata verification mismatch.');
  saved++;
}
console.log(JSON.stringify({ repaired: saved, verified: saved, fieldSize: (await db.getAttribute('presences_db', 'attendance_records', 'device_info')).size }));
