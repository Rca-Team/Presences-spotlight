
import { storage as appwriteStorage, APPWRITE_CONFIG, getAppwriteStorageViewUrl } from '@/integrations/appwrite/client';
import { ID, Permission, Role } from 'appwrite';
import { supabase } from '@/integrations/supabase/client';

/**
 * Uploads an image to Appwrite Storage (with Supabase fallback).
 * 
 * @param file - The file to upload.
 * @param path - The storage path or identifier.
 * @param bucket - The storage bucket (default: 'face-images').
 * @returns The public URL of the uploaded file.
 */
export const uploadImage = async (file: File, path: string, bucket: string = 'face-images'): Promise<string> => {
  try {
    if (!file || file.size === 0) {
      throw new Error('Invalid file: The file is empty or invalid');
    }

    const bucketId = APPWRITE_CONFIG.buckets.faceImages || bucket || 'face-images';
    
    // Clean path to generate fileId if helpful, or unique ID
    const cleanId = path ? path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36) : ID.unique();
    const fileId = (cleanId && /^[a-zA-Z0-9._-]+$/.test(cleanId)) ? cleanId : ID.unique();

    console.log(`Uploading image to Appwrite bucket: ${bucketId} (fileId: ${fileId}), size: ${file.size} bytes`);

    try {
      const res = await appwriteStorage.createFile(
        bucketId,
        fileId,
        file,
        [
          Permission.read(Role.any()),
          Permission.write(Role.any()),
          Permission.delete(Role.any())
        ]
      );
      const publicUrl = getAppwriteStorageViewUrl(bucketId, res.$id);
      console.log(`File uploaded successfully to Appwrite:`, publicUrl);
      return publicUrl;
    } catch (appwriteErr: any) {
      if (appwriteErr?.code === 409) {
        // File already exists -> return existing view URL
        return getAppwriteStorageViewUrl(bucketId, fileId);
      }
      console.warn('Appwrite upload attempt error, falling back to Supabase:', appwriteErr?.message);
    }

    // Fallback: Supabase storage
    const safeBucket = 'face-images';
    const cleanPath = path.replace(/^(faces|public|face-images)\//, '');
    const fullPath = `faces/${cleanPath}`;

    const result = await supabase.storage.from(safeBucket).upload(fullPath, file, {
      cacheControl: '3600',
      upsert: true,
    });

    if (result.error) {
      throw new Error(`Upload failed: ${result.error.message}`);
    }

    const publicUrlResult = supabase.storage.from(safeBucket).getPublicUrl(fullPath);
    return publicUrlResult.data.publicUrl;
  } catch (error) {
    console.error('Error in uploadImage:', error);
    throw error;
  }
};

/**
 * Retrieves the public URL of a file from Appwrite Storage.
 * 
 * @param path - The storage path or file ID.
 * @param bucket - The storage bucket (default: 'face-images').
 * @returns The public URL of the file.
 */
export const getImageUrl = (path: string, bucket: string = 'face-images'): string => {
  const bucketId = APPWRITE_CONFIG.buckets.faceImages || bucket || 'face-images';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanId = path.replace(/^(faces|public|face-images)\//, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 36);
  return getAppwriteStorageViewUrl(bucketId, cleanId);
};

