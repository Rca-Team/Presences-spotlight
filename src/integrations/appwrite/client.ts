import { Client, Account, Databases, Storage, Avatars, Functions, Realtime, OAuthProvider } from 'appwrite';
export { OAuthProvider };

const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const rawProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const APPWRITE_PROJECT_ID =
  rawProjectId && rawProjectId !== '6abfd34f000604fcf074'
    ? rawProjectId
    : '6accbd5d00053c5c1ac2';

const isLocalOrNativeOrigin = () =>
  typeof window === 'undefined' ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'file:';

if (typeof window !== 'undefined') {
  // Sanitize any stale or legacy project session keys in cookieFallback
  try {
    const rawFallback = window.localStorage?.getItem('cookieFallback');
    if (rawFallback) {
      const parsed = JSON.parse(rawFallback);
      if (parsed && typeof parsed === 'object') {
        let modified = false;
        for (const k of Object.keys(parsed)) {
          if (k.includes('6abfd34f000604fcf074') || !parsed[k] || parsed[k] === 'deleted') {
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
      const parsed = new URL(urlStr, window.location.origin);
      if (parsed.hostname.endsWith('.cloud.appwrite.io')) {
        return `${window.location.origin}/api/appwrite${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // ignore invalid URL
    }
    return null;
  };

  let proxyUnavailable = false;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : '';

    // If caller passed a /api/appwrite URL and the proxy returned 404 earlier, rewrite back to upstream
    if (rawUrl.includes('/api/appwrite/v1') && proxyUnavailable) {
      const directUrl = rawUrl.replace(/^https?:\/\/[^/]+\/api\/appwrite\/v1/, APPWRITE_ENDPOINT).replace(/^\/api\/appwrite\/v1/, APPWRITE_ENDPOINT);
      return originalFetch(directUrl, init);
    }

    if (rawUrl.includes('/api/appwrite/v1')) {
      const res = await originalFetch(input, init);
      if (res.status === 404) {
        proxyUnavailable = true;
        const directUrl = rawUrl.replace(/^https?:\/\/[^/]+\/api\/appwrite\/v1/, APPWRITE_ENDPOINT).replace(/^\/api\/appwrite\/v1/, APPWRITE_ENDPOINT);
        return originalFetch(directUrl, init);
      }
      return res;
    }

    if (!rawUrl.includes('.cloud.appwrite.io/v1')) {
      return originalFetch(input, init);
    }

    if (!isLocalOrNativeOrigin() && !proxyUnavailable) {
      const proxyUrl = rewriteToSameOriginProxy(rawUrl);
      if (proxyUrl) {
        const res = await originalFetch(proxyUrl, init);
        if (res.status === 404) {
          proxyUnavailable = true;
          return originalFetch(input, init);
        }
        return res;
      }
    }

    return originalFetch(input, init);
  };

  // Prevent infinite 1-second Realtime WebSocket reconnect loops when custom domain
  // is not yet registered in Appwrite Console -> Web Platforms
  if (typeof window.WebSocket === 'function' && !isLocalOrNativeOrigin()) {
    const NativeWebSocket = window.WebSocket;
    let realtimeWsBlocked = false;

    const PatchedWebSocket = function (
      this: WebSocket,
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const urlStr = String(url);
      if (urlStr.includes('.cloud.appwrite.io/v1/realtime')) {
        if (realtimeWsBlocked) {
          // Return an inert WebSocket-like object that stays quiet so the SDK does not loop
          const dummyTarget = new EventTarget();
          return Object.assign(dummyTarget, {
            url: urlStr,
            readyState: NativeWebSocket.OPEN,
            protocol: '',
            extensions: '',
            bufferedAmount: 0,
            binaryType: 'blob' as BinaryType,
            CONNECTING: NativeWebSocket.CONNECTING,
            OPEN: NativeWebSocket.OPEN,
            CLOSING: NativeWebSocket.CLOSING,
            CLOSED: NativeWebSocket.CLOSED,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            send() {},
            close() {},
          }) as unknown as WebSocket;
        }

        const ws = protocols !== undefined
          ? new NativeWebSocket(url, protocols)
          : new NativeWebSocket(url);

        let receivedValidMessage = false;
        ws.addEventListener('message', (ev) => {
          try {
            const parsed = JSON.parse(String(ev.data || '{}'));
            if (parsed?.type === 'connected' || parsed?.type === 'event' || parsed?.type === 'pong') {
              receivedValidMessage = true;
            }
            if (parsed?.type === 'error' && (parsed?.data?.code === 1008 || parsed?.data?.code === 403)) {
              realtimeWsBlocked = true;
            }
          } catch {
            // ignore
          }
        });
        ws.addEventListener('close', (ev) => {
          if (!receivedValidMessage && (ev.code === 1008 || ev.code === 1006 || ev.code === 1000)) {
            realtimeWsBlocked = true;
          }
        });
        return ws;
      }

      return protocols !== undefined
        ? new NativeWebSocket(url, protocols)
        : new NativeWebSocket(url);
    } as unknown as typeof WebSocket;

    Object.assign(PatchedWebSocket, {
      CONNECTING: NativeWebSocket.CONNECTING,
      OPEN: NativeWebSocket.OPEN,
      CLOSING: NativeWebSocket.CLOSING,
      CLOSED: NativeWebSocket.CLOSED,
      prototype: NativeWebSocket.prototype,
    });
    window.WebSocket = PatchedWebSocket;
  }
}

const RUNTIME_APPWRITE_ENDPOINT =
  typeof window !== 'undefined' && !isLocalOrNativeOrigin()
    ? `${window.location.origin}/api/appwrite/v1`
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

