/**
 * ProgressiveTrainingService
 *
 * Manages the per-student gallery of face descriptors stored in the
 * `face_descriptors` Supabase table.
 *
 * Key fixes vs the previous version:
 *
 * 1. Averaged descriptor is NO LONGER normalised to unit-length.
 *    face-api.js descriptors are compared with raw Euclidean distance;
 *    normalising the average vector changes the scale of the representation
 *    and makes it incomparable to individual descriptors.
 *
 * 2. Outlier rejection when computing the average.
 *    Samples whose distance from the provisional mean exceeds 2× the median
 *    deviation are discarded.  This prevents a single mis-enrolled capture
 *    from pulling the average towards the wrong person.
 *
 * 3. Descriptor length flexibility.
 *    Accepts both 128-dim (face-api.js) and 512-dim (future ArcFace) vectors.
 */

import { supabase } from '@/integrations/supabase/client';
import { descriptorToString, stringToDescriptor } from './ModelService';
import { uploadImage } from './StorageService';
import { uploadAttendanceTrainingImage } from './TrainingDataStorageService';
import { getGalleryScope, isRowInGalleryScope } from './GalleryScopeService';
import { isSaveAttendanceFaceSamplesEnabledSync } from '../attendance/AttendanceSettingsService';

// ─── constants ────────────────────────────────────────────────────────────────

const MAX_SAMPLES_PER_USER = 30;
// Minimum recognition confidence required before a capture is used as training data
const MIN_CONFIDENCE_FOR_TRAINING = 0.80;

// ─── types ────────────────────────────────────────────────────────────────────

