import { FaceSample, StudentGroup } from '@/components/admin/StudentFaceSamplesManager';

export interface CoverCandidate {
  id?: string;
  image_url: string | null;
  label?: string | null;
  source?: string | null;
  source_table?: string | null;
  created_at?: string | null;
  confidence_score?: number | null;
  quality?: {
    brightness?: number;
    sharpness?: number;
    clarityScore?: number;
    flags?: string[];
    isEnhanced?: boolean;
    anomalyWarning?: string;
  };
}

export interface CoverPhotoScore {
  candidate: CoverCandidate;
  score: number;
  reasons: string[];
}

/**
 * Evaluates and scores an individual photo candidate to determine
 * if it represents an ideal official student ID portrait.
 *
 * Scoring Criteria:
 * 1. Pose Orientation: Frontal neutral baseline & master HD gets top priority.
 * 2. Visual Clarity & Sharpness: High clarity score & lack of motion blur.
 * 3. Lighting Symmetry: Optimal luminance without harsh glare or extreme shadow.
 * 4. Source Credibility: Trained enrollment vectors > Gate scans > Secondary snapshots.
 * 5. Pose Filter: Deep angle profiles (left/right/down) are penalized for ID covers.
 */
export function scoreCoverPhotoCandidate(candidate: CoverCandidate): CoverPhotoScore {
  const url = candidate.image_url || '';
  if (!url || (url.startsWith('data:') && url.length < 500)) {
    return { candidate, score: -1000, reasons: ['Invalid or empty photo URL'] };
  }

  let score = 100;
  const reasons: string[] = [];

  const label = (candidate.label || '').toLowerCase();
  const urlLower = url.toLowerCase();

  // 1. Source Reliability (Trained live vectors are verified representations)
  if (candidate.source_table === 'face_descriptors' || candidate.source === 'descriptor_registration') {
    score += 150;
    reasons.push('Verified trained face slot (+150)');
  } else if (candidate.source === 'record_registration') {
    score += 100;
    reasons.push('Official enrollment baseline (+100)');
  } else if (candidate.source === 'recognition_gate' || candidate.source === 'recognition_attendance') {
    score += 30;
    reasons.push('Live attendance capture (+30)');
  }

  // 2. Pose & Framing Evaluation
  const isFrontal =
    label.includes('front') ||
    label.includes('master') ||
    label.includes('primary') ||
    label.includes('baseline') ||
    urlLower.includes('-front.') ||
    urlLower.includes('-master.') ||
    urlLower.includes('register');

  const isSmiling = label.includes('smile') || urlLower.includes('-smile.');

  const isTurnedOrTilted =
    label.includes('deep') ||
    label.includes('left') ||
    label.includes('right') ||
    label.includes('up') ||
    label.includes('down') ||
    urlLower.includes('-left.') ||
    urlLower.includes('-right.') ||
    urlLower.includes('-up.') ||
    urlLower.includes('-down.');

  if (isFrontal) {
    score += 200;
    reasons.push('Frontal neutral orientation (+200)');
  } else if (isSmiling) {
    score += 170;
    reasons.push('Natural smiling front portrait (+170)');
  }

  if (isTurnedOrTilted) {
    score -= 100;
    reasons.push('Tilted / profile turn angle penalty (-100)');
  }

  // 3. AI Quality & Telemetry Diagnostics
  if (candidate.quality) {
    const { clarityScore, sharpness, brightness, anomalyWarning, flags } = candidate.quality;

    if (clarityScore !== undefined) {
      if (clarityScore >= 80) {
        score += 75;
        reasons.push(`Superior clarity (${clarityScore}%) (+75)`);
      } else if (clarityScore >= 60) {
        score += 40;
        reasons.push(`Good clarity (${clarityScore}%) (+40)`);
      } else if (clarityScore < 45) {
        score -= 60;
        reasons.push(`Poor clarity (${clarityScore}%) (-60)`);
      }
    }

    if (sharpness && sharpness > 60) {
      score += 35;
      reasons.push('Sharp edge definition (+35)');
    }

    if (brightness !== undefined) {
      if (brightness >= 90 && brightness <= 170) {
        score += 40;
        reasons.push('Even studio luminance (+40)');
      } else if (brightness < 60 || brightness > 220) {
        score -= 70;
        reasons.push('Harsh lighting or underexposed (-70)');
      }
    }

    if (anomalyWarning) {
      score -= 90;
      reasons.push(`Anomaly flagged: ${anomalyWarning} (-90)`);
    }

    if (flags && flags.length > 0) {
      if (flags.includes('motion_blur') || flags.includes('too_dark') || flags.includes('glare')) {
        score -= 80;
        reasons.push(`Quality flags: ${flags.join(', ')} (-80)`);
      }
    }
  }

  // 4. Recognition Confidence
  if (candidate.confidence_score && candidate.confidence_score > 0.88) {
    score += 45;
    reasons.push(`High recognition confidence (${Math.round(candidate.confidence_score * 100)}%) (+45)`);
  }

  // 5. Clean Image Format & Resolution
  if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || urlLower.includes('.webp') || urlLower.includes('/view?')) {
    score += 15;
  }

  // 6. Recency Tiebreaker (newer verified captures preferred)
  if (candidate.created_at) {
    const ts = new Date(candidate.created_at).getTime();
    if (!Number.isNaN(ts) && ts > 0) {
      const daysOld = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (daysOld < 30) {
        score += 20;
        reasons.push('Recent capture (+20)');
      }
    }
  }

  return { candidate, score, reasons };
}

/**
 * Selects the highest-scoring candidate from a list of photo samples.
 */
export function selectBestCoverPhoto(candidates: CoverCandidate[]): CoverPhotoScore | null {
  if (!candidates || candidates.length === 0) return null;

  const valid = candidates.filter((c) => c.image_url && typeof c.image_url === 'string');
  if (valid.length === 0) return null;

  const scored = valid
    .map(scoreCoverPhotoCandidate)
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

/**
 * Automatically evaluates all samples for a student and returns the best photo
 * along with whether the current cover photo is already optimal.
 */
export function evaluateStudentCoverPhoto(student: StudentGroup): {
  bestSample: FaceSample | null;
  score: number;
  reasons: string[];
  isAlreadyBest: boolean;
} {
  if (!student.samples || student.samples.length === 0) {
    return {
      bestSample: null,
      score: 0,
      reasons: ['No samples found for student'],
      isAlreadyBest: true,
    };
  }

  const bestScored = selectBestCoverPhoto(student.samples);
  if (!bestScored) {
    return {
      bestSample: null,
      score: 0,
      reasons: ['No valid candidate photo URLs'],
      isAlreadyBest: true,
    };
  }

  const currentCover = student.avatarUrl || '';
  const bestUrl = bestScored.candidate.image_url || '';
  const isAlreadyBest = Boolean(currentCover && bestUrl && (
    currentCover === bestUrl ||
    currentCover.includes(bestUrl) ||
    bestUrl.includes(currentCover)
  ));

  return {
    bestSample: bestScored.candidate as FaceSample,
    score: bestScored.score,
    reasons: bestScored.reasons,
    isAlreadyBest,
  };
}
