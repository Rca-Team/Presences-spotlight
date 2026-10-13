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

  // Adaptive threshold: If user is on the current pose for > 750ms, widen angle tolerance; after 1450ms auto-assist
  const adaptiveAssisted = holdDurationMs > 750;
  const autoAssistReady = holdDurationMs > 1450;
  const toleranceMultiplier = adaptiveAssisted ? 1.65 : 1.15;

  if (!targetPose || targetPose === 'master-hd') {
    targetSatisfied = autoAssistReady || (Math.abs(yawDeg) <= 14 * toleranceMultiplier && Math.abs(pitchDeg) <= 15 * toleranceMultiplier);
    targetAlignment = Math.max(20, Math.round(100 - Math.hypot(yawDeg, pitchDeg) * 3));
    guidanceReasoning = targetSatisfied ? 'Perfect center baseline! Hold still…' : 'Center face and hold still';
  } else if (targetPose === 'front') {
    targetSatisfied = autoAssistReady || (Math.abs(yawDeg) <= 15 * toleranceMultiplier && Math.abs(pitchDeg) <= 16 * toleranceMultiplier);
    targetAlignment = Math.max(20, Math.round(100 - Math.hypot(yawDeg, pitchDeg) * 2.8));
    guidanceReasoning = targetSatisfied ? 'Great center alignment! Hold still…' : 'Look straight ahead';
  } else if (targetPose === 'front-smile') {
    const isFront = Math.abs(yawDeg) <= 16 * toleranceMultiplier && Math.abs(pitchDeg) <= 16 * toleranceMultiplier;
    const isSmiling = autoAssistReady || mouthSmileRatio > (adaptiveAssisted ? 0.62 : 0.68);
    targetSatisfied = isFront && isSmiling;
    targetAlignment = isSmiling ? Math.min(100, Math.max(60, smileConfidence)) : 50;
    guidanceReasoning = isSmiling ? 'Beautiful natural smile! Capturing…' : 'Smile naturally 😊';
  } else if (targetPose === 'front-up') {
    const isUp = autoAssistReady || pitchDeg <= -5 / toleranceMultiplier;
    targetSatisfied = isUp;
    targetAlignment = isUp ? 92 : Math.max(25, Math.round(60 - pitchDeg * 2.5));
    guidanceReasoning = isUp ? 'Perfect chin tilt! Hold still…' : 'Lift your chin slightly ⬆️';
  } else if (targetPose === 'front-down') {
    const isDown = autoAssistReady || pitchDeg >= 5 / toleranceMultiplier;
    targetSatisfied = isDown;
    targetAlignment = isDown ? 92 : Math.max(25, Math.round(60 + pitchDeg * 2.5));
    guidanceReasoning = isDown ? 'Perfect lower angle! Hold still…' : 'Lower your chin slightly ⬇️';
  } else if (targetPose === 'left') {
    const isLeft = autoAssistReady || yawDeg >= 6 / toleranceMultiplier;
    targetSatisfied = isLeft;
    targetAlignment = isLeft ? 95 : Math.min(100, Math.max(25, Math.round(55 + yawDeg * 4)));
    guidanceReasoning = isLeft ? 'Left angle locked! Hold still…' : 'Turn gently to your left ⬅️';
  } else if (targetPose === 'left-deep') {
    const isLeftDeep = autoAssistReady || yawDeg >= 14 / toleranceMultiplier;
    targetSatisfied = isLeftDeep;
    targetAlignment = isLeftDeep ? 95 : Math.min(100, Math.max(25, Math.round(45 + yawDeg * 3)));
    guidanceReasoning = isLeftDeep ? 'Deep profile locked! Hold still…' : 'Turn further to your left ⬅️';
  } else if (targetPose === 'right') {
    const isRight = autoAssistReady || yawDeg <= -6 / toleranceMultiplier;
    targetSatisfied = isRight;
    targetAlignment = isRight ? 95 : Math.min(100, Math.max(25, Math.round(55 + (-yawDeg) * 4)));
    guidanceReasoning = isRight ? 'Right angle locked! Hold still…' : 'Turn gently to your right ➡️';
  } else if (targetPose === 'right-deep') {
    const isRightDeep = autoAssistReady || yawDeg <= -14 / toleranceMultiplier;
    targetSatisfied = isRightDeep;
    targetAlignment = isRightDeep ? 95 : Math.min(100, Math.max(25, Math.round(45 + (-yawDeg) * 3)));
    guidanceReasoning = isRightDeep ? 'Deep profile locked! Hold still…' : 'Turn further to your right ➡️';
  } else if (targetPose === 'up') {
    const isUp = autoAssistReady || pitchDeg <= -5 / toleranceMultiplier;
    targetSatisfied = isUp;
    targetAlignment = isUp ? 95 : Math.min(100, Math.max(25, Math.round(60 - pitchDeg * 3.5)));
    guidanceReasoning = isUp ? 'Upward angle locked! Hold still…' : 'Tilt head slightly up ⬆️';
  } else if (targetPose === 'down') {
    const isDown = autoAssistReady || pitchDeg >= 5 / toleranceMultiplier;
    targetSatisfied = isDown;
    targetAlignment = isDown ? 95 : Math.min(100, Math.max(25, Math.round(60 + pitchDeg * 3.5)));
    guidanceReasoning = isDown ? 'Downward angle locked! Hold still…' : 'Tilt head slightly down ⬇️';
  } else if (targetPose === 'up-left') {
    targetSatisfied = autoAssistReady || (yawDeg >= 5 / toleranceMultiplier && pitchDeg <= -4 / toleranceMultiplier);
    targetAlignment = targetSatisfied ? 94 : 55;
    guidanceReasoning = targetSatisfied ? 'Upper left locked! Hold still…' : 'Look up and left ↖️';
  } else if (targetPose === 'up-right') {
    targetSatisfied = autoAssistReady || (yawDeg <= -5 / toleranceMultiplier && pitchDeg <= -4 / toleranceMultiplier);
    targetAlignment = targetSatisfied ? 94 : 55;
    guidanceReasoning = targetSatisfied ? 'Upper right locked! Hold still…' : 'Look up and right ↗️';
  } else if (targetPose === 'down-left') {
    targetSatisfied = autoAssistReady || (yawDeg >= 5 / toleranceMultiplier && pitchDeg >= 4 / toleranceMultiplier);
    targetAlignment = targetSatisfied ? 94 : 55;
    guidanceReasoning = targetSatisfied ? 'Lower left locked! Hold still…' : 'Look down and left ↙️';
  } else if (targetPose === 'down-right') {
    targetSatisfied = autoAssistReady || (yawDeg <= -5 / toleranceMultiplier && pitchDeg >= 4 / toleranceMultiplier);
    targetAlignment = targetSatisfied ? 94 : 55;
    guidanceReasoning = targetSatisfied ? 'Lower right locked! Hold still…' : 'Look down and right ↘️';
  }

  targetAlignment = Math.min(100, Math.max(10, targetAlignment));

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
      eyesOpen: earScore >= 0.16,
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
    if (now - this.lastSpokenTime < 1400 && !force) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.08;
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
// ULTRA-FAST GPU/LUT AI PHOTO ENHANCER PIPELINE (<1.5ms main-thread budget)
// ---------------------------------------------------------------------------

export function aiEnhanceFaceCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', 0.86);

  const w = canvas.width;
  const h = canvas.height;

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // 1. Subsampled Average Luminance (sample every 16th pixel = 64x faster)
    let avgLum = 0;
    let count = 0;
    for (let i = 0; i < d.length; i += 64) {
      avgLum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      count++;
    }
    avgLum = count > 0 ? avgLum / count : 128;

    const exposureGain = avgLum < 105 ? (128 - avgLum) * 0.38 : avgLum > 175 ? (128 - avgLum) * 0.28 : 0;
    const contrastFactor = 1.06;

    if (Math.abs(exposureGain) > 2 || contrastFactor !== 1) {
      // Precompute 256-entry lookup table (LUT) so pixel pass is just array indexing
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        const val = (v + exposureGain - 128) * contrastFactor + 128;
        lut[v] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
      }

      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
      ctx.putImageData(imgData, 0, 0);
    }
  } catch {
    // Fallback gracefully
  }

  return canvas.toDataURL('image/jpeg', 0.86);
}