interface TrainingSample {
  id: string;
  user_id: string;
  descriptor: string;
  image_url: string | null;
  created_at: string;
  label: string | null;
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Persist a new face sample for a student.
 *
 * Only high-confidence captures are accepted so that mis-recognitions don't
 * corrupt the gallery.
 */
const MIN_DISTINCT_VECTOR_DIST = 0.042;
const MAX_REGISTRATION_POSE_EXEMPLARS = 6;

/**
 * Filter a list of captured descriptors + images to remove outlier frames and
 * near-identical burst duplicates (< 0.042 Euclidean distance).
 */
/**
 * Purge any anomalous or outlier vectors from a student's sample cluster.
 * Strictly discards vectors whose distance to the cluster median exceeds maxAllowedDist (default 0.42).
 * Prevents corrupted or noisy vectors from polluting the student gallery.
 */
export function purgeClusterOutliers(descriptors: Float32Array[], maxAllowedDist = 0.42): Float32Array[] {
  if (descriptors.length <= 2) return descriptors;

  const dim = descriptors[0].length;
  const mean = new Float32Array(dim);
  for (const d of descriptors) {
    for (let i = 0; i < dim; i++) mean[i] += d[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= descriptors.length;

  const dists = descriptors.map(d => euclideanDistance(d, mean));
  const sorted = [...dists].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0.12;
  const cutoff = Math.min(Math.max(median * 2.0, 0.16), maxAllowedDist);

  const clean = descriptors.filter((_, idx) => dists[idx] <= cutoff);
  return clean.length >= 1 ? clean : descriptors.slice(0, 1);
}

export function filterDistinctCaptureSamples(
  descriptors: Float32Array[],
  images: string[] = [],
  maxCount = MAX_REGISTRATION_POSE_EXEMPLARS
): {
  centroid: Float32Array;
  distinctDescriptors: Float32Array[];
  distinctImages: string[];
} {
  const validPairs: { desc: Float32Array; img: string }[] = [];
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i];
    if (d && d.length >= 64) {
      validPairs.push({ desc: d, img: images[i] || images[0] || '' });
    }
  }
  if (validPairs.length === 0) {
    return { centroid: new Float32Array(128), distinctDescriptors: [], distinctImages: [] };
  }

  const centroid = robustAverage(validPairs.map((p) => p.desc));

  // Filter out motion-blur / extreme outliers relative to centroid
  const distsToCentroid = validPairs.map((p) => euclideanDistance(p.desc, centroid));
  const sortedDists = [...distsToCentroid].sort((a, b) => a - b);
  const medianDist = sortedDists[Math.floor(sortedDists.length / 2)] || 0.12;
  const outlierCutoff = Math.min(Math.max(medianDist * 2.0, 0.18), 0.40);

  const inlierPairs = validPairs.filter((_, idx) => distsToCentroid[idx] <= outlierCutoff);
  const pool = inlierPairs.length > 0 ? inlierPairs : validPairs;

  // Deduplicate near-identical consecutive/burst captures (< MIN_DISTINCT_VECTOR_DIST)
  const deduped: { desc: Float32Array; img: string }[] = [];
  for (const candidate of pool) {
    const isDuplicate = deduped.some(
      (existing) => euclideanDistance(existing.desc, candidate.desc) < MIN_DISTINCT_VECTOR_DIST
    );
    if (!isDuplicate) {
      deduped.push(candidate);
    }
  }

  // Ensure at least the closest-to-centroid sample is included
  if (deduped.length === 0) {
    deduped.push(pool[0]);
  }

  // If more than maxCount remain, select the most diverse pose exemplars via farthest-point sampling
  let selected = deduped;
  if (deduped.length > maxCount) {
    selected = [];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < deduped.length; i++) {
      const d = euclideanDistance(deduped[i].desc, centroid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = new Set<number>([bestIdx]);
    selected.push(deduped[bestIdx]);

    while (selected.length < maxCount && chosen.size < deduped.length) {
      let farthestIdx = -1;
      let maxMinDist = -1;
      for (let i = 0; i < deduped.length; i++) {
        if (chosen.has(i)) continue;
        let minDist = Infinity;
        for (const s of selected) {
          const d = euclideanDistance(deduped[i].desc, s.desc);
          if (d < minDist) minDist = d;
        }
        if (minDist > maxMinDist) {
          maxMinDist = minDist;
          farthestIdx = i;
        }
      }
      if (farthestIdx === -1) break;
      chosen.add(farthestIdx);
      selected.push(deduped[farthestIdx]);
    }
  }

  return {
    centroid,
    distinctDescriptors: selected.map((s) => s.desc),
    distinctImages: selected.map((s) => s.img),
  };
}

/**
 * Persist a new face sample for a student with automatic duplicate & outlier protection.
 */
export async function storeFaceSample(
  userId:         string,
  faceDescriptor: Float32Array,
  imageBlob:      Blob | null,
  userName:       string,
  confidence:     number,
  studentContext?: {
    student_id?: string;
    student_name?: string;
    class?: string;
    section?: string;
    category?: string;
  }
): Promise<boolean> {
  try {
    // Attendance-time progressive training is disabled for privacy and pure attendance operations
    if (confidence !== 1.0) {
      return false;
    }

    // 1. Single query to fetch existing samples for this user (replaces 3 separate queries!)
    const { data: existingSamples, error: fetchErr } = await supabase
      .from('face_descriptors')
      .select('id, descriptor, student_id, student_name, class, section, category, image_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (fetchErr) {
      console.error('Error fetching existing samples:', fetchErr);
      return false;
    }

    const existingList = existingSamples || [];
    let minDistanceToExisting = Infinity;

    for (const sample of existingList) {
      if (!sample.descriptor) continue;
      const enrolledVec = parseStoredDescriptor(sample.descriptor);
      if (enrolledVec && enrolledVec.length === faceDescriptor.length) {
        const dist = euclideanDistance(enrolledVec, faceDescriptor);
        if (dist < minDistanceToExisting) minDistanceToExisting = dist;
      }
    }

    // 2. Duplicate Vector Gate: Skip if an identical or near-identical vector is already stored!
    if (minDistanceToExisting < MIN_DISTINCT_VECTOR_DIST) {
      console.log(
        `[ProgressiveTraining] Skipping redundant duplicate sample for ${userId} (dist=${minDistanceToExisting.toFixed(4)} < ${MIN_DISTINCT_VECTOR_DIST})`
      );
      return true;
    }

    // 3. Anti-Contamination Gate: Reject if too far from verified baseline
    if (existingList.length >= 2 && Number.isFinite(minDistanceToExisting) && minDistanceToExisting > 0.44) {
      console.warn(
        `[ProgressiveTraining] Rejecting outlier sample for ${userId}: distance ${minDistanceToExisting.toFixed(3)} > 0.44 from baseline`
      );
      return false;
    }

    // 4. Enforce per-user sample cap (FIFO eviction of oldest beyond MAX_SAMPLES_PER_USER)
    if (existingList.length >= MAX_SAMPLES_PER_USER) {
      const toDelete = existingList.slice(MAX_SAMPLES_PER_USER - 1);
      for (const oldRow of toDelete) {
        await supabase.from('face_descriptors').delete().eq('id', oldRow.id);
      }
    }

    const existingScopeRow: any = existingList[0] || null;
    const resolvedStudentName = studentContext?.student_name || existingScopeRow?.student_name || userName;
    const resolvedStudentId = studentContext?.student_id ?? existingScopeRow?.student_id ?? null;
    const resolvedClass = studentContext?.class ?? existingScopeRow?.class ?? null;
    const resolvedSection = studentContext?.section ?? existingScopeRow?.section ?? null;
    const resolvedCategory = studentContext?.category ?? existingScopeRow?.category ?? null;

    // 5. Upload image only once (never duplicate into attendance-training-faces during registration!)
    let imageUrl: string | null = null;
    if (imageBlob) {
      try {
        const safeKey = String(resolvedStudentId || userId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const slotIdx = (existingList.length % MAX_REGISTRATION_POSE_EXEMPLARS) + 1;
        const fileName = `pose_${slotIdx}.jpg`;
        const file = new File([imageBlob], fileName, { type: 'image/jpeg' });
        imageUrl = await uploadImage(file, `students/${safeKey}/faces/${fileName}`, 'student-registration-faces');

        if (confidence < 1.0) {
          await uploadAttendanceTrainingImage({
            imageBlob,
            studentId: userId,
            status: 'present',
            mode: 'ai-scan',
            confidence,
          });
        }
      } catch (uploadErr) {
        console.error('Training image upload error:', uploadErr);
      }
    }

    if (!imageUrl) {
      if (existingScopeRow?.image_url) {
        imageUrl = existingScopeRow.image_url;
      } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('user_id', userId)
          .maybeSingle();
        if (profile?.avatar_url) {
          imageUrl = profile.avatar_url;
        }
      }
    }

    const { error: insertErr } = await supabase.from('face_descriptors').insert({
      user_id:      userId,
      descriptor:   descriptorToString(faceDescriptor),
      image_url:    imageUrl,
      label:        resolvedStudentName,
      student_name: resolvedStudentName,
      student_id:   resolvedStudentId,
      class:        resolvedClass,
      section:      resolvedSection,
      category:     resolvedCategory,
      metadata:     confidence === 1.0 ? { registration: 'true' } : {},
    });

    if (insertErr) {
      console.error('Error inserting face descriptor:', insertErr);
      return false;
    }

    await syncUserBiometricSummaryToProfile(userId, resolvedStudentId);
    invalidateTrainedDescriptorsCache();
    return true;
  } catch (err) {
    console.error('storeFaceSample error:', err);
    return false;
  }
}

/**
 * Deduplicate and batch-store multi-angle registration descriptors for a student in one clean pass.
 * Prevents duplicate rows, prevents stacking old + new registrations, and avoids redundant image uploads.
 */
export async function storeRegistrationSamplesBatch(params: {
  userId: string;
  studentId?: string | null;
  studentName: string;
  className?: string | null;
  section?: string | null;
  category?: string | null;
  primaryImageUrl?: string | null;
  descriptors: Float32Array[];
  sampleImages?: string[];
  replaceExisting?: boolean;
}): Promise<{ storedCount: number; centroid: Float32Array }> {
  const {
    userId,
    studentId,
    studentName,
    className,
    section,
    category,
    primaryImageUrl,
    descriptors,
    sampleImages = [],
    replaceExisting = true,
  } = params;

  const { centroid, distinctDescriptors, distinctImages } = filterDistinctCaptureSamples(
    descriptors,
    sampleImages,
    MAX_REGISTRATION_POSE_EXEMPLARS
  );

  if (distinctDescriptors.length === 0) {
    return { storedCount: 0, centroid };
  }

  const cleanSid = studentId ? String(studentId).trim() : null;
  const safeStudentKey = String(cleanSid || userId).replace(/[^a-zA-Z0-9_-]/g, '_');

  // 1. If replaceExisting is true, remove old face_descriptors for this student so rows never stack up
  if (replaceExisting) {
    try {
      const orFilter = cleanSid
        ? `user_id.eq.${userId},student_id.eq.${cleanSid}`
        : `user_id.eq.${userId}`;
      await supabase.from('face_descriptors').delete().or(orFilter);
    } catch (delErr) {
      console.warn('[storeRegistrationSamplesBatch] Cleanup notice:', delErr);
    }
  }

  // 2. Upload distinct pose images to deterministic paths (up to 4 extra pose images; reuse primaryImageUrl for slot 0)
  const uploadedUrls: string[] = [];
  for (let i = 0; i < distinctDescriptors.length; i++) {
    if (i === 0 && primaryImageUrl) {
      uploadedUrls.push(primaryImageUrl);
      continue;
    }
    const rawImg = distinctImages[i];
    if (rawImg && rawImg.startsWith('data:image/')) {
      try {
        const res = await fetch(rawImg);
        const blob = await res.blob();
        const fileName = `pose_${i + 1}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        const url = await uploadImage(
          file,
          `students/${safeStudentKey}/faces/${fileName}`,
          'student-registration-faces'
        );
        uploadedUrls.push(url || primaryImageUrl || '');
      } catch {
        uploadedUrls.push(primaryImageUrl || '');
      }
    } else if (rawImg && /^https?:\/\//.test(rawImg)) {
      uploadedUrls.push(rawImg);
    } else {
      uploadedUrls.push(primaryImageUrl || '');
    }
  }

  // 3. Build batch rows: 1 master_centroid row + distinct pose exemplar rows
  const rowsToInsert: Record<string, any>[] = [
    {
      user_id: userId,
      student_id: cleanSid,
      student_name: studentName,
      label: studentName,
      descriptor: descriptorToString(centroid),
      image_url: primaryImageUrl || uploadedUrls[0] || null,
      class: className || null,
      section: section || null,
      category: category || null,
      metadata: {
        registration: 'true',
        pose: 'master_centroid',
        is_primary: true,
        sample_count: distinctDescriptors.length,
        captured_at: new Date().toISOString(),
      },
    },
  ];

  // Add distinct pose vectors (skip if only 1 vector since centroid already equals it)
  if (distinctDescriptors.length > 1) {
    for (let i = 0; i < distinctDescriptors.length; i++) {
      rowsToInsert.push({
        user_id: userId,
        student_id: cleanSid,
        student_name: studentName,
        label: studentName,
        descriptor: descriptorToString(distinctDescriptors[i]),
        image_url: uploadedUrls[i] || primaryImageUrl || null,
        class: className || null,
        section: section || null,
        category: category || null,
        metadata: {
          registration: 'true',
          pose: `angle_${i + 1}`,
          is_primary: false,
          captured_at: new Date().toISOString(),
        },
      });
    }
  }

  const { error: batchErr } = await supabase.from('face_descriptors').insert(rowsToInsert);
  if (batchErr) {
    console.error('[storeRegistrationSamplesBatch] Batch insert error:', batchErr);
  }

  await syncUserBiometricSummaryToProfile(userId, cleanSid);
  invalidateTrainedDescriptorsCache();

  return { storedCount: rowsToInsert.length, centroid };
}

export interface TrainedUserEntry {
  userId?:            string;
  descriptors:        Float32Array[];
  averagedDescriptor: Float32Array;
  userName:           string;
  studentId:          string | null;
  sampleCount:        number;
  avatarUrl?:         string;
  department?:        string;
  position?:          string;
}

const TRAINED_GALLERY_CACHE_TTL_MS = 5 * 60 * 1000;
let trainedGalleryCache: {
  expiresAt: number;
  scopeKey: string;
  data: Map<string, TrainedUserEntry>;
} | null = null;
let trainedGalleryInFlight: Promise<Map<string, TrainedUserEntry>> | null = null;

export function invalidateTrainedDescriptorsCache(): void {
  trainedGalleryCache = null;
  trainedGalleryInFlight = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('presence:descriptors-updated', () => {
    invalidateTrainedDescriptorsCache();
  });
  window.addEventListener('presences:roster-updated', () => {
    invalidateTrainedDescriptorsCache();
  });
  window.addEventListener('presences:enrollment-completed', () => {
    invalidateTrainedDescriptorsCache();
  });
  try {
    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('presences_enrollment_sync');
      bc.onmessage = () => {
        invalidateTrainedDescriptorsCache();
      };
    }
  } catch {}
}

/**
 * Recompute and persist a user's compact biometric_summary (centroid + up to 5 diverse exemplars)
 * directly onto their `profiles.metadata` row so recognition only needs to read 1 row per student.
 */
export async function syncUserBiometricSummaryToProfile(
  userId: string,
  studentId?: string | null
): Promise<void> {
  try {
    const { data: fdRows } = await supabase
      .from('face_descriptors')
      .select('descriptor, metadata')
      .eq('user_id', userId);

    if (!fdRows || fdRows.length === 0) return;

    const vectors: Float32Array[] = [];
    const glassesSet = new Set<'with' | 'without'>();
    for (const r of fdRows) {
      const vec = parseStoredDescriptor(r.descriptor);
      if (vec) vectors.push(vec);
      const meta: any = typeof r.metadata === 'string' ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : r.metadata;
      if (meta && (meta.glasses === 'with' || meta.glasses === 'without')) {
        glassesSet.add(meta.glasses);
      }
    }
    if (vectors.length === 0) return;

    const centroid = robustAverage(vectors);
    const exemplars = selectDiverseExemplars(vectors, centroid, 2);
    const roundVec = (v: Float32Array) => Array.from(v, (n) => Number(n.toFixed(4)));

    let profileRow: any = null;
    const { data: byUid } = await supabase
      .from('profiles')
      .select('id, metadata')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    profileRow = byUid;

    if (!profileRow && studentId) {
      const { data: bySid } = await supabase
        .from('profiles')
        .select('id, metadata')
        .or(`admission_number.eq.${studentId},employee_id.eq.${studentId}`)
        .limit(1)
        .maybeSingle();
      profileRow = bySid;
    }

    if (!profileRow?.id) return;

    let prevMeta: Record<string, any> = {};
    try {
      prevMeta = typeof profileRow.metadata === 'string'
        ? JSON.parse(profileRow.metadata)
        : (profileRow.metadata || {});
    } catch {
      prevMeta = {};
    }

    const updatedMeta = {
      ...prevMeta,
      biometric_summary: {
        version: 1,
        centroid_descriptor: roundVec(centroid),
        exemplar_descriptors: exemplars.map(roundVec),
        sample_count: vectors.length,
        has_glasses_profile: glassesSet.has('with') && glassesSet.has('without'),
        updated_at: new Date().toISOString(),
      },
    };

    await supabase
      .from('profiles')
      .update({ metadata: updatedMeta })
      .eq('id', profileRow.id);
  } catch (err) {
    console.warn('syncUserBiometricSummaryToProfile warning:', err);
  }
}

/**
 * Fetch all face descriptors for a single user.
 */
export async function getUserFaceDescriptors(userId: string): Promise<Float32Array[]> {
  try {
    // Check in-memory gallery cache first
    if (trainedGalleryCache && trainedGalleryCache.expiresAt > Date.now()) {
      const cached = trainedGalleryCache.data.get(userId);
      if (cached && cached.descriptors.length > 0) return cached.descriptors;
    }

    const { data, error } = await supabase
      .from('face_descriptors')
      .select('descriptor')
      .eq('user_id', userId);

    if (error || !data?.length) return [];

    return data
      .map(r => parseStoredDescriptor(r.descriptor))
      .filter((d): d is Float32Array => d !== null);
  } catch (err) {
    console.error('getUserFaceDescriptors error:', err);
    return [];
  }
}

/**
 * Load all students with their descriptor galleries.
 *
 * Optimization #1:
 *   - Uses an in-memory parsed Float32Array cache (5 min TTL) so camera frames
 *     do ZERO JSON parsing or centroid recomputation.
 *   - Reads pre-computed `metadata.biometric_summary` (`centroid_descriptor` +
 *     up to 5 diverse `exemplar_descriptors`) directly from `profiles` (47 rows,
 *     1 single page read) instead of downloading 652 individual `face_descriptors` rows!
 *   - Automatically falls back to `face_descriptors` if `profiles` has no summaries.
 */
export async function getAllTrainedDescriptors(forceFresh = false): Promise<Map<string, TrainedUserEntry>> {
  try {
    const scope = await getGalleryScope();
    const scopeKey = scope.userIds
      ? `scoped:${Array.from(scope.userIds).sort().join(',')}:${scope.categories.join(',')}`
      : 'unrestricted';

    if (
      !forceFresh &&
      trainedGalleryCache &&
      trainedGalleryCache.expiresAt > Date.now() &&
      trainedGalleryCache.scopeKey === scopeKey &&
      trainedGalleryCache.data.size > 0
    ) {
      return trainedGalleryCache.data;
    }

    if (!forceFresh && trainedGalleryInFlight) {
      return trainedGalleryInFlight;
    }

    trainedGalleryInFlight = (async () => {
      try {
        const result = new Map<string, TrainedUserEntry>();

        // Concurrently query:
        // 1. face_descriptors (primary trained vectors)
        // 2. profiles (metadata.biometric_summary, names, photos)
        // 3. attendance_records with status='registered' (legacy and standard registrations)
        const [fdRes, profRes, regRes] = await Promise.all([
          supabase
            .from('face_descriptors')
            .select('user_id, descriptor, label, student_name, student_id, class, section, category, image_url, metadata')
            .limit(5000),
          supabase
            .from('profiles')
            .select('id, user_id, full_name, display_name, admission_number, employee_id, roll_number, class, section, category, department, position, avatar_url, photo_url, metadata')
            .limit(5000),
          supabase
            .from('attendance_records')
            .select('user_id, student_id, student_name, category, class, section, device_info, face_descriptor, image_url')
            .eq('status', 'registered')
            .limit(5000),
        ]);

        const fdRows = (!fdRes.error && fdRes.data) ? (scope.userIds ? fdRes.data.filter((r: any) => isRowInGalleryScope(scope, r)) : fdRes.data) : [];
        const profRows = (!profRes.error && profRes.data) ? (scope.userIds ? profRes.data.filter((p: any) => isRowInGalleryScope(scope, p)) : profRes.data) : [];
        const regRows = (!regRes.error && regRes.data) ? (scope.userIds ? regRes.data.filter((r: any) => isRowInGalleryScope(scope, r)) : regRes.data) : [];

        // Build canonical identity resolver
        const aliasToCanonical = new Map<string, string>();
        const profileInfo = new Map<string, any>();

        // 1. Index profiles
        for (const p of profRows) {
          const uid = String(p.user_id || p.id).trim();
          const sid = String(p.admission_number || p.employee_id || '').trim();
          const name = String(p.full_name || p.display_name || '').trim();
          profileInfo.set(uid, p);
          aliasToCanonical.set(`uid:${uid}`, uid);
          if (sid) {
            aliasToCanonical.set(`sid:${sid}`, uid);
            profileInfo.set(sid, p);
          }
          if (name && name !== 'Unknown') {
            aliasToCanonical.set(`name:${name.toLowerCase().trim()}`, uid);
          }
        }

        const resolveCanonicalKey = (userId?: string | null, studentId?: string | null, name?: string | null) => {
          const u = userId ? String(userId).trim() : '';
          const s = studentId ? String(studentId).trim() : '';
          const n = name && name !== 'Unknown' ? name.toLowerCase().trim() : '';

          let key = (s && aliasToCanonical.get(`sid:${s}`)) ||
                    (u && aliasToCanonical.get(`uid:${u}`)) ||
                    (n && aliasToCanonical.get(`name:${n}`));

          if (!key) {
            key = u || s || n || 'unknown';
            if (u) aliasToCanonical.set(`uid:${u}`, key);
            if (s) aliasToCanonical.set(`sid:${s}`, key);
            if (n) aliasToCanonical.set(`name:${n}`, key);
          } else {
            if (u) aliasToCanonical.set(`uid:${u}`, key);
            if (s) aliasToCanonical.set(`sid:${s}`, key);
            if (n) aliasToCanonical.set(`name:${n}`, key);
          }
          return key;
        };

        const grouped = new Map<string, {
          descriptors: Float32Array[];
          userName: string;
          studentId: string | null;
          avatarUrl: string;
          department: string;
          position: string;
        }>();

        const ensureGroup = (canonicalKey: string) => {
          if (!grouped.has(canonicalKey)) {
            const p = profileInfo.get(canonicalKey);
            const rawMeta = p?.metadata;
            let meta: any = rawMeta;
            if (typeof rawMeta === 'string') {
              try { meta = JSON.parse(rawMeta); } catch { meta = null; }
            }
            const name = String(p?.full_name || p?.display_name || meta?.name || 'Unknown').trim();
            const sid = String(p?.admission_number || p?.employee_id || meta?.student_id || '').trim() || null;
            const dept = String(p?.category || (p?.class && p?.section ? `${p.class}-${p.section}` : p?.department || meta?.department || 'Unknown')).trim();
            const pos = String(p?.roll_number || p?.position || meta?.roll_number || 'Student').trim();
            const avatarUrl = String(p?.avatar_url || p?.photo_url || meta?.avatar_url || '').trim();

            grouped.set(canonicalKey, {
              descriptors: [],
              userName: name,
              studentId: sid,
              avatarUrl,
              department: dept,
              position: pos,
            });
          }
          return grouped.get(canonicalKey)!;
        };

        // 2. Load from profiles metadata.biometric_summary
        for (const p of profRows) {
          let meta: any = p.metadata;
          if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch { meta = null; }
          }
          const bio = meta?.biometric_summary;
          if (bio?.centroid_descriptor) {
            const centroid = parseStoredDescriptor(bio.centroid_descriptor);
            if (centroid) {
              const uid = String(p.user_id || p.id).trim();
              const sid = String(p.admission_number || p.employee_id || meta?.student_id || '').trim() || null;
              const name = String(p.full_name || p.display_name || meta?.name || '').trim();
              const key = resolveCanonicalKey(uid, sid, name);
              const g = ensureGroup(key);
              g.descriptors.push(centroid);
              if (Array.isArray(bio.exemplar_descriptors)) {
                for (const ex of bio.exemplar_descriptors) {
                  const d = parseStoredDescriptor(ex);
                  if (d && d.length === centroid.length) g.descriptors.push(d);
                }
              }
            }
          }
        }

        // 3. Load from face_descriptors table
        for (const rec of fdRows) {
          const desc = parseStoredDescriptor((rec as any).descriptor);
          if (!desc) continue;
          const sid = (rec as any).student_id ? String((rec as any).student_id).trim() : null;
          const name = String((rec as any).student_name || (rec as any).label || (rec as any).metadata?.name || '').trim();
          const uid = (rec as any).user_id ? String((rec as any).user_id).trim() : null;
          const key = resolveCanonicalKey(uid, sid, name);
          const g = ensureGroup(key);
          g.descriptors.push(desc);
          if (g.userName === 'Unknown' && name && name !== 'Unknown') g.userName = name;
          if (!g.studentId && sid) g.studentId = sid;
          if (!g.avatarUrl && (rec as any).image_url) g.avatarUrl = (rec as any).image_url;
          if ((!g.department || g.department === 'Unknown') && (rec as any).category) {
            g.department = (rec as any).category;
          }
        }

        // 4. Load from attendance_records table (status='registered')
        for (const rec of regRows) {
          const rawDesc = (rec as any).face_descriptor ||
                          (rec as any).device_info?.metadata?.faceDescriptor ||
                          (rec as any).device_info?.faceDescriptor;
          const desc = parseStoredDescriptor(rawDesc);
          if (!desc) continue;

          const sid = (rec as any).student_id || (rec as any).device_info?.metadata?.employee_id || null;
          const name = String((rec as any).student_name || (rec as any).device_info?.metadata?.name || '').trim();
          const uid = (rec as any).user_id ? String((rec as any).user_id).trim() : null;
          const key = resolveCanonicalKey(uid, sid, name);
          const g = ensureGroup(key);
          g.descriptors.push(desc);
          if (g.userName === 'Unknown' && name && name !== 'Unknown') g.userName = name;
          if (!g.studentId && sid) g.studentId = sid;
          if (!g.avatarUrl && (rec as any).image_url) g.avatarUrl = (rec as any).image_url;
          if ((!g.department || g.department === 'Unknown') && (rec as any).category) {
            g.department = (rec as any).category;
          }
        }

        // 5. Build centroids and diverse exemplars for every registered person
        for (const [key, { descriptors, userName, studentId, avatarUrl, department, position }] of grouped) {
          if (descriptors.length === 0) continue;

          const dimGroups = new Map<number, Float32Array[]>();
          for (const d of descriptors) {
            const group = dimGroups.get(d.length) ?? [];
            group.push(d);
            dimGroups.set(d.length, group);
          }
          let dominantGroup: Float32Array[] = [];
          for (const [, group] of dimGroups) {
            if (group.length > dominantGroup.length) dominantGroup = group;
          }
          if (dominantGroup.length === 0) continue;

          // Autonomous runtime firewall: purge any outlier vectors before computing gallery representations
          const sanitizedGroup = purgeClusterOutliers(dominantGroup, 0.42);
          if (sanitizedGroup.length === 0) continue;

          const averaged = robustAverage(sanitizedGroup);
          const exemplars = selectDiverseExemplars(sanitizedGroup, averaged, 6);

          const entry: TrainedUserEntry = {
            userId: key,
            descriptors: exemplars,
            averagedDescriptor: averaged,
            userName,
            studentId: studentId ?? null,
            sampleCount: dominantGroup.length,
            avatarUrl,
            department: department || 'Unknown',
            position: position || 'Student',
          };

          // Store under primary canonical key
          result.set(key, entry);
        }

        trainedGalleryCache = {
          expiresAt: Date.now() + TRAINED_GALLERY_CACHE_TTL_MS,
          scopeKey,
          data: result,
        };
        console.log(`[UnifiedGallery] Loaded ${result.size} enrolled student entries across face_descriptors, profiles, and attendance_records`);
        return result;
      } finally {
        trainedGalleryInFlight = null;
      }
    })();

    return trainedGalleryInFlight;
  } catch (err) {
    console.error('getAllTrainedDescriptors error:', err);
    return new Map();
  }
}

// ─── matching helper (used by DescriptorCacheService) ────────────────────────

/**
 * Compute the best Euclidean distance from inputDescriptor to a user's gallery.
 *
 * Compares against the averaged descriptor AND every individual sample, returning
 * the minimum.  Does NOT mix in cosine distance — face-api.js vectors must be
 * compared with raw Euclidean only.
 */
export function calculateBestMatchDistance(
  inputDescriptor:    Float32Array,
  userDescriptors:    Float32Array[],
  averagedDescriptor: Float32Array
): number {
  let best = euclideanDistance(inputDescriptor, averagedDescriptor);
  for (const d of userDescriptors) {
    const dist = euclideanDistance(inputDescriptor, d);
    if (dist < best) best = dist;
  }
  return best;
}

// ─── training statistics ─────────────────────────────────────────────────────

export async function getUserTrainingStats(userId: string): Promise<{
  sampleCount:   number;
  oldestSample:  Date | null;
  newestSample:  Date | null;
  trainingLevel: 'none' | 'basic' | 'moderate' | 'good' | 'excellent';
  /** True only when both a with-glasses and a without-glasses sample exist. */
  hasGlassesProfile: boolean;
}> {
  try {
    // Fast path from cached profiles biometric_summary
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('metadata, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileRow?.metadata) {
      const meta: any = typeof profileRow.metadata === 'string'
        ? (() => { try { return JSON.parse(profileRow.metadata); } catch { return null; } })()
        : profileRow.metadata;
      const bio = meta?.biometric_summary;
      if (bio && typeof bio.sample_count === 'number' && bio.sample_count > 0) {
        const n = bio.sample_count;
        const ts = bio.updated_at || profileRow.updated_at || profileRow.created_at || new Date().toISOString();
        return {
          sampleCount: n,
          oldestSample: new Date(profileRow.created_at || ts),
          newestSample: new Date(ts),
          trainingLevel: n === 0 ? 'none' : n < 3 ? 'basic' : n < 5 ? 'moderate' : n < 8 ? 'good' : 'excellent',
          hasGlassesProfile: Boolean(bio.has_glasses_profile),
        };
      }
    }

    const { data, error } = await supabase
      .from('face_descriptors')
      .select('created_at, metadata')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error || !data?.length) {
      return { sampleCount: 0, oldestSample: null, newestSample: null, trainingLevel: 'none', hasGlassesProfile: false };
    }

    const n = data.length;
    const glassesStates = new Set<'with' | 'without'>();
    for (const row of data) {
      const meta: unknown = row.metadata;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
      const glasses = (meta as { glasses?: unknown }).glasses;
      if (glasses === 'with' || glasses === 'without') glassesStates.add(glasses);
    }
    return {
      sampleCount:  n,
      oldestSample: new Date(data[0].created_at),
      newestSample: new Date(data[n - 1].created_at),
      trainingLevel: n === 0 ? 'none' : n < 3 ? 'basic' : n < 5 ? 'moderate' : n < 8 ? 'good' : 'excellent',
      hasGlassesProfile: glassesStates.has('with') && glassesStates.has('without'),
    };
  } catch (err) {
    console.error('getUserTrainingStats error:', err);
    return { sampleCount: 0, oldestSample: null, newestSample: null, trainingLevel: 'none', hasGlassesProfile: false };
  }
}

export async function getTrainingStats(): Promise<{
  totalSamples:          number;
  usersWithSamples:      number;
  averageSamplesPerUser: number;
}> {
  try {
    const gallery = await getAllTrainedDescriptors();
    if (gallery.size > 0) {
      let totalSamples = 0;
      for (const entry of gallery.values()) {
        totalSamples += entry.sampleCount;
      }
      const usersWithSamples = gallery.size;
      return {
        totalSamples,
        usersWithSamples,
        averageSamplesPerUser: totalSamples / usersWithSamples,
      };
    }

    const { data, error } = await supabase.from('face_descriptors').select('user_id');
    if (error || !data) return { totalSamples: 0, usersWithSamples: 0, averageSamplesPerUser: 0 };

    const userCounts = new Map<string, number>();
    data.forEach(r => userCounts.set(r.user_id, (userCounts.get(r.user_id) || 0) + 1));

    const usersWithSamples = userCounts.size;
    const totalSamples     = data.length;
    return {
      totalSamples,
      usersWithSamples,
      averageSamplesPerUser: usersWithSamples > 0 ? totalSamples / usersWithSamples : 0,
    };
  } catch (err) {
    console.error('getTrainingStats error:', err);
    return { totalSamples: 0, usersWithSamples: 0, averageSamplesPerUser: 0 };
  }
}

export async function getUsersWithTrainingSamples(): Promise<Array<{ userId: string; sampleCount: number }>> {
  try {
    const gallery = await getAllTrainedDescriptors();
    if (gallery.size > 0) {
      return Array.from(gallery.entries()).map(([userId, entry]) => ({
        userId,
        sampleCount: entry.sampleCount,
      }));
    }

    const { data, error } = await supabase.from('face_descriptors').select('user_id');
    if (error || !data) return [];

    const counts = new Map<string, number>();
    data.forEach(r => counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1));
    return Array.from(counts.entries()).map(([userId, sampleCount]) => ({ userId, sampleCount }));
  } catch (err) {
    console.error('getUsersWithTrainingSamples error:', err);
    return [];
  }
}

// ─── internal maths ──────────────────────────────────────────────────────────

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

/**
 * Compute a robust average of a descriptor gallery.
 *
 * Algorithm:
 *   1. Compute simple mean.
 *   2. Compute each sample's distance from the mean.
 *   3. Discard samples whose distance is > 2× the median deviation.
 *   4. Re-compute mean from the surviving samples.
 *
 * IMPORTANT: The result is NOT normalised to unit length.  face-api.js
 * descriptors are NOT L2-normalised; normalising the average would change
 * the scale and break Euclidean comparisons.
 */
function robustAverage(descriptors: Float32Array[]): Float32Array {
  if (descriptors.length === 0) return new Float32Array(128);
  if (descriptors.length === 1) return descriptors[0];

  const dim = descriptors[0].length;

  // Step 1: simple mean
  const mean = new Float32Array(dim);
  for (const d of descriptors) {
    for (let i = 0; i < dim; i++) mean[i] += d[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= descriptors.length;

  if (descriptors.length <= 3) return mean; // Not enough samples for outlier detection

  // Step 2: distances from mean
  const dists = descriptors.map(d => euclideanDistance(d, mean));

  // Step 3: median deviation
  const sorted   = [...dists].sort((a, b) => a - b);
  const median   = sorted[Math.floor(sorted.length / 2)] || 0.10;
  const cutoff   = Math.min(Math.max(median * 2.0, 0.12), 0.40);

  // Step 4: filter outliers and re-average
  const inliers  = descriptors.filter((_, i) => dists[i] <= cutoff);
  if (inliers.length === 0) return mean; // All outliers? Return simple mean.

  const robust = new Float32Array(dim);
  for (const d of inliers) {
    for (let i = 0; i < dim; i++) robust[i] += d[i];
  }
  for (let i = 0; i < dim; i++) robust[i] /= inliers.length;

  return robust;
}

function selectDiverseExemplars(
  descriptors: Float32Array[],
  centroid: Float32Array,
  maxExemplars = 5
): Float32Array[] {
  if (descriptors.length <= maxExemplars) return descriptors;

  // Filter out outliers relative to centroid
  const dists = descriptors.map(d => euclideanDistance(d, centroid));
  const sorted = [...dists].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0.10;
  const cutoff = Math.min(Math.max(median * 2.0, 0.08), 0.40);
  const inliers = descriptors.filter((_, idx) => dists[idx] <= cutoff);
  const pool = inliers.length > 0 ? inliers : descriptors;

  if (pool.length <= maxExemplars) return pool;

  const exemplars: Float32Array[] = [];
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const d = euclideanDistance(pool[i], centroid);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const chosen = new Set<number>([bestIdx]);
  exemplars.push(pool[bestIdx]);

  while (exemplars.length < maxExemplars && chosen.size < pool.length) {
    let farthestIdx = -1;
    let maxMinDist = -1;
    for (let i = 0; i < pool.length; i++) {
      if (chosen.has(i)) continue;
      let minDist = Infinity;
      for (const ex of exemplars) {
        const d = euclideanDistance(pool[i], ex);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        farthestIdx = i;
      }
    }
    if (farthestIdx === -1 || maxMinDist < 0.025) break;
    chosen.add(farthestIdx);
    exemplars.push(pool[farthestIdx]);
  }

  return exemplars;
}

function parseStoredDescriptor(raw: unknown): Float32Array | null {
  try {
    if (!raw) return null;
    if (raw instanceof Float32Array) return raw;
    if (typeof raw === 'string') return stringToDescriptor(raw);
    if (Array.isArray(raw)) {
      const a = new Float32Array(raw as number[]);
      return a.length >= 64 ? a : null;
    }
    if (typeof raw === 'object') {
      const keys = Object.keys(raw as object);
      if (keys.length >= 64) {
        const vals = new Float32Array(keys.length);
        for (let i = 0; i < keys.length; i++) vals[i] = Number((raw as any)[i] ?? 0);
        return vals;
      }
    }
    return null;
  } catch {
    return null;
  }
}
