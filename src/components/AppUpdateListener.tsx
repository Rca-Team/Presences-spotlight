import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCw, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadLatestApk, LATEST_APK_CONFIG } from '@/utils/apkDownload';

interface VersionInfo {
  version: string;
  buildTime: number;
  releaseTag?: string;
  appName?: string;
}

export const AppUpdateListener: React.FC = () => {
  const [hasWebUpdate, setHasWebUpdate] = useState(false);
  const [hasNativeApkUpdate, setHasNativeApkUpdate] = useState(false);
  const [latestApkTag, setLatestApkTag] = useState(LATEST_APK_CONFIG.version);
  const [isUpdating, setIsUpdating] = useState(false);
  const initialBuildTimeRef = useRef<number | null>(null);

  // Check for web update by comparing /version.json buildTime
  const checkWebUpdate = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;

      const data: VersionInfo = await res.json();
      if (!data?.buildTime) return;

      if (initialBuildTimeRef.current === null) {
        initialBuildTimeRef.current = data.buildTime;
      } else if (data.buildTime > initialBuildTimeRef.current) {
        setHasWebUpdate(true);
      }
    } catch {
      // Offline or network error - ignore gracefully
    }
  }, []);

  // Check for native APK update on GitHub Releases if running inside native Capacitor
  const checkNativeApkUpdate = useCallback(async () => {
    const isNative = Boolean((window as any).Capacitor?.isNativePlatform());
    if (!isNative) return;

    try {
      const res = await fetch('https://api.github.com/repos/Rca-Team/Presences-supabase/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) return;

      const release = await res.json();
      const tagName = release.tag_name || '';

      // If GitHub has a newer tag than the local configured version
      if (tagName && tagName !== LATEST_APK_CONFIG.version && tagName !== 'latest') {
        setLatestApkTag(tagName);
        setHasNativeApkUpdate(true);
      }
    } catch {
      // Network error - ignore gracefully
    }
  }, []);

  useEffect(() => {
    // 1. Initial check on mount
    checkWebUpdate();
    checkNativeApkUpdate();

    // 2. Listen to Service Worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  setHasWebUpdate(true);
                }
              });
            }
          });
        }
      });

      // Reload when new service worker takes over
      const onControllerChange = () => {
        setHasWebUpdate(true);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }

    // 3. Periodic polling every 3 minutes
    const interval = setInterval(() => {
      checkWebUpdate();
      checkNativeApkUpdate();
    }, 180000);

    // 4. Check on window focus or app resume
    const onFocus = () => {
      checkWebUpdate();
      checkNativeApkUpdate();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [checkWebUpdate, checkNativeApkUpdate]);

  const handleApplyWebUpdate = async () => {
    setIsUpdating(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    } catch {}

    setTimeout(() => {
      window.location.reload();
    }, 300);
  };

  const handleDownloadApk = async () => {
    await downloadLatestApk();
    setHasNativeApkUpdate(false);
  };

  return (
    <>
      {/* 1. Live Web Update Banner (Applicable to both Web and APK app) */}
      <AnimatePresence>
        {hasWebUpdate && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
            className="fixed top-3 left-3 right-3 z-[9999] sm:left-auto sm:right-4 sm:max-w-md"
          >
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950/95 border border-emerald-500/40 shadow-2xl backdrop-blur-2xl text-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0">
                  <Sparkles className="w-4 h-4 animate-spin" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    ⚡ New Live Update Available
                  </p>
                  <p className="text-[10px] text-slate-300 truncate">
                    Presences has been updated with the latest web features.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  onClick={handleApplyWebUpdate}
                  disabled={isUpdating}
                  className="h-8 px-3 text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl shadow-md gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
                  <span>{isUpdating ? 'Updating...' : 'Reload'}</span>
                </Button>
                <button
                  onClick={() => setHasWebUpdate(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Native Android APK Update Banner (Only shown if running native APK and new binary exists) */}
      <AnimatePresence>
        {!hasWebUpdate && hasNativeApkUpdate && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
            className="fixed top-3 left-3 right-3 z-[9999] sm:left-auto sm:right-4 sm:max-w-md"
          >
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950/95 border border-purple-500/40 shadow-2xl backdrop-blur-2xl text-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-purple-500/20 text-purple-400 shrink-0">
                  <Download className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    📦 New Native Android Build ({latestApkTag})
                  </p>
                  <p className="text-[10px] text-slate-300 truncate">
                    New native home screen widgets & device enhancements.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  onClick={handleDownloadApk}
                  className="h-8 px-3 text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl shadow-md gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Update APK</span>
                </Button>
                <button
                  onClick={() => setHasNativeApkUpdate(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AppUpdateListener;
