import { Client, Account, Databases, Users, Query, Permission, Role } from 'node-appwrite';
import { createHash } from 'node:crypto';

const dbId = process.env.APPWRITE_DATABASE_ID || 'presences_db';
const statuses = new Set(['detected','verified','corrected','present','late','absent','excused','unauthorized']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0,36);
const normalize = doc => ({ ...doc, id: doc.$id });

export async function dispatch(body, user, db, users) {
  const labels = user.labels || [];
  const admin = labels.includes('admin') || labels.includes('principal') || labels.includes('superadmin');
  const staff = admin || labels.includes('teacher') || labels.includes('guard') || labels.includes('security');
  const action = body.action;
  if (action === 'upsert_class_attendance_event') {
    if (!staff) fail(403, 'Staff access required');
    if (!body.p_session_id || !body.p_student_id || !statuses.has(body.p_status)) fail(400, 'Invalid attendance event');
    const session = await db.getDocument(dbId, 'class_sessions', body.p_session_id);
    if (!session.is_active) fail(409, 'Class session is closed');
    const id = idFor(body.p_session_id + ':' + body.p_student_id);
    const payload = {
      session_id: body.p_session_id, student_id: body.p_student_id, status: body.p_status,
      source: body.p_source || 'scanner', confidence_score: body.p_confidence_score ?? null,
      idempotency_key: body.p_idempotency_key || body.p_session_id + ':' + body.p_student_id,
      metadata: JSON.stringify(body.p_metadata || {}), recorded_by: user.$id,
      recognized_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    let document;
    try { document = await db.updateDocument(dbId, 'attendance_session_events', id, payload); }
    catch(error) {
      if (error.code !== 404) throw error;
      try { document = await db.createDocument(dbId, 'attendance_session_events', id, { ...payload, created_at: payload.updated_at }); }
      catch(error) {
        if(error.code!==409) throw error;
        document = await db.updateDocument(dbId, 'attendance_session_events', id, payload);
      }
    }
    return normalize(document);
  }
  if (action === 'get_all_auth_users') {
    if (!admin) fail(403,'Administrator access required');
    const result=[];
    for(let offset=0;;offset+=100) {
      const page=await users.list([Query.limit(100),Query.offset(offset)]);
      result.push(...page.users.map(u=>({ id:u.$id,email:u.email,created_at:u.$createdAt,last_sign_in_at:u.accessedAt,user_metadata:{name:u.name},email_confirmed_at:u.emailVerification?u.$updatedAt:null })));
      if(result.length>=page.total || !page.users.length) break;
    }
    return result;
  }
  if (action === 'realtime.send') {
    if (body.type !== 'broadcast' || typeof body.channel !== 'string' || typeof body.event !== 'string') fail(400,'Invalid realtime message');
    const adminChannels=new Set(['broadcast:fleet-commands','presences_app_updates_broadcast']);
    if(adminChannels.has(body.channel) && !admin) fail(403,'Administrator access required');
    if (!staff) fail(403,'Staff access required');
    const payload=JSON.stringify(body.payload || {});
    if(Buffer.byteLength(payload,'utf8')>65535) fail(413,'Realtime payload is too large');
    const permissions=[Permission.read(Role.user(user.$id)), Permission.read(Role.label('admin')), Permission.read(Role.label('principal'))];
    if(adminChannels.has(body.channel)) permissions.push(Permission.read(Role.users()));
    if(body.channel==='broadcast:remote-camera-relay') permissions.push(Permission.read(Role.label('teacher')));
    // Replace the latest message for a sender/event instead of retaining every camera frame.
    const id=idFor(user.$id+':'+body.channel+':'+body.event);
    const data={channel:body.channel,event:body.event,payload,sender_id:user.$id,sent_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
    try { await db.updateDocument(dbId,'realtime_messages',id,data,permissions); }
    catch(error) { if(error.code!==404) throw error; await db.createDocument(dbId,'realtime_messages',id,data,permissions); }
    return {success:true};
  if (action === 'trigger_auto_backup') {
    if (!admin) fail(403, 'Administrator access required');
    const collections = ['profiles', 'face_descriptors', 'attendance_records', 'timetable', 'user_roles', 'emergency_events', 'notifications', 'subjects', 'attendance_settings'];
    const backupData = { version: '2.0.0', system: 'Presences Appwrite Auto-Backup', createdAt: new Date().toISOString(), collections: {}, summary: { totalDocs: 0 } };
    
    for (const col of collections) {
      try {
        const page = await db.listDocuments(dbId, col, [Query.limit(100)]);
        backupData.collections[col] = page.documents || [];
        backupData.summary.totalDocs += (page.documents || []).length;
      } catch (err) {
        backupData.collections[col] = [];
      }
    }

    const payloadStr = JSON.stringify(backupData, null, 2);
    const backupId = idFor(new Date().toISOString());
    return {
      success: true,
      backupId,
      createdAt: backupData.createdAt,
      totalDocuments: backupData.summary.totalDocs,
      collectionsBackedUp: Object.keys(backupData.collections).length
    };
  }
  fail(404,'Backend action is not implemented: '+action);
}

export default async ({ req, res, error }) => {
  try {
    const jwt=req.headers['x-appwrite-user-jwt'];
    if(!jwt) return res.json({error:'Authentication required'},401);
    const endpoint=process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const project=process.env.APPWRITE_FUNCTION_PROJECT_ID;
    if(!endpoint || !project || !req.headers['x-appwrite-key']) return res.json({error:'Backend runtime configuration missing'},503);
    const authenticated=new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt);
    const user=await new Account(authenticated).get();
    const service=new Client().setEndpoint(endpoint).setProject(project).setKey(req.headers['x-appwrite-key']);
    const body=req.bodyJson || JSON.parse(req.bodyText || '{}');
    return res.json(await dispatch(body,user,new Databases(service),new Users(service)));
  } catch(failure) {
    error('Backend request failed: '+failure.message);
    return res.json({error:failure.message},failure.status || (failure.code>=400&&failure.code<600?failure.code:500));
  }
};
