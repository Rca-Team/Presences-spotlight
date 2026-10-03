import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useAttendanceCalendar } from './hooks/useAttendanceCalendar';
import StudentInfoCard from './StudentInfoCard';
import DailyAttendanceDetails from './DailyAttendanceDetails';
import AttendanceCalendarView from './AttendanceCalendarView';
import ReportControls from './ReportControls';
import { CalendarDays, ChevronLeft, Users, Sparkles, Check, CheckCircle2, User, Phone, Mail, MapPin, Loader2, Camera, Upload, RotateCcw, AlertCircle, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import CaptureFaceDialog from './CaptureFaceDialog';
import { CLASSES, SECTIONS } from '@/constants/schoolConfig';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';
import { cn } from '@/lib/utils';

interface AttendanceCalendarProps {
  selectedFaceId: string | null;
  onBack?: () => void;
  availableFaces?: Array<{ id: string; name: string; employee_id: string; department?: string; image_url?: string }>;
  onSelectFaceId?: (id: string) => void;
}

const AttendanceCalendar: React.FC<AttendanceCalendarProps> = ({ 
  selectedFaceId,
  onBack,
  availableFaces,
  onSelectFaceId
}) => {
  const { toast } = useToast();
  const {
    attendanceDays,
    lateAttendanceDays,
    absentDays,
    selectedFace,
    selectedDate,
    setSelectedDate,
    visibleMonth,
    setVisibleMonth,
    dailyAttendance,
    workingDays,
    isDateInArray,
    attendanceRecords,
    refreshSelectedFace,
  } = useAttendanceCalendar(selectedFaceId);

  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSavedRecently, setIsSavedRecently] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [detailsForm, setDetailsForm] = useState({
    student_name: '',
    class_name: '',
    section: '',
    roll_number: '',
    admission_number: '',
    blood_group: '',
    date_of_birth: '',
    gender: '',
    parent_name: '',
    parent_phone: '',
    parent_email: '',
    transport_mode: '',
    address: '',
  });
  const [availablePhotoOptions, setAvailablePhotoOptions] = useState<Array<{ value: string; label: string; preview: string }>>([]);
  const [selectedPhotoValue, setSelectedPhotoValue] = useState('');
  const [loadingPhotoOptions, setLoadingPhotoOptions] = useState(false);
  const [applyingPhoto, setApplyingPhoto] = useState(false);

  const normalizePhotoRef = (value?: string | null) => (value || '').trim();

  const applyStudentPhotoReference = useCallback(async (photoRef: string) => {
    const normalized = normalizePhotoRef(photoRef);
    if (!normalized || !selectedFace) return;

    setApplyingPhoto(true);
    try {
      let attendanceQuery = supabase.from('attendance_records').update({ image_url: normalized });
      let descriptorQuery = supabase.from('face_descriptors').update({ image_url: normalized });

      if (selectedFace.user_id) {
        attendanceQuery = attendanceQuery.eq('user_id', selectedFace.user_id);
        descriptorQuery = descriptorQuery.eq('user_id', selectedFace.user_id);
      } else {
        attendanceQuery = attendanceQuery.eq('student_id', selectedFace.employee_id || '');
        descriptorQuery = descriptorQuery.eq('student_id', selectedFace.employee_id || '');
      }

      const profileQuery = selectedFace.user_id
        ? supabase.from('profiles').update({ avatar_url: normalized }).eq('user_id', selectedFace.user_id)
        : Promise.resolve({ error: null } as { error: null });

      const [{ error: attendanceError }, { error: descriptorError }, profileRes] = await Promise.all([
        attendanceQuery,
        descriptorQuery,
        profileQuery,
      ]);

      if (attendanceError) throw attendanceError;
      if (descriptorError) throw descriptorError;
      if (profileRes?.error) throw profileRes.error;

      await refreshSelectedFace();
      toast({
        title: 'Profile photo updated',
        description: 'Selected photo is now active for this student.',
      });
    } catch (error: any) {
      console.error('Failed to apply student photo:', error);
      toast({
        title: 'Photo update failed',
        description: error?.message || 'Could not apply this photo right now.',
        variant: 'destructive',
      });
    } finally {
      setApplyingPhoto(false);
    }
  }, [refreshSelectedFace, selectedFace, toast]);

  const loadAvailablePhotoOptions = useCallback(async () => {
    if (!selectedFace) {
      setAvailablePhotoOptions([]);
      setSelectedPhotoValue('');
      return;
    }

    setLoadingPhotoOptions(true);
    try {
      const rawCandidates: string[] = [];
      const seen = new Set<string>();
      const pushCandidate = (value?: string | null) => {
        const normalized = normalizePhotoRef(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        rawCandidates.push(normalized);
      };

      pushCandidate(selectedFace.image_url);

      let attendanceQuery = supabase
        .from('attendance_records')
        .select('image_url, timestamp')
        .not('image_url', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(20);

      let descriptorsQuery = supabase
        .from('face_descriptors')
        .select('image_url, created_at')
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (selectedFace.user_id) {
        attendanceQuery = attendanceQuery.eq('user_id', selectedFace.user_id);
        descriptorsQuery = descriptorsQuery.eq('user_id', selectedFace.user_id);
      } else {
        attendanceQuery = attendanceQuery.eq('student_id', selectedFace.employee_id || '');
        descriptorsQuery = descriptorsQuery.eq('student_id', selectedFace.employee_id || '');
      }

      const profileQuery = selectedFace.user_id
        ? supabase.from('profiles').select('avatar_url').eq('user_id', selectedFace.user_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as { data: { avatar_url?: string | null } | null; error: null });

      const [{ data: attendancePhotos }, { data: descriptorPhotos }, { data: profilePhoto }] = await Promise.all([
        attendanceQuery,
        descriptorsQuery,
        profileQuery,
      ]);

      (attendancePhotos || []).forEach((row) => pushCandidate(row.image_url));
      (descriptorPhotos || []).forEach((row) => pushCandidate(row.image_url));
      pushCandidate(profilePhoto?.avatar_url);

      const options = await Promise.all(
        rawCandidates.slice(0, 12).map(async (raw, index) => ({
          value: raw,
          label: index === 0 ? 'Current photo' : `Saved photo ${index + 1}`,
          preview: await resolveStudentPhotoUrl(raw),
        })),
      );

      setAvailablePhotoOptions(options);
      setSelectedPhotoValue((prev) => (options.some((opt) => opt.value === prev) ? prev : options[0]?.value || ''));
    } catch (error) {
      console.error('Failed to load photo options:', error);
      setAvailablePhotoOptions([]);
      setSelectedPhotoValue('');
    } finally {
      setLoadingPhotoOptions(false);
    }
  }, [selectedFace]);

  const handleUploadPhoto = async (file: File) => {
    if (!selectedFace) return;

    setApplyingPhoto(true);
    try {
      const identity = (selectedFace.employee_id || selectedFace.user_id || selectedFace.recordId || 'student').trim();
      const sanitizedName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
      const storagePath = `faces/manual-updates/${Date.now()}-${identity}-${sanitizedName}`;
      const { data, error } = await supabase.storage
        .from('face-images')
        .upload(storagePath, file, { upsert: true, cacheControl: '3600' });

      if (error || !data?.path) throw error || new Error('Upload failed');

      await applyStudentPhotoReference(data.path);
      await loadAvailablePhotoOptions();
      setSelectedPhotoValue(data.path);
    } catch (error: any) {
      console.error('Failed to upload profile photo:', error);
      toast({
        title: 'Upload failed',
        description: error?.message || 'Could not upload the photo.',
        variant: 'destructive',
      });
    } finally {
      setApplyingPhoto(false);
    }
  };

  const resetFormToCurrentFace = useCallback(() => {
    if (!selectedFace) return;
    setDetailsForm({
      student_name: selectedFace.name || '',
      class_name: selectedFace.class || '',
      section: selectedFace.section || '',
      roll_number: selectedFace.roll_number || '',
      admission_number: selectedFace.admission_number || '',
      blood_group: selectedFace.blood_group || '',
      date_of_birth: selectedFace.date_of_birth || '',
      gender: selectedFace.gender || '',
      parent_name: selectedFace.parent_name || '',
      parent_phone: selectedFace.parent_phone || '',
      parent_email: selectedFace.parent_email || '',
      transport_mode: selectedFace.transport_mode || '',
      address: selectedFace.address || '',
    });
    setHasChanges(false);
  }, [selectedFace]);

  useEffect(() => {
    resetFormToCurrentFace();
    loadAvailablePhotoOptions();
  }, [selectedFace?.recordId, resetFormToCurrentFace, loadAvailablePhotoOptions]);

  const updateFormField = (field: keyof typeof detailsForm, value: string) => {
    setDetailsForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const studentForCapture = selectedFace?.user_id
    ? {
        id: selectedFace.user_id,
        user_id: selectedFace.user_id,
        name: selectedFace.name,
        employee_id: selectedFace.employee_id,
        roll_number: selectedFace.roll_number,
        parent_name: selectedFace.parent_name,
        parent_phone: selectedFace.parent_phone,
        parent_email: selectedFace.parent_email,
      }
    : null;

  const saveStudentDetails = async () => {
    if (!selectedFace) {
      toast({ title: 'Unable to save', description: 'Student reference missing.', variant: 'destructive' });
      return;
    }

    const studentName = detailsForm.student_name.trim();
    if (!studentName) {
      toast({ title: 'Name required', description: 'Please enter student name.', variant: 'destructive' });
      return;
    }

    setSavingDetails(true);
    try {
      const classValue = detailsForm.class_name.trim();
      const sectionValue = detailsForm.section.trim().toUpperCase();
      const rollValue = detailsForm.roll_number.trim();
      const admissionValue = detailsForm.admission_number.trim();
      const bloodValue = detailsForm.blood_group.trim();
      const dobValue = detailsForm.date_of_birth.trim();
      const genderValue = detailsForm.gender.trim();
      const parentNameValue = detailsForm.parent_name.trim();
      const parentPhoneValue = detailsForm.parent_phone.trim();
      const parentEmailValue = detailsForm.parent_email.trim();
      const transportValue = detailsForm.transport_mode.trim();
      const addressValue = detailsForm.address.trim();

      // 1. Update attendance_records metadata & columns
      let recordsQuery = supabase
        .from('attendance_records')
        .select('id, device_info');

      if (selectedFace.user_id) {
        recordsQuery = recordsQuery.or(`user_id.eq.${selectedFace.user_id},student_id.eq.${selectedFace.user_id}`);
      } else if (selectedFace.employee_id) {
        recordsQuery = recordsQuery.eq('student_id', selectedFace.employee_id);
      } else {
        recordsQuery = recordsQuery.eq('id', selectedFace.recordId);
      }

      const { data: rows, error: fetchErr } = await recordsQuery;
      if (fetchErr) console.warn('Could not query all attendance records:', fetchErr);

      for (const row of rows || []) {
        const existing = typeof row.device_info === 'string' ? JSON.parse(row.device_info) : (row.device_info || {});
        const metadata = existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
        const categoryValue = classValue && sectionValue ? `${classValue}-${sectionValue}` : existing?.category;
        const updatedInfo = {
          ...existing,
          category: categoryValue,
          metadata: {
            ...metadata,
            name: studentName,
            class: classValue,
            section: sectionValue,
            roll_number: rollValue,
            admission_number: admissionValue,
            blood_group: bloodValue,
            date_of_birth: dobValue,
            gender: genderValue,
            parent_name: parentNameValue,
            parent_phone: parentPhoneValue,
            parent_email: parentEmailValue,
            transport_mode: transportValue,
            address: addressValue,
          },
        };

        await supabase
          .from('attendance_records')
          .update({
            device_info: updatedInfo,
            student_name: studentName,
            class: classValue || null,
            section: sectionValue || null,
            category: categoryValue || null,
          })
          .eq('id', row.id);
      }

      // 2. Update face_descriptors
      let descriptorUpdate = supabase
        .from('face_descriptors')
        .update({
          student_name: studentName,
          label: studentName,
          class: classValue || null,
          section: sectionValue || null,
        });

      if (selectedFace.user_id) {
        descriptorUpdate = descriptorUpdate.or(`user_id.eq.${selectedFace.user_id},student_id.eq.${selectedFace.user_id}`);
      } else if (selectedFace.employee_id) {
        descriptorUpdate = descriptorUpdate.eq('student_id', selectedFace.employee_id);
      }
      await descriptorUpdate;

      // 3. Update profiles table
      const profilePayload: any = {
        full_name: studentName,
        display_name: studentName,
        class: classValue || null,
        section: sectionValue || null,
        roll_number: rollValue || null,
        admission_number: admissionValue || null,
        parent_name: parentNameValue || null,
        parent_phone: parentPhoneValue || null,
        parent_email: parentEmailValue || null,
        blood_group: bloodValue || null,
        address: addressValue || null,
        date_of_birth: dobValue || null,
        gender: genderValue || null,
      };

      if (selectedFace.user_id) {
        await supabase.from('profiles').update(profilePayload).eq('user_id', selectedFace.user_id);
      }
      if (admissionValue) {
        await supabase.from('profiles').update(profilePayload).eq('admission_number', admissionValue);
      }
      if (selectedFace.employee_id && selectedFace.employee_id !== admissionValue) {
        await supabase.from('profiles').update(profilePayload).eq('employee_id', selectedFace.employee_id);
      }

      await refreshSelectedFace();

      setHasChanges(false);
      setIsSavedRecently(true);
      setTimeout(() => setIsSavedRecently(false), 3000);

      // Broadcast update across app
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('presence:student-identities-loaded'));
      }

      toast({
        title: '⚡ Profile Updated in Real-Time',
        description: `All records, class details, and contacts for ${studentName} are live.`,
      });
    } catch (error: any) {
      console.error('Failed to save student details:', error);
      toast({ title: 'Save failed', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingDetails(false);
    }
  };

  if (!selectedFaceId) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        {onBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="gap-1.5 h-8 text-xs font-semibold rounded-xl"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Student Directory
          </Button>
        )}
        <Card className="border-dashed">
          <CardContent className="py-10 sm:py-16 flex flex-col items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-muted flex items-center justify-center">
              <CalendarDays className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground/50" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-semibold text-base sm:text-lg">No student selected</h3>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-xs px-4">
                Select a student from the list or choose from the dropdown below to view their attendance calendar.
              </p>
            </div>
            {availableFaces && availableFaces.length > 0 && onSelectFaceId && (
              <div className="w-full max-w-xs pt-2">
                <Select onValueChange={onSelectFaceId}>
                  <SelectTrigger className="w-full h-9 rounded-xl text-xs">
                    <SelectValue placeholder="Choose a student..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {availableFaces.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">
                        {f.name} ({f.employee_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 sm:space-y-4"
    >
      {/* Top action bar when embedded in student section */}
      {(onBack || (availableFaces && availableFaces.length > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-card/60 border border-border/60 p-2 rounded-2xl">
          {onBack && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="gap-1.5 h-8 text-xs font-semibold rounded-xl bg-card"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Student Directory
            </Button>
          )}
          {availableFaces && availableFaces.length > 0 && onSelectFaceId && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Student:</span>
              <Select value={selectedFaceId || ''} onValueChange={onSelectFaceId}>
                <SelectTrigger className="h-8 w-48 sm:w-60 text-xs rounded-xl bg-card">
                  <SelectValue placeholder="Switch student..." />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {availableFaces.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.name} ({f.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Student Header + Report Actions */}
      <StudentInfoCard
        selectedFace={selectedFace}
        attendanceDays={attendanceDays}
        lateAttendanceDays={lateAttendanceDays}
        absentDays={absentDays}
        workingDays={workingDays}
        visibleMonth={visibleMonth}
        onToggleDetails={() => {
          setShowDetailsPanel((prev) => !prev);
        }}
        showDetailsPanel={showDetailsPanel}
        reportControls={
          <ReportControls
            selectedFace={selectedFace}
            workingDays={workingDays}
            attendanceDays={attendanceDays}
            lateAttendanceDays={lateAttendanceDays}
            absentDays={absentDays}
            selectedDate={selectedDate}
            dailyAttendance={dailyAttendance}
          />
        }
      />

      <AnimatePresence>
        {showDetailsPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="overflow-hidden border border-primary/25 bg-card/95 shadow-xl backdrop-blur-xl rounded-2xl">
              {/* Header Toolbar */}
              <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/70 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="absolute w-4 h-4 rounded-full bg-emerald-500/30 animate-ping" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold tracking-tight text-foreground">
                        Real-Time Student Record Editor
                      </h3>
                      {hasChanges && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Unsaved edits
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Updates synchronize immediately to profiles, biometric descriptors, and school attendance.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {hasChanges && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={resetFormToCurrentFace}
                      disabled={savingDetails}
                      className="h-8 text-xs gap-1.5 font-semibold text-muted-foreground hover:text-foreground rounded-xl"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Discard
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCaptureOpen(true)}
                    disabled={!studentForCapture || savingDetails}
                    className="h-8 text-xs font-semibold rounded-xl border-border/80 gap-1.5 hidden sm:inline-flex"
                  >
                    <Camera className="w-3.5 h-3.5 text-primary" />
                    Recapture 3D Face
                  </Button>

                  <Button
                    size="sm"
                    onClick={saveStudentDetails}
                    disabled={savingDetails}
                    className={cn(
                      "h-8 text-xs font-bold gap-1.5 rounded-xl px-4 shadow-sm transition-all",
                      isSavedRecently
                        ? "bg-emerald-600 hover:bg-emerald-600 text-white shadow-emerald-500/25"
                        : "bg-primary text-primary-foreground shadow-primary/25 hover:opacity-95"
                    )}
                  >
                    {savingDetails ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Saving…
                      </>
                    ) : isSavedRecently ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Saved in Real-Time!
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Form Body: 4 Organized Bento Sections */}
              <CardContent className="p-4 sm:p-6 space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
                  {/* Card 1: Academic & Identity */}
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
                    <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                      <User className="w-4 h-4 text-primary" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Academic & Identity</h4>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Student Full Name *</Label>
                      <Input
                        value={detailsForm.student_name}
                        onChange={(e) => updateFormField('student_name', e.target.value)}
                        placeholder="e.g. Aarav Sharma"
                        className="h-9 rounded-xl text-xs bg-background"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Class</Label>
                        <Select
                          value={detailsForm.class_name || '__none'}
                          onValueChange={(v) => updateFormField('class_name', v === '__none' ? '' : v)}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                          <SelectContent className="max-h-56">
                            <SelectItem value="__none">None</SelectItem>
                            {CLASSES.map((cls) => (
                              <SelectItem key={cls} value={String(cls)}>{`Class ${cls}`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Section</Label>
                        <Select
                          value={detailsForm.section || '__none'}
                          onValueChange={(v) => updateFormField('section', v === '__none' ? '' : v)}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                            <SelectValue placeholder="Section" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">None</SelectItem>
                            {SECTIONS.map((sec) => (
                              <SelectItem key={sec} value={sec}>{`Section ${sec}`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Roll Number</Label>
                        <Input
                          value={detailsForm.roll_number}
                          onChange={(e) => updateFormField('roll_number', e.target.value)}
                          placeholder="e.g. 24"
                          className="h-9 rounded-xl text-xs bg-background"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Admission / Student ID</Label>
                        <Input
                          value={detailsForm.admission_number}
                          onChange={(e) => updateFormField('admission_number', e.target.value)}
                          placeholder="e.g. ADM2024042"
                          className="h-9 rounded-xl text-xs bg-background font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Personal & Demographics */}
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
                    <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Personal & Medical</h4>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Date of Birth</Label>
                        <Input
                          type="date"
                          value={detailsForm.date_of_birth}
                          onChange={(e) => updateFormField('date_of_birth', e.target.value)}
                          className="h-9 rounded-xl text-xs bg-background"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Gender</Label>
                        <Select
                          value={detailsForm.gender || '__none'}
                          onValueChange={(v) => updateFormField('gender', v === '__none' ? '' : v)}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Not specified</SelectItem>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Blood Group</Label>
                        <Select
                          value={detailsForm.blood_group || '__none'}
                          onValueChange={(v) => updateFormField('blood_group', v === '__none' ? '' : v)}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                            <SelectValue placeholder="Blood group" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Not known</SelectItem>
                            {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                              <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Transport Mode</Label>
                        <Select
                          value={detailsForm.transport_mode || '__none'}
                          onValueChange={(v) => updateFormField('transport_mode', v === '__none' ? '' : v)}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                            <SelectValue placeholder="Select mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">None</SelectItem>
                            <SelectItem value="School Bus">School Bus</SelectItem>
                            <SelectItem value="Parent Drop">Parent Drop</SelectItem>
                            <SelectItem value="Walking">Walking</SelectItem>
                            <SelectItem value="Bicycle">Bicycle</SelectItem>
                            <SelectItem value="Private Van">Private Van</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Guardian & Contact Details */}
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
                    <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                      <Phone className="w-4 h-4 text-sky-500" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Guardian & Contact Details</h4>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Parent / Guardian Name</Label>
                      <Input
                        value={detailsForm.parent_name}
                        onChange={(e) => updateFormField('parent_name', e.target.value)}
                        placeholder="e.g. Ramesh Sharma"
                        className="h-9 rounded-xl text-xs bg-background"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold flex items-center gap-1">
                          <Phone className="w-3 h-3 text-emerald-500" /> Parent Phone
                        </Label>
                        <Input
                          type="tel"
                          value={detailsForm.parent_phone}
                          onChange={(e) => updateFormField('parent_phone', e.target.value)}
                          placeholder="e.g. 9876543210"
                          className="h-9 rounded-xl text-xs bg-background font-mono"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold flex items-center gap-1">
                          <Mail className="w-3 h-3 text-sky-500" /> Parent Email
                        </Label>
                        <Input
                          type="email"
                          value={detailsForm.parent_email}
                          onChange={(e) => updateFormField('parent_email', e.target.value)}
                          placeholder="parent@example.com"
                          className="h-9 rounded-xl text-xs bg-background"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-rose-500" /> Residential Address
                      </Label>
                      <Input
                        value={detailsForm.address}
                        onChange={(e) => updateFormField('address', e.target.value)}
                        placeholder="Street, City, Pin Code"
                        className="h-9 rounded-xl text-xs bg-background"
                      />
                    </div>
                  </div>

                  {/* Card 4: Profile Photo Manager */}
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3.5 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                        <Camera className="w-4 h-4 text-purple-500" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Profile & Biometric Photo</h4>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Select a verified biometric photo captured during gate attendance or upload an official student ID photo.
                      </p>

                      <div className="flex items-center gap-3 pt-1">
                        <div className="relative shrink-0 w-16 h-16 rounded-2xl border border-border/80 overflow-hidden bg-background shadow-inner flex items-center justify-center">
                          {selectedPhotoValue ? (
                            <img
                              src={availablePhotoOptions.find((p) => p.value === selectedPhotoValue)?.preview || selectedPhotoValue}
                              alt="Student preview"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-7 h-7 text-muted-foreground/40" />
                          )}
                        </div>

                        <div className="flex-1 space-y-2 min-w-0">
                          <Select value={selectedPhotoValue} onValueChange={setSelectedPhotoValue}>
                            <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                              <SelectValue placeholder={loadingPhotoOptions ? 'Loading photos…' : 'Choose saved face photo'} />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                              {availablePhotoOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => photoInputRef.current?.click()}
                              disabled={applyingPhoto}
                              className="h-7 text-xs font-semibold rounded-lg border-border/80 gap-1 flex-1"
                            >
                              <Upload className="w-3 h-3" />
                              Upload File
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              onClick={() => applyStudentPhotoReference(selectedPhotoValue)}
                              disabled={!selectedPhotoValue || applyingPhoto || loadingPhotoOptions}
                              className="h-7 text-xs font-semibold rounded-lg gap-1 flex-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                            >
                              {applyingPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Apply Photo
                            </Button>

                            <input
                              ref={photoInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadPhoto(file);
                                e.target.value = '';
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border/40 text-[10px] text-muted-foreground flex items-center justify-between">
                      <span>Live biometric photo sync</span>
                      <span className="font-mono">{availablePhotoOptions.length} photo candidate(s)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar + Daily Details — stack on mobile, side-by-side on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 sm:gap-4 items-start">
        <div className="md:col-span-3 min-w-0">
          <AttendanceCalendarView
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            visibleMonth={visibleMonth}
            setVisibleMonth={setVisibleMonth}
            attendanceDays={attendanceDays}
            lateAttendanceDays={lateAttendanceDays}
            absentDays={absentDays}
            attendanceRecords={attendanceRecords}
          />
        </div>
        <div className="md:col-span-2 min-w-0">
          <DailyAttendanceDetails
            selectedDate={selectedDate}
            dailyAttendance={dailyAttendance}
            isDateInArray={isDateInArray}
            attendanceDays={attendanceDays}
            lateAttendanceDays={lateAttendanceDays}
            absentDays={absentDays}
            selectedFaceId={selectedFaceId}
            selectedUserName={selectedFace?.name}
          />
        </div>
      </div>

      <CaptureFaceDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        student={studentForCapture as any}
        onSuccess={refreshSelectedFace}
      />
    </motion.div>
  );
};

export default AttendanceCalendar;
