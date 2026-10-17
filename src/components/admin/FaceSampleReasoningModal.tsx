import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Brain,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Layers,
  ShieldCheck,
  Zap,
  ArrowRight,
  Database,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  faceSampleReasoningEngine,
  AIReasoningReport,
  AIReasoningStep,
} from '@/services/ai/faceSampleReasoningEngine';

interface FaceSampleReasoningModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHealed?: () => void;
}

export const FaceSampleReasoningModal: React.FC<FaceSampleReasoningModalProps> = ({
  open,
  onOpenChange,
  onHealed,
}) => {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [healing, setHealing] = useState(false);
  const [report, setReport] = useState<AIReasoningReport | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [healProgress, setHealProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setProgressMsg('AI Reasoning Model initializing database inspection...');
    try {
      const result = await faceSampleReasoningEngine.runReasoningDiagnostic({
        onProgress: (msg) => setProgressMsg(msg),
      });
      setReport(result);
    } catch (err: any) {
      toast({
        title: 'AI Analysis Error',
        description: err.message || 'Could not complete AI reasoning diagnosis.',
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
      setProgressMsg('');
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      runAnalysis();
    }
  }, [open, runAnalysis]);

  const handleExecuteAutoHeal = async () => {
    setHealing(true);
    try {
      const { healedCount, report: updatedReport } = await faceSampleReasoningEngine.autoHealAllDatabaseProblems({
        onProgress: (p) => setHealProgress(p),
      });

      setReport(updatedReport);
      toast({
        title: '⚡ Autonomous AI Healing Complete',
        description: `Successfully repaired ${healedCount} database inconsistencies. All missing paths and legacy URLs have been healed!`,
      });

      onHealed?.();
    } catch (err: any) {
      toast({
        title: 'Healing Failed',
        description: err.message || 'Could not complete autonomous repair.',
        variant: 'destructive',
      });
    } finally {
      setHealing(false);
      setHealProgress(null);
    }
  };

  const filteredSteps = (report?.steps || []).filter((step) => {
    if (filterType === 'all') return true;
    if (filterType === 'missing') return step.anomalyType === 'missing_image_path';
    if (filterType === 'legacy') return step.anomalyType === 'legacy_domain_url';
    if (filterType === 'avatars') return step.anomalyType === 'missing_profile_avatar';
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 rounded-3xl border border-primary/30 bg-card/95 backdrop-blur-3xl shadow-2xl overflow-hidden">
        
        {/* Header with Liquid Glass Theme */}
        <DialogHeader className="p-6 pb-4 border-b border-border/40 bg-gradient-to-r from-primary/15 via-accent/10 to-transparent shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-primary to-cyan-500 p-0.5 shadow-lg shadow-primary/25 shrink-0 flex items-center justify-center">
                <div className="h-full w-full bg-card/90 rounded-[14px] flex items-center justify-center">
                  <Brain className="h-6 w-6 text-primary animate-pulse" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-xl font-extrabold text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                    AI Face Samples Reasoning Engine
                  </DialogTitle>
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider">
                    Self-Healing Model
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Deeply cross-references descriptors, attendance records, profiles & cloud storage to diagnose and self-heal missing paths.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={runAnalysis}
                disabled={analyzing || healing}
                className="rounded-2xl border-border/60 bg-card/60 gap-1.5 text-xs font-semibold hover:bg-card/90"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
                {analyzing ? 'Reasoning...' : 'Re-Scan'}
              </Button>

              <Button
                size="sm"
                variant="default"
                onClick={handleExecuteAutoHeal}
                disabled={healing || analyzing || !report || report.steps.filter((s) => s.autoFixable && !s.fixed).length === 0}
                className="rounded-2xl bg-gradient-to-r from-primary via-indigo-600 to-cyan-500 hover:from-primary/90 hover:to-cyan-600 text-white font-bold text-xs gap-1.5 shadow-md shadow-primary/25 active:scale-95 transition-all"
              >
                <Zap className={`w-3.5 h-3.5 ${healing ? 'animate-spin' : ''}`} />
                {healing ? 'Self-Healing...' : '1-Click AI Auto-Heal'}
              </Button>
            </div>
          </div>

          {/* Healing progress banner if active */}
          {healProgress && (
            <div className="mt-4 p-3 rounded-2xl bg-primary/10 border border-primary/20 space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-primary">
                <span>{healProgress.label}</span>
                <span>{Math.round((healProgress.current / healProgress.total) * 100)}%</span>
              </div>
              <Progress value={(healProgress.current / healProgress.total) * 100} className="h-2 rounded-full" />
            </div>
          )}
        </DialogHeader>

        {/* Diagnostic Metric Gauges */}
        <div className="p-6 py-4 border-b border-border/40 bg-muted/20 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-2xl border border-border/50 bg-card/60 p-3 backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> System Health
              </div>
              <div className="text-2xl font-extrabold mt-1 text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                {report ? `${report.overallHealthScore}%` : '--'}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/60 p-3 backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Missing Paths
              </div>
              <div className="text-2xl font-extrabold mt-1 text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                {report ? report.breakdown.missingPaths : '--'}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/60 p-3 backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-500" /> Legacy URLs
              </div>
              <div className="text-2xl font-extrabold mt-1 text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                {report ? report.breakdown.legacyUrls : '--'}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/60 p-3 backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" /> Sync Avatars
              </div>
              <div className="text-2xl font-extrabold mt-1 text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                {report ? report.breakdown.missingAvatars : '--'}
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-2xl border border-border/50 bg-card/60 p-3 backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Repaired
              </div>
              <div className="text-2xl font-extrabold mt-1 text-emerald-500" style={{ fontFamily: 'Sora, sans-serif' }}>
                {report ? report.anomaliesFixed : 0}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="px-6 py-2.5 border-b border-border/40 flex items-center gap-2 shrink-0 overflow-x-auto">
          <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
              filterType === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30'
            }`}
          >
            All Findings ({report?.steps.length || 0})
          </button>
          <button
            onClick={() => setFilterType('missing')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
              filterType === 'missing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30'
            }`}
          >
            Missing Paths ({report?.breakdown.missingPaths || 0})
          </button>
          <button
            onClick={() => setFilterType('legacy')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
              filterType === 'legacy' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30'
            }`}
          >
            Legacy Hostnames ({report?.breakdown.legacyUrls || 0})
          </button>
          <button
            onClick={() => setFilterType('avatars')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
              filterType === 'avatars' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30'
            }`}
          >
            Profile Sync ({report?.breakdown.missingAvatars || 0})
          </button>
        </div>

        {/* AI Reasoning Thought Chains (Scrollable) */}
        <ScrollArea className="flex-1 p-6">
          {analyzing ? (
            <div className="py-16 text-center space-y-4">
              <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
                <Brain className="w-10 h-10 text-primary animate-pulse" />
                <div className="absolute inset-0 border-2 border-primary/40 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-foreground">AI Reasoning Model Active</p>
                <p className="text-xs text-muted-foreground">{progressMsg || 'Examining face descriptor vectors and photo references...'}</p>
              </div>
            </div>
          ) : filteredSteps.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-extrabold text-foreground">Database Biometrics Perfectly Optimized</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  All face descriptors are correctly linked to verified photos, storage paths are normalized, and profile avatars are synchronized.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSteps.map((step) => {
                const isExpanded = expandedStepId === step.id;
                const isFixed = step.fixed;

                return (
                  <div
                    key={step.id}
                    className={`rounded-2xl border transition-all overflow-hidden ${
                      isFixed
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : step.severity === 'high' || step.severity === 'critical'
                        ? 'border-amber-500/30 bg-card/80 hover:border-amber-500/50'
                        : 'border-border/60 bg-card/60 hover:border-border'
                    }`}
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                      className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isFixed
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : step.anomalyType === 'missing_image_path'
                              ? 'bg-amber-500/20 text-amber-500'
                              : 'bg-primary/20 text-primary'
                          }`}
                        >
                          {isFixed ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <Brain className="w-5 h-5" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground truncate">{step.studentName}</span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] font-bold px-1.5 py-0 uppercase ${
                                isFixed
                                  ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                                  : 'border-primary/30 text-primary bg-primary/10'
                              }`}
                            >
                              {isFixed ? 'Repaired' : step.anomalyType.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{step.title}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {step.autoFixable && !isFixed && (
                          <Badge variant="secondary" className="text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">
                            Auto-Fixable
                          </Badge>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    {/* Detailed AI Reasoning Body */}
                    {isExpanded && (
                      <div className="p-4 pt-1 border-t border-border/30 bg-muted/15 space-y-3 text-xs">
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5 text-primary" /> Observation
                          </span>
                          <p className="text-muted-foreground font-sans pl-5">{step.observation}</p>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Brain className="w-3.5 h-3.5 text-indigo-400" /> AI Reasoning Deduction
                          </span>
                          <p className="text-muted-foreground font-sans pl-5">{step.reasoning}</p>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-emerald-400" /> Self-Healing Prescription
                          </span>
                          <p className="text-emerald-400 font-mono text-[11px] pl-5">{step.prescription}</p>
                        </div>

                        {step.resolvedUrl && (
                          <div className="mt-2 p-2 rounded-xl bg-card border border-border/60 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground truncate font-mono">
                              Resolved Path: {step.resolvedUrl}
                            </span>
                            <a
                              href={step.resolvedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1 shrink-0"
                            >
                              Inspect <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="p-4 border-t border-border/40 bg-card/90 flex flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <span>AI Reasoning Engine v2.4 · Autonomous Biometric Healer</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-2xl"
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteAutoHeal}
              disabled={healing || analyzing || !report || report.steps.filter((s) => s.autoFixable && !s.fixed).length === 0}
              className="rounded-2xl bg-gradient-to-r from-primary to-cyan-500 text-white font-bold gap-1.5 shadow-md shadow-primary/20"
            >
              <Zap className={`w-3.5 h-3.5 ${healing ? 'animate-spin' : ''}`} />
              {healing ? 'Repairing Database...' : `Auto-Heal All (${report?.steps.filter((s) => s.autoFixable && !s.fixed).length || 0})`}
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
};

export default FaceSampleReasoningModal;
