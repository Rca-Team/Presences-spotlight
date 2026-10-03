import { Client, Account, Databases, Storage, Avatars, Functions, Realtime, OAuthProvider } from 'appwrite';
export { OAuthProvider };

const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '6abfd34f000604fcf074';

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const appwriteClient = client;

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const avatars = new Avatars(client);
export const functions = new Functions(client);
export const realtime = new Realtime(client);

// Run client.ping() once when the app starts so the user can confirm setup
try {
  client.ping().then(
    (response) => {
      console.log('[Appwrite] Ping successful:', response);
    },
    (error) => {
      console.warn('[Appwrite] Ping response:', error?.message || error);
    }
  );
} catch (e) {
  console.warn('[Appwrite] Ping caught:', e);
}

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
export function getAppwriteStorageViewUrl(bucketId: string, fileId: string): string {
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/view?project=${APPWRITE_PROJECT_ID}`;
}

/**
 * Returns the download URL for an Appwrite storage file
 */
export function getAppwriteStorageDownloadUrl(bucketId: string, fileId: string): string {
  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/download?project=${APPWRITE_PROJECT_ID}`;
}

/**
 * Returns an optimized, on-the-fly transformed image preview URL using Appwrite's native media engine.
 * Automatically handles resizing, intelligent face centering, WebP/AVIF compression, and quality adjustment.
 */
export function getAppwriteStoragePreviewUrl(
  bucketId: string,
  fileId: string,
  options?: ImageTransformOptions
): string {
  const params = new URLSearchParams({
    project: APPWRITE_PROJECT_ID,
  });

  if (options?.width) params.set('width', String(Math.round(options.width)));
  if (options?.height) params.set('height', String(Math.round(options.height)));
  if (options?.gravity) params.set('gravity', options.gravity);
  if (options?.quality) params.set('quality', String(Math.max(1, Math.min(100, Math.round(options.quality)))));
  if (options?.borderWidth !== undefined) params.set('borderWidth', String(options.borderWidth));
  if (options?.borderColor) params.set('borderColor', options.borderColor);
  if (options?.borderRadius !== undefined) params.set('borderRadius', String(options.borderRadius));
  if (options?.opacity !== undefined) params.set('opacity', String(options.opacity));
  if (options?.rotation !== undefined) params.set('rotation', String(options.rotation));
  if (options?.background) params.set('background', options.background);
  if (options?.output) params.set('output', options.output);

  return `${APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/preview?${params.toString()}`;
}

