const fs = require('fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Query, ID, OAuthProvider, Permission, Role, Channel } = require('appwrite');
function compile(file, injected) {
 const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
 const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
 const exports = {};
 new Function('exports', ...Object.keys(injected), code)(exports, ...Object.values(injected));
 return exports;
}
const { storageFileId } = compile('src/integrations/appwrite/storage-id.ts', {});
let calls = [];
let records = [{ $id: 'target', user_id: 'u1', metadata: '{"active":true}' }];
let failure = null;
const databases = {
 async listDocuments(db, collection, queries) {
  calls.push(['list', queries.map(JSON.parse)]);
  if (failure) throw failure;
  let docs = records;
  for (const q of queries.map(JSON.parse)) if (q.method === 'equal') docs = docs.filter(d => q.values.includes(d[q.attribute]));
  const total = docs.length;
  const parsed = queries.map(JSON.parse);
  const offset = parsed.find(q => q.method === 'offset')?.values[0] || 0;
  const limit = parsed.find(q => q.method === 'limit')?.values[0] ?? total;
  return { documents: docs.slice(offset, offset + limit), total };
 },
 async updateDocument(db, c, id, data) { calls.push(['update', id, data]); if (failure) throw failure; return {$id:id,...data}; },
 async createDocument(db, c, id, data) { calls.push(['create', id, data]); if (failure) throw failure; return {$id:id,...data}; },
 async deleteDocument(db, c, id) { calls.push(['delete',id]); if (failure) throw failure; }
};
const unauthorized = Object.assign(new Error('Invalid credentials'), { code: 401 });
let accountCalls=0;
const account = { async get() {accountCalls++; throw unauthorized;}, async createEmailPasswordSession() {throw unauthorized;} };
const storage = { async createFile() {throw new Error('Upload rejected');} };
const functions = {async createExecution() {return {status:'failed',responseStatusCode:500,responseBody:'No active deployment'};} };
const {AppwriteQueryBuilder, appwriteUnifiedClient} = compile('src/integrations/appwrite/adapter.ts', {
 Query, ID, OAuthProvider, Permission, Role, Channel, storageFileId, databases, account, storage, functions,
 realtime:{ async subscribe(){ return {async unsubscribe(){}};} },
 appwriteClient:{subscribe(){return ()=>{};}}, APPWRITE_CONFIG:{databaseId:'db',buckets:{}},
 getAppwriteStorageViewUrl:(b,id)=>b+'/'+id, getAppwriteStorageDownloadUrl:(b,id)=>b+'/'+id
});
(async () => {
 let passed = 0;
 async function test(name, fn) {await fn(); passed++; console.log('PASS', name);}
 await test('Update applies filters added after update()', async () => {
  calls=[]; records=[{$id:'target',user_id:'u1'},{$id:'other',user_id:'u2'}];
  const r = await new AppwriteQueryBuilder('profiles').update({name:'Changed'}).eq('user_id','u1').select().single();
  assert.equal(r.error,null); assert.equal(r.data.id,'target');
  assert.deepEqual(calls.filter(c=>c[0]==='update').map(c=>c[1]),['target']);
 });
 await test('Delete applies filters added after delete()',async()=>{
  calls=[]; await new AppwriteQueryBuilder('profiles').delete().eq('user_id','u2');
  assert.deepEqual(calls.filter(c=>c[0]==='delete').map(c=>c[1]),['other']);
 });
 await test('Backend failures remain errors without unfiltered retries',async()=>{
  calls=[]; failure = new Error('Missing index');
  const r=await new AppwriteQueryBuilder('profiles').select().eq('user_id','u1');
  assert.equal(r.error,failure); assert.equal(r.data,null); assert.equal(calls.length,1); failure=null;
 });
 await test('Rejected writes never report success',async()=>{
  failure=new Error('Permission denied');
  assert.equal((await new AppwriteQueryBuilder('profiles').insert({name:'test'})).error,failure); failure=null;
 });
 await test('Empty in() cannot read or mutate every record',async()=>{
  calls=[]; const r=await new AppwriteQueryBuilder('profiles').delete().in('id',[]);
  assert.deepEqual(r.data,[]); assert.equal(calls.length,0);
 });
 await test('Count-only queries fetch at most one record',async()=>{
  calls=[];
  const r=await new AppwriteQueryBuilder('profiles').select('id',{count:'exact',head:true});
  assert.equal(r.data,null); assert.equal(r.count,records.length);
  assert.equal(calls.length,1); assert.equal(calls[0][1].find(q=>q.method==='limit').values[0],1);
 });
 await test('JSON payloads round trip',async()=>{
  calls=[]; const r=await new AppwriteQueryBuilder('profiles').insert({metadata:{active:true}}).single();
  assert.equal(calls[0][2].metadata,'{"active":true}'); assert.deepEqual(r.data.metadata,{active:true});
 });
 await test('Single detects ambiguous results',async()=>{
  assert.equal((await new AppwriteQueryBuilder('profiles').select().single()).error.code,'PGRST116');
 });
 await test('Single reads avoid scanning the entire collection',async()=>{
  const saved = records;
  records = Array.from({length:250}, (_,i)=>({$id:String(i)})); calls=[];
  const r = await new AppwriteQueryBuilder('profiles').select().maybeSingle();
  assert.equal(r.error.code,'PGRST116'); assert.equal(calls.length,1);
  assert.equal(calls[0][1].find(q=>q.method==='limit').values[0],2);
  records = saved;
 });
 await test('Invalid login cannot create an administrator session',async()=>{
  const r=await appwriteUnifiedClient.auth.signInWithPassword({email:'test@example.com',password:'invalid-password'});
  assert.ok(r.error); assert.equal(r.data,null);
  assert.equal((await appwriteUnifiedClient.auth.getSession()).data.session,null);
  const admin = await appwriteUnifiedClient.auth.signInWithPassword({email:'atl@gmail.com',password:'invalid-password'});
  assert.ok(admin.error); assert.equal(admin.data,null);
 });
 await test('Function failures remain errors',async()=>{
  const r=await appwriteUnifiedClient.functions.invoke('test'); assert.equal(r.error.code,500); assert.equal(r.data,null);
 });
 await test('Simultaneous auth checks share one request',async()=>{
  accountCalls=0;
  await Promise.all([appwriteUnifiedClient.auth.getSession(),appwriteUnifiedClient.auth.getUser(),appwriteUnifiedClient.auth.getSession()]);
  assert.equal(accountCalls,1);
 });
 await test('Removed realtime channels are released',async()=>{
  const channel=appwriteUnifiedClient.channel('test-channel').on('postgres_changes',{table:'profiles'},()=>{}).subscribe();
  appwriteUnifiedClient.removeChannel(channel);
  assert.equal(appwriteUnifiedClient.getChannels().length,0);
 });
 await test('Storage IDs match migrated files including nested and Unicode paths',async()=>{
  for (const path of ['folder/student.png','a'.repeat(80),'छात्र/photo.jpg','/nested/file.jpg']) {
   const normalized=path.replace(/^\/+/, '').trim();
   assert.equal(storageFileId(path),crypto.createHash('md5').update(normalized).digest('hex'));
  }
  assert.equal(storageFileId('photo.jpg'),'photo.jpg');
 });
 console.log(passed+' regression tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
