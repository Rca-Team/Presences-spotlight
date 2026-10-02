import React from 'react';
import { Sparkles, ShieldAlert, ShieldCheck, Zap, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAutoHeal } from '@/hooks/useAutoHeal';
import { useToast } from '@/hooks/use-toast';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  onClick?: () => void;
  showQuickFix?: boolean;
}

export const AutoHealBadgeWidget: React.FC<Props> = ({ className, onClick, showQuickFix = true }) => {
  const { overallScore, overallStatus, isHealing, totalAnomalies, runFullAutoHeal } = useAutoHeal();
  const { toast } = useToast();
  const { trigger: haptic } = useHapticFeedback();

  const handleQuickHeal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic('heavy');
    toast({ title: '⚡ Autonomous Auto-Heal Initiated', description: 'Repairing detected system faults...' });
    const res = await runFullAutoHeal();
    haptic('success');
    toast({
      title: '✅ Auto-Heal Complete',
      description: `Resolved ${res.healedCount} item(s). Health score: ${res.report.overallScore}%.`,
    });
  };

  const getBadgeStyle = () => {
    if (overallScore >= 85) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20';
    if (overallScore >= 60) return 'bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20';
    return 'bg-rose-500/10 text-rose-600 border-rose-500/20 hover:bg-rose-500/20';
  };

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <Badge
        variant="outline"
        onClick={onClick}
        className={cn(
          'cursor-pointer transition-all active:scale-95 font-sans font-bold text-xs py-1 px-2.5 gap-1.5 shadow-xs select-none',
          getBadgeStyle()
        )}
      >
        {isHealing ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
        ) : overallStatus === 'optimal' ? (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
        )}
        <span>AutoHeal: {overallScore}%</span>
      </Badge>

      {showQuickFix && overallScore < 85 && (
        <Button
          size="sm"
          variant="outline"
          disabled={isHealing}
          onClick={handleQuickHeal}
          className="h-7 px-2 text-[11px] font-bold rounded-lg gap-1 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground shadow-xs"
        >
          <Zap className="w-3 h-3 fill-current" />
          Heal ({totalAnomalies})
        </Button>
      )}
    </div>
  );
};

export default AutoHealBadgeWidget;
