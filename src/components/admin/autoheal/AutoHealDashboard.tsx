import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  ShieldAlert,
  Activity,
  Zap,
  RefreshCw,
  Cpu,
  Database,
  Wifi,
  Camera,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Download,
  Terminal,
  Play,
  RotateCcw,
  Sparkles,
  SearchCheck,
  Wrench,
  Check,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { useAutoHeal } from '@/hooks/useAutoHeal';
import { SubsystemType } from '@/services/autoheal/AutoHealService';
import { cn } from '@/lib/utils';

export const AutoHealDashboard: React.FC = () => {
  const {
    overallScore,
    overallStatus,
    subsystems,
    totalAnomalies,
    totalRepairsAllTime,
    watchdogActive,
    logs,
    progress,
    isHealing,
    isDiagnosing,
    runFullDiagnostic,
    runFullAutoHeal,
    healSubsystem,
    toggleWatchdog,
    downloadAuditReport,
  } = useAutoHeal();

  const { toast } = useToast();
  const { trigger: haptic } = useHapticFeedback();
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'biometrics' | 'storage' | 'network' | 'hardware' | 'runtime'>('all');
  const [logFilter, setLogFilter] = useState<string>('all');

  const handleRunDiagnostics = async () => {
    haptic('medium');
    toast({ title: '🔍 Diagnostic Sweep Started', description: 'Scanning 5 system tiers...' });
    const report = await runFullDiagnostic();
    haptic('success');
    toast({
      title: '✅ Diagnostic Sweep Complete',
      description: `Health Score: ${report.overallScore}%. ${report.totalAnomalies} issue(s) identified.`,
    });
  };

  const handleFullAutoHeal = async () => {
    haptic('heavy');
    toast({ title: '⚡ Autonomous Auto-Heal Initiated', description: 'Executing multi-tier system repair sequence...' });
    const result = await runFullAutoHeal();
    haptic('success');
    toast({
      title: '🎉 System Auto-Heal Concluded',
      description: `Resolved ${result.healedCount} anomalies. System health score is now ${result.report.overallScore}%.`,
    });
  };

  const handleTargetedHeal = async (subsystem: SubsystemType, name: string) => {
    haptic('medium');
    toast({ title: `🛠️ Healing ${name}`, description: 'Executing targeted repair sequence...' });
    const count = await healSubsystem(subsystem);
    haptic('success');
    toast({
      title: `✅ ${name} Repaired`,
      description: `Successfully resolved ${count} anomaly item(s).`,
    });
  };

  const getSubsystemIcon = (id: SubsystemType) => {
    switch (id) {
      case 'biometrics':
        return <Cpu className="w-5 h-5 text-indigo-500" />;
      case 'storage':
        return <Database className="w-5 h-5 text-blue-500" />;
      case 'network':
        return <Wifi className="w-5 h-5 text-emerald-500" />;
      case 'hardware':
        return <Camera className="w-5 h-5 text-amber-500" />;
      case 'runtime':
        return <Layers className="w-5 h-5 text-purple-500" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-emerald-500 stroke-emerald-500';
    if (score >= 60) return 'text-amber-500 stroke-amber-500';
    return 'text-rose-500 stroke-rose-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 85) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    if (score >= 60) return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
  };

  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'all') return true;
    return l.subsystem === logFilter || l.status === logFilter;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner & Primary Control Matrix */}
      <Card className="relative overflow-hidden border-border/80 bg-gradient-to-br from-card via-card to-background/60 shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
            {/* Left Column: Health Score Gauge */}
            <div className="flex items-center gap-6">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    className="stroke-muted/40"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    className={cn('transition-all duration-1000 ease-out', getScoreColor(overallScore))}
                    strokeWidth="8"
                    strokeDasharray={251.2}
                    strokeDashoffset={251.2 - (251.2 * overallScore) / 100}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black tracking-tight text-foreground">{overallScore}%</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Health</span>
                </div>
              </div>

              <div className="space-y-1.5 text-left">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                  </div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    AutoHeal Guardian Engine
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
                  Autonomous 5-tier self-healing system. Proactively audits biometric embeddings, cache stores, realtime channels, and camera pipelines.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant="outline" className={cn('text-xs font-semibold px-2.5 py-0.5', getScoreBg(overallScore))}>
                    {overallStatus === 'optimal' ? (
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3" /> System Healthy
                      </span>
                    ) : overallStatus === 'warning' ? (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {totalAnomalies} Anomaly Detected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> Action Required ({totalAnomalies})
                      </span>
                    )}
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {totalRepairsAllTime} Repairs All-Time
                  </Badge>
                </div>
              </div>
            </div>

            {/* Right Column: Actions & Watchdog Switch */}
            <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-3 w-full lg:w-auto">
              <div className="flex items-center justify-between sm:justify-center gap-3 px-4 py-2.5 rounded-2xl bg-muted/40 border border-border/60 w-full sm:w-auto">
                <div className="space-y-0.5 text-left">
                  <div className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <Activity className={cn('w-3.5 h-3.5', watchdogActive ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground')} />
                    Watchdog Daemon
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {watchdogActive ? 'Active auto-repair' : 'Paused'}
                  </div>
                </div>
                <Switch
                  checked={watchdogActive}
                  onCheckedChange={(val) => {
                    haptic('selection');
                    toggleWatchdog(val);
                    toast({
                      title: val ? '🛡️ Watchdog Enabled' : '⏸️ Watchdog Paused',
                      description: val ? 'Auto-healing will silently repair faults every 3m.' : 'Autonomous healing paused.',
                    });
                  }}
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunDiagnostics}
                  disabled={isDiagnosing || isHealing}
                  className="rounded-xl text-xs font-bold gap-1.5 h-10 px-3 flex-1 sm:flex-none"
                >
                  <SearchCheck className={cn('w-4 h-4', isDiagnosing && 'animate-spin')} />
                  {isDiagnosing ? 'Scanning…' : 'Scan'}
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  onClick={handleFullAutoHeal}
                  disabled={isHealing || isDiagnosing}
                  className="rounded-xl text-xs font-bold gap-1.5 h-10 px-4 bg-gradient-to-r from-primary to-primary/90 shadow-md shadow-primary/20 hover:opacity-95 active:scale-95 transition flex-1 sm:flex-none"
                >
                  <Zap className={cn('w-4 h-4 fill-current', isHealing && 'animate-bounce')} />
                  {isHealing ? 'Healing…' : 'Run Auto-Heal'}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={downloadAuditReport}
                  title="Export Health Audit Report"
                  className="rounded-xl h-10 w-10 text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Active Auto-Heal Progress Bar */}
          <AnimatePresence>
            {isHealing && progress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 pt-5 border-t border-border/60 space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-2 text-primary">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Step {progress.current} of {progress.total}: {progress.step}
                  </span>
                  <span className="text-muted-foreground">{progress.message}</span>
                </div>
                <Progress value={(progress.current / progress.total) * 100} className="h-2 rounded-full" />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Subsystem Health Matrix (5 Tiers) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(Object.keys(subsystems) as SubsystemType[]).map((key) => {
          const sub = subsystems[key];
          return (
            <Card
              key={sub.id}
              className={cn(
                'border transition-all hover:shadow-md bg-card/95',
                sub.status === 'optimal'
                  ? 'border-border/80'
                  : sub.status === 'warning'
                  ? 'border-amber-500/30'
                  : 'border-rose-500/30'
              )}
            >
              <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-muted/60 border border-border/60">
                    {getSubsystemIcon(sub.id)}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-foreground">{sub.name}</CardTitle>
                    <CardDescription className="text-[11px]">
                      {sub.anomaliesCount === 0
                        ? 'Optimal performance'
                        : `${sub.anomaliesCount} issue${sub.anomaliesCount > 1 ? 's' : ''} detected`}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className={cn('font-mono text-xs font-bold px-2 py-0.5', getScoreBg(sub.score))}>
                  {sub.score}%
                </Badge>
              </CardHeader>

              <CardContent className="p-4 pt-2 space-y-3">
                {sub.issues.length === 0 ? (
                  <div className="py-2 px-3 rounded-xl bg-muted/30 text-[11px] text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>All parameters operating nominally.</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                    {sub.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="py-1.5 px-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5"
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                        <span className="leading-tight">{issue}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Audited {new Date(sub.lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isHealing}
                    onClick={() => handleTargetedHeal(sub.id, sub.name)}
                    className="h-7 text-[11px] font-bold rounded-lg gap-1 hover:bg-primary hover:text-primary-foreground transition"
                  >
                    <Wrench className="w-3 h-3" />
                    Heal
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Audit Log Console & Event Stream */}
      <Card className="border-border/80 shadow-md">
        <CardHeader className="p-4 sm:p-5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-primary" />
            <div>
              <CardTitle className="text-sm font-bold">AutoHeal Live Activity Feed</CardTitle>
              <CardDescription className="text-[11px]">
                Real-time diagnostic events, error interceptions, and autonomous repair logs
              </CardDescription>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {['all', 'biometrics', 'storage', 'network', 'hardware', 'runtime'].map((filter) => (
              <Button
                key={filter}
                variant={logFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLogFilter(filter)}
                className="h-7 px-2.5 text-[11px] rounded-lg capitalize"
              >
                {filter}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="max-h-72 overflow-y-auto divide-y divide-border/40 font-mono text-[11px]">
            {filteredLogs.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground font-sans text-xs">
                No activity logs recorded yet. Run a diagnostic sweep or auto-heal sequence.
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="p-3 px-4 flex items-start gap-3 hover:bg-muted/30 transition">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1.5 py-0 uppercase shrink-0 font-sans font-bold',
                      log.status === 'success'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                        : log.status === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                        : log.status === 'error'
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-600'
                        : 'border-blue-500/30 bg-blue-500/10 text-blue-600'
                    )}
                  >
                    {log.status}
                  </Badge>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{log.action}</span>
                      <span className="text-[10px] text-muted-foreground">[{log.subsystem}]</span>
                    </div>
                    <p className="text-muted-foreground whitespace-pre-wrap break-all leading-tight">
                      {log.message}
                    </p>
                  </div>

                  <span className="text-[10px] text-muted-foreground shrink-0">{log.timestamp}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AutoHealDashboard;
