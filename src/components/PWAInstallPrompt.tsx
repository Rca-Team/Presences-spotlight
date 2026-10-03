import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Download, Share, Plus, Smartphone, Feather, Sparkles, LayoutGrid, Zap, ShieldCheck } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { downloadLatestApk, LATEST_APK_CONFIG } from '@/utils/apkDownload';

const PWAInstallPrompt: React.FC = () => {
  // Banner permanently removed as requested
  return null;
};

export default PWAInstallPrompt;

