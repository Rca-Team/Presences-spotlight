import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { getUserTrainingStats } from '@/services/face-recognition/ProgressiveTrainingService';
import { toast } from 'sonner';
import { 
  Scan, RefreshCw, CheckCircle2, AlertTriangle, Trash2, 
  ShieldCheck, Loader2, Info, ArrowRight, ExternalLink
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface FaceReRegistrationProps {
  userId: string;
  userName: string;
}

const FaceReRegistration: React.FC<FaceReRegistrationProps> = ({ userId, userName }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);

  const { data: trainingStats } = useQuery({
    queryKey: ['trainingStats', userId],
    queryFn: () => getUserTrainingStats(userId),
    enabled: !!userId
  });

  const { data: sampleCount } = useQuery({
    queryKey: ['faceSampleCount', userId],
    queryFn: async () => {
      const { count } = await supabase
        .from('face_descriptors')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      return count || 0;
    },
    enabled: !!userId
  });

  const handleStartScan = (openNewTab = false, replace = false) => {
    const params = new URLSearchParams({
      student: userId,
      bypass: 'true',
      replace: String(replace),
      returnTo: '/profile',
    });
    const targetUrl = `/enroll?${params.toString()}`;

    if (openNewTab) {
      window.open(targetUrl, '_blank');
    } else {
      navigate(targetUrl);
    }
  };

  const handleClearAndRescan = async () => {
    setIsClearing(true);
    try {
      const { error } = await supabase
        .from('face_descriptors')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['trainingStats', userId] });
      queryClient.invalidateQueries({ queryKey: ['faceSampleCount', userId] });

      toast.success('Old face data cleared. Opening biometric studio...');
      setIsClearing(false);
      handleStartScan(false, true);
    } catch {
      setIsClearing(false);
      toast.error('Failed to clear face data');
    }
  };

  const levelConfig = {
    none: { color: 'text-muted-foreground', bg: 'bg-muted', label: 'Not Set', icon: AlertTriangle },
    basic: { color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Basic', icon: Info },
    moderate: { color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: 'Moderate', icon: Scan },
    good: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Good', icon: CheckCircle2 },
    excellent: { color: 'text-primary', bg: 'bg-primary/10', label: 'Excellent', icon: ShieldCheck },
  };

  const level = trainingStats?.trainingLevel || 'none';
  const config = levelConfig[level];
  const LevelIcon = config.icon;

  return (
    <Card className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border border-blue-100 dark:border-blue-900/50 shadow-xl">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Scan className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          Face Recognition Data
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Update your face biometric calibration using the dedicated 3D capture studio
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Training level indicator */}
        <div className={`flex items-center gap-3 p-3 rounded-xl ${config.bg}`}>
          <LevelIcon className={`w-5 h-5 ${config.color}`} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Biometric Calibration:</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
                {config.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {trainingStats?.hasGlassesProfile ? 'Glasses + No Glasses profile configured' : 'Standard 3D facial profile'}
            </p>
          </div>
        </div>

        {/* Quality meter */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Model Quality Meter</span>
            <span>{Math.min(100, (sampleCount || 0) * 12)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (sampleCount || 0) * 12)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full"
            />
          </div>
        </div>

        {/* Stats */}
        {trainingStats && trainingStats.sampleCount > 0 && (
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-bold text-foreground">{trainingStats.sampleCount}</p>
              <p className="text-[10px] text-muted-foreground">Face Samples</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-bold text-foreground">
                {trainingStats.newestSample 
                  ? new Date(trainingStats.newestSample).toLocaleDateString() 
                  : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">Last Updated</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          <Button 
            onClick={() => handleStartScan(false)}
            className="w-full bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-600 hover:to-cyan-700 text-white font-bold gap-2 rounded-xl h-11"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {sampleCount ? 'Open 3D Studio to Add Samples' : 'Launch 3D Biometric Studio'}
            <ArrowRight className="w-4 h-4 ml-auto" />
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartScan(true)}
              className="flex-1 rounded-xl text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Open in New Window
            </Button>
            
            {(sampleCount || 0) > 0 && (
              <Button 
                variant="outline"
                size="sm"
                onClick={handleClearAndRescan}
                disabled={isClearing}
                className="flex-1 rounded-xl border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs"
              >
                {isClearing ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Clearing...</>
                ) : (
                  <><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear & Recalibrate</>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FaceReRegistration;
