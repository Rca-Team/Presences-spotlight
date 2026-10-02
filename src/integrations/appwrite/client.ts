import { Client, Account, Databases, Storage, Avatars, Functions } from 'appwrite';

const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '6abfd34f000604fcf074';

export const appwriteClient = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(appwriteClient);
export const databases = new Databases(appwriteClient);
export const storage = new Storage(appwriteClient);
export const avatars = new Avatars(appwriteClient);
export const functions = new Functions(appwriteClient);

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

