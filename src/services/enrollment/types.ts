export const studentFields = ['name', 'admission_number', 'class', 'section', 'father_name', 'mother_name', 'parent_phone', 'date_of_birth', 'address'] as const;
export type StudentField = typeof studentFields[number];
export type StudentDetails = Record<StudentField, string>;
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
  'front-smile',
  'front-up',
  'front-down',
  'left',
  'left-deep',
  'right',
  'right-deep',
  'up',
  'down',
  'up-left',
  'up-right',
  'down-left',
  'down-right',
  'master-hd'
];

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
  date_of_birth: 'Date of birth', 
  address: 'Address' 
};
