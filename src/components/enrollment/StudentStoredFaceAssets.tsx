import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import type { MonitorStudent } from '@/services/enrollment/monitor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  deleteSingleFacePhoto,
  deleteStudentProfilePhoto,
  deleteAllStudentFacePhotos,
} from '@/services/enrollment/photoDeletionService';

const Student3DFaceModelViewer = lazy(() => import('./Student3DFaceModelViewer'));

type Artifact = {
  sample_count?: number;
  descriptor_dimensions?: number;
  sample_images?: string[];
  point_cloud_3d_equivalent?: { id: number; x: number; y: number; z: number }[];
  point_cloud_3d?: { id: number; x: number; y: number; z: number }[];
  canonical_landmarks_3d?: any[];
  face_3d_structure?: any;
  averaged_descriptor?: number[];
  descriptor_cloud?: number[][];
  sample_poses?: string[];
};

interface SampleImageItem {
  id?: string;
  url: string;
  rawUrl?: string;
  pose?: string;
}

export default function StudentStoredFaceAssets({
  student,
  onPhotosChanged,
}: {
  student: MonitorStudent;
  onPhotosChanged?: () => void;
}) {
  const { toast } = useToast();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [sampleItems, setSampleItems] = useState<SampleImageItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  // Local state for primary and profile photos
  const [primaryPhotoUrl, setPrimaryPhotoUrl] = useState<string | null>(
    student.primaryPhotoUrl || student.avatarUrl || null
  );
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(
    student.profilePhotoUrl || student.avatarUrl || null
  );

  // Deletion modals state
  const [photoToDelete, setPhotoToDelete] = useState<{
    type: 'sample' | 'primary' | 'profile';
    item?: SampleImageItem;
    label: string;
  } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setPrimaryPhotoUrl(student.primaryPhotoUrl || student.avatarUrl || null);
    setProfilePhotoUrl(student.profilePhotoUrl || student.avatarUrl || null);
  }, [student.primaryPhotoUrl, student.profilePhotoUrl, student.avatarUrl]);

  useEffect(() => {
    let active = true;
    setArtifact(null);
    setSampleItems([]);
    setError('');
    setLoading(true);

    void (async () => {
      try {
        let loadedModel: Artifact | null = null;
        let loadedItems: SampleImageItem[] = [];
        const cleanAdm = student.admission_number?.trim();

        // 1. Primary authoritative source: query face_descriptors table directly (fast & zero 404s)
        if (cleanAdm) {
          try {
            const { data: descRows, error: descErr } = await supabase
              .from('face_descriptors')
              .select('id, descriptor, metadata, image_url')
              .or(`student_id.ilike.${cleanAdm},user_id.ilike.${cleanAdm}`)
              .limit(25);

            if (!descErr && descRows && descRows.length > 0) {
              const cloud: number[][] = [];
              const poses: string[] = [];
              const rawItems: { id: string; rawUrl: string; pose: string }[] = [];

              for (const row of descRows) {
                let vec = row.descriptor;
                if (typeof vec === 'string') {
                  try {
                    vec = JSON.parse(vec);
                  } catch {
                    // ignore invalid parse
                  }
                }
                if (Array.isArray(vec) && vec.length >= 64) {
                  cloud.push(vec.map(Number));
                }
                let meta: any = row.metadata;
                if (typeof meta === 'string') {
                  try {
                    meta = JSON.parse(meta);
                  } catch {
                    meta = {};
                  }
                }
                const pose = meta?.pose || 'front';
                if (pose !== 'master_centroid') poses.push(pose);
                if (row.image_url) {
                  rawItems.push({ id: row.id, rawUrl: row.image_url, pose });
                }
              }

              if (cloud.length > 0) {
                const dim = cloud[0].length;
                const avg = new Array(dim).fill(0);
                for (const c of cloud) {
                  for (let i = 0; i < dim; i++) {
                    avg[i] += (c[i] || 0) / cloud.length;
                  }
                }

                loadedModel = {
                  sample_count: cloud.length,
                  descriptor_dimensions: dim,
                  averaged_descriptor: avg,
                  descriptor_cloud: cloud,
                  sample_poses: poses.length > 0 ? poses : ['front', 'left', 'right', 'up', 'down'],
                  sample_images: rawItems.map((r) => r.rawUrl),
                };

                // Resolve URLs
                const resolvedList = await Promise.all(
                  rawItems.map(async (item) => ({
                    id: item.id,
                    rawUrl: item.rawUrl,
                    pose: item.pose,
                    url: await resolveStudentPhotoUrl(item.rawUrl),
                  }))
                );
                loadedItems = resolvedList;
              }
            }
          } catch (queryErr) {
            console.warn('[StudentStoredFaceAssets] face_descriptors query error:', queryErr);
          }
        }

        // 2. Optional model artifact from storage only if student.modelPath is explicitly present
        if (!loadedModel && student.modelPath) {
          try {
            const { data, error: supaErr } = await supabase.storage
              .from('student-registration-faces')
              .download(student.modelPath);
            if (!supaErr && data) {
              const text = await data.text();
              if (text.trim().startsWith('{')) {
                loadedModel = JSON.parse(text) as Artifact;
              }
            }
          } catch {
            // Optional model artifact not in storage
          }
        }

        // 3. Fallback: if student has enrolled status or samples, synthesize baseline model so viewer can render
        if (!loadedModel && (student.faceOnFile || student.status === 'completed' || (student.samples && student.samples.length > 0))) {
          loadedModel = {
            sample_count: student.samples?.length || 10,
            descriptor_dimensions: 128,
            sample_poses: student.samples?.map((s) => s.pose) || ['front', 'left', 'right', 'up', 'down'],
            sample_images: [],
          };
        }

        // 4. Resolve fallback sample image URLs if loadedItems is still empty but sample_images present
        if (loadedItems.length === 0 && loadedModel?.sample_images && loadedModel.sample_images.length > 0) {
          const resolved = await Promise.all(
            loadedModel.sample_images
              .filter(
                (img) =>
                  typeof img === 'string' &&
                  (/^data:image\/(jpeg|png|webp);base64,/.test(img) || /^https?:\/\//.test(img) || !img.includes(':'))
              )
              .map(async (rawUrl, idx) => ({
                id: `sample_${idx}`,
                rawUrl,
                url: await resolveStudentPhotoUrl(rawUrl),
                pose: loadedModel?.sample_poses?.[idx] || `angle_${idx + 1}`,
              }))
          );
          loadedItems = resolved;
        }

        if (active) {
          setArtifact(loadedModel);
          setSampleItems(loadedItems);
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load face model.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [student.admission_number, student.modelPath, student.faceOnFile, retry]);

  const has3DModelData = Boolean(
    artifact || student.faceOnFile || (student.samples && student.samples.length > 0)
  );

  const handleConfirmDelete = async () => {
    if (!photoToDelete) return;
    setDeleting(true);

    try {
      if (photoToDelete.type === 'sample') {
        const item = photoToDelete.item;
        await deleteSingleFacePhoto({
          student,
          photoUrl: item?.rawUrl || item?.url,
          descriptorId: item?.id,
        });

        // Update local items immediately
        setSampleItems((prev) => prev.filter((i) => i.id !== item?.id && i.url !== item?.url));
        if (artifact) {
          setArtifact({
            ...artifact,
            sample_count: Math.max(0, (artifact.sample_count || 1) - 1),
          });
        }
        toast({
          title: 'Photo Deleted',
          description: `Captured sample photo removed successfully.`,
        });
      } else if (photoToDelete.type === 'primary') {
        await deleteStudentProfilePhoto({ student, type: 'primary' });
        setPrimaryPhotoUrl(null);
        toast({
          title: 'Photo Deleted',
          description: `Primary face photo removed.`,
        });
      } else if (photoToDelete.type === 'profile') {
        await deleteStudentProfilePhoto({ student, type: 'profile' });
        setProfilePhotoUrl(null);
        toast({
          title: 'Photo Deleted',
          description: `Profile / ID-card photo removed.`,
        });
      }

      setPhotoToDelete(null);
      onPhotosChanged?.();
    } catch (err: any) {
      toast({
        title: 'Delete Failed',
        description: err?.message || 'Could not remove photo.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteAll = async () => {
    setDeleting(true);
    try {
      await deleteAllStudentFacePhotos(student);
      setSampleItems([]);
      setPrimaryPhotoUrl(null);
      setProfilePhotoUrl(null);
      setArtifact(null);
      setConfirmDeleteAll(false);
      toast({
        title: 'All Photos Removed',
        description: `All face enrollment photos and biometric descriptors removed for ${student.name}.`,
      });
      onPhotosChanged?.();
    } catch (err: any) {
      toast({
        title: 'Delete All Failed',
        description: err?.message || 'Could not remove all photos.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-foreground">Biometric Face Assets & 3D Model</h4>
        <div className="flex items-center gap-2">
          {artifact?.sample_count ? (
            <Badge variant="outline" className="text-[10px] font-mono text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
              {artifact.sample_count} samples · {artifact.descriptor_dimensions || 128}D
            </Badge>
          ) : null}
          {(sampleItems.length > 0 || primaryPhotoUrl || profilePhotoUrl) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteAll(true)}
              className="h-6 text-[10px] border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 gap-1 px-2"
            >
              <Trash2 className="h-3 w-3" />
              Remove All Photos
            </Button>
          )}
        </div>
      </div>

      {/* Primary & Profile Photos */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Primary face photo', url: primaryPhotoUrl, type: 'primary' as const },
          { label: 'Profile / ID-card photo', url: profilePhotoUrl, type: 'profile' as const },
        ].map(({ label, url, type }) => (
          <figure key={label} className="group relative rounded-xl border border-border/40 overflow-hidden bg-card/40">
            <div className="aspect-square bg-slate-950 flex items-center justify-center relative">
              {url ? (
                <>
                  <img src={url} alt={label} className="h-full w-full object-contain" loading="lazy" />
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPhotoToDelete({ type, label });
                    }}
                    title={`Delete ${label}`}
                    className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md bg-black/60 hover:bg-rose-600 text-white/80 hover:text-white transition-all shadow-md backdrop-blur-sm"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span className="sr-only">Delete {label}</span>
                  </Button>
                </>
              ) : (
                <p className="p-3 text-xs text-muted-foreground">No saved photo</p>
              )}
            </div>
            <figcaption className="p-2 text-xs text-foreground/80 font-medium flex items-center justify-between">
              <span className="truncate">{label}</span>
              {url && (
                <button
                  type="button"
                  onClick={() => setPhotoToDelete({ type, label })}
                  className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline inline-flex items-center gap-0.5"
                >
                  <Trash2 className="h-2.5 w-2.5" /> Remove
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      {loading && <p role="status" className="text-xs text-muted-foreground animate-pulse">Loading 3D face model and biometric vectors…</p>}

      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)} className="h-6 text-[11px]">
            Retry
          </Button>
        </div>
      )}

      {/* Interactive 3D Face Biometric Model Viewer */}
      {has3DModelData && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/90">Interactive 3D Biometric Face Model</span>
            <span className="text-[10px] text-muted-foreground font-mono">Drag to rotate · Scroll to zoom</span>
          </div>
          <div className="w-full h-[380px] rounded-xl overflow-hidden border border-white/10 bg-[#060a14] shadow-2xl relative">
            <Suspense
              fallback={
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-white/50 space-y-2">
                  <div className="h-6 w-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span>Loading 3D Biometric Model…</span>
                </div>
              }
            >
              <Student3DFaceModelViewer
                descriptor={artifact?.averaged_descriptor || artifact?.descriptor_cloud?.[0]}
                descriptorsCloud={artifact?.descriptor_cloud}
                sampleCount={artifact?.sample_count || artifact?.descriptor_cloud?.length || sampleItems.length || (student.samples?.length || 10)}
                samplePoses={artifact?.sample_poses || ['front', 'left', 'right', 'up', 'down']}
                studentName={student.name}
                admissionNumber={student.admission_number}
                face3DStructure={artifact?.face_3d_structure}
                canonicalLandmarks={artifact?.canonical_landmarks_3d || artifact?.face_3d_structure?.canonical_landmarks_3d}
                pointCloud3D={artifact?.point_cloud_3d || artifact?.face_3d_structure?.point_cloud_3d}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Captured Training Samples Gallery */}
      {sampleItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/90">
              Captured Multi-Angle Training Samples ({sampleItems.length})
            </span>
            <button
              type="button"
              onClick={() => setConfirmDeleteAll(true)}
              className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline inline-flex items-center gap-1 font-medium"
            >
              <Trash2 className="h-3 w-3" /> Remove All Samples
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {sampleItems.map((item, index) => (
              <figure key={item.id || index} className="group relative rounded-xl border border-border/40 overflow-hidden bg-card/40">
                <div className="relative aspect-square">
                  <img
                    src={item.url}
                    alt={`Saved face sample ${index + 1}`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPhotoToDelete({
                        type: 'sample',
                        item,
                        label: `Sample ${index + 1} (${item.pose || 'angle'})`,
                      });
                    }}
                    title="Delete this sample photo"
                    className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md bg-black/60 hover:bg-rose-600 text-white/80 hover:text-white transition-all shadow-md backdrop-blur-sm"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span className="sr-only">Delete photo</span>
                  </Button>
                </div>
                <figcaption className="p-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
                  <span className="capitalize">{item.pose || `Sample ${index + 1}`}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoToDelete({
                        type: 'sample',
                        item,
                        label: `Sample ${index + 1} (${item.pose || 'angle'})`,
                      })
                    }
                    className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline"
                  >
                    Delete
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {!has3DModelData && !loading && (
        <p className="text-xs text-muted-foreground/80 py-2">
          No 3D biometric face model or descriptor vector stored for this student yet.
        </p>
      )}

      {/* Confirmation Dialog for Single Photo Deletion */}
      <AlertDialog open={Boolean(photoToDelete)} onOpenChange={(open) => !open && !deleting && setPhotoToDelete(null)}>
        <AlertDialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
              <Trash2 className="h-5 w-5" />
              Remove {photoToDelete?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300 text-xs pt-1">
              Are you sure you want to delete this photo for <strong className="text-white">{student.name}</strong>?
              This will remove the photo file and its corresponding biometric descriptor slot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 mt-2">
            <AlertDialogCancel
              disabled={deleting}
              onClick={() => setPhotoToDelete(null)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Yes, Delete Photo'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog for All Photos Deletion */}
      <AlertDialog open={confirmDeleteAll} onOpenChange={(open) => !open && !deleting && setConfirmDeleteAll(false)}>
        <AlertDialogContent className="max-w-md bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
              Remove All Face Photos & Biometrics?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300 text-xs space-y-2 pt-1">
              <p>
                This will permanently delete all captured face angle photos, 3D model structures, and biometric descriptor slots for{' '}
                <strong className="text-white">{student.name}</strong> (<span className="font-mono text-emerald-300">{student.admission_number}</span>).
              </p>
              <p className="text-amber-300/90 font-medium">
                The student's face enrollment will be reset to pending and will require a new biometric scan.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 mt-2">
            <AlertDialogCancel
              disabled={deleting}
              onClick={() => setConfirmDeleteAll(false)}
              className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDeleteAll();
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing All…
                </>
              ) : (
                'Yes, Remove All Photos'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
