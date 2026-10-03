import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

let landmarker: FaceLandmarker | null = null;
let loading: Promise<FaceLandmarker> | null = null;

async function initLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;
  if (loading) return loading;

  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
    );
    const m = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    landmarker = m;
    return m;
  })();

  return loading;
}

export async function warmupFaceLandmarker(): Promise<void> {
  await initLandmarker();
}

export interface AdvancedPose {
  yaw: number;
  pitch: number;
  roll: number;
  faceDetected: boolean;
  box?: { x: number, y: number, width: number, height: number };
}

export async function detectFacePose(
  video: HTMLVideoElement,
  timestampMs: number,
): Promise<AdvancedPose> {
  const m = await initLandmarker();
  if (video.readyState < 2 || video.videoWidth === 0) {
    return { yaw: 0, pitch: 0, roll: 0, faceDetected: false };
  }

  const result = m.detectForVideo(video, timestampMs);
  
  if (!result.facialTransformationMatrixes || result.facialTransformationMatrixes.length === 0 || !result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { yaw: 0, pitch: 0, roll: 0, faceDetected: false };
  }

  // Get transformation matrix for the first face
  const matrix = result.facialTransformationMatrixes[0].data;
  
  // Matrix is a 4x4 array (16 elements), row-major.
  // m00 m01 m02 m03
  // m10 m11 m12 m13
  // m20 m21 m22 m23
  // m30 m31 m32 m33
  const m00 = matrix[0], m01 = matrix[1], m02 = matrix[2];
  const m10 = matrix[4], m11 = matrix[5], m12 = matrix[6];
  const m20 = matrix[8], m21 = matrix[9], m22 = matrix[10];

  // Euler angles from rotation matrix (Pitch, Yaw, Roll)
  const sy = Math.sqrt(m00 * m00 + m10 * m10);
  const singular = sy < 1e-6;

  let pitch, yaw, roll;
  if (!singular) {
    pitch = Math.atan2(m21, m22);
    yaw = Math.atan2(-m20, sy);
    roll = Math.atan2(m10, m00);
  } else {
    pitch = Math.atan2(-m12, m11);
    yaw = Math.atan2(-m20, sy);
    roll = 0;
  }

  // Bounding box from landmarks
  const landmarks = result.faceLandmarks[0];
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  
  const width = (maxX - minX) * video.videoWidth;
  const height = (maxY - minY) * video.videoHeight;
  const x = minX * video.videoWidth;
  const y = minY * video.videoHeight;

  return {
    yaw,
    pitch,
    roll,
    faceDetected: true,
    box: { x, y, width, height }
  };
}
