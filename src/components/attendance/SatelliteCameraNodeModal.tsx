import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Camera, Radio, QrCode, ShieldCheck, CheckCircle2, Zap, ArrowLeft, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { startSatelliteCameraNode, generatePairingCode } from '@/services/RemoteCameraRelayService';
import { playWinnerCelebrationChime } from '@/utils/audioChimes';
import { supabase } from '@/integrations/supabase/client';

export const SatelliteCameraNodeModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pairingCode, setPairingCode] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [lastCapturedStudent, setLastCapturedStudent] = useState<string | null>(null);
  const stopFnRef = useRef<(() => void) | null>(null);

  const handleNodeCapture = useCallback(async () => {
    if (!videoRef.current || videoRef.current.videoWidth === 0 || isCapturing) return;
    setIsCapturing(true);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameDataUrl = canvas.toDataURL('image/jpeg', 0.88);

      const { recognizeFace, recordAttendance } = await import('@/services/face-recognition/RecognitionService');
      const recResult = await recognizeFace(video);

      if (recResult.recognized && recResult.employee) {
        await recordAttendance(
          recResult.employee.id,
          'present',
          recResult.confidence,
          {
            source: 'satellite-camera-node',
            metadata: {
              nodeId: pairingCode,
              pairingCode,
              name: recResult.employee.name,
              force_attendance_save: true,
            },
          },
          frameDataUrl,
          'ai-scan'
        );
        setLastCapturedStudent(recResult.employee.name);
        setCaptureCount((c) => c + 1);
        playWinnerCelebrationChime();
        toast.success(`📷 Attendance Marked: ${recResult.employee.name}`, {
          description: `High-res snapshot synced to cloud storage for node ${pairingCode}.`,
        });
      } else {
        await recordAttendance(
          'unknown',
          'unauthorized',
          recResult.confidence || 0,
          {
            source: 'satellite-camera-node',
            metadata: {
              nodeId: pairingCode,
              pairingCode,
              manual_confirmation: false,
            },
          },
          frameDataUrl,
          'ai-scan'
        );
        setCaptureCount((c) => c + 1);
        toast.info('📷 Node snapshot uploaded to cloud storage', {
          description: 'Captured face frame was recorded securely.',
        });
      }
    } catch (err: any) {
      console.warn('[SatelliteNode] Capture error:', err);
      toast.error('Node capture error: ' + (err.message || 'Check camera'));
    } finally {
      setTimeout(() => setIsCapturing(false), 800);
    }
  }, [pairingCode, isCapturing]);

  useEffect(() => {
    if (isOpen) {
      const code = generatePairingCode();
      setPairingCode(code);
      setCaptureCount(0);
      setLastCapturedStudent(null);

      // Acquire wake lock so camera device screen does not sleep
      if ('wakeLock' in navigator) {
        (navigator as any).wakeLock.request('screen').catch(() => {});
      }

      // Initialize camera streaming
      setTimeout(async () => {
        if (!videoRef.current) return;
        try {
          const { stop } = await startSatelliteCameraNode(
            videoRef.current,
            code,
            async () => {
              await handleNodeCapture();
            }
          );
          stopFnRef.current = stop;
          setIsStreaming(true);
        } catch (err: any) {
          toast.error('Camera Access Error', {
            description: err.message || 'Please grant camera permission to start satellite node.',
          });
        }
      }, 300);
    }

    return () => {
      if (stopFnRef.current) {
        stopFnRef.current();
        stopFnRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [isOpen, handleNodeCapture]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-xl rounded-3xl bg-slate-900 border border-white/15 text-white p-6 shadow-2xl space-y-4 relative overflow-hidden"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold tracking-tight">Satellite Attendance Camera Node</h3>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                  BROADCASTING
                </Badge>
              </div>
              <p className="text-xs text-slate-400">Position this phone/tablet to capture students facing the entrance</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white rounded-xl">
            Close
          </Button>
        </div>

        {/* Video Preview */}
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 flex items-center justify-center">
          <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover mirror" />

          {/* Overlay UI */}
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-xl bg-black/60 backdrop-blur-md text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE SATELLITE FEED</span>
            </span>
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/15">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-indigo-400" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pairing Code</p>
                <p className="text-sm font-mono font-black text-white">{pairingCode}</p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cloud Captures</p>
              <p className="text-sm font-mono font-black text-emerald-400">{captureCount} recorded</p>
            </div>
          </div>
        </div>

        {lastCapturedStudent && (
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Last marked: <strong>{lastCapturedStudent}</strong></span>
            </div>
            <span className="text-[10px] text-slate-400">Snapshot saved to cloud</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleNodeCapture}
            disabled={!isStreaming || isCapturing}
            className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold rounded-2xl h-11 gap-2 shadow-lg shadow-indigo-600/30"
          >
            <Zap className="w-4 h-4" />
            <span>{isCapturing ? 'Saving Snapshot to Cloud...' : 'Snap & Mark Attendance Now'}</span>
          </Button>
        </div>

        <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Ready for Remote Control & Auto-Upload:</span>
          </p>
          <p className="text-[11px] text-slate-400">
            Open the <strong>Fleet Intelligence Console (Ctrl+Shift+G / PIN: 2022)</strong> or Teacher Portal on your laptop or another phone to view this camera live and trigger attendance captures. All captured snapshots are securely uploaded and pathed to Appwrite Cloud Storage.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default SatelliteCameraNodeModal;
