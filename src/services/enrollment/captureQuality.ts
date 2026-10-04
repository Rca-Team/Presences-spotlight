import type { Pose } from './types';

export interface Point { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export interface PoseEstimate {
  pose: Pose | null;
  yaw: number;
  pitchRatio: number;
  continuousAngle: number;
  mouthSmileRatio?: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  faceWidth: number;
  faceHeight: number;
  faceCoverageRatio: number;
}

export function estimateFacePose(points: Point[], videoW = 480): PoseEstimate {
  const eyeMid = { x: (points[36].x + points[45].x) / 2, y: (points[36].y + points[45].y) / 2 };
  const eyeDist = Math.max(1, distance(points[36], points[45]));
  const chin = points[8];
  const faceH = Math.max(1, distance(chin, eyeMid));
  const nose = points[30];

  const yaw = (nose.x - eyeMid.x) / eyeDist;
  const pitchRatio = (nose.y - eyeMid.y) / faceH;

  // Degrees approximation
  const yawDeg = Math.round(yaw * 85);
  const pitchDeg = Math.round((pitchRatio - 0.41) * 115);
  const rollDeg = Math.round(Math.atan2(points[45].y - points[36].y, points[45].x - points[36].x) * (180 / Math.PI));

  // Mouth Smile Ratio (width of mouth relative to eye distance)
  const mouthWidth = distance(points[48], points[54]);
  const mouthSmileRatio = mouthWidth / eyeDist;

  const jawWidth = distance(points[0], points[16]);
  const faceWidth = Math.max(jawWidth, eyeDist * 2.3);
  const faceCoverageRatio = faceWidth / Math.max(1, videoW);

  const dx = yaw * 2.8;
  const dy = (pitchRatio - 0.41) * 3.2;
  let continuousAngle = Math.atan2(dy, dx);
  if (continuousAngle < 0) continuousAngle += Math.PI * 2;

  let pose: Pose | null = null;
  const horizontal = yaw > 0.23 ? 'left-deep' : yaw > 0.11 ? 'left' : yaw < -0.23 ? 'right-deep' : yaw < -0.11 ? 'right' : '';
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

  return { 
    pose, 
    yaw, 
    pitchRatio, 
    continuousAngle, 
    mouthSmileRatio,
    yawDeg,
    pitchDeg,
    rollDeg,
    faceWidth,
    faceHeight: faceH,
    faceCoverageRatio
  };
}

export function facePose(points: Point[]): Pose | null {
  return estimateFacePose(points).pose;
}

export function eyeOpenness(p: Point[]): number {
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

  // Left vs Right hemisphere luminance for symmetry reasoning
  let leftSum = 0, leftCount = 0;
  let rightSum = 0, rightCount = 0;
  const halfW = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x < halfW) {
        leftSum += gray[idx];
        leftCount++;
      } else {
        rightSum += gray[idx];
        rightCount++;
      }
    }
  }

  const leftLum = leftSum / Math.max(1, leftCount);
  const rightLum = rightSum / Math.max(1, rightCount);
  const lumDiff = Math.abs(leftLum - rightLum);
  const symmetry = Math.max(10, Math.round(100 - (lumDiff / 128) * 100));

  return { 
    brightness: sum / gray.length, 
    sharpness: lapSquare / Math.max(1, count) - (lapSum / Math.max(1, count)) ** 2, 
    faces: 1,
    leftLum,
    rightLum,
    symmetry,
  };
}

export interface QualityDiagnosticResult {
  clarityScore: number; // 0 to 100
  flags: string[];
  userWarning: string | null;
  isOptimal: boolean;
}

