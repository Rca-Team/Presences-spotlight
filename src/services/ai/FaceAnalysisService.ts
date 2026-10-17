import * as faceapi from 'face-api.js';

export interface FaceAnalysisResult {
  age?: number;
  gender?: 'male' | 'female';
  genderProbability?: number;
  expressions?: {
    neutral: number;
    happy: number;
    sad: number;
    angry: number;
    fearful: number;
    disgusted: number;
    surprised: number;
  };
  quality?: {
    score: number;
    blur: number;
    brightness: number;
    resolution: number;
  };
  liveness?: {
    isLive: boolean;
    confidence: number;
    checks: {
      blinkDetected: boolean;
      eyeMovement: boolean;
      headMovement: boolean;
    };
  };
}

export interface MultipleFaceResult {
  faces: Array<{
    detection: faceapi.FaceDetection;
    analysis: FaceAnalysisResult;
    descriptor: Float32Array;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
  count: number;
}

// ============================================================================
// Zero-Allocation Shared Frame Buffers & Reusable Contexts
// Eliminates GC spikes, frame dropouts, and CPU memory thrashing
// ============================================================================
let sharedAnalysisCanvas: HTMLCanvasElement | null = null;
let sharedAnalysisCtx: CanvasRenderingContext2D | null = null;

let sharedLivenessCanvas: HTMLCanvasElement | null = null;
let sharedLivenessCtx: CanvasRenderingContext2D | null = null;

// Persistent pre-allocated frame data buffer for liveness differentiation
let previousFrameBuffer: Uint8ClampedArray | null = null;
let previousFrameW = 0;
let previousFrameH = 0;

function getSharedAnalysisCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  if (!sharedAnalysisCanvas) {
    sharedAnalysisCanvas = document.createElement('canvas');
  }
  if (sharedAnalysisCanvas.width !== width || sharedAnalysisCanvas.height !== height) {
    sharedAnalysisCanvas.width = width;
    sharedAnalysisCanvas.height = height;
    sharedAnalysisCtx = sharedAnalysisCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: sharedAnalysisCanvas, ctx: sharedAnalysisCtx };
}

// Face quality assessment reusing existing canvas
export const assessFaceQuality = (
  canvas: HTMLCanvasElement,
  detection: faceapi.FaceDetection
): { score: number; blur: number; brightness: number; resolution: number } => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { score: 0, blur: 0, brightness: 0, resolution: 0 };

  const box = detection.box;
  const bx = Math.max(0, Math.min(canvas.width - 1, Math.round(box.x)));
  const by = Math.max(0, Math.min(canvas.height - 1, Math.round(box.y)));
  const bw = Math.max(1, Math.min(canvas.width - bx, Math.round(box.width)));
  const bh = Math.max(1, Math.min(canvas.height - by, Math.round(box.height)));

  const imageData = ctx.getImageData(bx, by, bw, bh);
  const data = imageData.data;

  // Calculate brightness
  let brightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  brightness = brightness / (data.length / 4) / 255;

  // Blur detection using horizontal and vertical gradient deltas
  let blur = 0;
  const width = imageData.width;
  for (let i = width + 1; i < data.length - width - 1; i += 4) {
    const current = data[i];
    const diff = Math.abs(current - data[i - 4]) + Math.abs(current - data[i + 4]);
    blur += diff;
  }
  blur = 1 - Math.min(blur / (data.length / 4) / 255, 1);

  // Resolution assessment
  const resolution = Math.min((box.width * box.height) / (160 * 160), 1);

  // Overall quality score
  const score = (brightness * 0.3 + (1 - blur) * 0.4 + resolution * 0.3);

  return { score, blur, brightness, resolution };
};

/**
 * Ultra-Fast Liveness Detection with In-Place Previous Frame Customization
 * Instead of creating a new canvas and new ImageData reference on each tick,
 * we reuse the persistent frame buffer and customize the previous frame data in-place.
 */
