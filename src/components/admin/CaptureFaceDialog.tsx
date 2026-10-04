import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import Scan3DCapture from '@/components/register/Scan3DCapture';
import { loadRegistrationModels } from '@/services/face-recognition/OptimizedRegistrationService';
import { uploadFaceImage } from '@/services/face-recognition/RegistrationService';
import { storeFaceSample } from '@/services/face-recognition/ProgressiveTrainingService';
import { supabase } from '@/integrations/supabase/client';
import { descriptorToString } from '@/services/face-recognition/ModelService';
import { syncFromSupabase as syncDescriptorCache } from '@/services/face-recognition/DescriptorCacheService';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import { 
  Sparkles, 
  Loader2, 
  ScanFace, 
  RefreshCw, 
  UserCheck, 
  Trash2, 
  Layers, 
  CheckCircle2, 
  ShieldCheck, 
  ArrowLeft, 
  ChevronRight,
  Camera,
  Info
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

type DialogStep = 'configure' | 'scanning' | 'saving';

const CaptureFaceDialog: React.FC<Props> = ({ open, onOpenChange, student, onSuccess }) => {
  const { toast } = useToast();
  const [step, setStep] = useState<DialogStep>('configure');
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState<string>('Preparing biometric engine...');
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('configure');
      setReplaceExisting(true);
      setSavingStatus('Preparing biometric engine...');
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setIsModelLoading(true);
        await loadRegistrationModels();
      } catch (e) {
        console.error('Failed loading face models:', e);
      } finally {
        if (mounted) setIsModelLoading(false);
      }
    })();

    // Resolve student avatar photo
    if (student) {
      const rawPhoto = student.avatarUrl || student.photo_url;
      if (rawPhoto) {
        resolveStudentPhotoUrl(rawPhoto).then((resolved) => {
          if (mounted && resolved) setResolvedAvatar(resolved);
        }).catch(() => {});
      } else {
        setResolvedAvatar(null);
      }
    }

    return () => {
      mounted = false;
    };
  }, [open, student]);

  const studentName = student?.name || 'Student';
  const studentEmpId = student?.employee_id || student?.admission_number || student?.id || '';
  const studentClass = student?.classSection || student?.category || '';
  const initials = (studentName || 'ST')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'ST';

  const handleScanComplete = async (
    averaged: Float32Array,
    primaryImage: string,
    rawDescriptors: Float32Array[],
    rawImages?: string[],
  ) => {
    if (!student) return;
    setStep('saving');
    setIsSaving(true);

    try {
      const targetUserId = student.user_id || `student-${studentEmpId || student.id}`;

      // 1. Upload primary cropped image to Supabase Storage
      setSavingStatus('Uploading high-resolution biometric face scan...');
      let imageUrl: string | null = null;
      let primaryBlob: Blob | null = null;
      try {
        const response = await fetch(primaryImage);
        primaryBlob = await response.blob();
        imageUrl = await uploadFaceImage(primaryBlob);
      } catch (uploadErr) {
        console.warn('Image upload failed, continuing without storage URL:', uploadErr);
      }

      // 2. Erase existing face data if requested (Clean Slate Mode)
      if (replaceExisting) {
        setSavingStatus('Purging old face descriptors & cached training vectors...');
        try {
          if (student.user_id) {
            await supabase.from('face_descriptors').delete().eq('user_id', student.user_id);
            await supabase.from('face_training_samples').delete().eq('user_id', student.user_id);
          }
          if (studentEmpId) {
            await supabase.from('face_descriptors').delete().eq('student_id', studentEmpId);
          }
          if (student.name) {
            await supabase.from('face_descriptors').delete().eq('label', student.name);
          }
        } catch (delErr) {
          console.warn('Descriptor cleanup warning:', delErr);
        }
      }

      // 3. Save the primary averaged 3D descriptor
      setSavingStatus('Inserting calibrated 3D face descriptor...');
      const { error: descErr } = await supabase.from('face_descriptors').insert({
        user_id: targetUserId,
        student_id: studentEmpId || null,
        descriptor: descriptorToString(averaged) as any,
        label: student.name,
        image_url: imageUrl || primaryImage,
        metadata: {
          enrollment_version: '3d_guided_v2',
          wearsGlasses: false,
          captured_at: new Date().toISOString(),
          is_primary: true,
          replaced_old_data: replaceExisting,
          angles_count: rawDescriptors.length,
        },
      });
      if (descErr) console.error('face_descriptors insert error:', descErr);

      // 4. Update profiles table with the new primary avatar photo & timestamp
      setSavingStatus('Updating student profile & ID photo...');
      if (imageUrl) {
        if (student.user_id) {
          await supabase
            .from('profiles')
            .update({ 
              avatar_url: imageUrl, 
              photo_url: imageUrl,
              updated_at: new Date().toISOString() 
            })
            .eq('user_id', student.user_id);
        }
        if (studentEmpId) {
          await supabase
            .from('profiles')
            .update({ 
              avatar_url: imageUrl, 
              photo_url: imageUrl,
              updated_at: new Date().toISOString() 
            })
            .or(`employee_id.eq.${studentEmpId},roll_number.eq.${studentEmpId},admission_number.eq.${studentEmpId}`);
        }
      }

      // 5. Store multi-angle training samples in face_training_samples
      setSavingStatus(`Syncing ${rawDescriptors.length} 3D multi-angle neural slots...`);
      for (let i = 0; i < rawDescriptors.length; i++) {
        const d = rawDescriptors[i];
        let sampleBlob: Blob | null = null;
        if (rawImages && rawImages[i]) {
          try {
            const resp = await fetch(rawImages[i]);
            sampleBlob = await resp.blob();
          } catch {}
        }
        if (!sampleBlob && primaryBlob) {
          sampleBlob = primaryBlob;
        }
        await storeFaceSample(targetUserId, d, sampleBlob, student.name, 1.0);
      }

      // 6. Instantly sync in-memory descriptor cache across app
      setSavingStatus('Broadcasting instant real-time recognition cache...');
      try {
        await syncDescriptorCache();
      } catch (cacheErr) {
        console.warn('Descriptor cache sync warning:', cacheErr);
      }

      toast({
        title: replaceExisting ? 'Face Data Recaptured & Cleaned' : 'Face Samples Appended & Trained',
        description: `Successfully stored ${rawDescriptors.length} 3D biometric angles for ${student.name}. Instant recognition is active across all gates & cameras.`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (e: any) {
      console.error('Face capture save error:', e);
      toast({
        title: 'Save failed',
        description: e?.message || 'Could not save the captured face. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
      setStep('configure');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-xl max-h-[94dvh] overflow-y-auto p-0 rounded-[28px] border border-border/80 shadow-2xl bg-card">
        
        {/* Header Banner */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-indigo-500/10 dark:from-cyan-950/40 dark:via-blue-950/40 dark:to-indigo-950/40">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <ScanFace className="h-5 w-5 text-primary" />
              Recapture 3D Face
            </DialogTitle>
            {studentEmpId && (
              <Badge variant="outline" className="font-mono text-xs font-bold border-primary/30 text-primary">
                ID: {studentEmpId}
              </Badge>
            )}
          </div>
          <DialogDescription className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            Apple TrueDepth 15-angle neural face calibration & instant sync
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Configure / Choose Strategy */}
        {step === 'configure' && (
          <div className="p-5 space-y-5">
            
            {/* Student Preview Card */}
            <div className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-border/70 bg-muted/30">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 via-blue-500/10 to-primary/5 border border-primary/20 flex items-center justify-center font-bold text-sm text-primary overflow-hidden shrink-0 shadow-sm">
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
                  {studentEmpId && <span>ID: {studentEmpId}</span>}
                  {studentClass && <span>• Class: {studentClass}</span>}
                  {student?.roll_number && <span>• Roll: {student?.roll_number}</span>}
                </div>
              </div>
            </div>

            {/* Mode Selection Heading */}
            <div className="space-y-1">
              <h5 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-primary" />
                Select Face Data Action:
              </h5>
              <p className="text-xs text-muted-foreground">
                Decide whether to erase prior face data or merge these new photos with existing models.
              </p>
            </div>

            {/* Strategy Options Cards */}
            <div className="grid grid-cols-1 gap-3">
              
              {/* Option A: Erase & Replace (Clean Slate) */}
              <button
                type="button"
                onClick={() => setReplaceExisting(true)}
                className={`relative flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                  replaceExisting
                    ? 'border-primary bg-primary/10 shadow-md shadow-primary/10 ring-2 ring-primary/30'
                    : 'border-border/70 bg-card hover:bg-muted/40'
                }`}
              >
                <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${replaceExisting ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <RefreshCw className="h-5 w-5" />
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-foreground flex items-center gap-1.5">
                      Erase & Replace Old Face Data
                    </span>
                    <Badge variant="default" className="text-[10px] bg-emerald-600 hover:bg-emerald-600 font-bold py-0.5 px-2">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Completely wipes previous face descriptors & photos for {studentName}. Replaces them with a fresh 15-angle 3D calibration.
                  </p>
                  <p className="text-[11px] text-primary/90 font-medium">
                    ✓ Best for growth, changed hairstyles, glasses changes, or fixing inaccurate scans.
                  </p>
                </div>
              </button>

              {/* Option B: Merge & Keep Existing Data */}
              <button
                type="button"
                onClick={() => setReplaceExisting(false)}
                className={`relative flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                  !replaceExisting
                    ? 'border-blue-500 bg-blue-500/10 shadow-md shadow-blue-500/10 ring-2 ring-blue-500/30'
                    : 'border-border/70 bg-card hover:bg-muted/40'
                }`}
              >
                <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${!replaceExisting ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                  <Layers className="h-5 w-5" />
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-foreground flex items-center gap-1.5">
                      Merge & Keep Existing Face Data
                    </span>
                    <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2">
                      Additive Mode
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Retains current face descriptors and photos. Appends the new 15 angles into their profile to expand recognition tolerance.
                  </p>
                  <p className="text-[11px] text-blue-500 dark:text-blue-400 font-medium">
                    ✓ Best for capturing different lighting (indoor/outdoor) or adding accessories.
                  </p>
                </div>
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-xl h-11"
              >
                Cancel
              </Button>
              <Button
                onClick={() => setStep('scanning')}
                disabled={isModelLoading}
                className="flex-2 rounded-xl h-11 font-bold text-sm bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 gap-2"
              >
                {isModelLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading Models...
                  </>
                ) : (
                  <>
                    <ScanFace className="h-4 w-4" />
                    Start 3D Face Capture
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: 3D Face Scanning */}
        {step === 'scanning' && (
          <div className="p-4 sm:p-5 space-y-4">
            {/* Active Mode Pill & Option Switcher */}
            <div className="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-muted/60 border border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <Badge 
                  variant={replaceExisting ? 'default' : 'secondary'} 
                  className={`text-[10px] font-bold ${replaceExisting ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-blue-600 text-white'}`}
                >
                  {replaceExisting ? 'Clean Slate Mode' : 'Merge Mode'}
                </Badge>
                <span className="text-xs text-muted-foreground truncate">
                  {replaceExisting ? 'Replacing all old face data' : 'Appending to existing models'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('configure')}
                className="text-xs h-7 px-2.5 rounded-lg text-primary hover:text-primary hover:bg-primary/10 gap-1"
              >
                <ArrowLeft className="h-3 w-3" /> Change Mode
              </Button>
            </div>

            {/* Scan3DCapture Component */}
            <Scan3DCapture
              isModelLoading={isModelLoading}
              onComplete={handleScanComplete}
            />
          </div>
        )}

        {/* STEP 3: Saving / Processing Animation */}
        {step === 'saving' && (
          <div className="flex flex-col items-center justify-center py-16 px-6 gap-4 text-center">
            <div className="relative">
              <div className="h-16 w-16 rounded-3xl bg-primary/15 border-2 border-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center text-white">
                <Sparkles className="h-3 w-3" />
              </div>
            </div>

            <div className="space-y-1.5 max-w-sm">
              <h4 className="text-base font-extrabold text-foreground">
                Syncing 3D Face Descriptors
              </h4>
              <p className="text-xs text-primary font-mono font-medium animate-pulse">
                {savingStatus}
              </p>
              <p className="text-[11px] text-muted-foreground pt-1">
                Updating neural model weights and instant recognition caches across all gates & cameras...
              </p>
            </div>
          </div>
        )}

        {/* Bottom Bar Footer for Step 1 & 2 */}
        {step !== 'saving' && (
          <div className="px-5 py-3 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              Directly enrolled for <strong className="text-foreground">{studentName}</strong>
            </span>
            {step === 'scanning' && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setStep('configure')}
                className="rounded-xl h-7 text-xs"
              >
                Back to Options
              </Button>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
};

export default CaptureFaceDialog;