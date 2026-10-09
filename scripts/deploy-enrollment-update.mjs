import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, Functions } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
if (!process.env.APPWRITE_API_KEY) throw new Error('APPWRITE_API_KEY required.');
const functions = new Functions(new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('6abfd34f000604fcf074').setKey(process.env.APPWRITE_API_KEY));
const functionId = 'presences-enrollment';
await functions.get(functionId); // Update an existing function without changing scopes or storage.
const stage = path.resolve('.vercel/enrollment-function-release');
fs.mkdirSync(stage, { recursive: true });
fs.cpSync('appwrite/functions/presences-backend/src', path.join(stage, 'src'), { recursive: true });
const pkg = JSON.parse(fs.readFileSync('appwrite/functions/presences-backend/package.json', 'utf8'));
for (const [name, version] of Object.entries(pkg.dependencies)) if (version.startsWith('file:')) delete pkg.dependencies[name];
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
const archive = path.join(stage, 'release.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, 'package.json', 'src']);
const deployment = await functions.createDeployment({ functionId, code: InputFile.fromPath(archive), activate: true, entrypoint: 'src/enrollment-entry.js', commands: 'npm install --omit=dev --ignore-scripts' });
console.log(JSON.stringify({ functionId, deploymentId: deployment.$id, status: deployment.status }));
for (let count = 0; count < 60; count++) {
  const result = await functions.getDeployment({ functionId, deploymentId: deployment.$id });
  if (result.status === 'ready') { console.log('Enrollment deployment ready.'); process.exit(0); }
  if (result.status === 'failed') { console.log(result.buildLogs); throw new Error('Enrollment deployment failed.'); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error('Deployment still building; check status before publishing frontend.');
