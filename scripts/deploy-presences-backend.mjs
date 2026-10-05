import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, Functions, Runtime, ProjectKeyScopes, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

if (!process.argv.includes('--apply')) {
  console.log('Deployment plan: presences-backend, node-22, signed-in execution only, documents.read/write + users.read scopes. Use --apply only after approval.');
  process.exit(0);
}
const key=process.env.APPWRITE_API_KEY;
if (!key) throw new Error('APPWRITE_API_KEY must be provided through the environment.');
const client=new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('6abfd34f000604fcf074').setKey(key);
const functions=new Functions(client);
const functionId='presences-backend';
try {
  const existing = await functions.get(functionId);
  await functions.update({ functionId, name: existing.name, runtime: existing.runtime, execute: existing.execute, events: existing.events, schedule: existing.schedule, timeout: Math.max(existing.timeout || 30, 90), enabled: existing.enabled, logging: existing.logging, entrypoint: 'src/main.js', commands: existing.commands || 'npm install --omit=dev --ignore-scripts', scopes: existing.scopes });
} catch(error) {
  if(error.code!==404) throw error;
  await functions.create({functionId,name:'Presences Backend',runtime:Runtime.Node22,execute:[Role.users()],timeout:90,entrypoint:'src/main.js',commands:'npm install --omit=dev --ignore-scripts',scopes:[ProjectKeyScopes.DocumentsRead,ProjectKeyScopes.DocumentsWrite,ProjectKeyScopes.UsersRead]});
}
const archive=path.resolve('appwrite/functions/presences-backend.tar.gz');
execFileSync('tar',['-czf',archive,'-C','appwrite/functions/presences-backend','package.json','src']);
const deployment=await functions.createDeployment({functionId,code:InputFile.fromPath(archive,'presences-backend.tar.gz'),activate:true,entrypoint:'src/main.js',commands:'npm install --omit=dev --ignore-scripts'});
console.log(JSON.stringify({functionId,deploymentId:deployment.$id,status:deployment.status}));
