/**
 * RealtimeRecognitionEngine
 *
 * Restored 3-thread architecture (from commit 39bc521) with temporal hold
 * verification and session-level deduplication.
 *
 *  1. Thread 1 (Capture loop)  — rAF at display rate, only gates detection.
 *  2. Thread 2 (detectPass)    — Throttled TinyFaceDetector on a downscaled
 *     frame. NO landmarks or descriptors extracted here. Updates the IoU
 *     tracker and queues only NEW / unverified faces for recognition.
 *  3. Thread 3 (pumpQueue → recognizeTrack) — Bounded concurrency (default 2
 *     jobs). Each job crops at FULL resolution with 28% padding into a
 *     dedicated canvas, runs SSD+landmarks+descriptor on the crop, then
 *     matches with strict thresholds (0.41 default, 0.80 ambiguity ratio).
 *     Temporal hold verification requires the same identity to be confirmed
 *     across multiple recognition passes (≥ requiredHoldMs wall-clock time)
 *     before firing attendance callbacks.
 *
 * Key accuracy guarantees vs the previous single-pass architecture:
 *  • Detection runs separately from recognition — no descriptor extraction on
 *    every frame, so a momentary bad angle never triggers a false match.
 *  • Each face is recognised individually on a high-quality full-res crop,
 *    not on a shared downscaled detection frame.
 *  • Bounded concurrency prevents pixel bleed between concurrent recognition
 *    jobs (each gets its own canvas).
 *  • Temporal hold ensures transient matches (motion blur, odd angle) are
 *    never acted upon — only stable, consistent identities fire callbacks.
 */

import * as faceapi from 'face-api.js';
import { loadModels, areModelsLoaded } from './ModelService';
import { loadNet } from './NetLoaderService';
import { getAllTrainedDescriptors } from './ProgressiveTrainingService';
import { buildVectorIndex, searchVectorIndex, getVectorIndexStats } from './VectorIndexService';
import { createFaceTracker, type FaceTrack, type Box } from './FaceTrackerService';
import { initializeWorkerPool, matchDescriptorParallel, isPoolInitialized } from './WorkerPoolService';
import { initializeGPU } from './GPUAccelerationService';
import { embedFaceOnnx, initializeOnnxEmbedder, isOnnxEmbedderReady } from './OnnxEmbeddingService';
import { recordAttendance } from './RecognitionService';
import { estimateYaw, estimatePitch } from './FaceQualityGate';

export interface EngineOptions {
  /** Recognition/detection passes per second (camera preview stays full fps) */
  detectFps?: number;
  /** Max width of the downscaled detection frame */
  detectionWidth?: number;
  /** TinyFaceDetector input dimension (e.g. 320 for sub-50ms instant detection) */
  inputSize?: number;
  /** Euclidean match threshold (face-api descriptors) */
  matchThreshold?: number;
  /** Candidates pulled from the vector index before exact re-scoring */
  shortlist?: number;
  /** Concurrent embedding jobs */
  maxConcurrentJobs?: number;
  /** How long a track keeps its identity before re-verifying (ms) */
  identityTtlMs?: number;
  /** Detection passes a track may be missing before it is dropped */
  maxMissed?: number;
  /** Required continuous hold duration before confirming identity (ms) */
  requiredHoldMs?: number;
  /** Called on every detection pass with the current tracks */
  onTracks?: (tracks: FaceTrack[]) => void;
  /** Called once per newly identified person */
  onIdentified?: (result: IdentifiedFace) => void;
  /**
   * Optional persistence handler. When provided the engine calls it once per
   * verified person; the camera loop never waits for the network.
   */
  markAttendance?: (result: IdentifiedFace) => Promise<void>;
  /** Called with latency/throughput telemetry */
  onStats?: (stats: EngineStats) => void;
}

export interface IdentifiedFace {
  trackId: number;
  userId: string;
  name: string;
  confidence: number;
  distance: number;
  box: Box;
  descriptor: Float32Array;
}

export interface EngineStats {
  detectFps: number;
  detectMs: number;
  embedMs: number;
  matchMs: number;
  tracked: number;
  identified: number;
  galleryPeople: number;
  indexedVectors: number;
  queueDepth: number;
  skippedFrames: number;
}

type GalleryEntry = {
  descriptors: Float32Array[];
  averagedDescriptor: Float32Array;
  userName: string;
  sampleCount: number;
  studentId?: string;
  userId?: string;
};

