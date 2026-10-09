import { bulkIdCards } from '../_shared/bulk-id-cards.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-appwrite-user-jwt',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  try {
    const jwt = request.headers.get('x-appwrite-user-jwt');
    if (!jwt) return json({ error: 'Sign in with your school account.' }, 401);
    const endpoint = Deno.env.get('APPWRITE_ENDPOINT') || 'https://sgp.cloud.appwrite.io/v1';
    const project = Deno.env.get('APPWRITE_PROJECT_ID') || '6abfd34f000604fcf074';
    const auth = await fetch(`${endpoint.replace(/\/$/, '')}/account`, {
      headers: { 'x-appwrite-project': project, 'x-appwrite-jwt': jwt },
      signal: AbortSignal.timeout(10000),
    });
    if (!auth.ok) return json({ error: 'Your school session expired. Sign in again.' }, 401);
    const user = await auth.json();
    if (!(user.labels || []).some((label: string) => ['admin', 'principal', 'superadmin'].includes(label))) return json({ error: 'Administrator or principal access required.' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 17000000) return json({ error: 'Each uploaded PDF page must be at most 12 MB.' }, 413);
    const text = await request.text();
    if (text.length > 17000000) return json({ error: 'Each uploaded PDF page must be at most 12 MB.' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON request.' }, 400); }
    if (body.action !== 'idcards.extract') return json({ error: 'This function only extracts ID cards. Student saving uses the existing school database.' }, 400);
    // The shared extractor accepts the authenticated user, never client-provided roles.
    return json(await bulkIdCards(body, user, null, ''));
  } catch (failure) {
    const error = failure as Error & { status?: number };
    return json({ error: error.message || 'PDF extraction failed.' }, error.status || 500);
  }
});