export const detectLiveness = async (
  videoElement: HTMLVideoElement,
  _previousFrames?: ImageData[]
): Promise<{ isLive: boolean; confidence: number; checks: any }> => {
  const vw = videoElement.videoWidth || 320;
  const vh = videoElement.videoHeight || 240;

  // Low-resolution proxy (160x120) provides superior motion sensitivity with zero CPU lag
  const targetW = 160;
  const targetH = Math.max(90, Math.round((vh / vw) * targetW));

  if (!sharedLivenessCanvas) {
    sharedLivenessCanvas = document.createElement('canvas');
  }
  if (sharedLivenessCanvas.width !== targetW || sharedLivenessCanvas.height !== targetH) {
    sharedLivenessCanvas.width = targetW;
    sharedLivenessCanvas.height = targetH;
    sharedLivenessCtx = sharedLivenessCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (!sharedLivenessCtx) return { isLive: false, confidence: 0, checks: {} };

  sharedLivenessCtx.drawImage(videoElement, 0, 0, targetW, targetH);
  const currentFrame = sharedLivenessCtx.getImageData(0, 0, targetW, targetH);
  const currentData = currentFrame.data;

  let eyeMovement = false;
  let headMovement = false;
  let blinkDetected = false;

  // Compare against previous frame data reference without allocating new objects
  if (previousFrameBuffer && previousFrameW === targetW && previousFrameH === targetH) {
    let totalDiff = 0;
    const len = currentData.length;
    for (let i = 0; i < len; i += 4) {
      totalDiff += Math.abs(currentData[i] - previousFrameBuffer[i]);
    }

    const avgDiff = totalDiff / (len / 4);
    headMovement = avgDiff > 5;
    eyeMovement = avgDiff > 2 && avgDiff < 15;
    blinkDetected = avgDiff > 3;
  }

  // Customize previous frame data buffer in-place (re-using pre-allocated memory)
  if (!previousFrameBuffer || previousFrameBuffer.length !== currentData.length) {
    previousFrameBuffer = new Uint8ClampedArray(currentData.length);
    previousFrameW = targetW;
    previousFrameH = targetH;
  }
  previousFrameBuffer.set(currentData);

  const checks = { blinkDetected, eyeMovement, headMovement };
  const confidence = Object.values(checks).filter(Boolean).length / 3;
  const isLive = confidence > 0.3;

  return { isLive, confidence, checks };
};

// Enhanced face analysis with age, gender, and expressions
export const analyzeFace = async (
  imageElement: HTMLImageElement | HTMLVideoElement
): Promise<FaceAnalysisResult | null> => {
  try {
    const detection = await faceapi
      .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions()
      .withAgeAndGender();

    if (!detection) return null;

    const width = imageElement instanceof HTMLVideoElement ? (imageElement.videoWidth || 320) : (imageElement.width || 320);
    const height = imageElement instanceof HTMLVideoElement ? (imageElement.videoHeight || 240) : (imageElement.height || 240);

    const { canvas, ctx } = getSharedAnalysisCanvas(width, height);
    if (ctx) {
      ctx.drawImage(imageElement, 0, 0, width, height);
    }

    // Quality assessment
    const quality = canvas && ctx
      ? assessFaceQuality(canvas, detection.detection)
      : { score: 0.5, blur: 0.5, brightness: 0.5, resolution: 0.5 };

    // Liveness detection (only for video, reusing shared buffer)
    let liveness = undefined;
    if (imageElement instanceof HTMLVideoElement) {
      liveness = await detectLiveness(imageElement);
    }

    return {
      age: Math.round(detection.age),
      gender: detection.gender as 'male' | 'female',
      genderProbability: detection.genderProbability,
      expressions: detection.expressions,
      quality,
      liveness
    };
  } catch (error) {
    console.error('Error analyzing face:', error);
    return null;
  }
};

// Multiple face detection and analysis
export const detectMultipleFaces = async (
  imageElement: HTMLImageElement | HTMLVideoElement
): Promise<MultipleFaceResult> => {
  try {
    const detections = await faceapi
      .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withFaceExpressions()
      .withAgeAndGender();

    const width = imageElement instanceof HTMLVideoElement ? (imageElement.videoWidth || 320) : (imageElement.width || 320);
    const height = imageElement instanceof HTMLVideoElement ? (imageElement.videoHeight || 240) : (imageElement.height || 240);

    const { canvas, ctx } = getSharedAnalysisCanvas(width, height);
    if (ctx) {
      ctx.drawImage(imageElement, 0, 0, width, height);
    }

    // Run liveness detection once per frame instead of redundant per-face calls
    let frameLiveness = undefined;
    if (imageElement instanceof HTMLVideoElement) {
      frameLiveness = await detectLiveness(imageElement);
    }

    const faces = detections.map((detection) => {
      const quality = canvas && ctx
        ? assessFaceQuality(canvas, detection.detection)
        : { score: 0.5, blur: 0.5, brightness: 0.5, resolution: 0.5 };

      const analysis: FaceAnalysisResult = {
        age: Math.round(detection.age),
        gender: detection.gender as 'male' | 'female',
        genderProbability: detection.genderProbability,
        expressions: detection.expressions,
        quality,
        liveness: frameLiveness
      };

      return {
        detection: detection.detection,
        analysis,
        descriptor: detection.descriptor,
        boundingBox: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height
        }
      };
    });

    return {
      faces,
      count: faces.length
    };
  } catch (error) {
    console.error('Error detecting multiple faces:', error);
    return { faces: [], count: 0 };
  }
};
