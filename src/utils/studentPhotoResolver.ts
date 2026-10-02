import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { APPWRITE_CONFIG, getAppwriteStorageViewUrl } from '@/integrations/appwrite/client';

const FACE_BUCKET = 'face-images';
const signedUrlCache = new Map<string, string>();

const unwrapPath = (value: string) => value.replace(/^\/+/, '').trim();

// Pure JS MD5 for deterministic Appwrite fileId resolution
function computeMd5(string: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    }
    return lResult ^ lX8 ^ lY8;
  }
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(str: string) {
    const lMessageLength = str.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords).fill(0);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue: number) {
    let WordToHexValue = '', lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      const WordToHexValue_temp = '0' + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  const x = convertToWordArray(unescape(encodeURIComponent(string)));
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x02441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

export function getAppwriteFileId(path: string): string {
  const normalized = path.replace(/^\/+/, '').trim();
  if (!normalized.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(normalized)) {
    return normalized;
  }
  return computeMd5(normalized);
}

const STORAGE_URL_PATTERN = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/i;

const extractStorageRef = (raw: string): { bucket: string; path: string } | null => {
  const value = raw.trim();
  if (!value || value.startsWith('data:')) return null;

  if (/^https?:\/\//i.test(value)) {
    const storageMatch = value.match(STORAGE_URL_PATTERN);
    if (storageMatch?.[1] && storageMatch?.[2]) {
      const bucket = unwrapPath(storageMatch[1]);
      const rawPath = decodeURIComponent(storageMatch[2]);
      const [cleanPath] = rawPath.split('?');
      return {
        bucket,
        path: unwrapPath(cleanPath),
      };
    }

    const markers = ['/face-images/', '/student-registration-faces/', '/attendance-training-faces/'];
    for (const marker of markers) {
      const markerIndex = value.indexOf(marker);
      if (markerIndex >= 0) {
        const bucket = marker.replace(/\//g, '');
        const pathWithQuery = value.slice(markerIndex + marker.length);
        const [cleanPath] = pathWithQuery.split('?');
        return { bucket, path: unwrapPath(cleanPath) };
      }
    }

    return null;
  }

  const normalized = unwrapPath(value);
  const prefixed = normalized.match(/^([^/]+)\/(.+)$/);
  if (prefixed?.[1] && prefixed?.[2] && ['face-images', 'student-registration-faces', 'attendance-training-faces'].includes(prefixed[1])) {
    const [cleanPath] = prefixed[2].split('?');
    return {
      bucket: prefixed[1],
      path: unwrapPath(cleanPath),
    };
  }

  const [cleanNormalized] = normalized.split('?');
  return {
    bucket: FACE_BUCKET,
    path: unwrapPath(cleanNormalized.replace(/^face-images\//, '')),
  };
};

export const sanitizeStudentPhotoUrl = (raw?: string | null): string => {
  const value = raw?.toString().trim();
  if (!value) return '';
  if (value.startsWith('data:') || value.startsWith('blob:')) return value;

  const currentOrigin = import.meta.env.VITE_SUPABASE_URL || 'https://cvdcbcsonlianbfeessy.supabase.co';

  // Clean legacy project IDs from URLs
  if (value.includes('eiahucigcvsnuvviajqt.supabase.co')) {
    return value
      .replace('https://eiahucigcvsnuvviajqt.supabase.co', currentOrigin)
      .replace('http://eiahucigcvsnuvviajqt.supabase.co', currentOrigin)
      .replace(/eiahucigcvsnuvviajqt/g, 'cvdcbcsonlianbfeessy');
  }

  return value;
};

export const pickPreferredPhotoCandidate = (
  ...candidates: Array<string | null | undefined>
): string => {
  for (const candidate of candidates) {
    const value = sanitizeStudentPhotoUrl(candidate);
    if (value) return value;
  }
  return '';
};

export const resolveStudentPhotoUrl = async (raw?: string | null): Promise<string> => {
  const value = sanitizeStudentPhotoUrl(raw);
  if (!value) return '';
  if (value.startsWith('data:') || value.startsWith('blob:')) return value;

  // 1. Direct Appwrite Storage URLs
  if (/^https?:\/\//i.test(value) && (value.includes('appwrite.io') || value.includes('/storage/buckets/'))) {
    return value;
  }

  // 2. Non-supabase external URLs (e.g. Dicebear, Gravatar, Unsplash)
  if (/^https?:\/\//i.test(value) && !value.includes('.supabase.co/storage/v1/object/')) {
    return value;
  }

  const cacheKey = value;
  if (signedUrlCache.has(cacheKey)) return signedUrlCache.get(cacheKey)!;

  const storageRef = extractStorageRef(value);
  const primaryBucket = storageRef?.bucket || FACE_BUCKET;
  const bucketPath = storageRef?.path || unwrapPath(value).replace(/^(?:face-images|student-registration-faces|attendance-training-faces|public)\//, '');

  if (!bucketPath) {
    return value;
  }

  // Generate Appwrite View URL directly from bucket and deterministic fileId
  const appwriteFileId = getAppwriteFileId(bucketPath);
  const appwriteUrl = getAppwriteStorageViewUrl(primaryBucket, appwriteFileId);
  signedUrlCache.set(cacheKey, appwriteUrl);
  return appwriteUrl;
};


const coverPhotoCache = new Map<string, string>();
const inFlightCoverPhoto = new Map<string, Promise<string | null>>();

/**
 * Get student's enrolled cover photo (profile avatar / registration photo),
 * NOT the webcam snapshot in which they were recognized.
 */
export async function getStudentCoverPhoto(
  userIdOrId?: string | null,
  name?: string | null,
  employeeId?: string | null
): Promise<string | null> {
  const key = (userIdOrId || employeeId || name || '').trim();
  if (!key) return null;

  if (coverPhotoCache.has(key)) {
    return coverPhotoCache.get(key) || null;
  }
  if (employeeId && coverPhotoCache.has(employeeId.trim())) {
    return coverPhotoCache.get(employeeId.trim()) || null;
  }
  if (name && coverPhotoCache.has(name.trim().toLowerCase())) {
    return coverPhotoCache.get(name.trim().toLowerCase()) || null;
  }

  if (inFlightCoverPhoto.has(key)) {
    return inFlightCoverPhoto.get(key)!;
  }

  const promise = (async () => {
    try {
      // 1. Check profiles table for avatar_url / photo_url
      const isUuid = (val?: string | null) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
      const orConditions: string[] = [];
      if (userIdOrId) {
        if (isUuid(userIdOrId)) {
          orConditions.push(`user_id.eq.${userIdOrId}`, `id.eq.${userIdOrId}`);
        } else {
          orConditions.push(`employee_id.eq.${userIdOrId}`);
        }
      }
      if (employeeId) {
        orConditions.push(`employee_id.eq.${employeeId}`);
      }
      if (name) {
        orConditions.push(`display_name.ilike.${name}`, `full_name.ilike.${name}`);
      }

      if (orConditions.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('avatar_url, photo_url, user_id, employee_id, display_name')
          .or(orConditions.join(','))
          .limit(5);

        const foundProfile = profiles?.find((p: any) => p.avatar_url || p.photo_url);
        const candidate = foundProfile?.avatar_url || foundProfile?.photo_url;
        if (candidate) {
          const resolved = await resolveStudentPhotoUrl(candidate);
          if (resolved) {
            coverPhotoCache.set(key, resolved);
            if (userIdOrId) coverPhotoCache.set(userIdOrId.trim(), resolved);
            if (employeeId) coverPhotoCache.set(employeeId.trim(), resolved);
            if (name) coverPhotoCache.set(name.trim().toLowerCase(), resolved);
            return resolved;
          }
        }
      }

      // 2. Check registered attendance_records metadata
      const { data: regList } = await supabase
        .from('attendance_records')
        .select('device_info, image_url, user_id, id')
        .eq('status', 'registered');

      const matchedReg = (regList || []).find((r: any) => {
        const di = r.device_info as any;
        const meta = di?.metadata || di || {};
        const emp = String(meta.employee_id || meta.roll_number || '').toLowerCase();
        const nm = String(meta.name || meta.student_name || '').toLowerCase();
        if (employeeId && emp === employeeId.toLowerCase()) return true;
        if (userIdOrId && (r.user_id === userIdOrId || r.id === userIdOrId || emp === userIdOrId.toLowerCase())) return true;
        if (name && nm === name.toLowerCase()) return true;
        return false;
      });

      if (matchedReg) {
        const di = matchedReg.device_info as any;
        const meta = di?.metadata || di || {};
        const candidate = meta.firebase_image_url || meta.id_card_photo_url || meta.avatar_url || meta.photo_url || matchedReg.image_url;
        if (candidate) {
          const resolved = await resolveStudentPhotoUrl(candidate);
          if (resolved) {
            coverPhotoCache.set(key, resolved);
            if (userIdOrId) coverPhotoCache.set(userIdOrId.trim(), resolved);
            if (employeeId) coverPhotoCache.set(employeeId.trim(), resolved);
            if (name) coverPhotoCache.set(name.trim().toLowerCase(), resolved);
            return resolved;
          }
        }

        // If matchedReg has user_id, check face_descriptors
        if (matchedReg.user_id) {
          const { data: descriptor } = await supabase
            .from('face_descriptors')
            .select('image_url')
            .eq('user_id', matchedReg.user_id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (descriptor?.image_url) {
            const resolved = await resolveStudentPhotoUrl(descriptor.image_url);
            if (resolved) {
              coverPhotoCache.set(key, resolved);
              if (userIdOrId) coverPhotoCache.set(userIdOrId.trim(), resolved);
              if (employeeId) coverPhotoCache.set(employeeId.trim(), resolved);
              if (name) coverPhotoCache.set(name.trim().toLowerCase(), resolved);
              return resolved;
            }
          }
        }
      }

      // 3. Check face_descriptors directly if userIdOrId is available
      if (userIdOrId) {
        const { data: descriptor } = await supabase
          .from('face_descriptors')
          .select('image_url')
          .eq('user_id', userIdOrId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (descriptor?.image_url) {
          const resolved = await resolveStudentPhotoUrl(descriptor.image_url);
          if (resolved) {
            coverPhotoCache.set(key, resolved);
            return resolved;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch student cover photo:', e);
    } finally {
      inFlightCoverPhoto.delete(key);
    }
    return null;
  })();

  inFlightCoverPhoto.set(key, promise);
  return promise;
}

/**
 * Synchronous cache lookup for instant rendering without lag
 */
export function getCachedStudentCoverPhoto(userIdOrId?: string | null): string | null {
  if (!userIdOrId) return null;
  const key = userIdOrId.trim();
  return coverPhotoCache.get(key) || coverPhotoCache.get(key.toLowerCase()) || null;
}

/**
 * React hook for consuming student cover photo with instant cache hydration
 */
export function useStudentCoverPhoto(student?: {
  id?: string | null;
  user_id?: string | null;
  name?: string | null;
  employee_id?: string | null;
  image_url?: string | null;
  cover_url?: string | null;
} | null): { coverUrl: string | null; loading: boolean } {
  const rawCandidate = student?.cover_url || student?.image_url;
  const initial =
    (rawCandidate && rawCandidate.startsWith('http') && !rawCandidate.includes('/null'))
      ? rawCandidate
      : getCachedStudentCoverPhoto(student?.user_id || student?.id || student?.employee_id || student?.name);

  const [coverUrl, setCoverUrl] = useState<string | null>(initial || null);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    let active = true;

    if (rawCandidate && (rawCandidate.startsWith('data:') || rawCandidate.startsWith('blob:') || (rawCandidate.startsWith('http') && rawCandidate.includes('token=')))) {
      setCoverUrl(rawCandidate);
      setLoading(false);
      return;
    }

    const cached = getCachedStudentCoverPhoto(student?.user_id || student?.id || student?.employee_id || student?.name);
    if (cached) {
      setCoverUrl(cached);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        if (rawCandidate) {
          const resolvedRaw = await resolveStudentPhotoUrl(rawCandidate);
          if (active && resolvedRaw) {
            setCoverUrl(resolvedRaw);
            setLoading(false);
            return;
          }
        }

        const resolved = await getStudentCoverPhoto(
          student?.user_id || student?.id,
          student?.name,
          student?.employee_id
        );
        if (active && resolved) {
          setCoverUrl(resolved);
        }
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [student?.id, student?.user_id, student?.employee_id, student?.name, rawCandidate]);

  return { coverUrl, loading };
}

/**
 * Pre-warm cover photos cache for enrolled students
 */
export async function prefetchStudentCoverPhotos(userIds?: string[]): Promise<void> {
  try {
    const query = supabase
      .from('profiles')
      .select('user_id, id, avatar_url, photo_url');

    if (userIds && userIds.length > 0) {
      const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const uuidList = userIds.filter(isUuid);
      const nonUuidList = userIds.filter(id => !isUuid(id));
      const orParts: string[] = [];
      if (uuidList.length > 0) {
        orParts.push(`user_id.in.(${uuidList.join(',')})`, `id.in.(${uuidList.join(',')})`);
      }
      if (nonUuidList.length > 0) {
        orParts.push(`employee_id.in.(${nonUuidList.join(',')})`);
      }
      if (orParts.length > 0) {
        query.or(orParts.join(','));
      }
    } else {
      query.not('avatar_url', 'is', null);
    }

    const { data: profiles } = await query.limit(200);

    if (profiles) {
      for (const p of profiles) {
        const url = (p as any)?.photo_url || (p as any)?.avatar_url;
        if (url) {
          const resolved = await resolveStudentPhotoUrl(url);
          if (resolved) {
            if (p.user_id) coverPhotoCache.set(p.user_id, resolved);
            if (p.id) coverPhotoCache.set(p.id, resolved);
          }
        }
      }
    }

    // Also get enrolled descriptors
    const { data: descriptors } = await supabase
      .from('face_descriptors')
      .select('user_id, image_url')
      .not('image_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(200);

    if (descriptors) {
      for (const d of descriptors) {
        if (d.user_id && !coverPhotoCache.has(d.user_id) && d.image_url) {
          const resolved = await resolveStudentPhotoUrl(d.image_url);
          if (resolved) coverPhotoCache.set(d.user_id, resolved);
        }
      }
    }
  } catch (e) {
    console.warn('Prefetching student cover photos failed:', e);
  }
}
