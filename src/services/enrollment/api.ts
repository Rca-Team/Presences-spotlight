import { functions, account } from '@/integrations/appwrite/client';
import { ExecutionMethod } from 'appwrite';
import CryptoJS from 'crypto-js';

const E2E_SECRET = import.meta.env.VITE_E2E_SECRET || 'secure-e2e-secret-key-123!';

export async function enrollmentApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let jwt: string | undefined;
  try {
    const jwtRes = await account.createJWT().catch(() => null);
    if (jwtRes?.jwt) jwt = jwtRes.jwt;
  } catch {}

  const plainTextPayload = JSON.stringify({ ...body, action, ...(jwt ? { jwt } : {}) });
  const encryptedPayload = CryptoJS.AES.encrypt(plainTextPayload, E2E_SECRET).toString();

  const result = await functions.createExecution({ 
    functionId: 'presences-enrollment', 
    body: JSON.stringify({ e2e: encryptedPayload }), 
    async: false, 
    xpath: '/', 
    method: ExecutionMethod.POST,
    headers: jwt ? { 'x-appwrite-user-jwt': jwt } : undefined,
  });
  
  let data: T & { error?: string };
  try { 
    const rawRes = JSON.parse(result.responseBody);
    if (rawRes.e2e) {
      const bytes = CryptoJS.AES.decrypt(rawRes.e2e, E2E_SECRET);
      data = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    } else {
      data = rawRes;
    }
  } catch { 
    throw new Error('Enrollment service is unavailable. Please contact the school.'); 
  }
  
  if (result.status === 'failed' || result.responseStatusCode >= 400 || data?.error) throw new Error(data?.error || 'Enrollment request failed. Please retry.');
  return data;
}
