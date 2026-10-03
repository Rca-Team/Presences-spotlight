import { functions } from '@/integrations/appwrite/client';
import CryptoJS from 'crypto-js';

const E2E_SECRET = import.meta.env.VITE_E2E_SECRET || 'secure-e2e-secret-key-123!';

export async function enrollmentApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const plainTextPayload = JSON.stringify({ ...body, action });
  const encryptedPayload = CryptoJS.AES.encrypt(plainTextPayload, E2E_SECRET).toString();

  const result = await functions.createExecution({ 
    functionId: 'presences-enrollment', 
    body: JSON.stringify({ e2e: encryptedPayload }), 
    async: false, 
    path: '/', 
    method: 'POST' 
  });
  
  let data: any;
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
