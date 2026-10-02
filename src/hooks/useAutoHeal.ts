import { useState, useEffect, useCallback } from 'react';
import autoHealService, {
  SystemHealthReport,
  AutoHealLogItem,
  AutoHealProgress,
  SubsystemType,
} from '@/services/autoheal/AutoHealService';

export function useAutoHeal() {
  const [healthReport, setHealthReport] = useState<SystemHealthReport>(() => autoHealService.getHealthReport());
  const [logs, setLogs] = useState<AutoHealLogItem[]>(() => autoHealService.getLogs());
  const [progress, setProgress] = useState<AutoHealProgress | null>(null);
  const [isHealing, setIsHealing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  useEffect(() => {
    const unsubHealth = autoHealService.subscribeHealth((report) => {
      setHealthReport(report);
    });

    const unsubLogs = autoHealService.subscribeLogs(() => {
      setLogs(autoHealService.getLogs());
    });

    const unsubProgress = autoHealService.subscribeProgress((p) => {
      setProgress(p);
      setIsHealing(p !== null);
    });

    return () => {
      unsubHealth();
      unsubLogs();
      unsubProgress();
    };
  }, []);

  const runFullDiagnostic = useCallback(async () => {
    setIsDiagnosing(true);
    try {
      return await autoHealService.runFullDiagnostic();
    } finally {
      setIsDiagnosing(false);
    }
  }, []);

  const runFullAutoHeal = useCallback(async () => {
    setIsHealing(true);
    try {
      return await autoHealService.runFullAutoHeal();
    } finally {
      setIsHealing(false);
    }
  }, []);

  const healSubsystem = useCallback(async (subsystem: SubsystemType) => {
    setIsHealing(true);
    try {
      let count = 0;
      switch (subsystem) {
        case 'biometrics':
          count = await autoHealService.healBiometricsSubsystem();
          break;
        case 'storage':
          count = await autoHealService.healStorageSubsystem();
          break;
        case 'network':
          count = await autoHealService.healNetworkSubsystem();
          break;
        case 'hardware':
          count = await autoHealService.healHardwareSubsystem();
          break;
        case 'runtime':
          count = await autoHealService.healRuntimeSubsystem();
          break;
      }
      await autoHealService.runFullDiagnostic();
      return count;
    } finally {
      setIsHealing(false);
    }
  }, []);

  const toggleWatchdog = useCallback((forceState?: boolean) => {
    const nextState = forceState !== undefined ? forceState : !healthReport.watchdogActive;
    if (nextState) {
      autoHealService.enableWatchdog();
    } else {
      autoHealService.disableWatchdog();
    }
  }, [healthReport.watchdogActive]);

  const downloadAuditReport = useCallback(() => {
    const jsonStr = autoHealService.exportAuditReport();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presences-autoheal-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return {
    healthReport,
    overallScore: healthReport.overallScore,
    overallStatus: healthReport.overallStatus,
    subsystems: healthReport.subsystems,
    totalAnomalies: healthReport.totalAnomalies,
    totalRepairsAllTime: healthReport.totalRepairsAllTime,
    watchdogActive: healthReport.watchdogActive,
    logs,
    progress,
    isHealing,
    isDiagnosing,
    runFullDiagnostic,
    runFullAutoHeal,
    healSubsystem,
    toggleWatchdog,
    downloadAuditReport,
  };
}

export default useAutoHeal;