export function diagnoseFrameQuality(
  quality: { brightness: number; sharpness: number; faces?: number; symmetry?: number },
  earScore = 0.28
): QualityDiagnosticResult {
  const flags: string[] = [];
  let userWarning: string | null = null;
  let score = 85;

  // Sharpness check
  if (quality.sharpness < 6) {
    flags.push('severe_blur');
    score -= 35;
    userWarning = '⚠️ Frame is blurry. Please hold steady.';
  } else if (quality.sharpness < 14) {
    flags.push('slight_blur');
    score -= 15;
    userWarning = '⚠️ Slight motion blur detected. Hold still.';
  } else {
    score += 10;
  }

  // Lighting check
  if (quality.brightness < 30) {
    flags.push('dark_lighting');
    score -= 25;
    userWarning = '⚠️ Lighting is dim. Please face toward a light source.';
  } else if (quality.brightness > 230) {
    flags.push('harsh_glare');
    score -= 20;
    userWarning = '⚠️ Harsh glare / backlighting. Avoid bright windows behind you.';
  } else if (quality.brightness >= 80 && quality.brightness <= 170) {
    score += 10;
  }

  // Lighting symmetry / shadows
  if (quality.symmetry !== undefined && quality.symmetry < 55) {
    flags.push('harsh_side_shadow');
    score -= 10;
    userWarning = '⚠️ Uneven lighting detected. Turn slightly toward the room light.';
  }

  // Eye openness
  if (earScore < 0.18) {
    flags.push('eyes_closed_or_squinting');
    score -= 15;
    userWarning = '👀 Eyes appear closed or squinting. Keep eyes open naturally.';
  }

  const clarityScore = Math.min(100, Math.max(10, score));
  const isOptimal = flags.length === 0;

  return { clarityScore, flags, userWarning, isOptimal };
}

// ---------------------------------------------------------------------------
// ADVANCED REASONING & SPATIAL ALIGNMENT ENGINE
// ---------------------------------------------------------------------------

export interface AIReasoningResult {
  distanceStatus: 'too_far' | 'too_close' | 'optimal';
  distanceAdvice: string;
  coveragePercent: number;

  lightingStatus: 'balanced' | 'left_shadow' | 'right_shadow' | 'backlit' | 'dim' | 'glare';
  lightingAdvice: string;
  lightingSymmetry: number;

  angles: {
    yaw: number;
    pitch: number;
    roll: number;
  };

  targetAlignment: number; // 0 to 100
  targetSatisfied: boolean;
  guidanceReasoning: string;

  liveness: {
    eyesOpen: boolean;
    smileRatio: number;
    smileConfidence: number;
  };

  adaptiveAssisted: boolean;
}

