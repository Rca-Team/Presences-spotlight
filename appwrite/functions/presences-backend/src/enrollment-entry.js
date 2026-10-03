import { Client, Account, Databases, Storage, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { createEnrollmentService, BUCKET } from './enrollment.js';
import { hash, reject } from './enrollment-domain.js';

export default async ({ req, res, error }) => {
  try {
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const project = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const key = req.headers['x-appwrite-key'];
    if (!endpoint || !project || !key) reject(503, 'Enrollment service is not configured.');
    const service = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
    const publicClient = new Client().setEndpoint(endpoint).setProject(project);
    const storage = new Storage(service);
    const account = new Account(publicClient);
    const users = new Users(service);
    const body = req.bodyJson || JSON.parse(req.bodyText || '{}');
    if (typeof body.action !== 'string') reject(400, 'An action is required.');
    let user = null;
    if (body.action.startsWith('staff.')) {
      const jwt = req.headers['x-appwrite-user-jwt'];
      if (!jwt) reject(401, 'Sign in with your school account.');
      user = await new Account(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt)).get();
    }
    const files = {
      async put(id, bytes) {
        try { await storage.createFile({ bucketId: BUCKET, fileId: id, file: InputFile.fromBuffer(bytes, id + '.jpg'), permissions: [] }); }
        catch (e) { if (e.code !== 409) throw e; }
      },
      async remove(id) { try { await storage.deleteFile({ bucketId: BUCKET, fileId: id }); } catch (e) { if (e.code !== 404) throw e; } },
      url(id) { return `${endpoint}/storage/buckets/${BUCKET}/files/${id}/view?project=${project}`; },
      async portrait(id, image) {
        if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 550000) reject(400, 'Invalid portrait.');
        const bytes = Buffer.from(image.split(',')[1], 'base64');
        if (bytes[0] !== 255 || bytes[1] !== 216) reject(400, 'Invalid portrait JPEG.');
        await this.put(id, bytes);
        return id;
      },
    };
    const dispatch = createEnrollmentService({ db: new Databases(service), files, sms: {
      async send(phone) {
        if (!phone || process.env.ENROLLMENT_SMS_ENABLED !== 'true') throw new Error('SMS is unavailable');
        const result = await account.createPhoneToken({ userId: hash('parent-phone:' + phone), phone });
        return { userId: result.userId, expire: result.expire };
      },
      async verify(userId, secret) {
        const result = await account.createSession({ userId, secret });
        // Never return a general Appwrite session to an enrollment browser.
        await users.deleteSession({ userId, sessionId: result.$id });
      },
    } });
    // Appwrite supplies x-appwrite-client-ip; do not trust caller-supplied forwarded headers.
    const ip = req.headers['x-appwrite-client-ip'] || 'unknown';
    return res.json(await dispatch(body, { user, ip }), 200, { 'Cache-Control': 'no-store' });
  } catch (failure) {
    const status = failure.status || (failure.code >= 400 && failure.code < 600 ? failure.code : 500);
    error('Enrollment request failed (' + status + ')');
    return res.json({ error: status >= 500 ? 'Enrollment could not be saved. Please retry shortly.' : failure.message }, status, { 'Cache-Control': 'no-store' });
  }
};
