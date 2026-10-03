import { functions } from '@/integrations/appwrite/client';

export async function enrollmentApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const result = await functions.createExecution({ functionId: 'presences-enrollment', body: JSON.stringify({ ...body, action }), async: false, path: '/', method: 'POST' });
  let data: T & { error?: string };
  try { data = JSON.parse(result.responseBody); } catch { throw new Error('Enrollment service is unavailable. Please contact the school.'); }
  if (result.status === 'failed' || result.responseStatusCode >= 400 || data.error) throw new Error(data.error || 'Enrollment request failed. Please retry.');
  return data;
}
