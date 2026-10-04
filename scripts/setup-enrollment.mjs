import { Client, Databases, Storage, Functions, Permission, Role, Runtime, ProjectKeyScopes } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const apply = process.argv.includes('--apply');
if (!apply) {
  console.log('Plan: create private student_enrollment state and enrollment-private JPEG storage; deploy public presences-enrollment with action-level authorization. No existing collection permissions change. Production requires the separate access audit and SMS setup in appwrite/ENROLLMENT.md.');
  process.exit(0);
}
if (!process.env.APPWRITE_API_KEY) throw new Error('Provide APPWRITE_API_KEY through the environment.');
const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').setProject(process.env.APPWRITE_PROJECT_ID || '6abfd34f000604fcf074').setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client), storage = new Storage(client), functions = new Functions(client);
const databaseId = process.env.APPWRITE_DATABASE_ID || 'presences_db';
try { await db.getCollection(databaseId, 'student_enrollment'); }
catch (e) {
  if (e.code !== 404) throw e;
  await db.createCollection(databaseId, 'student_enrollment', 'Student enrollment (server only)', [], true);
  await db.createStringAttribute(databaseId, 'student_enrollment', 'kind', 24, true);
  await db.createFloatAttribute(databaseId, 'student_enrollment', 'expires', true);
  await db.createStringAttribute(databaseId, 'student_enrollment', 'payload', 60000, true);
}
for (let attempt = 0; attempt < 30; attempt++) {
  const collection = await db.getCollection(databaseId, 'student_enrollment');
  if (collection.attributes.length === 3 && collection.attributes.every(a => a.status === 'available')) break;
  if (attempt === 29) throw new Error('Enrollment attributes are not ready. Rerun after checking Appwrite.');
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const collection = await db.getCollection(databaseId, 'student_enrollment');
if (collection.$permissions.length) throw new Error('Enrollment state must have no collection permissions.');
for (const field of ['kind', 'expires']) {
  if (!collection.indexes.some(i => i.key === field)) await db.createIndex(databaseId, 'student_enrollment', field, 'key', [field]);
}
try { await storage.getBucket('student-registration-faces'); }
catch (e) {
  if (e.code !== 404) throw e;
  await storage.createBucket({ bucketId: 'student-registration-faces', name: 'Student Registration Faces', permissions: [Permission.read(Role.any()), Permission.update(Role.any()), Permission.delete(Role.any())], fileSecurity: false, maximumFileSize: 100 * 1024 * 1024, allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp'], encryption: true, antivirus: true });
}
const scopes = [ProjectKeyScopes.DocumentsRead, ProjectKeyScopes.DocumentsWrite, ProjectKeyScopes.FilesRead, ProjectKeyScopes.FilesWrite, ProjectKeyScopes.UsersWrite];
try { await functions.get('presences-enrollment'); }
catch (e) {
  if (e.code !== 404) throw e;
  await functions.create({ functionId: 'presences-enrollment', name: 'Student enrollment', runtime: Runtime.Node22, execute: [Role.any()], timeout: 60, entrypoint: 'src/enrollment-entry.js', commands: 'npm install --omit=dev --ignore-scripts', scopes });
}
const archive = path.resolve('appwrite/functions/presences-enrollment.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', 'appwrite/functions/presences-backend', 'package.json', 'src']);
const deployment = await functions.createDeployment({ functionId: 'presences-enrollment', code: InputFile.fromPath(archive), activate: true, entrypoint: 'src/enrollment-entry.js', commands: 'npm install --omit=dev --ignore-scripts' });
console.log(JSON.stringify({ deployment: deployment.$id, status: deployment.status, sms: 'Disabled until ENROLLMENT_SMS_ENABLED=true is configured after provider setup.' }));
