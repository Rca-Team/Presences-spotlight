import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { enrollmentApi } from '@/services/enrollment/api';
import { type EnrollmentSession } from '@/services/enrollment/types';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import { 
  Sparkles, 
  Loader2, 
  ScanFace, 
  Copy, 
  ExternalLink, 
  ShieldCheck, 
  ArrowRight, 
  Info,
  Check
} from 'lucide-react';

export interface RecaptureStudent {
  id: string;
  user_id?: string;
  name: string;
  employee_id?: string;
  admission_number?: string;
  roll_number?: string;
  category?: string;
  classSection?: string;
  avatarUrl?: string;
  photo_url?: string;
  parent_name?: string;
  parent_phone?: string;
  parent_email?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: RecaptureStudent | null;
  onSuccess?: () => void;
}

const CaptureFaceDialog: React.FC<Props> = ({ open, onOpenChange, student }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);
  const [isLaunching, setIsLaunching] = useState(false);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);

  const studentName = student?.name || 'Student';
  const studentAdm = student?.admission_number || student?.employee_id || student?.id || '';
  const studentClass = student?.classSection || student?.category || '';
  const initials = (studentName || 'ST')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'ST';

  useEffect(() => {
    if (!open || !student) {
      setReplaceExisting(true);
      return;
    }

    let mounted = true;
    const rawPhoto = student.avatarUrl || student.photo_url;
    if (rawPhoto) {
      resolveStudentPhotoUrl(rawPhoto)
        .then((resolved) => {
          if (mounted && resolved) setResolvedAvatar(resolved);
        })
        .catch(() => {});
    } else {
      setResolvedAvatar(null);
    }

    return () => {
      mounted = false;
    };
  }, [open, student]);

  const generateBypassParams = async () => {
    let token = '';
    try {
      const res = await enrollmentApi<EnrollmentSession>('staff.session', {
        admission: studentAdm,
      });
      if (res?.session) {
        token = res.session;
        sessionStorage.setItem('bypass_enrollment_session', JSON.stringify(res));
      }
    } catch (e) {
      console.warn('Could not pre-mint session token; will fetch on enroll page:', e);
    }

    const currentPath = window.location.pathname + window.location.search;
    const params = new URLSearchParams({
      student: studentAdm,
      bypass: 'true',
      replace: String(replaceExisting),
      returnTo: currentPath,
    });
    if (token) {
      params.set('token', token);
    }
    return params;
  };

  const handleLaunchStudio = async (openNewTab = false) => {
    if (!student) return;
    setIsLaunching(true);

    try {
      toast({
        title: 'Opening Biometric Studio',
        description: `Preparing 3D face scan studio for ${studentName}...`,
      });

      const params = await generateBypassParams();
      const targetUrl = `/enroll?${params.toString()}`;
      onOpenChange(false);

      if (openNewTab) {
        window.open(targetUrl, '_blank');
      } else {
        navigate(targetUrl);
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error launching studio',
        description: err?.message || 'Could not launch biometric capture studio.',
      });
    } finally {
      setIsLaunching(false);
    }
  };

  const handleCopyLink = async () => {
    if (!student) return;
    try {
      const params = await generateBypassParams();
      const fullUrl = `${window.location.origin}/enroll?${params.toString()}`;
      await navigator.clipboard.writeText(fullUrl);
      toast({
        title: 'Bypass Link Copied!',
        description: `Direct 3D face scan link for ${studentName} copied. Can be opened on any camera tablet or device.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Could not copy capture link.',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-background border-border shadow-2xl rounded-3xl">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 dark:from-emerald-950/40 dark:via-teal-950/40 dark:to-cyan-950/40">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <ScanFace className="h-5 w-5 text-emerald-500" />
              Dedicated 3D Face Capture
            </DialogTitle>
            {studentAdm && (
              <Badge variant="outline" className="font-mono text-xs font-bold border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                ID: {studentAdm}
              </Badge>
            )}
          </div>
          <DialogDescription className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            Apple TrueDepth 360° multi-angle biometric face capture studio
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Target Student Preview */}
          <div className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-border/70 bg-muted/30">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-emerald-500/5 border border-emerald-500/20 flex items-center justify-center font-bold text-sm text-emerald-600 dark:text-emerald-400 overflow-hidden shrink-0 shadow-sm">
              {resolvedAvatar ? (
                <img
                  src={resolvedAvatar}
                  alt={studentName}
                  className="h-full w-full object-cover"
                  onError={() => setResolvedAvatar(null)}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-foreground truncate">{studentName}</h4>
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-bold">Target</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono mt-0.5">
                {studentAdm && <span>ID: {studentAdm}</span>}
                {studentClass && <span>• Class: {studentClass}</span>}
              </div>
            </div>
          </div>

          {/* Mode Selection Heading */}
          <div className="space-y-1">
            <h5 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-emerald-500" />
              Biometric Calibration Mode:
            </h5>
          </div>

          {/* Strategy Options Cards */}
          <div className="grid grid-cols-1 gap-2.5">
            {/* Option A: Erase & Replace (Clean Slate) */}
            <button
              type="button"
              onClick={() => setReplaceExisting(true)}
              className={`relative flex items-start gap-3 p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                replaceExisting
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-sm ring-2 ring-emerald-500/30'
                  : 'border-border/70 bg-card hover:bg-muted/40'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                replaceExisting ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground'
              }`}>
                {replaceExisting && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </div>
              <div>
                <p className="font-bold text-xs text-foreground">Clean Baseline: Erase & Recalibrate</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Recommended: Clears prior face descriptors and performs fresh 3D calibration.
                </p>
              </div>
            </button>

            {/* Option B: Additive Merge */}
            <button
              type="button"
              onClick={() => setReplaceExisting(false)}
              className={`relative flex items-start gap-3 p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                !replaceExisting
                  ? 'border-cyan-500 bg-cyan-500/10 shadow-sm ring-2 ring-cyan-500/30'
                  : 'border-border/70 bg-card hover:bg-muted/40'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                !replaceExisting ? 'border-cyan-500 bg-cyan-500 text-white' : 'border-muted-foreground'
              }`}>
                {!replaceExisting && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </div>
              <div>
                <p className="font-bold text-xs text-foreground">Additive Mode: Merge With Existing Data</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Retains prior photos and appends new lighting and angle models.
                </p>
              </div>
            </button>
          </div>

          {/* Quick Notice */}
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            <span>Opens dedicated full-screen studio with instant staff verification bypass.</span>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <Button
              onClick={() => void handleLaunchStudio(false)}
              disabled={isLaunching}
              className="w-full rounded-xl h-11 font-bold text-sm bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-600 hover:to-cyan-700 text-white shadow-lg shadow-emerald-500/20 gap-2 active:scale-95 transition-all"
            >
              {isLaunching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening Studio...
                </>
              ) : (
                <>
                  <ScanFace className="h-4 w-4" />
                  Launch Dedicated 3D Studio
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </>
              )}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLaunchStudio(true)}
                disabled={isLaunching}
                className="rounded-xl h-9 text-xs font-semibold gap-1.5 border-border"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                Open in New Tab
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopyLink()}
                disabled={isLaunching}
                className="rounded-xl h-9 text-xs font-semibold gap-1.5 border-border"
              >
                <Copy className="h-3.5 w-3.5 text-cyan-500" />
                Copy Bypass Link
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CaptureFaceDialog;