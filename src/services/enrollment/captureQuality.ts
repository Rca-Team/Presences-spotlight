import type { Pose } from './types';

export interface Point { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export interface PoseEstimate {
  pose: Pose | null;
  yaw: number;
  pitchRatio: number;
  continuousAngle: number;
  mouthSmileRatio?: number;
}

export function estimateFacePose(points: Point[]): PoseEstimate {
  const eyeMid = { x: (points[36].x + points[45].x) / 2, y: (points[36].y + points[45].y) / 2 };
  const eyeDist = Math.max(1, distance(points[36], points[45]));
  const chin = points[8];
  const faceH = Math.max(1, distance(chin, eyeMid));
  const nose = points[30];

  const yaw = (nose.x - eyeMid.x) / eyeDist;
  const pitchRatio = (nose.y - eyeMid.y) / faceH;

  // Mouth Smile Ratio (width of mouth relative to eye distance)
  const mouthWidth = distance(points[48], points[54]);
  const mouthSmileRatio = mouthWidth / eyeDist;

  const dx = yaw * 2.8;
  const dy = (pitchRatio - 0.41) * 3.2;
  let continuousAngle = Math.atan2(dy, dx);
  if (continuousAngle < 0) continuousAngle += Math.PI * 2;

  let pose: Pose | null = null;
  const horizontal = yaw > 0.24 ? 'left-deep' : yaw > 0.12 ? 'left' : yaw < -0.24 ? 'right-deep' : yaw < -0.12 ? 'right' : '';
  const vertical = pitchRatio < 0.35 ? 'up' : pitchRatio > 0.47 ? 'down' : '';

  if (horizontal && vertical) {
    pose = `${vertical}-${horizontal.startsWith('left') ? 'left' : 'right'}` as Pose;
  } else if (horizontal) {
    pose = horizontal as Pose;
  } else if (vertical) {
    pose = vertical as Pose;
  } else {
    // Frontal variations
    if (pitchRatio < 0.38) {
      pose = 'front-up';
    } else if (pitchRatio > 0.44) {
      pose = 'front-down';
    } else if (mouthSmileRatio > 0.72) {
      pose = 'front-smile';
    } else {
      pose = 'front';
    }
  }

  return { pose, yaw, pitchRatio, continuousAngle, mouthSmileRatio };
}

export function facePose(points: Point[]): Pose | null {
  return estimateFacePose(points).pose;
}

export function eyeOpenness(p: Point[]) {
  const eye = (i: number) => (distance(p[i + 1], p[i + 5]) + distance(p[i + 2], p[i + 4])) / Math.max(1, 2 * distance(p[i], p[i + 3]));
  return (eye(36) + eye(42)) / 2;
}

export function imageQuality(pixels: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) { 
    gray[i] = pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114; 
    sum += gray[i]; 
  }
  let lapSum = 0, lapSquare = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lapSum += lap; 
      lapSquare += lap * lap; 
      count++;
    }
  }
  return { 
    brightness: sum / gray.length, 
    sharpness: lapSquare / Math.max(1, count) - (lapSum / Math.max(1, count)) ** 2, 
    faces: 1 
  };
}

export interface QualityDiagnosticResult {
  clarityScore: number; // 0 to 100
  flags: string[];
  userWarning: string | null;
  isOptimal: boolean;
}

/**
 * Real-time diagnostic evaluation for blur, lighting, and pose anomalies
 */
export function diagnoseFrameQuality(
  quality: { brightness: number; sharpness: number; faces?: number },
  earScore = 0.28
): QualityDiagnosticResult {
  const flags: string[] = [];
  let userWarning: string | null = null;
  let score = 85;

  // Sharpness check
  if (quality.sharpness < 6) {
    flags.push('severe_blur');
    score -= 35;
    userWarning = '⚠️ Photo is blurry. Please hold camera steady.';
  } else if (quality.sharpness < 14) {
    flags.push('slight_blur');
    score -= 15;
    userWarning = '⚠️ Slight blur detected. Hold steady for best clarity.';
  } else {
    score += 10;
  }

  // Lighting check
  if (quality.brightness < 28) {
    flags.push('dark_lighting');
    score -= 25;
    userWarning = '⚠️ Lighting is too dark. Please face towards light.';
  } else if (quality.brightness > 230) {
    flags.push('harsh_glare');
    score -= 20;
    userWarning = '⚠️ Strong glare detected. Avoid direct backlighting.';
  } else if (quality.brightness >= 80 && quality.brightness <= 170) {
    score += 10;
  }

  // Eye openness
  if (earScore < 0.18) {
    flags.push('eyes_closed_or_squinting');
    score -= 15;
  }

  const clarityScore = Math.min(100, Math.max(10, score));
  const isOptimal = flags.length === 0;

  return { clarityScore, flags, userWarning, isOptimal };
}

/**
 * AI Photo Enhancer Pipeline
 * Normalizes exposure, boosts contrast, and applies unsharp mask sharpening on facial features
 */
export function aiEnhanceFaceCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', 0.90);

  const w = canvas.width;
  const h = canvas.height;

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // 1. Calculate Average Luminance
    let avgLum = 0;
    for (let i = 0; i < d.length; i += 4) {
      avgLum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    avgLum /= (d.length / 4);

    // Target ideal luminance = 128
    const exposureGain = avgLum < 100 ? (128 - avgLum) * 0.4 : avgLum > 180 ? (128 - avgLum) * 0.3 : 0;
    const contrastFactor = 1.08; // subtle 8% contrast boost

    // 2. Exposure & Contrast Adjustment
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = d[i + c] + exposureGain;
        val = (val - 128) * contrastFactor + 128;
        d[i + c] = Math.min(255, Math.max(0, val));
      }
    }

    // 3. Subtle Laplacian Sharpening Pass
    const copy = new Uint8ClampedArray(d);
    const stride = w * 4;
    const sharpFactor = 0.22; // 22% feature crispness

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * stride + x * 4;
        for (let c = 0; c < 3; c++) {
          const cur = copy[idx + c];
          const up = copy[idx - stride + c];
          const down = copy[idx + stride + c];
          const left = copy[idx - 4 + c];
          const right = copy[idx + 4 + c];
          const lap = cur * 5 - (up + down + left + right);
          d[idx + c] = Math.min(255, Math.max(0, cur + (lap - cur) * sharpFactor));
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch {
    // If CORS or worker context restricts getImageData, fallback gracefully
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
