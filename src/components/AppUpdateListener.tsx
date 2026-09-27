import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadLatestApk, LATEST_APK_CONFIG } from '@/utils/apkDownload';

export const AppUpdateListener: React.FC = () => {
  const [hasNativeApkUpdate, setHasNativeApkUpdate] = useState(false);
  const [latestApkTag, setLatestApkTag] = useState(LATEST_APK_CONFIG.version);

  // Silently trigger service worker update checks in the background without any popup banner
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;

        // Auto trigger background check
        reg.update().catch(() => {});

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing) {
            installing.addEventListener('statechange', () => {
              // Silently take over when installed
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      });
    }
  }, []);

  // Check for native APK binary updates on GitHub Releases only if running inside native Capacitor
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

      // If GitHub has a newer binary tag than the local configured version
      if (tagName && tagName !== LATEST_APK_CONFIG.version && tagName !== 'latest') {
        setLatestApkTag(tagName);
        setHasNativeApkUpdate(true);
      }
    } catch {
      // Offline or network error - ignore gracefully
    }
  }, []);

  useEffect(() => {
    checkNativeApkUpdate();

    // Check periodically every 5 minutes only for native APK binary updates
    const interval = setInterval(() => {
      checkNativeApkUpdate();
    }, 300000);

    const onResume = () => {
      checkNativeApkUpdate();
    };
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
    };
  }, [checkNativeApkUpdate]);

  const handleDownloadApk = async () => {
    await downloadLatestApk();
    setHasNativeApkUpdate(false);
  };

  return (
    <>
      {/* Native Android APK Binary Update Banner (Only shown inside native APK when a new binary APK is released) */}
      <AnimatePresence>
        {hasNativeApkUpdate && (
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
