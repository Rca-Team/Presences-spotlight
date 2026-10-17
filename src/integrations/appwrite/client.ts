import { Client, Account, Databases, Storage, Avatars, Functions, Realtime, OAuthProvider } from 'appwrite';
export { OAuthProvider };

const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const rawProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const APPWRITE_PROJECT_ID =
  rawProjectId && rawProjectId !== '6abfd34f000604fcf074' && rawProjectId !== '6accbd5d00053c5c1ac2'
    ? rawProjectId
    : '6ad309e200176195d398';

const isLocalOrNativeOrigin = () =>
  typeof window === 'undefined' ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'file:';

if (typeof window !== 'undefined') {
  // Sanitize any stale or legacy project session keys in cookieFallback and purge legacy quota lock
  try {
    window.localStorage?.removeItem('presences_appwrite_quota_frozen_until');
    const rawFallback = window.localStorage?.getItem('cookieFallback');
    if (rawFallback) {
      const parsed = JSON.parse(rawFallback);
      if (parsed && typeof parsed === 'object') {
        let modified = false;
        for (const k of Object.keys(parsed)) {
          if (
            k.includes('6abfd34f000604fcf074') ||
            k.includes('6accbd5d00053c5c1ac2') ||
            !parsed[k] ||
            parsed[k] === 'deleted'
          ) {
            delete parsed[k];
            modified = true;
          }
        }
        if (modified) {
          if (Object.keys(parsed).length > 0) {
            window.localStorage.setItem('cookieFallback', JSON.stringify(parsed));
          } else {
            window.localStorage.removeItem('cookieFallback');
          }
        }
      } else {
        window.localStorage.removeItem('cookieFallback');
      }
    }
  } catch {
    try {
      window.localStorage?.removeItem('cookieFallback');
    } catch {
      // ignore
    }
  }
}

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);

  const rewriteToSameOriginProxy = (urlStr: string): string | null => {
    try {
      const baseOrigin = isLocalOrNativeOrigin() && APPWRITE_PROJECT_ID === '6ad309e200176195d398'
        ? 'https://www.presences.dev'
        : window.location.origin;
      const parsed = new URL(urlStr, window.location.origin);
      if (parsed.hostname.endsWith('.cloud.appwrite.io')) {
        return `${baseOrigin}/api/appwrite${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // ignore invalid URL
    }
    return null;
  };

  let proxyUnavailable = false;

  const isProxyRouteMissing = (res: Response): boolean => {
    if (res.status !== 404) return false;
    if (res.headers.get('x-appwrite-proxy') === '1') return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // Legitimate Appwrite 404 responses (e.g. file/document not found) return JSON
    if (ct.includes('application/json') || ct.includes('application/problem+json')) {
      return false;
    }
    return true;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : '';

    // If caller passed a /api/appwrite URL and the proxy route itself was missing, rewrite back to upstream
    if (rawUrl.includes('/api/appwrite/v1') && proxyUnavailable) {
      const directUrl = rawUrl.replace(/^https?:\/\/[^/]+\/api\/appwrite\/v1/, APPWRITE_ENDPOINT).replace(/^\/api\/appwrite\/v1/, APPWRITE_ENDPOINT);
      return originalFetch(directUrl, init);
    }

    if (rawUrl.includes('/api/appwrite/v1')) {
      const res = await originalFetch(input, init);
      if (isProxyRouteMissing(res)) {
        proxyUnavailable = true;
        const directUrl = rawUrl.replace(/^https?:\/\/[^/]+\/api\/appwrite\/v1/, APPWRITE_ENDPOINT).replace(/^\/api\/appwrite\/v1/, APPWRITE_ENDPOINT);
        return originalFetch(directUrl, init);
      }
      if (res.status === 402) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('presences_appwrite_quota_frozen_until', String(Date.now() + 60 * 60 * 1000));
          }
        } catch {}
      }
      return res;
    }

    if (!rawUrl.includes('.cloud.appwrite.io/v1')) {
      return originalFetch(input, init);
    }

    if (!proxyUnavailable) {
      const proxyUrl = rewriteToSameOriginProxy(rawUrl);
      if (proxyUrl) {
        const res = await originalFetch(proxyUrl, init);
        if (isProxyRouteMissing(res)) {
          proxyUnavailable = true;
          return originalFetch(input, init);
        }
        if (res.status === 402) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('presences_appwrite_quota_frozen_until', String(Date.now() + 60 * 60 * 1000));
            }
          } catch {}
        }
        return res;
      }
    }

    const res = await originalFetch(input, init);
    if (res.status === 402) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('presences_appwrite_quota_frozen_until', String(Date.now() + 60 * 60 * 1000));
        }
      } catch {}
    }
    return res;
  };

  // Prevent any client connections to legacy/deprecated Supabase Realtime WebSockets,
  // and prevent browser console spam ("WebSocket is already in CLOSING or CLOSED state")
  if (typeof window.WebSocket === 'function') {
    const NativeWebSocket = window.WebSocket;
    const origSend = NativeWebSocket.prototype.send;
    NativeWebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== NativeWebSocket.OPEN) {
        return;
      }
      try {
        return origSend.call(this, data);
      } catch {
        // Ignore transient send errors on closing sockets
      }
    };

    // Intercept WebSocket creation to ensure no connection to supabase.co is ever established
    const WebSocketInterceptor = function (this: any, url: string | URL, protocols?: string | string[]) {
      const urlStr = String(url || '');
      if (urlStr.includes('supabase.co')) {
        // Return dummy dead socket to immediately drop legacy Supabase realtime requests
        const dummy = new EventTarget() as any;
        dummy.readyState = NativeWebSocket.CLOSED;
        dummy.close = () => {};
        dummy.send = () => {};
        dummy.url = urlStr;
        return dummy;
      }
      if (protocols !== undefined) {
        return new NativeWebSocket(url, protocols);
      }
      return new NativeWebSocket(url);
    } as any;

    WebSocketInterceptor.prototype = NativeWebSocket.prototype;
    WebSocketInterceptor.CONNECTING = NativeWebSocket.CONNECTING;
    WebSocketInterceptor.OPEN = NativeWebSocket.OPEN;
    WebSocketInterceptor.CLOSING = NativeWebSocket.CLOSING;
    WebSocketInterceptor.CLOSED = NativeWebSocket.CLOSED;
    window.WebSocket = WebSocketInterceptor;
  }
}

const RUNTIME_APPWRITE_ENDPOINT =
  typeof window !== 'undefined'
    ? (!isLocalOrNativeOrigin() ? `${window.location.origin}/api/appwrite/v1` : APPWRITE_ENDPOINT)
    : APPWRITE_ENDPOINT;

const REALTIME_APPWRITE_ENDPOINT = APPWRITE_ENDPOINT
  .replace(/^https:\/\//i, 'wss://')
  .replace(/^http:\/\//i, 'ws://');

export const client = new Client()
  .setEndpoint(RUNTIME_APPWRITE_ENDPOINT)
  .setEndpointRealtime(REALTIME_APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const appwriteClient = client;

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const avatars = new Avatars(client);
export const functions = new Functions(client);
export const realtime = new Realtime(client);

export const APPWRITE_CONFIG = {
  endpoint: APPWRITE_ENDPOINT,
  projectId: APPWRITE_PROJECT_ID,
  databaseId: 'presences_db',
  buckets: {
    faceImages: 'face-images',
    studentRegistrationFaces: 'student-registration-faces',
    attendanceTrainingFaces: 'attendance-training-faces',
    databaseExports: 'database-exports',
    public: 'face-images'
  },
  collections: {
    profiles: 'profiles',
    faceDescriptors: 'face_descriptors',
    attendanceRecords: 'attendance_records',
    timetable: 'timetable',
    userRoles: 'user_roles',
    emergencyEvents: 'emergency_events',
    notifications: 'notifications',
    subjects: 'subjects'
  }
};

/**
 * Options for Appwrite's native on-the-fly image transformation engine.
 */
export interface ImageTransformOptions {
  width?: number;
  height?: number;
  gravity?: 'center' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
  quality?: number;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  opacity?: number;
  rotation?: number;
  background?: string;
  output?: 'webp' | 'jpeg' | 'png' | 'gif' | 'avif';
}

/**
 * Returns the public view URL for an Appwrite storage file
 */
export function getAppwriteStorageViewUrl(bucketId: string, fileId: string, projectIdOverride?: string): string {
  const proj = projectIdOverride || APPWRITE_PROJECT_ID;
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/view?project=${proj}`;
}

/**
 * Returns the download URL for an Appwrite storage file
 */
export function getAppwriteStorageDownloadUrl(bucketId: string, fileId: string, projectIdOverride?: string): string {
  const proj = projectIdOverride || APPWRITE_PROJECT_ID;
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/download?project=${proj}`;
}

/**
 * Returns a direct view URL (avoiding the 100-image transformation quota lock on Appwrite Cloud)
 * while preserving the target project ID where the file is stored.
 */
export function getAppwriteStoragePreviewUrl(
  bucketId: string,
  fileId: string,
  _options?: ImageTransformOptions,
  projectIdOverride?: string
): string {
  const proj = projectIdOverride || APPWRITE_PROJECT_ID;
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/view?project=${proj}`;
}

