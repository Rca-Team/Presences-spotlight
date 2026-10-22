
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Search, User, Users, UserCheck, UserX, Calendar, MoreVertical, Phone, Filter, ArrowUpDown, Clock, CheckCircle2, XCircle, SortAsc, SortDesc, Trash2, BellRing, X, BrainCircuit, ScanFace, FileText, Download, LayoutList, LayoutGrid, FolderInput } from 'lucide-react';
import StudentAvatar from '@/components/common/StudentAvatar';
import NotificationService from './NotificationService';
import AttendanceCalendar from './AttendanceCalendar';
import CaptureFaceDialog from './CaptureFaceDialog';
import ChangeCategoryDialog from './ChangeCategoryDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { universalDeleteStudent } from '@/services/student/studentDeletionService';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  fetchUnifiedStudentSnapshot,
  getCachedUnifiedStudentSnapshot,
  invalidateUnifiedStatsCache,
  type UnifiedStudentSnapshot,
  type CanonicalStudent,
} from '@/utils/attendanceStatsHelper';
import { pickPreferredPhotoCandidate, resolveStudentPhotoUrlSync } from '@/utils/studentPhotoResolver';
import { CLASSES, SECTIONS, parseCategory } from '@/constants/schoolConfig';
import { parseClassSection, saveTeacherCategories } from '@/utils/teacherAccess';

interface AdminFacesListProps {
  viewMode: 'grid' | 'list';
  selectedFaceId: string | null;
  nameFilter: string;
  setSelectedFaceId: (id: string | null) => void;
}

interface RegisteredFace {
  id: string;
  user_id?: string;
  name: string;
  employee_id: string;
  department: string;
  image_url: string;
  position?: string;
  total_attendance: number;
  last_attendance?: string;
  is_face_enrolled?: boolean;
}

type TodayStatus = 'present' | 'late' | 'absent';
type StatusFilter = 'all' | 'present' | 'late' | 'absent';
type SortField = 'name' | 'status' | 'attendance' | 'lastSeen';
type SortDir = 'asc' | 'desc';

// Module-level caches so switching between Admin tabs is 0ms instant
let cachedUnifiedFaces: RegisteredFace[] | null = null;
let cachedUnifiedStatuses: Record<string, { status: TodayStatus; time?: string }> | null = null;
let cachedAttendanceCounts: Record<string, number> | null = null;
let cachedAttendanceCountsAt = 0;
let cachedEmotionStats: Record<string, { label: string; confidence: number; samples: number }> | null = null;
let cachedEmotionStatsAt = 0;
let cachedDescriptorPhotoMaps: {
  byUserId: Map<string, string>;
  byStudentKey: Map<string, string>;
  fetchedAt: number;
} | null = null;

function deriveFacesAndStatusesFromSnapshot(
  snapshot: UnifiedStudentSnapshot | null | undefined,
  countsMap?: Record<string, number> | null,
  descriptorMaps?: { byUserId: Map<string, string>; byStudentKey: Map<string, string> } | null
): {
  faces: RegisteredFace[];
  statuses: Record<string, { status: TodayStatus; time?: string }>;
} {
  const statusMap: Record<string, { status: TodayStatus; time?: string }> = {};
  if (!snapshot) return { faces: [], statuses: {} };

  const studentList: CanonicalStudent[] = Array.isArray(snapshot.roster)
    ? snapshot.roster
    : Array.isArray((snapshot as any).students)
      ? (snapshot as any).students
      : [];

  const statusesById = snapshot.statusesByEmployeeId || {};

  const faces: RegisteredFace[] = studentList.map((student) => {
    const empId = student.employee_id || student.admission_number || student.user_id || student.id;
    const empKey = empId ? empId.toLowerCase() : '';
    const uid = student.user_id || '';

    const candidateImg = pickPreferredPhotoCandidate(
      student.image_url,
      uid && descriptorMaps ? descriptorMaps.byUserId.get(uid) : '',
      empKey && descriptorMaps ? descriptorMaps.byStudentKey.get(empKey) : ''
    );
    const resolvedImg = resolveStudentPhotoUrlSync(candidateImg);

    const candidateKeys = [empId, student.admission_number, student.user_id, student.id].filter(Boolean) as string[];
    const matched = candidateKeys
      .map((key) => statusesById[key])
      .find(Boolean);

    statusMap[empId] = matched
      ? {
          status: matched.status,
          time: matched.time ? format(new Date(matched.time), 'hh:mm a') : undefined,
        }
      : { status: 'absent' };

    const totalAtt =
      (countsMap && (countsMap[empId] || (uid ? countsMap[uid] : 0))) || 0;

    return {
      id: student.id,
      user_id: student.user_id,
      name: student.name,
      employee_id: empId,
      department: student.department || student.category || 'N/A',
      position: student.role === 'teacher' ? 'Teacher' : 'Student',
      image_url: resolvedImg,
      total_attendance: totalAtt,
      last_attendance: matched?.time || 'Never',
      is_face_enrolled: Boolean(student.is_face_enrolled),
    };
  });

  return { faces, statuses: statusMap };
}