let gallery: Map<string, GalleryEntry> = new Map();
let galleryLoadedAt = 0;
const GALLERY_TTL_MS = 120_000;

// Reusable canvas pool to eliminate memory allocation churn & GC latency
const cropCanvasPool: HTMLCanvasElement[] = [];

function acquireCropCanvas(): HTMLCanvasElement {
  if (cropCanvasPool.length > 0) {
    return cropCanvasPool.pop()!;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 224;
  return canvas;
}

function releaseCropCanvas(canvas: HTMLCanvasElement) {
  if (cropCanvasPool.length < 8) {
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    cropCanvasPool.push(canvas);
  }
}

/** Load the gallery and (re)build the vector index. Safe to call repeatedly. */
export async function ensureGalleryIndex(force = false): Promise<void> {
  if (!force && gallery.size > 0 && Date.now() - galleryLoadedAt < GALLERY_TTL_MS) return;

  const trained = (await getAllTrainedDescriptors()) as unknown as Map<string, GalleryEntry>;
  gallery = trained;
  galleryLoadedAt = Date.now();

  const vectors: Array<{ ownerId: string; vector: Float32Array }> = [];
  let samples = 0;
  for (const [userId, entry] of trained) {
    vectors.push({ ownerId: userId, vector: entry.averagedDescriptor });
    for (const d of entry.descriptors) {
      vectors.push({ ownerId: userId, vector: d });
      samples++;
    }
  }
  buildVectorIndex(vectors, `${trained.size}:${samples}:${galleryLoadedAt > 0 ? 'v1' : 'v0'}`);
}

function euclidean(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function distanceToConfidence(distance: number, threshold: number): number {
  const x = (threshold - distance) / 0.12;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Match a descriptor against the gallery using pure minimum sample distance
 * (restored from commit 39bc521).
 *
 * For each registered student the minimum Euclidean distance across all stored
 * samples AND the averaged centroid is computed. The closest student below
 * `matchThreshold` wins, subject to a strict ambiguity guard: if the ratio
 * best/second > 0.80 for a different student, the match is rejected.
 */
export async function matchDescriptorIndexed(
  descriptor: Float32Array,
  matchThreshold = 0.41,
  shortlist = 64,
): Promise<{ userId: string; name: string; distance: number; confidence: number } | null> {
  await ensureGalleryIndex();
  if (gallery.size === 0) return null;

  // Exact re-scoring over all registered students
  const ranked: Array<{ userId: string; name: string; distance: number }> = [];
  for (const [userId, entry] of gallery.entries()) {
    if (!entry) continue;
    // Pure minimum distance: best of centroid and every individual sample
    let best = euclidean(descriptor, entry.averagedDescriptor);
    for (const d of entry.descriptors) {
      if (d.length !== descriptor.length) continue;
      const dist = euclidean(descriptor, d);
      if (dist < best) best = dist;
    }
    if (!Number.isFinite(best)) continue;
    const finalUserId = (entry as any).userId || userId;
    ranked.push({ userId: finalUserId, name: entry.userName, distance: best });
  }

  ranked.sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best || best.distance > matchThreshold) return null;

  // Strict Ambiguity Guard (39bc521):
  // If best/second ratio > 0.80 for a DIFFERENT student, reject to prevent
  // look-alike false-positive confusion.
  const second = ranked.find(
    r =>
      r.userId !== best.userId &&
      r.name.trim().toLowerCase() !== best.name.trim().toLowerCase(),
  );
  if (second && best.distance / second.distance > 0.80) {
    console.log(
      `Rejecting ambiguous match: best=${best.name} (${best.distance.toFixed(3)}) ` +
        `vs second=${second.name} (${second.distance.toFixed(3)})`,
    );
    return null;
  }

  return {
    userId: best.userId,
    name: best.name,
    distance: best.distance,
    confidence: distanceToConfidence(best.distance, matchThreshold),
  };
}

// ─── engine ──────────────────────────────────────────────────────────────────

export interface RecognitionEngine {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  getTracks: () => FaceTrack[];
  refreshGallery: () => Promise<void>;
  getStats: () => EngineStats;
}

export function createRecognitionEngine(
  getVideo: () => HTMLVideoElement | null,
  options: EngineOptions = {},
): RecognitionEngine {
  const detectFps = options.detectFps ?? 12;
  const detectionWidth = options.detectionWidth ?? 480;
  const matchThreshold = options.matchThreshold ?? 0.41;
  const shortlist = options.shortlist ?? 16;
  const maxConcurrentJobs = options.maxConcurrentJobs ?? 2;
  const baseRequiredHoldMs = options.requiredHoldMs ?? 400;

  const tracker = createFaceTracker({
    identityTtlMs: options.identityTtlMs ?? 3500,
    maxMissed: options.maxMissed ?? 4,
  });
  const detectCanvas = document.createElement('canvas');

  let running = false;
  let rafId: number | null = null;
  let detecting = false;
  let lastDetectAt = 0;
  let activeJobs = 0;
  let queue: number[] = [];
  /** trackId → userId that was last handed to markAttendance for that track */
  const markedByTrack = new Map<number, string>();
  /** Session-wide set of marked userIds and names to prevent cross-track duplicates */
  const markedIdentities = new Set<string>();

  const stats: EngineStats = {
    detectFps: 0,
    detectMs: 0,
    embedMs: 0,
    matchMs: 0,
    tracked: 0,
    identified: 0,
    galleryPeople: 0,
    indexedVectors: 0,
    queueDepth: 0,
    skippedFrames: 0,
  };

  function publishStats() {
    const idx = getVectorIndexStats();
    stats.galleryPeople = gallery.size;
    stats.indexedVectors = idx.vectors;
    stats.queueDepth = queue.length + activeJobs;
    options.onStats?.({ ...stats });
  }

  // ─── Thread 2: FAST detection only ─────────────────────────────────────────
  // Runs TinyFaceDetector on a downscaled frame. NO landmarks, NO descriptors.
  // Updates the IoU tracker and queues NEW / unverified faces for recognition.
  async function detectPass(video: HTMLVideoElement) {
    const t0 = performance.now();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, detectionWidth / vw);
    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);
    if (detectCanvas.width !== targetW || detectCanvas.height !== targetH) {
      detectCanvas.width = targetW;
      detectCanvas.height = targetH;
    }
    const ctx = detectCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, targetW, targetH);

    const detections = await faceapi.detectAllFaces(
      detectCanvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }),
    );

    // Map small-frame boxes back to full-resolution coordinates
    const boxes: Box[] = detections.map(d => ({
      x: d.box.x / scale,
      y: d.box.y / scale,
      width: d.box.width / scale,
      height: d.box.height / scale,
    }));

    const tracks = tracker.update(boxes);
    stats.detectMs = performance.now() - t0;
    stats.tracked = tracks.length;
    stats.identified = markedByTrack.size;

    // Prune bookkeeping for tracks that no longer exist
    if (markedByTrack.size > 0) {
      const live = new Set(tracks.map(t => t.id));
      for (const id of markedByTrack.keys()) if (!live.has(id)) markedByTrack.delete(id);
    }

    // Surface freshly-seen tracks so overlay boxes are always up-to-date
    options.onTracks?.(tracks.filter(t => t.missed === 0));

    // Queue only NEW / unverified faces for recognition
    for (const t of tracker.pendingRecognition()) {
      if (!queue.includes(t.id)) queue.push(t.id);
    }
    void pumpQueue(video);
    publishStats();
  }

  // ─── Thread 3: bounded concurrency recognition ────────────────────────────
  async function pumpQueue(video: HTMLVideoElement) {
    while (activeJobs < maxConcurrentJobs && queue.length > 0) {
      const trackId = queue.shift()!;
      const track = tracker.getTracks().find(t => t.id === trackId);
      // Skip tracks that are already fully verified AND marked
      if (!track || (track.identity?.verified && markedByTrack.has(track.id))) continue;
      activeJobs++;
      tracker.markPending(trackId, true);
      void recognizeTrack(video, track).finally(() => {
        activeJobs--;
        tracker.markPending(trackId, false);
        // Keep draining immediately when a recognition slot becomes free
        if (running && queue.length > 0) void pumpQueue(video);
      });
    }
  }

  // ─── Per-track recognition: full-res crop → embed → match → hold ──────────
  async function recognizeTrack(video: HTMLVideoElement, track: FaceTrack) {
    try {
      // ── 1. Full-resolution padded crop ──────────────────────────────────
      const pad = 0.28;
      const sx = Math.max(0, track.box.x - track.box.width * pad);
      const sy = Math.max(0, track.box.y - track.box.height * pad);
      const sw = Math.min(video.videoWidth - sx, track.box.width * (1 + pad * 2));
      const sh = Math.min(video.videoHeight - sy, track.box.height * (1 + pad * 2));
      if (sw < 40 || sh < 40) {
        tracker.assignIdentity(track.id, null);
        return;
      }

      // Each concurrent recognition job gets its own crop canvas to prevent
      // pixel bleed between faces (critical fix from 39bc521).
      const cropCanvas = acquireCropCanvas();
      const cctx = cropCanvas.getContext('2d');
      if (!cctx) {
        releaseCropCanvas(cropCanvas);
        return;
      }
      cctx.drawImage(video, sx, sy, sw, sh, 0, 0, 224, 224);

      // ── 2. Extract embedding ───────────────────────────────────────────
      const tEmbed = performance.now();

      // Fast path: InsightFace/ArcFace via ONNX Runtime (WebGPU/WASM-SIMD).
      // Only used when the gallery itself is 512-dim ArcFace.
      let onnxEmbedding: Float32Array | null = null;
      if (getVectorIndexStats().dimension === 512 && isOnnxEmbedderReady()) {
        onnxEmbedding = await embedFaceOnnx(cropCanvas);
      }

      const det = onnxEmbedding
        ? ({ descriptor: onnxEmbedding, landmarks: null } as {
            descriptor: Float32Array;
            landmarks: any;
          })
        : await faceapi
            .detectSingleFace(
              cropCanvas,
              new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }),
            )
            .withFaceLandmarks()
            .withFaceDescriptor();
      stats.embedMs = performance.now() - tEmbed;

      releaseCropCanvas(cropCanvas);

      if (!det) {
        tracker.assignIdentity(track.id, null);
        return;
      }

      // ── 3. Quality gate: reject extreme head poses ─────────────────────
      if (det.landmarks?.positions) {
        const yaw = estimateYaw(det.landmarks.positions);
        const pitch = estimatePitch(det.landmarks.positions);
        if (Math.abs(yaw) > 28 || Math.abs(pitch) > 22) {
          // Bad angle — don't count as failure, just skip this pass
          if (track.candidate && Date.now() - track.candidate.lastMatchedAt > 350) {
            track.candidate = null;
            track.holdingProgress = 0;
          }
          return;
        }
      }

      // ── 4. Match against gallery ───────────────────────────────────────
      const tMatch = performance.now();
      let match = await matchDescriptorIndexed(det.descriptor, matchThreshold, shortlist);

      // Worker pool fallback when the indexed match misses
      if (!match && isPoolInitialized()) {
        const registered = Array.from(gallery.entries()).map(([id, e]) => ({
          id,
          name: e.userName,
          descriptor: Array.from(e.averagedDescriptor),
        }));
        const parallel = await matchDescriptorParallel(
          det.descriptor,
          registered,
          matchThreshold,
        );
        if (parallel?.match) {
          match = {
            userId: parallel.match.id,
            name: parallel.match.name,
            distance: parallel.distance,
            confidence: parallel.confidence,
          };
        }
      }
      stats.matchMs = performance.now() - tMatch;

      const now = Date.now();

      // ── 5. No match: reset candidate after grace period ────────────────
      if (!match) {
        if (track.candidate && now - track.candidate.lastMatchedAt > 350) {
          track.candidate = null;
          track.holdingProgress = 0;
          tracker.assignIdentity(track.id, null);
        }
        publishStats();
        return;
      }

      // ── 6. Temporal Hold Verification ──────────────────────────────────
      const prevCand = track.candidate;
      const isSamePerson = prevCand && prevCand.userId === match.userId;

      if (isSamePerson) {
        // Same candidate matched again — extend hold streak
        track.candidate!.lastMatchedAt = now;
        track.candidate!.continuousHoldMs = now - track.candidate!.firstMatchedAt;
        track.candidate!.matchCount = (track.candidate!.matchCount || 1) + 1;
        track.candidate!.confidence = Math.max(track.candidate!.confidence, match.confidence);
        track.candidate!.distance = Math.min(track.candidate!.distance, match.distance);
      } else {
        // New or different candidate — start fresh hold
        track.candidate = {
          userId: match.userId,
          name: match.name,
          confidence: match.confidence,
          distance: match.distance,
          firstMatchedAt: now,
          lastMatchedAt: now,
          continuousHoldMs: 0,
          matchCount: 1,
        };
      }

      // Adaptive hold duration based on biometric certainty:
      // High-certainty match (distance <= 0.36) needs only ~280ms.
      // Standard match (0.36 < distance <= 0.41) requires ~380ms.
      // Both strictly require at least 2 consecutive matching frames to prevent any transient fluke.
      const isHighCertainty = match.distance <= 0.36;
      const targetHoldMs = isHighCertainty ? 280 : Math.max(350, baseRequiredHoldMs);
      const holdingProgress = Math.min(1.0, track.candidate!.continuousHoldMs / targetHoldMs);
      track.holdingProgress = holdingProgress;

      const holdComplete =
        track.candidate!.continuousHoldMs >= targetHoldMs &&
        (track.candidate!.matchCount ?? 0) >= 2;

      // Show identity in HUD immediately (verified flag gates attendance)
      tracker.assignIdentity(track.id, {
        userId: match.userId,
        name: match.name,
        confidence: track.candidate!.confidence,
        recognizedAt: now,
        verified: holdComplete,
      });

      if (!holdComplete) {
        // Fast-track the next verification pass without waiting for detection decimation
        if (running && !queue.includes(track.id)) {
          queue.push(track.id);
          setTimeout(() => {
            if (running && queue.length > 0) void pumpQueue(video);
          }, 30);
        }
        publishStats();
        return;
      }

      // ── 7. VERIFIED — fire attendance (once per person per session) ────
      track.holdingProgress = 1.0;

      const normName = match.name.toLowerCase().trim();
      const isAlreadyMarkedInSession =
        markedIdentities.has(`uid:${match.userId}`) ||
        (normName !== 'unknown' && markedIdentities.has(`name:${normName}`));

      if (!isAlreadyMarkedInSession && !markedByTrack.has(track.id)) {
        markedByTrack.set(track.id, match.userId);
        markedIdentities.add(`uid:${match.userId}`);
        if (normName !== 'unknown') {
          markedIdentities.add(`name:${normName}`);
        }

        const identified: IdentifiedFace = {
          trackId: track.id,
          userId: match.userId,
          name: match.name,
          confidence: track.candidate!.confidence,
          distance: track.candidate!.distance,
          box: track.box,
          descriptor: det.descriptor,
        };

        options.onIdentified?.(identified);

        if (options.markAttendance) {
          options.markAttendance(identified).catch(err => {
            console.error('[RealtimeEngine] markAttendance handler error:', err);
          });
        } else {
          // Fallback: direct cloud write when no handler is provided
          recordAttendance(
            match.userId,
            'present',
            track.candidate!.confidence,
            {
              metadata: {
                name: match.name,
                source: 'realtime-engine',
                trackId: track.id,
                matchDistance: track.candidate!.distance,
              },
            },
            undefined,
            'ai-scan',
          ).catch(err => {
            console.error('[RealtimeEngine] Direct cloud attendance write failed:', err);
          });
        }
      }

      publishStats();
    } catch (err) {
      console.warn('recognizeTrack failed:', err);
      tracker.assignIdentity(track.id, null);
    }
  }

  // ─── Thread 1: capture loop — runs at display rate, only gates detection ───
  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);

    const video = getVideo();
    if (!video || video.readyState < 2) return;

    const now = performance.now();
    const interval = 1000 / detectFps;
    if (detecting || now - lastDetectAt < interval) {
      stats.skippedFrames++;
      return;
    }
    lastDetectAt = now;
    stats.detectFps = Math.round(1000 / Math.max(1, interval));
    detecting = true;
    void detectPass(video).finally(() => {
      detecting = false;
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      void (async () => {
        if (!areModelsLoaded()) await loadModels();
        await loadNet('tinyFaceDetector');
        // SSD MobileNet is used in recognizeTrack for high-quality single-face
        // detection on the full-resolution crop canvas.
        await loadNet('ssdMobilenetv1').catch(() => undefined);
        await initializeGPU().catch(() => undefined);
        await initializeWorkerPool().catch(() => undefined);
        void initializeOnnxEmbedder().catch(() => undefined);
        await ensureGalleryIndex().catch(() => undefined);
        publishStats();
      })();
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      queue = [];
      markedByTrack.clear();
      markedIdentities.clear();
      tracker.reset();
    },
    isRunning: () => running,
    getTracks: () => tracker.getTracks(),
    refreshGallery: () => ensureGalleryIndex(true),
    getStats: () => ({ ...stats }),
  };
}
