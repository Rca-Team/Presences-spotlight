import type { Pose } from './types';
export interface Point { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export interface PoseEstimate {
  pose: Pose | null;
  yaw: number;
  pitchRatio: number;
  continuousAngle: number;
}

export function estimateFacePose(points: Point[]): PoseEstimate {
  const eyeMid = { x: (points[36].x + points[45].x) / 2, y: (points[36].y + points[45].y) / 2 };
  const eyeDist = Math.max(1, distance(points[36], points[45]));
  const chin = points[8];
  const faceH = Math.max(1, distance(chin, eyeMid));
  const nose = points[30];

  const yaw = (nose.x - eyeMid.x) / eyeDist;
  const pitchRatio = (nose.y - eyeMid.y) / faceH;

  const dx = yaw * 2.8;
  const dy = (pitchRatio - 0.41) * 3.2;
  let continuousAngle = Math.atan2(dy, dx);
  if (continuousAngle < 0) continuousAngle += Math.PI * 2;

  let pose: Pose | null = null;
  const horizontal = yaw > 0.18 ? 'left' : yaw < -0.18 ? 'right' : '';
  const vertical = pitchRatio < 0.33 ? 'up' : pitchRatio > 0.49 ? 'down' : '';
  if (horizontal && vertical) {
    pose = `${vertical}-${horizontal}` as Pose;
  } else if (Math.abs(yaw) < 0.16 && pitchRatio >= 0.35 && pitchRatio <= 0.48) {
    pose = 'front';
  } else if (yaw > 0.18) {
    pose = 'left';
  } else if (yaw < -0.18) {
    pose = 'right';
  } else if (pitchRatio < 0.33) {
    pose = 'up';
  } else if (pitchRatio > 0.49) {
    pose = 'down';
  }

  return { pose, yaw, pitchRatio, continuousAngle };
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
  for (let i = 0; i < gray.length; i++) { gray[i] = pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114; sum += gray[i]; }
  let lapSum = 0, lapSquare = 0, count = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    lapSum += lap; lapSquare += lap * lap; count++;
  }
  return { brightness: sum / gray.length, sharpness: lapSquare / Math.max(1, count) - (lapSum / Math.max(1, count)) ** 2, faces: 1 };
}
