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

      // 1. Session check on /v1/account -> return 401 unauthenticated (guest) rather than 402 billing crash
      if (normalizedPath === '/v1/account' || normalizedPath === '/v1/account/') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        return res.status(401).json({
          message: 'User (role: guests) missing scopes (["account"])',
          code: 401,
          type: 'general_unauthorized_scope',
          version: '2.5.0',
        });
      }

      // 2. Database reads -> return live fallback from Supabase REST with HTTP 200
      const dbMatch = normalizedPath.match(/\/databases\/[^/]+\/collections\/([^/]+)\/documents/);
      if (dbMatch && methodUpper === 'GET') {
        const collection = dbMatch[1];
        try {
          const supaUrl = 'https://cvdcbcsonlianbfeessy.supabase.co';
          const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDQ5MDcsImV4cCI6MjEwMzIyMDkwN30.fzJfZKKTw2Y3oFgk6fxVkfhdnIXNzXDeNa0CP84RxDg';
          const supaRes = await fetch(`${supaUrl}/rest/v1/${collection}?select=*&limit=100`, {
            headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
          });
          if (supaRes.ok) {
            const rows = await supaRes.json();
            const documents = (Array.isArray(rows) ? rows : []).map((r) => ({
              ...r,
              $id: r.id || r.user_id,
              $createdAt: r.created_at || new Date().toISOString(),
              $updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
            }));
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            return res.status(200).json({ total: documents.length, documents });
          }
        } catch {
          // Fall through to standard 402 forwarding
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
