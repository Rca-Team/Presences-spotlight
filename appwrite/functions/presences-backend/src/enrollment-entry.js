import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import CryptoJS from 'crypto-js';
import { Client, Account, Databases, Storage, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { createEnrollmentService, BUCKET } from './enrollment.js';
import { hash, reject } from './enrollment-domain.js';

let firebaseApp;
function getFirebase() {
  if (!firebaseApp) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Firebase Service Account is missing');
    firebaseApp = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return getAuth(firebaseApp);
}

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
    let body = req.bodyJson || JSON.parse(req.bodyText || '{}');
    const E2E_SECRET = process.env.E2E_SECRET || process.env.VITE_E2E_SECRET || 'secure-e2e-secret-key-123!';
    let isE2E = false;
    if (body.e2e) {
      isE2E = true;
      const bytes = CryptoJS.AES.decrypt(body.e2e, E2E_SECRET);
      body = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    }
    if (typeof body.action !== 'string') reject(400, 'An action is required.');
    if (['start', 'resend', 'verify-otp', 'verify-father'].includes(body.action)) reject(410, 'Use admission number, registered parent phone, and date of birth to verify.');
    let user = null;
    if (body.action.startsWith('staff.')) {
      const jwt = req.headers['x-appwrite-user-jwt'];
      if (!jwt) reject(401, 'Sign in with your school account.');
      user = await new Account(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt)).get();
    }
    const files = {
      async put(id, bytes) {
        try { await storage.createFile({ bucketId: BUCKET, fileId: id, file: InputFile.fromBuffer(bytes, id + '.jpg'), permissions: [Permission.read(Role.any()), Permission.update(Role.any()), Permission.delete(Role.any())] }); }
        catch (e) { if (e.code !== 409) throw e; }
      },
      async remove(id) { try { await storage.deleteFile({ bucketId: BUCKET, fileId: id }); } catch (e) { if (e.code !== 404) throw e; } },
      url(id) { return `${endpoint}/storage/buckets/${BUCKET}/files/${id}/view?project=${project}`; },
      async read(id) { return Buffer.from(await storage.getFileView({ bucketId: BUCKET, fileId: id })).toString('base64'); },
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
        return { userId: 'firebase', expire: Date.now() + 600000 };
      },
      async verify(userId, secret) {
        const decoded = await getFirebase().verifyIdToken(secret);
        return decoded.phone_number;
      },
    } });
    // Appwrite supplies x-appwrite-client-ip; do not trust caller-supplied forwarded headers.
    const ip = req.headers['x-appwrite-client-ip'] || 'unknown';
    const responseData = await dispatch(body, { user, ip });
    if (isE2E) {
      const encrypted = CryptoJS.AES.encrypt(JSON.stringify(responseData), E2E_SECRET).toString();
      return res.json({ e2e: encrypted }, 200, { 'Cache-Control': 'no-store' });
    }
    return res.json(responseData, 200, { 'Cache-Control': 'no-store' });
  } catch (failure) {
    const status = failure.status || (failure.code >= 400 && failure.code < 600 ? failure.code : 500);
    error('Enrollment request failed (' + status + ')');
    return res.json({ error: status >= 500 ? 'Enrollment could not be saved. Please retry shortly.' : failure.message }, status, { 'Cache-Control': 'no-store' });
  }
};
