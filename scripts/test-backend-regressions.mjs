import assert from 'node:assert/strict';
import handler, { dispatch } from '../appwrite/functions/presences-backend/src/main.js';
const user={$id:'staff-1',labels:['teacher']};
const admin={$id:'admin-1',labels:['admin']};
let stored=null;
const db={
 async getDocument(){return {is_active:true};},
 async updateDocument(_db,_table,id,data){if(!stored) throw Object.assign(new Error('Missing'),{code:404}); stored={$id:id,...data};return stored;},
 async createDocument(_db,_table,id,data){stored={$id:id,...data};return stored;}
};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
await test('Unauthenticated backend requests are rejected',async()=>{
 const result=await handler({req:{headers:{}},res:{json:(data,status)=>({data,status})},error:()=>{}});
 assert.equal(result.status,401);
});
await test('Students cannot write attendance events',async()=>{
 await assert.rejects(()=>dispatch({action:'upsert_class_attendance_event'},{$id:'student',labels:[]},db,{}),e=>e.status===403);
});
await test('Invalid attendance status is rejected',async()=>{
 await assert.rejects(()=>dispatch({action:'upsert_class_attendance_event',p_session_id:'s',p_student_id:'st',p_status:'unknown'},user,db,{}),e=>e.status===400);
});
await test('Attendance events reuse a deterministic record and preserve data',async()=>{
 const input={action:'upsert_class_attendance_event',p_session_id:'session',p_student_id:'student',p_status:'present',p_metadata:{mode:'scanner'}};
 const first=await dispatch(input,user,db,{});
 const second=await dispatch({...input,p_status:'late'},user,db,{});
 assert.equal(first.id,second.id);assert.equal(second.recorded_by,user.$id);assert.equal(second.status,'late');assert.equal(JSON.parse(second.metadata).mode,'scanner');
});
await test('Teacher cannot issue fleet commands or enumerate accounts',async()=>{
 await assert.rejects(()=>dispatch({action:'realtime.send',type:'broadcast',channel:'broadcast:fleet-commands',event:'lock_kiosk'},user,db,{}),e=>e.status===403);
 await assert.rejects(()=>dispatch({action:'get_all_auth_users'},user,db,{}),e=>e.status===403);
});
await test('Oversized camera payloads are rejected',async()=>{
 await assert.rejects(()=>dispatch({action:'realtime.send',type:'broadcast',channel:'broadcast:remote-camera-relay',event:'frame',payload:'x'.repeat(65536)},user,db,{}),e=>e.status===413);
});
await test('Admin account listing returns compatible IDs',async()=>{
 const result=await dispatch({action:'get_all_auth_users'},admin,db,{async list(){return {total:1,users:[{$id:'a',email:'test@example.com',labels:[]}]};}});
 assert.equal(result[0].id,'a');
});
await test('Unimplemented backend actions return errors',async()=>{
 await assert.rejects(()=>dispatch({action:'send-sms'},admin,db,{}),e=>e.status===404);
});
console.log(passed+' backend regression tests passed');