export function evaluateSpatialReasoning(
  points: Point[],
  videoW: number,
  targetPose: Pose | null,
  quality: { brightness: number; sharpness: number; leftLum?: number; rightLum?: number; symmetry?: number },
  earScore = 0.28,
  holdDurationMs = 0
): AIReasoningResult {
  const poseEst = estimateFacePose(points, videoW);
  const { yawDeg, pitchDeg, rollDeg, faceCoverageRatio, mouthSmileRatio = 0.6 } = poseEst;

  // 1. Distance reasoning
  const coveragePercent = Math.round(faceCoverageRatio * 100);
  let distanceStatus: 'too_far' | 'too_close' | 'optimal' = 'optimal';
  let distanceAdvice = 'Optimal distance (~50 cm)';

  if (faceCoverageRatio < 0.22) {
    distanceStatus = 'too_far';
    distanceAdvice = 'Move closer to the camera (~50 cm)';
  } else if (faceCoverageRatio > 0.58) {
    distanceStatus = 'too_close';
    distanceAdvice = 'Move slightly back for full perimeter capture';
  }

  // 2. Lighting reasoning
  let lightingStatus: 'balanced' | 'left_shadow' | 'right_shadow' | 'backlit' | 'dim' | 'glare' = 'balanced';
  let lightingAdvice = 'Lighting is clear and well-balanced';
  const symmetry = quality.symmetry ?? 90;

  if (quality.brightness < 32) {
    lightingStatus = 'dim';
    lightingAdvice = 'Lighting too dim — face a light source';
  } else if (quality.brightness > 225) {
    lightingStatus = 'glare';
    lightingAdvice = 'Harsh glare — move away from direct backlight';
  } else if ((quality.leftLum ?? 100) - (quality.rightLum ?? 100) > 36) {
    lightingStatus = 'right_shadow';
    lightingAdvice = 'Shadow on right cheek — turn slightly toward room light';
  } else if ((quality.rightLum ?? 100) - (quality.leftLum ?? 100) > 36) {
    lightingStatus = 'left_shadow';
    lightingAdvice = 'Shadow on left cheek — turn slightly toward room light';
  }

  // 3. Target Alignment & Reasoning
  let targetSatisfied = false;
  let targetAlignment = 40;
  let guidanceReasoning = 'Align face with target marker';

  const smileConfidence = Math.min(100, Math.max(0, Math.round(((mouthSmileRatio - 0.6) / 0.2) * 100)));

  // Adaptive threshold: If user holds near target for > 1600ms, soften tolerance by 25%
  const adaptiveAssisted = holdDurationMs > 1600;
  const toleranceMultiplier = adaptiveAssisted ? 1.35 : 1.0;

  if (!targetPose || targetPose === 'master-hd') {
    targetSatisfied = Math.abs(yawDeg) <= 8 * toleranceMultiplier && Math.abs(pitchDeg) <= 9 * toleranceMultiplier;
    targetAlignment = Math.max(10, Math.round(100 - Math.hypot(yawDeg, pitchDeg) * 4));
    guidanceReasoning = targetSatisfied ? 'Perfect center baseline! Hold still…' : 'Center face and hold still for master calibration';
  } else if (targetPose === 'front') {
    targetSatisfied = Math.abs(yawDeg) <= 10 * toleranceMultiplier && Math.abs(pitchDeg) <= 10 * toleranceMultiplier;
    targetAlignment = Math.max(10, Math.round(100 - Math.hypot(yawDeg, pitchDeg) * 3.5));
    guidanceReasoning = targetSatisfied ? 'Great center alignment! Hold still…' : 'Look straight ahead (Neutral)';
  } else if (targetPose === 'front-smile') {
    const isFront = Math.abs(yawDeg) <= 12 * toleranceMultiplier && Math.abs(pitchDeg) <= 11 * toleranceMultiplier;
    const isSmiling = mouthSmileRatio > (adaptiveAssisted ? 0.67 : 0.72);
    targetSatisfied = isFront && isSmiling;
    targetAlignment = isSmiling ? Math.min(100, Math.max(50, smileConfidence)) : 45;
    guidanceReasoning = isSmiling ? 'Beautiful natural smile! Capturing…' : 'Smile naturally 😊';
  } else if (targetPose === 'front-up') {
    const isUp = pitchDeg < -8 / toleranceMultiplier;
    targetSatisfied = isUp && Math.abs(yawDeg) <= 14 * toleranceMultiplier;
    targetAlignment = isUp ? 90 : Math.max(20, Math.round(50 - pitchDeg * 2));
    guidanceReasoning = isUp ? 'Perfect chin tilt! Hold still…' : 'Lift your chin slightly ⬆️';
  } else if (targetPose === 'front-down') {
    const isDown = pitchDeg > 8 / toleranceMultiplier;
    targetSatisfied = isDown && Math.abs(yawDeg) <= 14 * toleranceMultiplier;
    targetAlignment = isDown ? 90 : Math.max(20, Math.round(50 + pitchDeg * 2));
    guidanceReasoning = isDown ? 'Perfect lower angle! Hold still…' : 'Lower your chin slightly ⬇️';
  } else if (targetPose === 'left') {
    const isLeft = yawDeg > 9 / toleranceMultiplier && yawDeg < 28 * toleranceMultiplier;
    targetSatisfied = isLeft;
    targetAlignment = Math.min(100, Math.max(15, Math.round(100 - Math.abs(yawDeg - 16) * 4)));
    guidanceReasoning = isLeft ? 'Turn angle locked! Hold still…' : yawDeg <= 9 ? 'Turn gently to your left ⬅️ (15°)' : 'Turn back slightly toward center';
  } else if (targetPose === 'left-deep') {
    const isLeftDeep = yawDeg >= 22 / toleranceMultiplier;
    targetSatisfied = isLeftDeep;
    targetAlignment = Math.min(100, Math.max(15, Math.round(100 - Math.abs(yawDeg - 30) * 3.5)));
    guidanceReasoning = isLeftDeep ? 'Deep profile locked! Hold still…' : 'Turn further to your left ⬅️ (30°)';
  } else if (targetPose === 'right') {
    const isRight = yawDeg < -9 / toleranceMultiplier && yawDeg > -28 * toleranceMultiplier;
    targetSatisfied = isRight;
    targetAlignment = Math.min(100, Math.max(15, Math.round(100 - Math.abs(yawDeg - (-16)) * 4)));
    guidanceReasoning = isRight ? 'Turn angle locked! Hold still…' : yawDeg >= -9 ? 'Turn gently to your right ➡️ (15°)' : 'Turn back slightly toward center';
  } else if (targetPose === 'right-deep') {
    const isRightDeep = yawDeg <= -22 / toleranceMultiplier;
    targetSatisfied = isRightDeep;
    targetAlignment = Math.min(100, Math.max(15, Math.round(100 - Math.abs(yawDeg - (-30)) * 3.5)));
    guidanceReasoning = isRightDeep ? 'Deep profile locked! Hold still…' : 'Turn further to your right ➡️ (30°)';
  } else if (targetPose === 'up') {
    targetSatisfied = pitchDeg <= -14 / toleranceMultiplier;
    targetAlignment = Math.min(100, Math.max(20, Math.round(50 - pitchDeg * 2.5)));
    guidanceReasoning = targetSatisfied ? 'Upward angle locked! Hold still…' : 'Tilt head up ⬆️ (25°)';
  } else if (targetPose === 'down') {
    targetSatisfied = pitchDeg >= 14 / toleranceMultiplier;
    targetAlignment = Math.min(100, Math.max(20, Math.round(50 + pitchDeg * 2.5)));
    guidanceReasoning = targetSatisfied ? 'Downward angle locked! Hold still…' : 'Tilt head down ⬇️ (20°)';
  } else if (targetPose === 'up-left') {
    targetSatisfied = yawDeg >= 10 / toleranceMultiplier && pitchDeg <= -8 / toleranceMultiplier;
    targetAlignment = targetSatisfied ? 92 : 45;
    guidanceReasoning = targetSatisfied ? 'Upper left locked! Hold still…' : 'Look up and left ↖️';
  } else if (targetPose === 'up-right') {
    targetSatisfied = yawDeg <= -10 / toleranceMultiplier && pitchDeg <= -8 / toleranceMultiplier;
    targetAlignment = targetSatisfied ? 92 : 45;
    guidanceReasoning = targetSatisfied ? 'Upper right locked! Hold still…' : 'Look up and right ↗️';
  } else if (targetPose === 'down-left') {
    targetSatisfied = yawDeg >= 10 / toleranceMultiplier && pitchDeg >= 8 / toleranceMultiplier;
    targetAlignment = targetSatisfied ? 92 : 45;
    guidanceReasoning = targetSatisfied ? 'Lower left locked! Hold still…' : 'Look down and left ↙️';
  } else if (targetPose === 'down-right') {
    targetSatisfied = yawDeg <= -10 / toleranceMultiplier && pitchDeg >= 8 / toleranceMultiplier;
    targetAlignment = targetSatisfied ? 92 : 45;
    guidanceReasoning = targetSatisfied ? 'Lower right locked! Hold still…' : 'Look down and right ↘️';
  }

  targetAlignment = Math.min(100, Math.max(5, targetAlignment));

  return {
    distanceStatus,
    distanceAdvice,
    coveragePercent,
    lightingStatus,
    lightingAdvice,
    lightingSymmetry: symmetry,
    angles: { yaw: yawDeg, pitch: pitchDeg, roll: rollDeg },
    targetAlignment,
    targetSatisfied,
    guidanceReasoning,
    liveness: {
      eyesOpen: earScore >= 0.18,
      smileRatio: mouthSmileRatio,
      smileConfidence,
    },
    adaptiveAssisted,
  };
}

