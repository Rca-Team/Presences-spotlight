/**
 * AndroidShareService.ts
 * Facilitates handling photos and files shared to Presences from the Android System Share Sheet
 * or Web Share Target API.
 */

export interface SharedFileItem {
  name: string;
  type: string;
  dataUrl: string;
}

export interface SharedMediaPayload {
  files: SharedFileItem[];
  action?: string;
  mimeType?: string;
  timestamp?: number;
}

type SharedMediaListener = (payload: SharedMediaPayload) => void;

class AndroidShareServiceManager {
  private listeners: Set<SharedMediaListener> = new Set();
  private lastPayload: SharedMediaPayload | null = null;
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // 1. Listen for custom window event dispatched from MainActivity.java
    window.addEventListener('presences_shared_media', ((e: CustomEvent<SharedMediaPayload>) => {
      if (e.detail && e.detail.files && e.detail.files.length > 0) {
        this.emit(e.detail);
      }
    }) as EventListener);

    // 2. Global callback function in case WebView invokes directly
    (window as any).__onPresencesSharedMedia = (payload: SharedMediaPayload) => {
      if (payload && payload.files && payload.files.length > 0) {
        this.emit(payload);
      }
    };

    // 3. Poll pending media from Android native bridge on startup (for cold launches)
    this.checkColdBootPendingMedia();
  }

  public checkColdBootPendingMedia() {
    try {
      const bridge = (window as any).AndroidShareBridge;
      if (bridge && typeof bridge.getPendingSharedMedia === 'function') {
        const rawJson = bridge.getPendingSharedMedia();
        if (rawJson && typeof rawJson === 'string' && rawJson.trim().length > 0) {
          const parsed = JSON.parse(rawJson);
          if (parsed && parsed.files && parsed.files.length > 0) {
            console.log('[AndroidShareService] Received cold-launch shared media:', parsed.files.length, 'files');
            this.emit(parsed);
          }
        }
      }
    } catch (err) {
      console.warn('[AndroidShareService] Error checking cold boot pending media:', err);
    }
  }

  public subscribe(listener: SharedMediaListener): () => void {
    this.listeners.add(listener);

    // If there is an unprocessed payload from cold launch, replay it once
    if (this.lastPayload) {
      const p = this.lastPayload;
      setTimeout(() => listener(p), 100);
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  public emit(payload: SharedMediaPayload) {
    this.lastPayload = payload;
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (e) {
        console.error('[AndroidShareService] Listener error:', e);
      }
    });
  }

  public clearLastPayload() {
    this.lastPayload = null;
  }
}

export const AndroidShareService = new AndroidShareServiceManager();
