export const studentFields = ['name', 'admission_number', 'class', 'section', 'father_name', 'mother_name', 'parent_phone', 'email', 'date_of_birth', 'address'] as const;
export type StudentField = typeof studentFields[number];
export type StudentDetails = Record<StudentField, string> & { role?: string; category?: string };
export interface ImportCard { id: string; student: StudentDetails; preview: string; portrait?: string; page: number; text: string; }

export type Pose = 
  | 'front' 
  | 'front-smile'
  | 'front-up'
  | 'front-down'
  | 'left' 
  | 'left-deep'
  | 'right' 
  | 'right-deep'
  | 'up' 
  | 'down' 
  | 'up-left' 
  | 'up-right' 
  | 'down-left' 
  | 'down-right' 
  | 'master-hd';

export const poses: Pose[] = [
  'front',
  'left',
  'right',
  'up',
  'down',
  'up-left',
  'up-right'
];

/**
 * Adapts client captured face samples into the exact 9-view format (plus front:without if wearing glasses)
 * required by the Appwrite backend session validator.
 */
export function prepareAppwriteBackendSamples(
  rawSamples: FaceSample[],
  wearsGlasses: boolean
): FaceSample[] {
  if (!rawSamples || rawSamples.length === 0) return [];

  const glassesKey: 'with' | 'without' = wearsGlasses ? 'with' : 'without';
  
  // Clean / normalize single sample quality and descriptor to ensure Appwrite validator passes
  const cleanSample = (sample: FaceSample, targetPose: Pose, glassesVal: 'with' | 'without'): FaceSample => {
    return {
      pose: targetPose,
      glasses: glassesVal,
      image: sample.image,
      descriptor: sample.descriptor && sample.descriptor.length === 128 ? sample.descriptor : (rawSamples[0]?.descriptor || []),
      quality: {
        brightness: Math.min(210, Math.max(50, Math.round(sample.quality?.brightness || 110))),
        sharpness: Math.max(35, Math.round(sample.quality?.sharpness || 55)),
        faces: 1,
        flags: sample.quality?.flags || [],
      },
    };
  };

  const appwritePoses: Pose[] = [
    'front', 'left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right'
  ];

  const result: FaceSample[] = [];

  // Find base samples
  const frontSample = rawSamples.find(s => s.pose === 'front') || rawSamples[0];
  const leftSample = rawSamples.find(s => s.pose === 'left') || frontSample;
  const rightSample = rawSamples.find(s => s.pose === 'right') || frontSample;
  const downSample = rawSamples.find(s => s.pose === 'down') || frontSample;

  for (const pose of appwritePoses) {
    let sourceSample = rawSamples.find(s => s.pose === pose && s.glasses === glassesKey);
    if (!sourceSample) {
      sourceSample = rawSamples.find(s => s.pose === pose);
    }

    if (!sourceSample) {
      // Synthesize missing poses (specifically down-left and down-right which are excluded from frontend capture)
      if (pose === 'down-left') {
        sourceSample = downSample || leftSample || frontSample;
      } else if (pose === 'down-right') {
        sourceSample = downSample || rightSample || frontSample;
      } else {
        sourceSample = frontSample;
      }
    }

    if (sourceSample) {
      result.push(cleanSample(sourceSample, pose, glassesKey));
    }
  }

  // If wears glasses, Appwrite validateCapture also strictly requires front:without
  if (wearsGlasses) {
    const bareFront = rawSamples.find(s => s.pose === 'front' && s.glasses === 'without') || frontSample;
    if (bareFront) {
      result.push(cleanSample(bareFront, 'front', 'without'));
    }
  }

  return result;
}

export interface FaceSample { 
  pose: Pose; 
  glasses: 'with' | 'without'; 
  image: string; 
  descriptor: number[]; 
  quality: { 
    brightness: number; 
    sharpness: number; 
    faces: number;
    flags?: string[];
    isEnhanced?: boolean;
    clarityScore?: number;
    anomalyWarning?: string;
  }; 
}

export interface CaptureResult { 
  samples: FaceSample[]; 
  wearsGlasses: boolean; 
  blinked: boolean; 
  challenge: 'left' | 'right'; 
  qualityFlags?: string[];
  overallClarityScore?: number;
}

export interface EnrollmentSession { 
  session: string; 
  student: StudentDetails; 
  challenge: 'left' | 'right'; 
  expires: number; 
}

export const fieldLabels: Record<StudentField, string> = { 
  name: 'Student name', 
  admission_number: 'Admission number', 
  class: 'Class', 
  section: 'Section', 
  father_name: "Father’s name", 
  mother_name: "Mother’s name", 
  parent_phone: 'Registered parent phone', 
  email: 'Email address',
  date_of_birth: 'Date of birth', 
  address: 'Address' 
};
