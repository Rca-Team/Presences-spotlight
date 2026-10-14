import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  fetchSelectedFace, 
  fetchAttendanceRecords, 
  fetchDailyAttendance,
  generateWorkingDays,
  isDateInArray,
  FaceInfo
} from '../utils/attendanceUtils';
import { getFaceIdentifiers } from '../utils/attendanceRecordsUtils';
import { format } from 'date-fns';

interface AttendanceRecord {
  id: string;
  timestamp: string;
  status: string;
  name?: string;
  image_url?: string;
  source?: string;
  capture_mode?: string;
  period_key?: string;
  class_name?: string;
  section?: string;
  subject?: string;
}

function normalizeStatus(status: string | null): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase().trim();
  if (s.includes('present')) return 'present';
  if (s.includes('late')) return 'late';
  if (s.includes('absent')) return 'absent';
  return s;
}

function toMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

import { getCachedUnifiedStudentSnapshot } from '@/utils/attendanceStatsHelper';

export const useAttendanceCalendar = (
  selectedFaceId: string | null,
  availableFaces?: Array<{ id: string; name: string; employee_id: string; department?: string; image_url?: string; user_id?: string; position?: string }>
) => {
  const { toast } = useToast();
  
  const [attendanceDays, setAttendanceDays] = useState<Date[]>([]);
  const [lateAttendanceDays, setLateAttendanceDays] = useState<Date[]>([]);
  const [absentDays, setAbsentDays] = useState<Date[]>([]);
  const [selectedFace, setSelectedFace] = useState<FaceInfo | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [visibleMonth, setVisibleMonth] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [dailyAttendance, setDailyAttendance] = useState<AttendanceRecord[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, AttendanceRecord[]>>({});
  const [workingDays, setWorkingDays] = useState<Date[]>([]);

  useEffect(() => {
    setWorkingDays(generateWorkingDays(visibleMonth.getFullYear(), visibleMonth.getMonth()));
  }, [visibleMonth]);

  // Compute absent days from working days minus present/late days
  useEffect(() => {
    if (workingDays.length === 0) return;
    
    const today = toMidnight(new Date());
    const absent = workingDays.filter(workDay => {
      const d = toMidnight(workDay);
      if (d > today) return false;
      return !isDateInArray(d, attendanceDays) && !isDateInArray(d, lateAttendanceDays);
    });
    
    setAbsentDays(absent);
  }, [workingDays, attendanceDays, lateAttendanceDays]);

  const fetchFaceDetails = useCallback(async (faceId: string) => {
    try {
      const fallback = availableFaces?.find(f => f.id === faceId || f.employee_id === faceId || f.user_id === faceId);
      const faceInfo = await fetchSelectedFace(faceId, fallback);
      setSelectedFace(faceInfo);
    } catch (error) {
      console.error('Error fetching face details:', error);
    }
  }, [availableFaces]);

  // Load data when face changes
  useEffect(() => {
    let channel: any = null;

    if (selectedFaceId) {
      setAttendanceDays([]);
      setLateAttendanceDays([]);
      setAbsentDays([]);
      setAttendanceRecords({});
      setVisibleMonth((prev) => selectedDate || prev);

      // Instant 0ms hydration from memory snapshot or availableFaces so there's never 'Unknown Student'
      const fallback = availableFaces?.find(f => f.id === selectedFaceId || f.employee_id === selectedFaceId || f.user_id === selectedFaceId);
      const snapshot = getCachedUnifiedStudentSnapshot();
      const matched = snapshot?.roster?.find(s => s.id === selectedFaceId || s.employee_id === selectedFaceId || s.admission_number === selectedFaceId || s.user_id === selectedFaceId);

      if (matched || fallback) {
        setSelectedFace({
          recordId: matched?.id || fallback?.id || selectedFaceId,
          user_id: matched?.user_id || fallback?.user_id || undefined,
          name: matched?.name || fallback?.name || 'Student',
          employee_id: matched?.admission_number || matched?.employee_id || fallback?.employee_id || '',
          admission_number: matched?.admission_number || matched?.employee_id || fallback?.employee_id || '',
          class: matched?.class || '',
          section: matched?.section || '',
          department: matched?.category || matched?.department || fallback?.department || 'N/A',
          position: matched?.role === 'teacher' ? 'Teacher' : 'Student',
          image_url: matched?.image_url || fallback?.image_url || undefined,
          roll_number: matched?.roll_number || '',
          parent_name: matched?.parent_name || '',
          parent_phone: matched?.parent_phone || matched?.phone || '',
          parent_email: matched?.parent_email || '',
        });
      }
      
      fetchFaceDetails(selectedFaceId);
      loadAttendanceRecords(selectedFaceId);

      channel = supabase
        .channel(`attendance-calendar-${selectedFaceId}`)
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'attendance_records' }, 
          () => {
            loadAttendanceRecords(selectedFaceId);
            if (selectedDate) {
              loadDailyAttendance(selectedFaceId, selectedDate);
            }
          }
        )
        .subscribe();
    } else {
      setSelectedFace(null);
      setAttendanceDays([]);
      setLateAttendanceDays([]);
      setAbsentDays([]);
      setAttendanceRecords({});
      setVisibleMonth(new Date());
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [selectedFaceId, fetchFaceDetails, availableFaces]);

  const loadAttendanceRecords = async (faceId: string) => {
    try {
      setLoading(true);
      await fetchAttendanceRecords(faceId, setAttendanceDays, setLateAttendanceDays);
      
      // Build records-by-date map for tooltips using same identifier logic
      const { userIds, employeeId } = await getFaceIdentifiers(faceId);
      const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      
      const queries = userIds.map(uid => {
        let q = supabase.from('attendance_records')
          .select('id, timestamp, status, source, capture_mode, class, section, device_info, image_url');
        if (isUuid(uid)) {
          q = q.or(`user_id.eq.${uid},id.eq.${uid},student_id.eq.${uid}`);
        } else {
          q = q.eq('student_id', uid);
        }
        return q.in('status', ['present', 'late', 'unauthorized'])
          .order('timestamp', { ascending: true });
      });

      if (employeeId) {
        queries.push(
          supabase.from('attendance_records')
            .select('id, timestamp, status, source, capture_mode, class, section, device_info, image_url')
            .eq('student_id', employeeId)
            .in('status', ['present', 'late', 'unauthorized'])
            .order('timestamp', { ascending: true })
        );
        queries.push(
          supabase.from('attendance_records')
            .select('id, timestamp, status, source, capture_mode, class, section, device_info, image_url')
            .eq('user_id', employeeId)
            .in('status', ['present', 'late', 'unauthorized'])
            .order('timestamp', { ascending: true })
        );
      }

      const results = await Promise.all(queries);
      const seen = new Set<string>();
      const allRecords = results.flatMap(r => r.data || []).filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      if (allRecords.length > 0) {
        const recordsByDate: Record<string, AttendanceRecord[]> = {};
        
        for (const record of allRecords) {
          const deviceInfo = record.device_info as any;
          if (deviceInfo?.registration) continue;
          
          const status = normalizeStatus(record.status);
          if (status !== 'present' && status !== 'late') continue;
          
          let name = deviceInfo?.metadata?.name || deviceInfo?.name || '';
          const source = record.source || deviceInfo?.metadata?.capture_mode || '';
          const periodKey = deviceInfo?.metadata?.gate_period_key || deviceInfo?.metadata?.periodKey;
          const className = deviceInfo?.metadata?.class || deviceInfo?.metadata?.class_name || record.class;
          const section = deviceInfo?.metadata?.section || record.section;
          const subject = deviceInfo?.metadata?.subject;
          const dateKey = format(new Date(record.timestamp), 'yyyy-MM-dd');

          const nextRecord: AttendanceRecord = {
            id: record.id,
            timestamp: record.timestamp,
            status,
            name: name || selectedFace?.name || 'Student',
            image_url: record.image_url,
            source,
            capture_mode: record.capture_mode,
            period_key: periodKey,
            class_name: className,
            section,
            subject,
          };

          if (!recordsByDate[dateKey]) recordsByDate[dateKey] = [];
          recordsByDate[dateKey].push(nextRecord);
        }

        Object.keys(recordsByDate).forEach((key) => {
          recordsByDate[key] = recordsByDate[key].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
        });
        
        setAttendanceRecords(recordsByDate);
      }
    } catch (error) {
      console.error('Error loading attendance records:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedFace = useCallback(async () => {
    if (!selectedFaceId) return;
    await fetchFaceDetails(selectedFaceId);
  }, [selectedFaceId]);

  const loadDailyAttendance = async (faceId: string, date: Date) => {
    try {
      await fetchDailyAttendance(faceId, date, (records) => {
        const enhanced = records.map(r => ({
          ...r,
          name: r.name && r.name !== 'Student' ? r.name : selectedFace?.name || 'Student'
        }));
        setDailyAttendance(enhanced);
      });
    } catch (error) {
      console.error('Error loading daily attendance:', error);
    }
  };

  return {
    attendanceDays,
    lateAttendanceDays,
    absentDays,
    selectedFace,
    selectedDate,
    setSelectedDate,
    visibleMonth,
    setVisibleMonth,
    loading,
    dailyAttendance,
    workingDays,
    isDateInArray,
    attendanceRecords,
    selectedFaceId,
    refreshSelectedFace,
  };
};
