import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Client, Storage, Query, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
const bucketId = 'student-registration-faces';
const sourceUrl = 'https://cvdcbcsonlianbfeessy.supabase.co';
const endpoint = 'https://sgp.cloud.appwrite.io/v1', project = '6abfd34f000604fcf074';
if (!process.env.SUPABASE_STORAGE_KEY || !process.env.APPWRITE_API_KEY) throw new Error('Provide storage credentials through environment variables.');
const storage = new Storage(new Client().setEndpoint(endpoint).setProject(project).setKey(process.env.APPWRITE_API_KEY));
const sourceHeaders = { apikey: process.env.SUPABASE_STORAGE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_STORAGE_KEY };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileId = path => /^[a-zA-Z0-9._-]{1,36}$/.test(path) ? path : createHash('md5').update(path.replace(/^\/+/, '').trim()).digest('hex');
async function request(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) throw new Error(`Storage HTTP ${response.status}`);
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error('Storage request exhausted retries.');
}
const files = [];
async function crawl(prefix = '') {
  for (let offset = 0; ; offset += 100) {
    const response = await request(`${sourceUrl}/storage/v1/object/list/${bucketId}`, { method: 'POST', headers: { ...sourceHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, offset, limit: 100, sortBy: { column: 'name', order: 'asc' } }) });
    const rows = await response.json();
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id === null) await crawl(path);
      else files.push({ path, size: Number(row.metadata?.size || 0) });
    }
    if (rows.length < 100) break;
  }
}
await crawl();
const source = await (await request(`${sourceUrl}/storage/v1/bucket/${bucketId}`, { headers: sourceHeaders })).json();
const bucket = await storage.getBucket(bucketId);
console.log(JSON.stringify({ sourceFiles: files.length, sourceBytes: files.reduce((sum, file) => sum + file.size, 0), public: source.public, destinationFiles: (await storage.listFiles(bucketId, [Query.limit(1)])).total }));
if (!process.argv.includes('--apply')) process.exit(0);
// Match the source's public reading. Writes require sign-in; updates/deletes are administrative.
const permissions = [Permission.read(source.public ? Role.any() : Role.users()), Permission.create(Role.users()), ...['admin', 'principal', 'superadmin'].flatMap(label => [Permission.update(Role.label(label)), Permission.delete(Role.label(label))])];
await storage.updateBucket({ bucketId, name: bucket.name, permissions, fileSecurity: false, enabled: true, maximumFileSize: Math.max(bucket.maximumFileSize, ...files.map(file => file.size)), allowedFileExtensions: bucket.allowedFileExtensions, compression: bucket.compression, encryption: true, antivirus: true });
const report = { total: files.length, uploaded: 0, matched: 0, verified: 0, failures: [], mappings: [] };
const replacing = process.argv.includes('--replace');
const backup = `.vercel/registration-storage-backup-${Date.now()}`;
const backups = [];
async function destinationBytes(id) {
  const response = await request(`${endpoint}/storage/buckets/${bucketId}/files/${id}/download?project=${project}`, { headers: { 'x-appwrite-project': project, 'x-appwrite-key': process.env.APPWRITE_API_KEY } });
  return Buffer.from(await response.arrayBuffer());
}
async function preserve(id) {
  fs.mkdirSync(backup, { recursive: true });
  const metadata = await storage.getFile(bucketId, id);
  const bytes = await destinationBytes(id);
  fs.writeFileSync(`${backup}/${id}.bin`, bytes);
  fs.writeFileSync(`${backup}/${id}.json`, JSON.stringify(metadata, null, 2));
  backups.push({ id, sha256: hash(bytes), metadata: `${backup}/${id}.json` });
  fs.writeFileSync(`${backup}/manifest.json`, JSON.stringify(backups, null, 2));
}
let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++], id = fileId(file.path);
    try {
      const bytes = Buffer.from(await (await request(`${sourceUrl}/storage/v1/object/${bucketId}/${file.path.split('/').map(encodeURIComponent).join('/')}`, { headers: sourceHeaders })).arrayBuffer());
      let existing = false;
      try { await storage.getFile(bucketId, id); existing = true; } catch (error) { if (error.code !== 404) throw error; }
      if (!existing) {
        await storage.createFile({ bucketId, fileId: id, file: InputFile.fromBuffer(bytes, file.path.split('/').at(-1)), permissions: [Permission.read(source.public ? Role.any() : Role.users())] });
        report.uploaded++;
      }
      let copied = await destinationBytes(id);
      if (existing && hash(copied) !== hash(bytes) && replacing) {
        await preserve(id);
        await storage.deleteFile(bucketId, id);
        try {
          await storage.createFile({ bucketId, fileId: id, file: InputFile.fromBuffer(bytes, file.path.split('/').at(-1)), permissions: [Permission.read(source.public ? Role.any() : Role.users())] });
        } catch (error) {
          await storage.createFile({ bucketId, fileId: id, file: InputFile.fromBuffer(fs.readFileSync(`${backup}/${id}.bin`), 'restored.jpg'), permissions: [Permission.read(source.public ? Role.any() : Role.users())] });
          throw error;
        }
        report.uploaded++;
        copied = await destinationBytes(id);
      }
      if (hash(copied) !== hash(bytes)) throw new Error('Existing destination content differs; preserved without overwrite.');
      if (existing) report.matched++;
      // Verify the exact URL the website uses, without privileged API credentials.
      if (source.public) {
        const publicBytes = Buffer.from(await (await request(`${endpoint}/storage/buckets/${bucketId}/files/${id}/view?project=${project}`)).arrayBuffer());
        if (hash(publicBytes) !== hash(bytes)) throw new Error('Website view content mismatch.');
      }
      report.verified++;
      report.mappings.push({ path: file.path, id, sha256: hash(bytes) });
    } catch (error) { report.failures.push({ path: file.path, error: error.message }); }
    if ((report.verified + report.failures.length) % 25 === 0) console.log(JSON.stringify({ verified: report.verified, uploaded: report.uploaded, failed: report.failures.length, total: files.length }));
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
if (replacing && files.length && !report.failures.length) {
  const expected = new Set(files.map(file => fileId(file.path)));
  const extras = []; let cursor;
  while (true) {
    const page = await storage.listFiles(bucketId, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    extras.push(...page.files.filter(file => !expected.has(file.$id)));
    if (page.files.length < 100) break;
    cursor = page.files.at(-1).$id;
  }
  for (const file of extras) {
    await preserve(file.$id);
    await storage.deleteFile(bucketId, file.$id);
  }
  report.removedExtras = extras.length;
  report.destinationTotal = (await storage.listFiles(bucketId, [Query.limit(1)])).total;
  if (report.destinationTotal !== files.length) report.failures.push({ error: 'Final bucket count differs from source.' });
  report.backup = backup;
}
fs.mkdirSync('.vercel', { recursive: true });
fs.writeFileSync('.vercel/registration-storage-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, uploaded: report.uploaded, matched: report.matched, verified: report.verified, failures: report.failures.length, report: '.vercel/registration-storage-report.json' }));
if (report.failures.length) process.exitCode = 1;
