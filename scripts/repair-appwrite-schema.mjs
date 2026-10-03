import fs from 'node:fs';
import ts from 'typescript';
import { Client, Databases, Permission, Role, Query } from 'node-appwrite';

const parsed = ts.createSourceFile('types.ts', fs.readFileSync('src/integrations/supabase/types.ts','utf8'), ts.ScriptTarget.Latest, true);
const database = parsed.statements.find(s => ts.isTypeAliasDeclaration(s) && s.name.text === 'Database');
const member = (type, name) => type.members.find(m => m.name?.getText(parsed) === name)?.type;
const tables = member(member(database.type, 'public'), 'Tables');
const schema = new Map();
for (const table of tables.members) {
  const row = member(table.type, 'Row');
  const fields = new Map();
  for (const field of row.members) {
    const name = field.name.getText(parsed).replace(/["']/g,'');
    if (name === 'id') continue;
    const text = field.type.getText(parsed).replace(/\s+/g,'');
    const type = /^(boolean)(\|null)?$/.test(text) ? 'boolean' : /^(number)(\|null)?$/.test(text) ? 'double' : 'string';
    fields.set(name,{type,size: /Json|\[\]/.test(text) ? 65535 : /url|content|message|description|notes/.test(name) ? 2048 : 256});
  }
  schema.set(table.name.getText(parsed).replace(/["']/g,''),fields);
}
// Types generated from the previous cloud project omit these newer tables.
const legacy = [
  'appwrite/reference/initial-schema.sql',
  'appwrite/reference/attendance-schema.sql',
].map(path => fs.readFileSync(path,'utf8')).join('\n');
for (const match of legacy.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
  const fields = schema.get(match[1]) || new Map();
  for (const line of match[2].split('\n')) {
    const field = line.trim().match(/^(\w+)\s+(DOUBLE PRECISION|[\w.]+(?:\([^)]*\))?)(\[\])?/i);
    if (!field || ['id','unique','constraint','primary','foreign','check'].includes(field[1].toLowerCase()) || fields.has(field[1])) continue;
    const t=field[2].toLowerCase();
    fields.set(field[1],{type:t==='boolean'?'boolean':/^(integer|int|bigint|real|float|double|numeric)/.test(t)?'double':'string',size:/json|vector/.test(t)||field[3]?65535:/url|content|message|description|notes/.test(field[1])?2048:256});
  }
  schema.set(match[1],fields);
}
// The live migration stores weekday numbers; keep its existing numeric representation.
schema.get('timetable')?.set('day_of_week',{type:'double'});
schema.set('realtime_messages',new Map([
  ['channel',{type:'string',size:256}],['event',{type:'string',size:128}],
  ['payload',{type:'string',size:65535}],['sender_id',{type:'string',size:36}],
  ['sent_at',{type:'string',size:64}],['expires_at',{type:'string',size:64}],
]));
const key = process.env.APPWRITE_API_KEY;
if (!key) throw new Error('APPWRITE_API_KEY must be provided through the environment.');
const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').setProject(process.env.APPWRITE_PROJECT_ID || '6abfd34f000604fcf074').setKey(key);
const db = new Databases(client);
const databaseId = 'presences_db';
const apply = process.argv.includes('--apply');
const report={ mode:apply?'apply':'plan', missingCollections:[], missingAttributes:[], mismatches:[], errors:[] };
for (const [name, fields] of schema) {
  let collection;
  try { collection = await db.getCollection(databaseId,name); }
  catch(error) {
    if(error.code!==404) throw error;
    report.missingCollections.push(name);
    if (!apply) continue;
    const permissions = name === 'realtime_messages' ? [] : [Permission.read(Role.label('admin')), Permission.read(Role.label('principal')), Permission.read(Role.label('teacher')), Permission.create(Role.label('admin')), Permission.create(Role.label('principal')), Permission.create(Role.label('teacher'))];
    collection = await db.createCollection(databaseId,name,name,permissions,true);
  }
  for(const [field,spec] of fields) {
    const existing=collection.attributes.find(a=>a.key===field);
    if(existing) {
      if (existing.type!==spec.type && !(spec.type==='double'&&existing.type==='integer')) report.mismatches.push({collection:name,field,expected:spec.type,actual:existing.type});
      continue;
    }
    report.missingAttributes.push({collection:name,field,...spec});
    if(!apply) continue;
    try {
      if(spec.type==='boolean') await db.createBooleanAttribute(databaseId,name,field,false);
      else if(spec.type==='double') await db.createFloatAttribute(databaseId,name,field,false);
      else await db.createStringAttribute(databaseId,name,field,spec.size,false);
    } catch(error) { report.errors.push({collection:name,field,code:error.code,message:error.message}); }
  }
}
fs.writeFileSync('appwrite-schema-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({mode:report.mode,missingCollections:report.missingCollections.length,missingAttributes:report.missingAttributes.length,typeMismatches:report.mismatches.length,errors:report.errors.length}));