// ---------------------------------------------------------------------------
// AI SPEECH SYNTHESIZER (INTELLIGENT VOICE COACH)
// ---------------------------------------------------------------------------

class AISpeechVoiceCoach {
  private lastSpoken = '';
  private lastSpokenTime = 0;
  public enabled = true;

  speak(text: string, force = false) {
    if (!this.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const now = Date.now();
    // Debounce duplicate utterances within 3.5 seconds unless forced
    if (!force && this.lastSpoken === text && now - this.lastSpokenTime < 3500) return;
    if (now - this.lastSpokenTime < 1800 && !force) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.02;
      utterance.volume = 0.85;

      const voices = window.speechSynthesis.getVoices();
      const naturalVoice = voices.find((v) => 
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Siri') || v.name.includes('English')) && v.lang.startsWith('en')
      );
      if (naturalVoice) utterance.voice = naturalVoice;

      window.speechSynthesis.speak(utterance);
      this.lastSpoken = text;
      this.lastSpokenTime = now;
    } catch {
      // Speech synthesis not permitted or silent
    }
  }

  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }
}

export const speechCoach = new AISpeechVoiceCoach();

// ---------------------------------------------------------------------------
// AI PHOTO ENHANCER PIPELINE
// ---------------------------------------------------------------------------

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
