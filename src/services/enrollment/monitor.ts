import { enrollmentApi } from './api';
import type { StudentDetails } from './types';

export type MonitorStatus = 'not_started' | 'failed' | 'verified' | 'capturing' | 'completed';

export interface MonitorSample { pose: string; glasses: 'with' | 'without'; fileId: string; brightness: number; sharpness: number }

export interface MonitorStudent {
  admission_number: string;
  name: string;
  class: string;
  section: string;
  category: string;
  parent_phone: string;
  hasPhone: boolean;
  hasDob: boolean;
  hasFather: boolean;
  status: MonitorStatus;
  imported: boolean;
  portrait: boolean;
  faceOnFile: boolean;
  samples: MonitorSample[];
  method: string;
  verifiedAt: number;
  completedAt: number;
  failures: number;
  correction: string | null;
  lastActivity: number;
  inProgress?: { samples: string[]; expires: number };
}

export interface MonitorActivity { event: string; student: string; name: string; category: string; method: string; at: number }

export interface MonitorCorrection {
  id: string;
  student: string;
  name: string;
  category: string;
  original: StudentDetails;
  changes: Partial<StudentDetails>;
  status: 'pending' | 'approved' | 'rejected';
  at: number;
}

export interface MonitorOverview {
  scope: { all: boolean; classes: string[] };
  generatedAt: number;
  students: MonitorStudent[];
  activity: MonitorActivity[];
  corrections: MonitorCorrection[];
  canManage: boolean;
}

export const fetchMonitor = () => enrollmentApi<MonitorOverview>('staff.monitor');
export const fetchMonitorPhoto = (admission: string, fileId: string) =>
  enrollmentApi<{ image: string }>('staff.photo', { admission, fileId }).then(r => r.image);
export const reviewCorrection = (id: string, approve: boolean) => enrollmentApi('staff.review', { id, approve });

export const statusMeta: Record<MonitorStatus, { label: string; tone: string; dot: string }> = {
  completed: { label: 'Face enrolled', tone: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-500' },
  capturing: { label: 'Capturing', tone: 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-500' },
  verified: { label: 'Verified', tone: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/20', dot: 'bg-indigo-500' },
  failed: { label: 'Verification failed', tone: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-500' },
  not_started: { label: 'Not started', tone: 'text-muted-foreground bg-muted/60 border-border', dot: 'bg-slate-400' },
};

export const eventLabels: Record<string, string> = {
  imported: 'Record imported',
  verified: 'Parent verified',
  'verification-failed': 'Verification failed',
  'enrollment-completed': 'Face enrollment completed',
  'correction-reviewed': 'Correction reviewed',
};

export const methodLabels: Record<string, string> = {
  otp: 'SMS code',
  'verify-otp': 'SMS code',
  'father-name': "Father's name + DOB",
  'verify-father': "Father's name + DOB",
  staff: 'At school (staff)',
};

export const REQUIRED_POSES = ['front', 'left', 'right', 'up', 'down'];
