import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { storage as appwriteStorage, APPWRITE_CONFIG } from '@/integrations/appwrite/client';
import { storageFileId } from '@/integrations/appwrite/storage-id';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import type { MonitorStudent } from '@/services/enrollment/monitor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const Student3DFaceModelViewer = lazy(() => import('./Student3DFaceModelViewer'));

type Artifact = {
  sample_count?: number;
  descriptor_dimensions?: number;
  sample_images?: string[];
  point_cloud_3d_equivalent?: { id: number; x: number; y: number; z: number }[];
  averaged_descriptor?: number[];
  descriptor_cloud?: number[][];
  sample_poses?: string[];
};

export default function StudentStoredFaceAssets({ student }: { student: MonitorStudent }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setArtifact(null);
    setImages([]);
    setError('');
    setLoading(true);

    void (async () => {
      try {
        let loadedModel: Artifact | null = null;
        let loadedImages: string[] = [];

        // 1. Try loading stored model artifact from Supabase storage if path exists
        const cleanAdm = student.admission_number?.trim();
        const candidatePaths = [
          student.modelPath,
          cleanAdm ? `students/${cleanAdm}/models/face-model.json` : null,
          cleanAdm ? `face_models/${cleanAdm}.json` : null,
        ].filter(Boolean) as string[];

        for (const candidatePath of candidatePaths) {
          if (loadedModel) break;
          try {
            const { data, error: supaErr } = await supabase.storage
              .from('student-registration-faces')
              .download(candidatePath);
            if (!supaErr && data) {
              const text = await data.text();
              loadedModel = JSON.parse(text) as Artifact;
              break;
            }
          } catch (e) {
            console.warn('[StudentStoredFaceAssets] Supabase model download note:', e);
          }

          // Fallback: Check Appwrite storage for the model file
          if (!loadedModel) {
            try {
              const fileId = storageFileId(candidatePath);
              const fileData = await appwriteStorage.getFileDownload(
                APPWRITE_CONFIG.buckets.studentRegistrationFaces,
                fileId
              );
              if (fileData) {
                const text = await new Response(fileData).text();
                loadedModel = JSON.parse(text) as Artifact;
                break;
              }
            } catch (appwriteErr) {
              console.warn('[StudentStoredFaceAssets] Appwrite model download note:', appwriteErr);
            }
          }
        }

        // 2. If no artifact loaded from storage or descriptor vector missing, query face_descriptors table
        if (!loadedModel?.averaged_descriptor && cleanAdm) {
          try {
            const { data: descRows, error: descErr } = await supabase
              .from('face_descriptors')
              .select('descriptor, metadata, image_url')
              .or(`student_id.ilike.${cleanAdm},user_id.ilike.${cleanAdm}`)
              .limit(25);

            if (!descErr && descRows && descRows.length > 0) {
              const cloud: number[][] = [];
              const poses: string[] = [];
              const dbImages: string[] = [];

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
                const pose = (row.metadata as Record<string, any>)?.pose;
                if (pose && typeof pose === 'string') poses.push(pose);
                if (row.image_url) dbImages.push(row.image_url);
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
                  ...loadedModel,
                  sample_count: cloud.length,
                  descriptor_dimensions: dim,
                  averaged_descriptor: avg,
                  descriptor_cloud: cloud,
                  sample_poses: poses.length > 0 ? poses : ['front', 'left', 'right', 'up', 'down'],
                  sample_images: loadedModel?.sample_images?.length ? loadedModel.sample_images : dbImages,
                };
              }
            }
          } catch (queryErr) {
            console.warn('[StudentStoredFaceAssets] face_descriptors query error:', queryErr);
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

        // 4. Resolve sample image URLs
        if (loadedModel?.sample_images && loadedModel.sample_images.length > 0) {
          loadedImages = await Promise.all(
            loadedModel.sample_images
              .filter(
                (img) =>
                  typeof img === 'string' &&
                  (/^data:image\/(jpeg|png|webp);base64,/.test(img) || /^https?:\/\//.test(img) || !img.includes(':'))
              )
              .map((img) => resolveStudentPhotoUrl(img))
          );
        }

        if (active) {
          setArtifact(loadedModel);
          setImages(loadedImages);
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

  return (
    <section className="mt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-foreground">Biometric Face Assets & 3D Model</h4>
        {artifact?.sample_count ? (
          <Badge variant="outline" className="text-[10px] font-mono text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
            {artifact.sample_count} samples · {artifact.descriptor_dimensions || 128}D
          </Badge>
        ) : null}
      </div>

      {/* Primary & Profile Photos */}
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Primary face photo', student.primaryPhotoUrl || student.avatarUrl],
          ['Profile / ID-card photo', student.profilePhotoUrl || student.avatarUrl],
        ].map(([label, url]) => (
          <figure key={label} className="rounded-xl border border-border/40 overflow-hidden bg-card/40">
            <div className="aspect-square bg-slate-950 flex items-center justify-center">
              {url ? (
                <img src={url} alt={label} className="h-full w-full object-contain" loading="lazy" />
              ) : (
                <p className="p-3 text-xs text-muted-foreground">No saved photo</p>
              )}
            </div>
            <figcaption className="p-2 text-xs text-foreground/80 font-medium">{label}</figcaption>
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
                sampleCount={artifact?.sample_count || artifact?.descriptor_cloud?.length || images.length || (student.samples?.length || 10)}
                samplePoses={artifact?.sample_poses || ['front', 'left', 'right', 'up', 'down']}
                studentName={student.name}
                admissionNumber={student.admission_number}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Captured Training Samples Gallery */}
      {images.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-foreground/90">Captured Multi-Angle Training Samples ({images.length})</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {images.map((image, index) => (
              <figure key={index} className="rounded-xl border border-border/40 overflow-hidden bg-card/40">
                <img src={image} alt={`Saved face sample ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
                <figcaption className="p-1.5 text-[11px] text-muted-foreground">Sample {index + 1}</figcaption>
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
    </section>
  );
}
