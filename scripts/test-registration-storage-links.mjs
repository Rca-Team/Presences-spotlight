import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';
let source = fs.readFileSync('src/utils/studentPhotoResolver.ts', 'utf8');
source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '').replace(/import\.meta\.env/g, '({})');
source = `const storageFileId = globalThis.testStorageId; const getAppwriteStorageViewUrl = (bucket,id) => 'https://sgp.cloud.appwrite.io/v1/storage/buckets/'+bucket+'/files/'+id+'/view?project=6abfd34f000604fcf074'; const getAppwriteStoragePreviewUrl = getAppwriteStorageViewUrl; const APPWRITE_CONFIG = {};\n` + source;
globalThis.testStorageId = path => /^[a-zA-Z0-9._-]{1,36}$/.test(path) ? path : createHash('md5').update(path).digest('hex');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { resolveStudentPhotoUrl } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
for (const path of ['student1.jpg', 'class 11/student/photo.jpg']) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = await resolveStudentPhotoUrl(`https://cvdcbcsonlianbfeessy.supabase.co/storage/v1/object/public/student-registration-faces/${encoded}`);
  assert.ok(url.includes(`/student-registration-faces/files/${globalThis.testStorageId(path)}/view`));
}
assert.equal(await resolveStudentPhotoUrl('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
console.log('PASS: legacy registration links resolve to Appwrite, encoded folders preserve deterministic IDs, inline photos preserved.');