const AdminFacesList: React.FC<AdminFacesListProps> = ({ 
  viewMode, 
  selectedFaceId,
  nameFilter,
  setSelectedFaceId
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const initialSnapshot = useMemo(() => getCachedUnifiedStudentSnapshot(), []);
  const initialDerived = useMemo(() => {
    if (!initialSnapshot) return null;
    try {
      const derived = deriveFacesAndStatusesFromSnapshot(initialSnapshot, cachedAttendanceCounts, cachedDescriptorPhotoMaps);
      return derived.faces.length > 0 ? derived : null;
    } catch (e) {
      console.warn('[AdminFacesList] Failed to derive initial faces:', e);
      return null;
    }
  }, [initialSnapshot]);

  const [subTab, setSubTab] = useState<'roster' | 'calendar'>('roster');
  const [isLoading, setIsLoading] = useState(() => !initialDerived);
  const [faces, setFaces] = useState<RegisteredFace[]>(() => initialDerived?.faces || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>(() => cachedAttendanceCounts || {});
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [enrollmentFilter, setEnrollmentFilter] = useState<'all' | 'enrolled' | 'pending'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [todayStatuses, setTodayStatuses] = useState<Record<string, { status: TodayStatus; time?: string }>>(
    () => initialDerived?.statuses || {}
  );
  const [emotionStatsByStudent, setEmotionStatsByStudent] = useState<Record<string, { label: string; confidence: number; samples: number }>>(
    () => cachedEmotionStats || {}
  );
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table');
  const [selectedTeacher, setSelectedTeacher] = useState<RegisteredFace | null>(null);
  const [teacherCategories, setTeacherCategories] = useState<string[]>([]);
  const [classTeacherCategory, setClassTeacherCategory] = useState<string>('none');
  const [isPromoting, setIsPromoting] = useState(false);
  const [recaptureStudent, setRecaptureStudent] = useState<{
    id: string;
    user_id?: string;
    name: string;
    employee_id: string;
    category?: string;
  } | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<RegisteredFace | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');

  const hasLoadedOnceRef = useRef(Boolean(initialDerived));
  const selectedFaceIdRef = useRef(selectedFaceId);
  useEffect(() => {
    selectedFaceIdRef.current = selectedFaceId;
  }, [selectedFaceId]);

  const extractSection = (department: string): string => {
    if (!department) return '';
    const parsed = parseCategory(department);
    if (parsed?.section) return parsed.section;
    const match = department.match(/Section\s*([A-D])/i) || department.match(/\d+\s*-\s*([A-Da-d])/);
    return match ? match[1].toUpperCase() : '';
  };

  const extractClass = (department: string): string => {
    if (!department) return '';
    const parsed = parseCategory(department);
    if (parsed?.class) return String(parsed.class);
    const match = department.match(/(?:Class|Grade)\s*(\d+)/i) || department.match(/(\d+)\s*-[A-Da-d]/);
    return match ? match[1] : '';
  };

  const filteredAndSortedFaces = useMemo(() => {
    let result = faces.filter(face => {
      if (nameFilter !== 'all' && face.id !== nameFilter) return false;

      if (sectionFilter !== 'all') {
        if (extractSection(face.department) !== sectionFilter) return false;
      }

      if (classFilter !== 'all') {
        if (extractClass(face.department) !== classFilter) return false;
      }

      // Enrollment filter
      if (enrollmentFilter === 'enrolled' && !face.is_face_enrolled) return false;
      if (enrollmentFilter === 'pending' && face.is_face_enrolled) return false;

      // Status filter
      if (statusFilter !== 'all') {
        const faceStatus = todayStatuses[face.employee_id]?.status || 'absent';
        if (faceStatus !== statusFilter) return false;
      }

      const searchLower = searchTerm.toLowerCase();
      return (
        face.name?.toLowerCase().includes(searchLower) ||
        face.employee_id?.toLowerCase().includes(searchLower) ||
        face.department?.toLowerCase().includes(searchLower)
      );
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'status': {
          const order = { present: 0, late: 1, absent: 2 };
          const sa = todayStatuses[a.employee_id]?.status || 'absent';
          const sb = todayStatuses[b.employee_id]?.status || 'absent';
          cmp = order[sa] - order[sb];
          break;
        }
        case 'attendance':
          cmp = a.total_attendance - b.total_attendance;
          break;
        case 'lastSeen': {
          const da = a.last_attendance && a.last_attendance !== 'Never' ? new Date(a.last_attendance).getTime() : 0;
          const db = b.last_attendance && b.last_attendance !== 'Never' ? new Date(b.last_attendance).getTime() : 0;
          cmp = da - db;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [faces, nameFilter, searchTerm, sectionFilter, classFilter, statusFilter, sortField, sortDir, todayStatuses]);

  const [displayLimit, setDisplayLimit] = useState(40);

  useEffect(() => {
    setDisplayLimit(40);
  }, [searchTerm, sectionFilter, classFilter, statusFilter, sortField, sortDir]);

  const displayedFaces = useMemo(() => {
    return filteredAndSortedFaces.slice(0, displayLimit);
  }, [filteredAndSortedFaces, displayLimit]);

  // Stats counts
  const statusCounts = useMemo(() => {
    const counts = { present: 0, late: 0, absent: 0 };
    faces.forEach(face => {
      const s = todayStatuses[face.employee_id]?.status || 'absent';
      counts[s]++;
    });
    return counts;
  }, [faces, todayStatuses]);

  const fetchRegisteredFaces = useCallback(async (forceRefresh = false) => {
    try {
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true);
      }
      if (forceRefresh) {
        invalidateUnifiedStatsCache();
        cachedUnifiedFaces = null;
      }

      // If already cached in memory and not forcing refresh, hydrate instantly
      if (!forceRefresh && cachedUnifiedFaces && cachedUnifiedFaces.length > 0) {
        setFaces(cachedUnifiedFaces);
        if (cachedUnifiedStatuses) setTodayStatuses(cachedUnifiedStatuses);
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
        return;
      }

      // 1. Fetch snapshot + attendance counts in one stable pass
      const [snapshotRes, countsRes] = await Promise.allSettled([
        fetchUnifiedStudentSnapshot(forceRefresh),
        supabase
          .from('attendance_records')
          .select('timestamp, status, student_id, user_id, device_info')
          .in('status', ['present', 'late', 'unauthorized'])
          .order('timestamp', { ascending: false })
          .limit(1500),
      ]);

      const snapshot = snapshotRes.status === 'fulfilled' ? snapshotRes.value : null;

      let countsMap: Record<string, number> = cachedAttendanceCounts || {};
      if (countsRes.status === 'fulfilled' && countsRes.value.data) {
        const countsByEmp: Record<string, Set<string>> = {};
        countsRes.value.data.forEach((record: any) => {
          const day = (record.timestamp || '').split('T')[0];
          const m = (record.device_info as any)?.metadata || {};
          const emp = String(m.employee_id || (record.device_info as any)?.employee_id || record.student_id || '').trim();
          const uid = String(record.user_id || '').trim();
          if (emp && day) {
            if (!countsByEmp[emp]) countsByEmp[emp] = new Set();
            countsByEmp[emp].add(day);
          }
          if (uid && day) {
            if (!countsByEmp[uid]) countsByEmp[uid] = new Set();
            countsByEmp[uid].add(day);
          }
        });
        countsMap = {};
        Object.entries(countsByEmp).forEach(([emp, daysSet]) => {
          countsMap[emp] = daysSet.size;
        });
        cachedAttendanceCounts = countsMap;
        cachedAttendanceCountsAt = Date.now();
      }

      // 2. Derive stable faces and today's statuses atomically
      const derived = deriveFacesAndStatusesFromSnapshot(snapshot, countsMap, cachedDescriptorPhotoMaps);

      cachedUnifiedFaces = derived.faces;
      cachedUnifiedStatuses = derived.statuses;

      setAttendanceCounts(countsMap);
      setFaces(derived.faces);
      setTodayStatuses(derived.statuses);
      hasLoadedOnceRef.current = true;
      setIsLoading(false);

      if (selectedFaceIdRef.current && !derived.faces.some((face) => face.id === selectedFaceIdRef.current)) {
        setSelectedFaceId(null);
      }
    } catch (error) {
      console.error('Error fetching registered faces:', error);
      toast({
        title: "Error",
        description: "Failed to load registered faces",
        variant: "destructive"
      });
    } finally {
      hasLoadedOnceRef.current = true;
      setIsLoading(false);
    }
  }, [toast, setSelectedFaceId]);

  useEffect(() => {
    fetchRegisteredFaces();

    // Debounce realtime sync to 30 seconds so screen never jumps or fluctuates while reading
    let updateTimeout: ReturnType<typeof setTimeout>;
    const attendanceChannel = supabase
      .channel('attendance-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'attendance_records' }, 
        () => {
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(() => {
            fetchRegisteredFaces(true);
          }, 30000);
        }
      )
      .subscribe();

    return () => {
      clearTimeout(updateTimeout);
      supabase.removeChannel(attendanceChannel);
    };
  }, [fetchRegisteredFaces]);

  const handleConfirmDelete = async () => {
    if (!studentToDelete) return;
    setIsDeleting(true);
    setDeleteProgress(`Starting universal deletion for ${studentToDelete.name}...`);
    try {
      const res = await universalDeleteStudent(studentToDelete, (status) => setDeleteProgress(status));
      if (res.success) {
        toast({
          title: "Student Deleted Everywhere",
          description: `Completely removed ${studentToDelete.name} (${studentToDelete.employee_id || ''}) from profiles, face descriptors, attendance records, and cloud storage.`,
        });
        if (studentToDelete.id === selectedFaceId) setSelectedFaceId(null);
        setFaces((prev) => prev.filter((f) => f.id !== studentToDelete.id && f.employee_id !== studentToDelete.employee_id));
        setStudentToDelete(null);
        await fetchRegisteredFaces(true);
      } else {
        toast({
          title: "Partial Deletion Completed",
          description: res.errors.join("; ") || "Some records could not be purged.",
          variant: "destructive",
        });
        setStudentToDelete(null);
        await fetchRegisteredFaces(true);
      }
    } catch (error: any) {
      console.error('Error deleting student:', error);
      toast({
        title: "Delete Failed",
        description: error?.message || "Could not delete student from database.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteProgress('');
    }
  };

  const openPromoteDialog = (face: RegisteredFace) => {
    setSelectedTeacher(face);
    const inferred = face.department.match(/(\d+)\s*[-\s]\s*([A-D])/i);
    const inferredCategory = inferred ? `${inferred[1]}-${inferred[2].toUpperCase()}` : null;
    setTeacherCategories(inferredCategory ? [inferredCategory] : []);
    setClassTeacherCategory('none');
    setPromoteOpen(true);
  };

  const toggleTeacherCategory = (category: string) => {
    setTeacherCategories(prev => prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]);
  };

  const handlePromoteTeacher = async () => {
    if (!selectedTeacher) return;
    if (!selectedTeacher.user_id) {
      toast({ title: 'Missing linked account', description: 'This student has no user account linked yet.', variant: 'destructive' });
      return;
    }

    setIsPromoting(true);
    try {
      await supabase.from('attendance_records').update({ category: 'Teacher' }).eq('id', selectedTeacher.id);
      await saveTeacherCategories(selectedTeacher.user_id, teacherCategories);

      if (classTeacherCategory !== 'none') {
        const parsed = parseClassSection(classTeacherCategory);
        if (parsed) {
          await supabase
            .from('class_teachers')
            .delete()
            .eq('class', parsed.className)
            .eq('section', parsed.section);

          await supabase.from('class_teachers').insert({
            class: parsed.className,
            section: parsed.section,
            teacher_id: selectedTeacher.user_id,
            teacher_name: selectedTeacher.name,
          });
        }
      }

      toast({ title: 'Teacher updated', description: `${selectedTeacher.name} can now use teacher timetable and substitution features.` });
      setPromoteOpen(false);
      await fetchRegisteredFaces(true);
    } catch (error: any) {
      toast({ title: 'Failed to update teacher access', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setIsPromoting(false);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const getStatusBadge = (employeeId: string) => {
    const info = todayStatuses[employeeId];
    const status = info?.status || 'absent';
    
    switch (status) {
      case 'present':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 gap-1.5 px-2 py-0.5 text-xs font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span>Present</span>
            {info?.time && <span className="text-[10px] text-muted-foreground ml-0.5 hidden xs:inline">{info.time}</span>}
          </Badge>
        );
      case 'late':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25 gap-1.5 px-2 py-0.5 text-xs font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>Late</span>
            {info?.time && <span className="text-[10px] text-muted-foreground ml-0.5 hidden xs:inline">{info.time}</span>}
          </Badge>
        );
      case 'absent':
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25 gap-1.5 px-2 py-0.5 text-xs font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
            <span>Absent</span>
          </Badge>
        );
    }
  };

  const totalStudents = faces.length;
  const enrolledCount = useMemo(() => faces.filter(f => f.is_face_enrolled).length, [faces]);
  const attendanceRate = totalStudents > 0 
    ? Math.round(((statusCounts.present + statusCounts.late) / totalStudents) * 100)
    : 0;

  const hasActiveFilters = statusFilter !== 'all' || sectionFilter !== 'all' || classFilter !== 'all' || searchTerm.trim() !== '';

  const handleExportCSV = () => {
    if (filteredAndSortedFaces.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no student records matching the current filters.",
        variant: "destructive"
      });
      return;
    }
    
    const headers = ["Roll / ID", "Student Name", "Class & Section", "Today's Status", "Check-in Time", "Total Attendance Days", "Phone"];
    const rows = filteredAndSortedFaces.map(face => {
      const today = todayStatuses[face.employee_id];
      const status = today?.status || 'absent';
      const time = today?.time || '';
      const totalDays = attendanceCounts[face.employee_id] || 0;
      const phone = face.phone || '';
      return [
        `"${face.employee_id || ''}"`,
        `"${(face.name || '').replace(/"/g, '""')}"`,
        `"${(face.department || '').replace(/"/g, '""')}"`,
        `"${status}"`,
        `"${time}"`,
        totalDays,
        `"${phone}"`
      ].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `student_roster_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Roster Exported",
      description: `Exported ${filteredAndSortedFaces.length} student records as CSV.`,
    });
  };

  return (
    <>
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <Skeleton className="h-10 rounded-xl" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {subTab === 'calendar' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSubTab('roster')}
                  className="h-8 text-xs font-semibold rounded-lg gap-1.5"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 rotate-90" />
                  <span>← Back to Student List</span>
                </Button>
                {selectedFaceId && (
                  <span className="text-xs text-muted-foreground font-medium">
                    Attendance Calendar for: <strong className="text-foreground">{faces.find(f => f.id === selectedFaceId)?.name || 'Student'}</strong>
                  </span>
                )}
              </div>
              <AttendanceCalendar
                selectedFaceId={selectedFaceId}
                onBack={() => setSubTab('roster')}
                availableFaces={faces}
                onSelectFaceId={(id) => setSelectedFaceId(id)}
              />
            </div>
          ) : (
            <>
              {/* ── Clean Top Bar: Quick Status Filter Pills & Actions ── */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('all'); setEnrollmentFilter('all'); }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5",
                      statusFilter === 'all' && enrollmentFilter === 'all'
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border border-border/50"
                    )}
                  >
                    <span>All Students</span>
                    <Badge variant="secondary" className="px-1.5 py-0 h-4 text-[10px] font-mono">
                      {totalStudents}
                    </Badge>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnrollmentFilter(enrollmentFilter === 'enrolled' ? 'all' : 'enrolled')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5 border",
                      enrollmentFilter === 'enrolled'
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border-border/50"
                    )}
                  >
                    <ScanFace className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Face Enrolled</span>
                    <span className="text-[10px] font-mono opacity-90">({enrolledCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnrollmentFilter(enrollmentFilter === 'pending' ? 'all' : 'pending')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5 border",
                      enrollmentFilter === 'pending'
                        ? "bg-slate-700 text-white border-slate-600 shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border-border/50"
                    )}
                  >
                    <span>No Face Data</span>
                    <span className="text-[10px] font-mono opacity-90">({totalStudents - enrolledCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('present')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5",
                      statusFilter === 'present'
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border border-border/50"
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>Present</span>
                    <span className="text-[10px] font-mono opacity-90">({statusCounts.present})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('late')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5",
                      statusFilter === 'late'
                        ? "bg-amber-600 text-white shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border border-border/50"
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>Late</span>
                    <span className="text-[10px] font-mono opacity-90">({statusCounts.late})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('absent')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5",
                      statusFilter === 'absent'
                        ? "bg-rose-600 text-white shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground border border-border/50"
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                    <span>Absent</span>
                    <span className="text-[10px] font-mono opacity-90">({statusCounts.absent})</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCSV}
                    className="h-8 text-xs font-medium rounded-lg gap-1.5 shadow-2xs"
                    title="Export filtered roster to CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/register?openPdfImporter=true')}
                    className="h-8 text-xs font-medium rounded-lg gap-1.5 shadow-2xs"
                    title="Upload ID cards PDF to import students"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Upload PDF</span>
                  </Button>
                </div>
              </div>

              {/* ── Search + Clean Institutional Filters Toolbar ── */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by student name, roll number, or admission ID..."
                    className="pl-9 h-9 rounded-lg bg-background border-border text-xs focus-visible:ring-1"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                  <Select value={sectionFilter} onValueChange={setSectionFilter}>
                    <SelectTrigger className="w-auto min-w-[95px] h-9 text-xs rounded-lg border-border shrink-0 bg-background">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sections</SelectItem>
                      {['A','B','C','D'].map(s => (
                        <SelectItem key={s} value={s}>Section {s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={classFilter} onValueChange={setClassFilter}>
                    <SelectTrigger className="w-auto min-w-[95px] h-9 text-xs rounded-lg border-border shrink-0 bg-background">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Classes</SelectItem>
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(g => (
                        <SelectItem key={g} value={String(g)}>Class {g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("h-9 text-xs rounded-lg border-border gap-1 shrink-0 bg-background", sortField !== 'name' && "border-primary text-primary font-semibold")}>
                        <ArrowUpDown className="h-3 w-3" />
                        <span className="hidden sm:inline">Sort:</span> {sortField === 'name' ? 'Name' : sortField === 'status' ? 'Status' : sortField === 'attendance' ? 'Attendance' : 'Recent'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Sort by</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => toggleSort('name')} className="text-xs justify-between">
                        Name {sortField === 'name' && (sortDir === 'asc' ? <SortAsc className="h-3.5 w-3.5 text-primary" /> : <SortDesc className="h-3.5 w-3.5 text-primary" />)}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleSort('status')} className="text-xs justify-between">
                        Today's Status {sortField === 'status' && (sortDir === 'asc' ? <SortAsc className="h-3.5 w-3.5 text-primary" /> : <SortDesc className="h-3.5 w-3.5 text-primary" />)}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleSort('attendance')} className="text-xs justify-between">
                        Total Attendance {sortField === 'attendance' && (sortDir === 'asc' ? <SortAsc className="h-3.5 w-3.5 text-primary" /> : <SortDesc className="h-3.5 w-3.5 text-primary" />)}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleSort('lastSeen')} className="text-xs justify-between">
                        Recently Marked {sortField === 'lastSeen' && (sortDir === 'asc' ? <SortAsc className="h-3.5 w-3.5 text-primary" /> : <SortDesc className="h-3.5 w-3.5 text-primary" />)}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* View Mode Switcher (Table / Cards) */}
                  <div className="flex items-center border border-border rounded-lg p-0.5 bg-muted/40 shrink-0">
                    <Button
                      variant={displayMode === 'table' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8 rounded-md"
                      title="Data Table View"
                      onClick={() => setDisplayMode('table')}
                    >
                      <LayoutList className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant={displayMode === 'cards' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8 rounded-md"
                      title="Compact Cards View"
                      onClick={() => setDisplayMode('cards')}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-xs text-muted-foreground hover:text-foreground px-2 shrink-0"
                      onClick={() => {
                        setStatusFilter('all');
                        setSectionFilter('all');
                        setClassFilter('all');
                        setSearchTerm('');
                      }}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Student Data Display (Structured Table or Cards) ── */}
              {filteredAndSortedFaces.length === 0 ? (
                <div className="py-14 text-center text-muted-foreground border border-dashed rounded-xl bg-muted/10">
                  <User className="h-9 w-9 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold text-foreground">No students match current filters</p>
                  <p className="text-xs mt-1 text-muted-foreground">Try clearing search terms or resetting filters</p>
                </div>
              ) : displayMode === 'table' ? (
                /* ── High-density Institutional Table View ── */
                <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[280px] text-xs font-semibold">Student</TableHead>
                          <TableHead className="text-xs font-semibold">Roll / ID</TableHead>
                          <TableHead className="text-xs font-semibold">Class & Section</TableHead>
                          <TableHead className="text-xs font-semibold">Today's Status</TableHead>
                          <TableHead className="text-xs font-semibold text-center">Total Attendance</TableHead>
                          <TableHead className="text-xs font-semibold text-right pr-4">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedFaces.map((face) => {
                          const isSelected = selectedFaceId === face.id;
                          return (
                            <TableRow
                              key={face.id}
                              onClick={() => {
                                setSelectedFaceId(face.id);
                              }}
                              className={cn(
                                "cursor-pointer transition-colors text-xs",
                                isSelected ? "bg-muted/60 font-medium" : "hover:bg-muted/30"
                              )}
                            >
                              <TableCell className="py-2.5">
                                <div className="flex items-center gap-3">
                                  <StudentAvatar
                                    name={face.name}
                                    photoUrl={face.image_url}
                                    admissionNumber={face.employee_id}
                                    size="sm"
                                    shape="rounded-lg"
                                    className="shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <p className="font-semibold text-foreground truncate">{face.name}</p>
                                    {face.phone && (
                                      <span className="text-[11px] text-muted-foreground">{face.phone}</span>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground font-medium py-2.5">
                                {face.employee_id}
                              </TableCell>
                              <TableCell className="py-2.5">
                                {face.department && face.department !== 'N/A' ? (
                                  <Badge variant="secondary" className="text-[11px] font-medium">
                                    {face.department}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {getStatusBadge(face.employee_id)}
                                  {face.is_face_enrolled ? (
                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 text-[10px] font-semibold gap-1 shrink-0">
                                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                                      Enrolled
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-slate-500/10 text-slate-500 border-slate-500/20 text-[10px] font-medium shrink-0">
                                      No Face Data
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center font-medium tabular-nums py-2.5">
                                <Badge variant="outline" className="text-xs font-mono font-normal">
                                  {attendanceCounts[face.employee_id] || 0} days
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right py-2.5 pr-3">
                                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 gap-1 rounded-md text-primary hover:bg-primary/10 hover:text-primary"
                                    title="Recapture 3D Face"
                                    onClick={() => {
                                      setRecaptureStudent({
                                        id: face.id,
                                        user_id: face.user_id || face.id,
                                        name: face.name,
                                        employee_id: face.employee_id,
                                        category: face.department,
                                      });
                                    }}
                                  >
                                    <ScanFace className="h-3.5 w-3.5" />
                                    <span className="hidden md:inline">Recapture</span>
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 gap-1 rounded-md hover:bg-muted"
                                    title="View Attendance Calendar"
                                    onClick={() => {
                                      setSelectedFaceId(face.id);
                                      setSubTab('calendar');
                                    }}
                                  >
                                    <Calendar className="h-3.5 w-3.5" />
                                    <span className="hidden md:inline">Calendar</span>
                                  </Button>

                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md">
                                        <MoreVertical className="h-3.5 w-3.5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setSelectedFaceId(face.id);
                                          setSubTab('calendar');
                                        }}
                                        className="text-xs gap-2"
                                      >
                                        <Calendar className="h-3.5 w-3.5" /> View Attendance Calendar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setRecaptureStudent({
                                            id: face.id,
                                            user_id: face.user_id || face.id,
                                            name: face.name,
                                            employee_id: face.employee_id,
                                            category: face.department,
                                          });
                                        }}
                                        className="text-xs gap-2 text-primary font-medium"
                                      >
                                        <ScanFace className="h-3.5 w-3.5 text-primary" /> Recapture 3D Face
                                      </DropdownMenuItem>
                                      <ChangeCategoryDialog
                                        userId={face.user_id}
                                        employeeId={face.employee_id}
                                        studentId={face.id}
                                        userName={face.name}
                                        currentCategory={face.department}
                                        onCategoryChanged={() => void fetchFaces(true)}
                                        trigger={
                                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-xs gap-2">
                                            <FolderInput className="h-3.5 w-3.5" /> Change Class / Section
                                          </DropdownMenuItem>
                                        }
                                      />
                                      <DropdownMenuItem
                                        onClick={() => openPromoteDialog(face)}
                                        className="text-xs gap-2"
                                      >
                                        <UserCheck className="h-3.5 w-3.5" /> Make Teacher
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setStudentToDelete(face)}
                                        className="text-xs text-destructive gap-2 font-medium"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" /> Delete Student Everywhere
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                /* ── Compact Cards View ── */
                <div className="space-y-2">
                  {displayedFaces.map((face, index) => (
                    <motion.div
                      key={face.id}
                      initial={index < 8 ? { opacity: 0, y: 6 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Card
                        className={cn(
                          "cursor-pointer transition-all duration-150 overflow-hidden border-border",
                          selectedFaceId === face.id
                            ? "ring-1 ring-primary shadow-xs border-primary/50"
                            : "hover:bg-muted/30"
                        )}
                        onClick={() => {
                          setSelectedFaceId(face.id);
                          setSubTab('calendar');
                        }}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                              <StudentAvatar
                                name={face.name}
                                photoUrl={face.image_url}
                                admissionNumber={face.employee_id}
                                size="md"
                                shape="rounded-lg"
                              />
                              <span className={cn(
                                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card",
                                todayStatuses[face.employee_id]?.status === 'present' ? 'bg-emerald-500' :
                                todayStatuses[face.employee_id]?.status === 'late' ? 'bg-amber-500' :
                                'bg-rose-500'
                              )} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate text-foreground">{face.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] text-muted-foreground font-mono">{face.employee_id}</span>
                                {face.department && face.department !== 'N/A' && (
                                  <span className="text-[11px] text-muted-foreground truncate">· {face.department}</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {getStatusBadge(face.employee_id)}
                              
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Recapture 3D Face"
                                className="h-8 w-8 rounded-lg text-primary hover:bg-primary/10 hover:text-primary shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecaptureStudent({
                                    id: face.id,
                                    user_id: face.user_id || face.id,
                                    name: face.name,
                                    employee_id: face.employee_id,
                                    category: face.department,
                                  });
                                }}
                              >
                                <ScanFace className="h-4 w-4" />
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0" onClick={e => e.stopPropagation()}>
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setSelectedFaceId(face.id); 
                                    setSubTab('calendar');
                                  }} className="text-xs gap-2">
                                    <Calendar className="h-3.5 w-3.5" /> View Calendar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setRecaptureStudent({
                                      id: face.id,
                                      user_id: face.user_id || face.id,
                                      name: face.name,
                                      employee_id: face.employee_id,
                                      category: face.department,
                                    });
                                  }} className="text-xs gap-2 text-primary font-medium">
                                    <ScanFace className="h-3.5 w-3.5 text-primary" /> Recapture 3D Face
                                  </DropdownMenuItem>
                                  <ChangeCategoryDialog
                                    userId={face.user_id}
                                    employeeId={face.employee_id}
                                    studentId={face.id}
                                    userName={face.name}
                                    currentCategory={face.department}
                                    onCategoryChanged={() => void fetchFaces(true)}
                                    trigger={
                                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-xs gap-2">
                                        <FolderInput className="h-3.5 w-3.5" /> Change Class / Section
                                      </DropdownMenuItem>
                                    }
                                  />
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openPromoteDialog(face); }} className="text-xs gap-2">
                                    <UserCheck className="h-3.5 w-3.5" /> Make Teacher
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setStudentToDelete(face); }} className="text-xs text-destructive gap-2 font-medium">
                                    <Trash2 className="h-3.5 w-3.5" /> Delete Student Everywhere
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              )}

              {filteredAndSortedFaces.length > displayLimit && (
                <div className="pt-2 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs font-semibold h-8 rounded-lg"
                    onClick={() => setDisplayLimit(prev => prev + 40)}
                  >
                    Load More Students ({filteredAndSortedFaces.length - displayLimit} remaining)
                  </Button>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center pt-2">
                Showing {Math.min(displayLimit, filteredAndSortedFaces.length)} of {filteredAndSortedFaces.length} students ({totalStudents} total enrolled)
              </p>
            </>
          )}
        </div>
      )}

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Make Teacher — {selectedTeacher?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-sm">Class access permissions</Label>
              <div className="max-h-52 overflow-y-auto space-y-2 mt-2">
                {CLASSES.map(cls => {
                  const classCats = SECTIONS.map(sec => `${cls}-${sec}`);
                  return (
                    <div key={cls} className="border rounded-md p-2">
                      <p className="text-xs font-medium mb-1">Class {cls}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {classCats.map(cat => {
                          const checked = teacherCategories.includes(cat);
                          return (
                            <label key={cat} className={cn('flex items-center gap-1 text-xs rounded px-1.5 py-1 cursor-pointer', checked ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
                              <Checkbox checked={checked} onCheckedChange={() => toggleTeacherCategory(cat)} />
                              <span>{cat.split('-')[1]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-sm">Class teacher assignment (optional)</Label>
              <Select value={classTeacherCategory} onValueChange={setClassTeacherCategory}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Assign as class teacher" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No class teacher assignment</SelectItem>
                  {CLASSES.flatMap(cls => SECTIONS.map(sec => `${cls}-${sec}`)).map(cat => (
                    <SelectItem key={cat} value={cat}>Class {cat.split('-')[0]} - {cat.split('-')[1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPromoteOpen(false)}>Cancel</Button>
              <Button onClick={handlePromoteTeacher} disabled={isPromoting || !selectedTeacher?.user_id}>
                {isPromoting ? 'Saving...' : 'Save Teacher Access'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!studentToDelete} onOpenChange={(open) => { if (!open && !isDeleting) setStudentToDelete(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Permanently Delete Student Everywhere?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-foreground/80">
              <p>
                Are you sure you want to completely erase <strong>{studentToDelete?.name}</strong> (Roll / ID: {studentToDelete?.employee_id || 'N/A'})?
              </p>
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive space-y-1.5">
                <p className="font-bold">This will permanently delete from EVERYWHERE:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Student profile & registration accounts</li>
                  <li>All AI face model descriptor slots and recognition weights</li>
                  <li>All past and present attendance & gate records</li>
                  <li>All captured biometric face photos in Cloud Storage</li>
                  <li>Gate passes, badges, and notification logs</li>
                </ul>
              </div>
              {deleteProgress && (
                <p className="text-xs font-semibold text-primary animate-pulse">{deleteProgress}</p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting} onClick={() => setStudentToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold shadow-md shadow-destructive/20"
            >
              {isDeleting ? 'Deleting Everywhere...' : 'Yes, Delete Completely'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CaptureFaceDialog
        open={!!recaptureStudent}
        onOpenChange={(open) => !open && setRecaptureStudent(null)}
        student={recaptureStudent}
        onSuccess={() => {
          fetchRegisteredFaces();
        }}
      />
    </>
  );
};

export default AdminFacesList;
