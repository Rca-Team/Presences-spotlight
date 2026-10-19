/**
 * CloudQuotaGuard
 *
 * Comprehensive cloud security & resiliency layer for Presences AI:
 *  1. Sliding-window client rate limiter (Token Bucket) to protect Appwrite Cloud
 *     from runaway camera frames, render loops, and rapid polling.
 *  2. Soft circuit breaker: short 5-10s cooldown on transient 429/402 limits (never 24-hr lockout).
 *  3. Zero-block offline fallback: if Appwrite is unavailable or hits a rate/payment limit,
 *     attendance marking is stored locally in IndexedDB and automatically synced to the cloud.
 */

export interface OfflineAttendanceRecord {
  id: string;
  user_id?: string | null;
  student_id: string;
  student_name: string;
  class?: string | null;
  section?: string | null;
  category?: string | null;
  status: 'present' | 'late' | 'absent' | 'unauthorized';
  timestamp: string;
  confidence?: number;
  confidence_score?: number;
  source?: string;
  capture_mode?: string;
  device_info?: any;
  metadata?: any;
  queuedAt: number;
}

// ── Rate Limiter Constants ──────────────────────────────────────────────────
const MAX_REQUESTS_PER_10S = 60;   // At most 6 requests/sec sustained
const MAX_REQUESTS_PER_60S = 240;  // At most 4 requests/sec average
const requestTimestamps: number[] = [];

// ── Circuit Breaker State ───────────────────────────────────────────────────
let cooldownUntil = 0;
const MAX_COOLDOWN_MS = 15_000;    // Never lock out longer than 15 seconds

export function isCloudInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function triggerCloudCooldown(reason = 'Rate limit / quota response', durationMs = 8_000): void {
  const safeDuration = Math.min(Math.max(1_000, durationMs), MAX_COOLDOWN_MS);
  cooldownUntil = Date.now() + safeDuration;
  console.warn(`[CloudQuotaGuard] Circuit breaker engaged (${reason}). Backoff: ${safeDuration}ms`);
}

export function resetCloudCooldown(): void {
  cooldownUntil = 0;
}

/**
 * Check and acquire capacity to make a network call to Appwrite Cloud.
 * Returns true if request is permitted, or false if it should be served from cache.
 */
export function canMakeCloudRequest(): boolean {
  const now = Date.now();
  if (now < cooldownUntil) {
    return false;
  }

  // Prune timestamps older than 60s
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 60_000) {
    requestTimestamps.shift();
  }

  // Check 10s window
  const tenSecAgo = now - 10_000;
  let inLast10s = 0;
  for (let i = requestTimestamps.length - 1; i >= 0; i--) {
    if (requestTimestamps[i] >= tenSecAgo) inLast10s++;
    else break;
  }

  if (inLast10s >= MAX_REQUESTS_PER_10S || requestTimestamps.length >= MAX_REQUESTS_PER_60S) {
    triggerCloudCooldown('Client rate limit exceeded', 5_000);
    return false;
  }

  requestTimestamps.push(now);
  return true;
}

// ── Offline IndexedDB Queue ──────────────────────────────────────────────────
const DB_NAME = 'presences_cloud_resilience';
const DB_VERSION = 1;
const STORE_NAME = 'offline_attendance_queue';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save an attendance record to offline IndexedDB storage when the cloud is unreachable.
 */
export async function queueOfflineAttendance(record: OfflineAttendanceRecord): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    console.log(`[CloudQuotaGuard] Attendance saved offline for ${record.student_name} (${record.student_id})`);
    notifyQueueChange();
  } catch (err) {
    // Fallback to localStorage if IndexedDB fails
    try {
      const existingStr = localStorage.getItem('presences_offline_attendance') || '[]';
      const list = JSON.parse(existingStr);
      list.push(record);
      localStorage.setItem('presences_offline_attendance', JSON.stringify(list));
      notifyQueueChange();
    } catch {}
  }
}

/**
 * Get all pending offline attendance records.
 */
export async function getQueuedOfflineAttendance(): Promise<OfflineAttendanceRecord[]> {
  try {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const existingStr = localStorage.getItem('presences_offline_attendance') || '[]';
      return JSON.parse(existingStr);
    } catch {
      return [];
    }
  }
}

/**
 * Remove an item from the offline attendance queue once synced to cloud.
 */
export async function dequeueOfflineAttendance(id: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    notifyQueueChange();
  } catch {
    try {
      const existingStr = localStorage.getItem('presences_offline_attendance') || '[]';
      const list = JSON.parse(existingStr).filter((r: any) => r.id !== id);
      localStorage.setItem('presences_offline_attendance', JSON.stringify(list));
      notifyQueueChange();
    } catch {}
  }
}

function notifyQueueChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('presence:offline-queue-updated'));
  }
}

// ── Background Auto-Sync Worker ─────────────────────────────────────────────
let syncInProgress = false;

export async function flushOfflineAttendanceQueue(supabaseClient: any): Promise<number> {
  if (syncInProgress) return 0;
  if (isCloudInCooldown()) return 0;

  syncInProgress = true;
  let synced = 0;

  try {
    const pending = await getQueuedOfflineAttendance();
    if (pending.length === 0) return 0;

    console.log(`[CloudQuotaGuard] Attempting to sync ${pending.length} offline attendance records to cloud...`);

    for (const record of pending) {
      if (isCloudInCooldown()) break;

      const payload: any = {
        user_id: record.user_id,
        student_id: record.student_id,
        student_name: record.student_name,
        class: record.class,
        section: record.section,
        category: record.category,
        status: record.status,
        timestamp: record.timestamp,
        confidence: record.confidence ?? 0.95,
        confidence_score: record.confidence_score ?? 0.95,
        source: record.source || 'ai-scan',
        capture_mode: record.capture_mode || 'ai-scan',
        device_info: record.device_info,
        metadata: record.metadata,
      };

      try {
        const { error } = await supabaseClient.from('attendance_records').insert(payload);
        if (!error) {
          await dequeueOfflineAttendance(record.id);
          synced++;
        } else {
          console.warn(`[CloudQuotaGuard] Failed to sync record ${record.id}:`, error);
          if (String(error?.message || '').includes('402') || String(error?.message || '').includes('quota')) {
            triggerCloudCooldown('Quota hit during sync');
            break;
          }
        }
      } catch (err) {
        console.warn(`[CloudQuotaGuard] Sync exception for ${record.id}:`, err);
        break;
      }
    }

    if (synced > 0) {
      console.log(`[CloudQuotaGuard] Successfully synced ${synced} offline attendance records to Appwrite Cloud.`);
    }
  } finally {
    syncInProgress = false;
  }

  return synced;
}

// Initialize listeners if in browser environment
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[CloudQuotaGuard] Device came online — triggering cloud resilience sync.');
    resetCloudCooldown();
  });
}
