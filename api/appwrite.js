const APPWRITE_UPSTREAM_ORIGIN = 'https://sgp.cloud.appwrite.io';
const DEFAULT_PROJECT_ID = '6accbd5d00053c5c1ac2';

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ||
        'Content-Type, X-Appwrite-Project, X-Appwrite-JWT, X-Appwrite-Response-Format, X-Fallback-Cookies, X-SDK-Name, X-SDK-Platform, X-SDK-Language, X-SDK-Version'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    return res.status(204).end();
  }

  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    let subPath = parsedUrl.searchParams.get('__path') || '';
    if (!subPath) {
      subPath = parsedUrl.pathname.replace(/^\/api\/appwrite\/?/, '');
    }
    parsedUrl.searchParams.delete('__path');

    const normalizedPath = subPath.startsWith('v1/') || subPath === 'v1' ? `/${subPath}` : `/v1/${subPath.replace(/^\/+/, '')}`;
    const queryString = parsedUrl.searchParams.toString();
    const targetUrl = `${APPWRITE_UPSTREAM_ORIGIN}${normalizedPath}${queryString ? `?${queryString}` : ''}`;

    const forwardHeaders = {
      Origin: 'http://localhost:5173',
      Referer: 'http://localhost:5173/',
    };

    const allowedIncomingHeaders = [
      'content-type',
      'accept',
      'cookie',
      'x-appwrite-project',
      'x-appwrite-key',
      'x-appwrite-jwt',
      'x-appwrite-locale',
      'x-appwrite-mode',
      'x-appwrite-response-format',
      'x-fallback-cookies',
      'x-sdk-name',
      'x-sdk-platform',
      'x-sdk-language',
      'x-sdk-version',
      'x-sdk-graphql',
      'content-range',
    ];

    for (const key of allowedIncomingHeaders) {
      const val = req.headers[key];
      if (val !== undefined) {
        forwardHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
      }
    }

    if (
      !forwardHeaders['x-appwrite-project'] ||
      forwardHeaders['x-appwrite-project'] === '6abfd34f000604fcf074'
    ) {
      forwardHeaders['x-appwrite-project'] = DEFAULT_PROJECT_ID;
    }

    const methodUpper = (req.method || 'GET').toUpperCase();
    const isCreateSessionRequest =
      methodUpper === 'POST' &&
      (normalizedPath === '/v1/account/sessions/email' ||
        normalizedPath === '/v1/account/sessions/anonymous' ||
        normalizedPath === '/v1/account/sessions/token');

    if (isCreateSessionRequest) {
      // Never send stale or active session cookies when explicitly creating a new session,
      // preventing Appwrite 401 `user_session_already_exists` errors on sign-in.
      delete forwardHeaders['cookie'];
      delete forwardHeaders['x-fallback-cookies'];
    } else if (forwardHeaders['x-fallback-cookies']) {
      // Synchronize X-Fallback-Cookies into the upstream Cookie header so Appwrite Cloud
      // always recognizes the session even if browser cookies are blocked or stale.
      try {
        const parsedFallback = JSON.parse(forwardHeaders['x-fallback-cookies']);
        if (parsedFallback && typeof parsedFallback === 'object') {
          const cookieMap = new Map();
          if (forwardHeaders['cookie']) {
            for (const part of forwardHeaders['cookie'].split(';')) {
              const eqIdx = part.indexOf('=');
              if (eqIdx > 0) {
                const k = part.slice(0, eqIdx).trim();
                const v = part.slice(eqIdx + 1).trim();
                if (k && !k.includes('6abfd34f000604fcf074')) {
                  cookieMap.set(k, v);
                }
              }
            }
          }
          for (const [k, v] of Object.entries(parsedFallback)) {
            if (typeof v === 'string' && v && !k.includes('6abfd34f000604fcf074')) {
              cookieMap.set(k, v);
            }
          }
          if (cookieMap.size > 0) {
            forwardHeaders['cookie'] = Array.from(cookieMap.entries())
              .map(([k, v]) => `${k}=${v}`)
              .join('; ');
          }
        }
      } catch {
        // Ignore malformed fallback cookie JSON
      }
    }

    const hasBody = !['GET', 'HEAD'].includes(methodUpper);
    const rawBody = hasBody ? await readRawBody(req) : undefined;

    const upstreamRes = await fetch(targetUrl, {
      method: methodUpper,
      headers: forwardHeaders,
      body: hasBody && rawBody && rawBody.length > 0 ? rawBody : undefined,
      redirect: 'manual',
    });

    // Gracefully handle upstream Appwrite Cloud 402 billing limit freeze
    if (upstreamRes.status === 402) {
      res.setHeader('X-Appwrite-Proxy', '1');
      res.setHeader('Access-Control-Expose-Headers', 'X-Fallback-Cookies, X-Appwrite-Warning, X-Appwrite-Proxy');

      const supaUrl = 'https://cvdcbcsonlianbfeessy.supabase.co';
      const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';

      // 1. Session check on /v1/account
      if (normalizedPath === '/v1/account' || normalizedPath === '/v1/account/') {
        if (methodUpper === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=UTF-8');
          return res.status(401).json({
            message: 'User (role: guests) missing scopes (["account"])',
            code: 401,
            type: 'general_unauthorized_scope',
            version: '2.5.0',
          });
        }
        if (methodUpper === 'POST' && rawBody) {
          try {
            const bodyObj = JSON.parse(rawBody.toString('utf8'));
            const sRes = await fetch(`${supaUrl}/auth/v1/signup`, {
              method: 'POST',
              headers: { apikey: supaKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: bodyObj.email, password: bodyObj.password, data: { name: bodyObj.name } }),
            });
            const sJson = await sRes.json().catch(() => ({}));
            if (sRes.ok) {
              const u = sJson.user || {};
              res.setHeader('Content-Type', 'application/json; charset=UTF-8');
              return res.status(201).json({
                $id: u.id,
                $createdAt: u.created_at || new Date().toISOString(),
                $updatedAt: u.updated_at || new Date().toISOString(),
                name: bodyObj.name || u.email?.split('@')[0],
                email: u.email,
                phone: u.phone || '',
                emailVerification: false,
                status: true,
              });
            }
          } catch {}
        }
      }

      // 2. Login via email session: /v1/account/sessions/email
      if (normalizedPath === '/v1/account/sessions/email' && methodUpper === 'POST' && rawBody) {
        try {
          const creds = JSON.parse(rawBody.toString('utf8'));
          const sRes = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: supaKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: creds.email, password: creds.password }),
          });
          const sJson = await sRes.json().catch(() => ({}));
          if (sRes.ok && sJson.user) {
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            return res.status(201).json({
              $id: sJson.user.id,
              $createdAt: sJson.user.created_at || new Date().toISOString(),
              userId: sJson.user.id,
              expire: sJson.expires_at || 9999999999,
              provider: 'email',
              providerUid: creds.email,
              providerAccessToken: sJson.access_token,
              current: true,
            });
          } else {
            const errMsg = sJson.msg || sJson.error_description || sJson.message || 'Invalid credentials';
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            return res.status(401).json({
              message: errMsg,
              code: 401,
              type: 'user_invalid_credentials',
            });
          }
        } catch {
          res.setHeader('Content-Type', 'application/json; charset=UTF-8');
          return res.status(401).json({ message: 'Authentication failed', code: 401 });
        }
      }

      // 3. Logout: /v1/account/sessions/current or /v1/account/sessions/:id
      if (normalizedPath.startsWith('/v1/account/sessions') && methodUpper === 'DELETE') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        return res.status(200).json({});
      }

      // 4. Database collections & documents
      const dbDocMatch = normalizedPath.match(/\/databases\/[^/]+\/collections\/([^/]+)\/documents(?:\/([^/?#]+))?/);
      if (dbDocMatch) {
        const collection = dbDocMatch[1];
        const docId = dbDocMatch[2];

        try {
          if (methodUpper === 'GET') {
            if (docId) {
              const sRes = await fetch(`${supaUrl}/rest/v1/${collection}?or=(id.eq.${docId},user_id.eq.${docId})&limit=1`, {
                headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
              });
              if (sRes.ok) {
                const rows = await sRes.json();
                if (Array.isArray(rows) && rows[0]) {
                  const r = rows[0];
                  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
                  return res.status(200).json({
                    ...r,
                    $id: r.id || r.user_id || docId,
                    $createdAt: r.created_at || new Date().toISOString(),
                    $updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
                  });
                }
              }
              res.setHeader('Content-Type', 'application/json; charset=UTF-8');
              return res.status(404).json({ message: 'Document not found', code: 404 });
            } else {
              const sRes = await fetch(`${supaUrl}/rest/v1/${collection}?select=*&limit=100`, {
                headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
              });
              if (sRes.ok) {
                const rows = await sRes.json();
                const documents = (Array.isArray(rows) ? rows : []).map((r) => ({
                  ...r,
                  $id: r.id || r.user_id,
                  $createdAt: r.created_at || new Date().toISOString(),
                  $updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
                }));
                res.setHeader('Content-Type', 'application/json; charset=UTF-8');
                return res.status(200).json({ total: documents.length, documents });
              }
            }
          } else if (methodUpper === 'POST' && rawBody) {
            const bodyObj = JSON.parse(rawBody.toString('utf8'));
            const dataToInsert = bodyObj.data || bodyObj;
            const targetId = bodyObj.documentId || dataToInsert.$id || dataToInsert.id;
            const cleanRow = { ...dataToInsert };
            delete cleanRow.$id;
            delete cleanRow.$createdAt;
            delete cleanRow.$updatedAt;
            delete cleanRow.$permissions;
            delete cleanRow.$databaseId;
            delete cleanRow.$collectionId;
            if (targetId && !cleanRow.id && !cleanRow.user_id) cleanRow.id = targetId;

            const sRes = await fetch(`${supaUrl}/rest/v1/${collection}`, {
              method: 'POST',
              headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
              },
              body: JSON.stringify(cleanRow),
            });
            if (sRes.ok) {
              const inserted = await sRes.json().catch(() => [cleanRow]);
              const row = Array.isArray(inserted) ? inserted[0] : inserted;
              res.setHeader('Content-Type', 'application/json; charset=UTF-8');
              return res.status(201).json({
                ...row,
                $id: row.id || targetId || 'doc_' + Date.now(),
                $createdAt: row.created_at || new Date().toISOString(),
                $updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
              });
            }
          } else if ((methodUpper === 'PATCH' || methodUpper === 'PUT') && docId && rawBody) {
            const bodyObj = JSON.parse(rawBody.toString('utf8'));
            const dataToUpdate = bodyObj.data || bodyObj;
            const cleanRow = { ...dataToUpdate };
            delete cleanRow.$id;
            delete cleanRow.$createdAt;
            delete cleanRow.$updatedAt;
            delete cleanRow.$permissions;

            const sRes = await fetch(`${supaUrl}/rest/v1/${collection}?or=(id.eq.${docId},user_id.eq.${docId})`, {
              method: 'PATCH',
              headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
              },
              body: JSON.stringify(cleanRow),
            });
            if (sRes.ok) {
              const updated = await sRes.json().catch(() => [cleanRow]);
              const row = Array.isArray(updated) ? updated[0] : updated;
              res.setHeader('Content-Type', 'application/json; charset=UTF-8');
              return res.status(200).json({
                ...row,
                $id: docId,
                $createdAt: row.created_at || new Date().toISOString(),
                $updatedAt: row.updated_at || new Date().toISOString(),
              });
            }
          } else if (methodUpper === 'DELETE' && docId) {
            await fetch(`${supaUrl}/rest/v1/${collection}?or=(id.eq.${docId},user_id.eq.${docId})`, {
              method: 'DELETE',
              headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
            });
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            return res.status(204).end();
          }
        } catch {
          // Fall through
        }
      }
    }

    const passthroughHeaders = [
      'content-type',
      'x-fallback-cookies',
      'x-appwrite-warning',
      'content-disposition',
      'cache-control',
      'location',
    ];

    for (const h of passthroughHeaders) {
      const v = upstreamRes.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    const setCookies =
      typeof upstreamRes.headers.getSetCookie === 'function'
        ? upstreamRes.headers.getSetCookie()
        : upstreamRes.headers.get('set-cookie')
          ? [upstreamRes.headers.get('set-cookie')]
          : [];

    if (setCookies.length > 0) {
      const rewrittenCookies = setCookies.map((c) =>
        c
          .replace(/;\s*Domain=[^;]+/gi, '')
          .replace(/;\s*Path=[^;]+/gi, '; Path=/')
          .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
      );
      res.setHeader('Set-Cookie', rewrittenCookies);

      if (!upstreamRes.headers.get('x-fallback-cookies')) {
        const fallbackObj = {};
        for (const cookieStr of setCookies) {
          const firstPair = cookieStr.split(';')[0] || '';
          const eqIdx = firstPair.indexOf('=');
          if (eqIdx > 0) {
            const name = firstPair.slice(0, eqIdx).trim();
            const val = firstPair.slice(eqIdx + 1).trim();
            if (name.startsWith('a_session_') && val && val !== 'deleted') {
              fallbackObj[name] = val;
            }
          }
        }
        if (Object.keys(fallbackObj).length > 0) {
          res.setHeader('X-Fallback-Cookies', JSON.stringify(fallbackObj));
        }
      }
    }

    res.setHeader('X-Appwrite-Proxy', '1');
    res.setHeader('Access-Control-Expose-Headers', 'X-Fallback-Cookies, X-Appwrite-Warning, X-Appwrite-Proxy');

    const responseBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    return res.status(upstreamRes.status).send(responseBuffer);
  } catch (err) {
    return res.status(502).json({
      message: err?.message || 'Appwrite proxy request failed',
      code: 502,
      type: 'proxy_error',
    });
  }
}
