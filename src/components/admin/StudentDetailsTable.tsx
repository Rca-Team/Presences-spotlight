import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Search, Users, Phone, Heart, Bus, MapPin, User as UserIcon, IdCard, Download, Camera, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CLASSES, SECTIONS, getCategoryLabel } from '@/constants/schoolConfig';
import StudentIDCardGenerator from './StudentIDCardGenerator';
import StudentCSVImporter from './StudentCSVImporter';
import CaptureFaceDialog from './CaptureFaceDialog';
import { pickPreferredPhotoCandidate, resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import { universalDeleteStudent } from '@/services/student/studentDeletionService';
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

interface StudentRow {
  id: string;
  user_id: string;
  name: string;
  employee_id: string;
  roll_number: string;
  category: string;
  blood_group: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  transport_mode: string;
  address: string;
  avatar_url: string;
}

const StudentDetailsTable: React.FC = () => {
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [previewStudents, setPreviewStudents] = useState<StudentRow[] | null>(null);
  const [captureFor, setCaptureFor] = useState<StudentRow | null>(null);
  const [isRemovingDuplicates, setIsRemovingDuplicates] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<StudentRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');
  const { toast } = useToast();
  const refreshTimerRef = useRef<number | null>(null);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const [attendanceRes, descriptorsRes, profilesRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, user_id, status, device_info, category, image_url, timestamp')
          .eq('status', 'registered')      // only registered students, not present/late rows
          .order('timestamp', { ascending: false }),
        supabase
          .from('face_descriptors')
          .select('id, user_id, student_id, label, image_url, metadata, created_at')
          .not('image_url', 'is', null)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('id, user_id, admission_number, employee_id, roll_number, avatar_url, photo_url')
          .or('avatar_url.not.is.null,photo_url.not.is.null'),
      ]);

      if (attendanceRes.error) throw attendanceRes.error;
      if (descriptorsRes.error) throw descriptorsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const data = attendanceRes.data || [];

      const profileImageByUserId = new Map<string, string>();
      const profileImageByEmpId = new Map<string, string>();
      (profilesRes.data || []).forEach((profile: any) => {
        const img = (profile?.avatar_url || profile?.photo_url || '').toString().trim();
        if (!img) return;
        if (profile?.user_id && !profileImageByUserId.has(profile.user_id)) {
          profileImageByUserId.set(profile.user_id, img);
        }
        if (profile?.id && !profileImageByUserId.has(profile.id)) {
          profileImageByUserId.set(profile.id, img);
        }
        const emp = (profile?.admission_number || profile?.employee_id || profile?.roll_number || '').toString().trim().toLowerCase();
        if (emp && !profileImageByEmpId.has(emp)) {
          profileImageByEmpId.set(emp, img);
        }
      });

      const descriptorImageByUserId = new Map<string, string>();
      const descriptorImageByStudentKey = new Map<string, string>();
      // First pass: prefer registration primary/front photos
      (descriptorsRes.data || []).forEach((descriptor: any) => {
        const descriptorImg = descriptor?.image_url?.toString().trim();
        if (!descriptorImg) return;
        const meta = descriptor?.metadata || {};
        const isPrimary = meta.registration === 'true' || meta.registration === true || descriptor?.label === 'registration-primary' || (descriptor?.label && descriptor.label.toLowerCase().includes('front'));
        if (isPrimary) {
          if (descriptor?.user_id && !descriptorImageByUserId.has(descriptor.user_id)) {
            descriptorImageByUserId.set(descriptor.user_id, descriptorImg);
          }
          const studentKey = (descriptor?.student_id || '').toString().trim().toLowerCase();
          if (studentKey && !descriptorImageByStudentKey.has(studentKey)) {
            descriptorImageByStudentKey.set(studentKey, descriptorImg);
          }
        }
      });
      // Second pass: fill in earliest created descriptor
      (descriptorsRes.data || []).forEach((descriptor: any) => {
        const descriptorImg = descriptor?.image_url?.toString().trim();
        if (!descriptorImg) return;
        if (descriptor?.user_id && !descriptorImageByUserId.has(descriptor.user_id)) {
          descriptorImageByUserId.set(descriptor.user_id, descriptorImg);
        }
        const studentKey = (descriptor?.student_id || '').toString().trim().toLowerCase();
        if (studentKey && !descriptorImageByStudentKey.has(studentKey)) {
          descriptorImageByStudentKey.set(studentKey, descriptorImg);
        }
      });

      const normKey = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());
      const normName = (v: unknown) =>
        (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');

      // Build cross-references so different rows for the same student collapse.
      const employeeToUserId = new Map<string, string>();
      (data || []).forEach((r: any) => {
        const deviceInfo = r.device_info || {};
        const meta = deviceInfo?.metadata || {};
        const empKey = normKey(
          meta?.employee_id || meta?.roll_number || deviceInfo?.employee_id || r.student_id,
        );
        if (r.user_id && empKey) employeeToUserId.set(empKey, r.user_id);
      });

      // Primary map keyed by a canonical identity. We index by employee_id and (name + category).
      const map = new Map<string, StudentRow>();
      const byEmpId = new Map<string, string>(); // normEmpId -> canonical key
      const byNameAndCategory = new Map<string, string>(); // normName#normCategory -> canonical key

      const upsertStudent = (candidate: StudentRow) => {
        const nameKey = normName(candidate.name);
        const rawEmp = candidate.employee_id !== '—' ? candidate.employee_id : '';
        const empKey = normKey(rawEmp);
        const catKey = normKey(candidate.category);

        // Try to find an existing canonical key for this student:
        // 1. Exact employee / student ID match (highest confidence)
        // 2. Exact Name + Class/Category match
        // 3. Fallback to existing candidate.id in map
        let existingKey: string | undefined;
        if (empKey && empKey !== 'null' && empKey !== 'undefined' && empKey !== 'n/a') {
          existingKey = byEmpId.get(empKey);
        }
        if (!existingKey && nameKey && nameKey !== 'unknown' && nameKey !== 'user') {
          existingKey = byNameAndCategory.get(`${nameKey}#${catKey}`) || byNameAndCategory.get(`${nameKey}#all`);
        }
        if (!existingKey && map.has(candidate.id)) {
          existingKey = candidate.id;
        }

        if (existingKey && map.has(existingKey)) {
          // Merge: fill blanks on the existing row, don't create a new one.
          const cur = map.get(existingKey)!;
          const merged: StudentRow = {
            ...cur,
            avatar_url: cur.avatar_url || candidate.avatar_url,
            employee_id: cur.employee_id !== '—' ? cur.employee_id : candidate.employee_id,
            roll_number: cur.roll_number !== '—' ? cur.roll_number : candidate.roll_number,
            blood_group: cur.blood_group !== '—' ? cur.blood_group : candidate.blood_group,
            parent_name: cur.parent_name !== '—' ? cur.parent_name : candidate.parent_name,
            parent_phone: cur.parent_phone !== '—' ? cur.parent_phone : candidate.parent_phone,
            parent_email: cur.parent_email !== '—' ? cur.parent_email : candidate.parent_email,
            transport_mode: cur.transport_mode !== '—' ? cur.transport_mode : candidate.transport_mode,
            address: cur.address !== '—' ? cur.address : candidate.address,
            user_id: cur.user_id || candidate.user_id,
          };
          map.set(existingKey, merged);
        } else {
          const newKey = empKey && empKey !== 'null' && empKey !== 'n/a'
            ? `emp:${empKey}`
            : `${nameKey}#${catKey || 'A'}#${candidate.id}`;
          map.set(newKey, candidate);
          existingKey = newKey;
        }

        if (empKey && empKey !== 'null' && empKey !== 'n/a') {
          byEmpId.set(empKey, existingKey);
        }
        if (nameKey && nameKey !== 'unknown' && nameKey !== 'user') {
          byNameAndCategory.set(`${nameKey}#${catKey}`, existingKey);
          if (!byNameAndCategory.has(`${nameKey}#all`)) {
            byNameAndCategory.set(`${nameKey}#all`, existingKey);
          }
        }
      };

      (data || []).forEach((r: any) => {
        const deviceInfo = r.device_info || {};
        const meta = deviceInfo?.metadata || {};
        const name = meta?.name || deviceInfo?.name || r.student_name || '';
        if (!name || name === 'Unknown' || name === 'User') return;
        const empKey = normKey(
          meta?.employee_id || meta?.roll_number || deviceInfo?.employee_id || r.student_id,
        );
        const canonicalUserId = r.user_id || (empKey ? employeeToUserId.get(empKey) : null);
        const key = empKey ? `emp:${empKey}` : `rec:${r.id}`;

        const profilePhoto = (canonicalUserId && profileImageByUserId.get(canonicalUserId)) ||
          (empKey && profileImageByEmpId.get(empKey)) ||
          '';

        const avatar = pickPreferredPhotoCandidate(
          profilePhoto,
          meta?.face_model?.id_card_photo_url,
          meta?.id_card_photo_url,
          r.image_url,
          meta.firebase_image_url,
          meta.image,
          canonicalUserId ? descriptorImageByUserId.get(canonicalUserId) : '',
          empKey ? descriptorImageByStudentKey.get(empKey) : '',
        );

        upsertStudent({
          id: key,
          user_id: canonicalUserId || key,
          name,
          employee_id: meta.employee_id || deviceInfo.employee_id || r.student_id || '—',
          roll_number: meta.roll_number || meta.employee_id || deviceInfo.employee_id || '—',
          category: r.category || 'A',
          blood_group: meta.blood_group || '—',
          parent_name: meta.parent_name || '—',
          parent_phone: meta.parent_phone || meta.phone || '—',
          parent_email: meta.parent_email || '—',
          transport_mode: meta.transport_mode || '—',
          address: meta.address || '—',
          avatar_url: avatar,
        });
      });

      // Include descriptor-only students too, so Student page matches ID-card coverage.
      (descriptorsRes.data || []).forEach((descriptor: any) => {
        const descriptorName = (descriptor?.label || '').toString().trim();
        if (!descriptorName || descriptorName === 'Unknown' || descriptorName === 'User') return;

        const descriptorUserId = normKey(descriptor?.user_id);
        const descriptorStudentId = normKey(descriptor?.student_id);
        const descriptorKey = descriptorStudentId ? `emp:${descriptorStudentId}` : `fd:${descriptor?.id || Math.random().toString(36).slice(2)}`;

        const profilePhoto = (descriptorUserId && profileImageByUserId.get(descriptorUserId)) ||
          (descriptorStudentId && profileImageByEmpId.get(descriptorStudentId)) ||
          '';

        const avatar = pickPreferredPhotoCandidate(
          profilePhoto,
          descriptorStudentId ? descriptorImageByStudentKey.get(descriptorStudentId) : '',
          descriptorUserId ? descriptorImageByUserId.get(descriptorUserId) : '',
          descriptor?.image_url,
        );

        upsertStudent({
          id: descriptorKey,
          user_id: descriptorUserId || descriptorKey,
          name: descriptorName,
          employee_id: descriptorStudentId || '—',
          roll_number: descriptorStudentId || '—',
          category: descriptor?.category || 'A',
          blood_group: '—',
          parent_name: '—',
          parent_phone: '—',
          parent_email: '—',
          transport_mode: '—',
          address: '—',
          avatar_url: avatar,
        });
      });

      const resolvedRows = await Promise.all(
        Array.from(map.values()).map(async (student) => ({
          ...student,
          avatar_url: await resolveStudentPhotoUrl(student.avatar_url),
        })),
      );

      const sortedRows = resolvedRows.sort((a, b) => {
        const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return String(a.employee_id || '').localeCompare(String(b.employee_id || ''), undefined, { sensitivity: 'base' });
      });

      setRows(sortedRows);
    } catch (e) {
      console.error('Error loading students:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  const removeDuplicateStudents = async () => {
    const confirmed = window.confirm(
      'Remove duplicate students? This keeps the newest record per student and deletes older duplicates from attendance_records and face_descriptors.'
    );
    if (!confirmed) return;
    setIsRemovingDuplicates(true);
    try {
      const [{ data: attRows, error: attErr }, { data: descRows, error: descErr }] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, user_id, student_id, student_name, device_info, timestamp')
          .eq('status', 'registered')
          .order('timestamp', { ascending: false }),
        supabase
          .from('face_descriptors')
          .select('id, user_id, student_id, label, created_at')
          .order('created_at', { ascending: false }),
      ]);
      if (attErr) throw attErr;
      if (descErr) throw descErr;

      const identityOf = (r: any): string => {
        const meta = r?.device_info?.metadata || {};
        const emp = (meta.employee_id || meta.roll_number || r?.device_info?.employee_id || r?.student_id || '').toString().trim().toLowerCase();
        if (emp) return `emp:${emp}`;
        const uid = (r?.user_id || '').toString().trim().toLowerCase();
        if (uid) return `uid:${uid}`;
        const name = (meta.name || r?.device_info?.name || r?.student_name || r?.label || '').toString().trim().toLowerCase();
        if (name) return `name:${name}`;
        return `id:${r?.id}`;
      };

      const collectDupes = (rows: any[]) => {
        const seen = new Set<string>();
        const dupes: string[] = [];
        for (const r of rows || []) {
          const k = identityOf(r);
          if (seen.has(k)) dupes.push(r.id);
          else seen.add(k);
        }
        return dupes;
      };

      const attDupes = collectDupes(attRows || []);
      const descDupes = collectDupes(descRows || []);

      const chunk = <T,>(arr: T[], n: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
      };

      let attDeleted = 0;
      for (const batch of chunk(attDupes, 100)) {
        const { error } = await supabase.from('attendance_records').delete().in('id', batch);
        if (!error) attDeleted += batch.length;
      }
      let descDeleted = 0;
      for (const batch of chunk(descDupes, 100)) {
        const { error } = await supabase.from('face_descriptors').delete().in('id', batch);
        if (!error) descDeleted += batch.length;
      }

      toast({
        title: 'Duplicates removed',
        description: `Deleted ${attDeleted} attendance rows and ${descDeleted} face descriptor rows.`,
      });
      await fetchStudents();
    } catch (e: any) {
      console.error('Remove duplicates failed:', e);
      toast({ title: 'Failed', description: e?.message || 'Could not remove duplicates.', variant: 'destructive' });
    } finally {
      setIsRemovingDuplicates(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!studentToDelete) return;
    setIsDeleting(true);
    setDeleteProgress(`Starting deletion for ${studentToDelete.name}...`);
    try {
      const res = await universalDeleteStudent(
        {
          id: studentToDelete.id,
          user_id: studentToDelete.user_id,
          employee_id: studentToDelete.employee_id,
          roll_number: studentToDelete.roll_number,
          name: studentToDelete.name,
          avatar_url: studentToDelete.avatar_url,
        },
        (status) => setDeleteProgress(status)
      );

      if (res.success) {
        toast({
          title: "Student Deleted Completely",
          description: `Permanently removed ${studentToDelete.name} (${studentToDelete.employee_id || studentToDelete.roll_number || ''}) from profiles, face descriptors, attendance records, and cloud storage.`,
        });
        setRows((prev) => prev.filter((r) => r.id !== studentToDelete.id && r.employee_id !== studentToDelete.employee_id));
        setStudentToDelete(null);
        await fetchStudents();
      } else {
        toast({
          title: "Partial Deletion",
          description: res.errors.join("; ") || "Some records could not be purged.",
          variant: "destructive",
        });
        setStudentToDelete(null);
        await fetchStudents();
      }
    } catch (err: any) {
      console.error('Delete student error:', err);
      toast({
        title: "Delete Failed",
        description: err?.message || "Could not delete student.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteProgress('');
    }
  };


  useEffect(() => {
    const queueRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        fetchStudents();
        refreshTimerRef.current = null;
      }, 300);
    };

    const channel = supabase
      .channel('student-details-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'face_descriptors' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, queueRefresh)
      .subscribe();

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const blob = `${r.name} ${r.employee_id} ${r.roll_number} ${r.parent_name} ${r.parent_phone}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (classFilter !== 'all' && !r.category.startsWith(classFilter)) return false;
      if (sectionFilter !== 'all' && !r.category.endsWith(sectionFilter)) return false;
      return true;
    });
  }, [rows, search, classFilter, sectionFilter]);

  if (previewStudents) {
    return (
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={() => setPreviewStudents(null)}>
          ← Back to Student List
        </Button>
        <StudentIDCardGenerator students={previewStudents as any} />
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-gradient-to-r from-cyan-50 via-blue-50 to-violet-50 dark:from-cyan-950/30 dark:via-blue-950/30 dark:to-violet-950/30">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          All Students — Full Details & ID Cards
        </CardTitle>
        <CardDescription>
          Searchable directory of every registered student. Click a row to preview / download an ID card.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Responsive Filters */}
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 items-center">
          <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, roll, ID, parent or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="flex-1 sm:w-[120px]">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {CLASSES.map((c) => (
                  <SelectItem key={c} value={String(c)}>Class {c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="flex-1 sm:w-[120px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>Sec {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button
              variant="default"
              size="sm"
              className="flex-1 sm:flex-initial"
              disabled={filtered.length === 0}
              onClick={() => setPreviewStudents(filtered)}
            >
              <IdCard className="h-4 w-4 mr-1" />
              ID Cards ({filtered.length})
            </Button>
            <StudentCSVImporter onImported={fetchStudents} />
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 sm:flex-initial"
              onClick={removeDuplicateStudents}
              disabled={isRemovingDuplicates}
              title="Delete duplicate student rows, keeping newest"
            >
              {isRemovingDuplicates ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Remove Duplicates
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" />{rows.length} Total</Badge>
          <Badge variant="secondary">{filtered.length} Shown</Badge>
        </div>

        {/* Content: Mobile Cards (< md) & Desktop Table (>= md) */}
        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No students match the current filters.</p>
          </div>
        ) : (
          <>
            {/* Mobile View: Clean, high-density student cards */}
            <div className="grid grid-cols-1 gap-2.5 md:hidden">
              {filtered.map((s) => (
                <div
                  key={s.id}
                  className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-11 w-11 border shrink-0">
                        {s.avatar_url ? <AvatarImage src={s.avatar_url} alt={s.name} /> : null}
                        <AvatarFallback><UserIcon className="h-4 w-4" /></AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-foreground truncate">{s.name}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <span>Roll: <strong className="text-foreground">{s.roll_number}</strong></span>
                          <span>•</span>
                          <span>ID: {s.employee_id}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[11px] font-bold">
                      {getCategoryLabel(s.category)}
                    </Badge>
                  </div>

                  {/* Contact & Detail Row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/50">
                    {s.parent_name && (
                      <span className="truncate">Parent: <strong className="text-foreground font-medium">{s.parent_name}</strong></span>
                    )}
                    {s.parent_phone && (
                      <a
                        href={`tel:${s.parent_phone}`}
                        className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                      >
                        <Phone className="h-3 w-3" />
                        {s.parent_phone}
                      </a>
                    )}
                    {s.blood_group && (
                      <Badge variant="outline" className="text-[10px] text-red-600 border-red-300 px-1.5 py-0">
                        <Heart className="h-2.5 w-2.5 mr-0.5" />
                        {s.blood_group}
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs flex-1"
                      onClick={() => setCaptureFor(s)}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      Face Scan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs flex-1"
                      onClick={() => setPreviewStudents([s])}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      ID Card
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 border-destructive/20 px-2.5"
                      onClick={() => setStudentToDelete(s)}
                      title="Delete Student Completely"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop View: Full Data Table */}
            <div className="hidden md:block rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Roll / ID</TableHead>
                    <TableHead>Blood</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/40">
                      <TableCell>
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <Avatar className="h-10 w-10 border">
                            {s.avatar_url ? <AvatarImage src={s.avatar_url} alt={s.name} /> : null}
                            <AvatarFallback><UserIcon className="h-4 w-4" /></AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{s.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{s.parent_email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getCategoryLabel(s.category)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>Roll: <span className="font-semibold">{s.roll_number}</span></div>
                        <div className="text-xs text-muted-foreground">ID: {s.employee_id}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-red-600 border-red-300">
                          <Heart className="h-3 w-3 mr-1" />
                          {s.blood_group}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{s.parent_name}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {s.parent_phone}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Bus className="h-3 w-3" />
                          {s.transport_mode}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px]">
                        <span className="inline-flex items-start gap-1">
                          <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-2">{s.address}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCaptureFor(s)}
                            title="Capture face for this student"
                          >
                            <Camera className="h-3.5 w-3.5 mr-1" />
                            Capture Face
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPreviewStudents([s])}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            ID Card
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                            onClick={() => setStudentToDelete(s)}
                            title="Delete Student Completely"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={!!studentToDelete} onOpenChange={(open) => { if (!open && !isDeleting) setStudentToDelete(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Permanently Delete Student Everywhere?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-foreground/80">
              <p>
                Are you sure you want to completely erase <strong>{studentToDelete?.name}</strong> (Roll: {studentToDelete?.roll_number || 'N/A'}, ID: {studentToDelete?.employee_id || 'N/A'})?
              </p>
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive space-y-1.5">
                <p className="font-bold">This will permanently delete from EVERYWHERE:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Student profile & registration accounts</li>
                  <li>All AI face model descriptors & recognition weights</li>
                  <li>All past and present attendance records</li>
                  <li>All biometric photos in Cloud Storage</li>
                  <li>Gate pass entries, badges, and notification records</li>
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
        open={!!captureFor}
        onOpenChange={(o) => { if (!o) setCaptureFor(null); }}
        student={captureFor as any}
        onSuccess={fetchStudents}
      />
    </Card>
  );
};

export default StudentDetailsTable;