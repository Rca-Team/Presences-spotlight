import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AndroidShareService,
  SharedFileItem,
  SharedMediaPayload,
} from '@/services/AndroidShareService';
import {
  loadRegistrationModels,
  areRegistrationModelsLoaded,
} from '@/services/face-recognition/OptimizedRegistrationService';
import {
  recognizeFace,
  recordAttendance,
} from '@/services/face-recognition/RecognitionService';
import * as faceapi from 'face-api.js';

import {
  CreditCard,
  UserCheck,
  CalendarCheck,
  Users,
  Sparkles,
  PhoneCall,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  UserPlus,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Check,
  Share2,
} from 'lucide-react';

interface ExtractedCardData {
  name?: string;
  employee_id?: string;
  roll_number?: string;
  department?: string;
  position?: string;
  parent_name?: string;
  parent_phone?: string;
  blood_group?: string;
  address?: string;
  photoDataUrl?: string;
}

interface IdentifiedStudent {
  id: string;
  name: string;
  employee_id: string;
  department?: string;
  position?: string;
  confidence: number;
  avatar_url?: string;
  parent_name?: string;
  parent_phone?: string;
  today_marked?: boolean;
  today_time?: string;
  faceBox?: { x: number; y: number; width: number; height: number };
}

export const SharedMediaActionModal: React.FC = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);

  // Active Mode: 'menu' | 'id_card_scan' | 'identify_student' | 'instant_attendance' | 'group_scan'
  const [activeMode, setActiveMode] = useState<
    'menu' | 'id_card_scan' | 'identify_student' | 'instant_attendance' | 'group_scan'
  >('menu');

  // Loading & Processing states
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatusText, setProcessStatusText] = useState('');

  // ID Card Extraction States
  const [extractedCard, setExtractedCard] = useState<ExtractedCardData | null>(null);

  // Student Identification States
  const [identifiedStudents, setIdentifiedStudents] = useState<IdentifiedStudent[]>([]);
  const [unidentifiedFaceCount, setUnidentifiedFaceCount] = useState(0);

  const activeFile = files[activeFileIndex] || null;

  // Listen for shared media from Android Native Intent
  useEffect(() => {
    const unsubscribe = AndroidShareService.subscribe((payload: SharedMediaPayload) => {
      if (payload.files && payload.files.length > 0) {
        setFiles(payload.files);
        setActiveFileIndex(0);
        setIsOpen(true);
        setActiveMode('menu');
        setExtractedCard(null);
        setIdentifiedStudents([]);
        setUnidentifiedFaceCount(0);
        toast.success(`Received ${payload.files.length} shared item(s) from phone!`);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const closeDialog = () => {
    setIsOpen(false);
    AndroidShareService.clearLastPayload();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // FEATURE 1: ID Card Scan & Data Acquisition
  // ─────────────────────────────────────────────────────────────────────────────
  const runIdCardExtraction = async () => {
    if (!activeFile) return;
    setActiveMode('id_card_scan');
    setIsProcessing(true);
    setProcessStatusText('Scanning ID Card & Extracting Student Records...');

    try {
      const { data, error } = await supabase.functions.invoke('extract-pdf-users', {
        body: {
          fileData: activeFile.dataUrl,
          fileName: activeFile.name,
          fileType: activeFile.type,
        },
      });

      if (error) {
        throw new Error(error.message || 'ID Card extraction failed');
      }

      const user = data?.users?.[0];
      if (!user) {
        toast.error('Could not detect student details on this ID card. Try another angle.');
        setIsProcessing(false);
        return;
      }

      // Crop portrait photo from card if coordinates exist
      let croppedPhoto: string | undefined = undefined;
      try {
        croppedPhoto = (await extractPhotoCrop(activeFile.dataUrl, user.photo_bbox)) || undefined;
      } catch (cropErr) {
        console.warn('Photo crop fallback', cropErr);
      }

      setExtractedCard({
        name: user.name || '',
        employee_id: user.employee_id || user.roll_number || '',
        roll_number: user.roll_number || user.employee_id || '',
        department: user.department || user.class || '',
        position: user.position || 'Student',
        parent_name: user.parent_name || user.father_name || '',
        parent_phone: user.parent_phone || user.phone || '',
        blood_group: user.blood_group || '',
        address: user.address || '',
        photoDataUrl: croppedPhoto || activeFile.dataUrl,
      });

      toast.success('ID Card data acquired successfully!');
    } catch (err: any) {
      console.error('ID Card extraction error:', err);
      toast.error(err.message || 'Failed to extract ID card details');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegisterExtractedStudent = async () => {
    if (!extractedCard || !extractedCard.name) {
      toast.error('Student name is required');
      return;
    }
    setIsProcessing(true);
    setProcessStatusText('Saving new student profile...');

    try {
      const studentId = extractedCard.employee_id || `STU-${Date.now().toString().slice(-6)}`;
      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          employee_id: studentId,
          name: extractedCard.name,
          roll_number: extractedCard.roll_number || studentId,
          class: extractedCard.department || 'General',
          parent_name: extractedCard.parent_name || null,
          parent_phone: extractedCard.parent_phone || null,
          role: 'student',
          photo_url: extractedCard.photoDataUrl || null,
        } as any,
        { onConflict: 'employee_id' }
      );

      if (profileError) throw profileError;

      toast.success(`Student ${extractedCard.name} successfully registered!`);
      closeDialog();
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error(err.message || 'Failed to save student profile');
    } finally {
      setIsProcessing(false);
    }
  };

  const openInFullRegistration = () => {
    if (extractedCard) {
      sessionStorage.setItem('presences_prefill_registration', JSON.stringify(extractedCard));
    }
    closeDialog();
    navigate('/register');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // FEATURE 2: Identify Student & Show Full Detail Card
  // ─────────────────────────────────────────────────────────────────────────────
  const runStudentIdentification = async (mode: 'identify' | 'attendance' | 'group' = 'identify') => {
    if (!activeFile) return;
    setActiveMode(
      mode === 'attendance'
        ? 'instant_attendance'
        : mode === 'group'
        ? 'group_scan'
        : 'identify_student'
    );
    setIsProcessing(true);
    setProcessStatusText('Analyzing face embeddings & matching database...');

    try {
      if (!areRegistrationModelsLoaded()) {
        setProcessStatusText('Loading AI Face Recognition Neural Models...');
        await loadRegistrationModels();
      }

      setProcessStatusText('Detecting faces in shared photo...');
      const img = new Image();
      img.src = activeFile.dataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Detect faces using SSD MobileNet (with Tiny fallback)
      let detections = await faceapi
        .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detections || detections.length === 0) {
        detections = await faceapi
          .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      if (!detections || detections.length === 0) {
        toast.error('No human face detected in this photo. Please use a clearer portrait.');
        setIsProcessing(false);
        return;
      }

      setProcessStatusText(`Matching ${detections.length} detected face(s)...`);

      const matchedList: IdentifiedStudent[] = [];
      let unknownCount = 0;

      for (const det of detections) {
        const result = await recognizeFace(det.descriptor);
        if (result.recognized && result.employee) {
          const emp = result.employee;

          // Fetch full profile info from Supabase
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .or(`employee_id.eq.${emp.employee_id},id.eq.${emp.id}`)
            .maybeSingle();

          // Check if marked today
          const today = new Date().toISOString().split('T')[0];
          const { data: attRec } = await supabase
            .from('attendance_records')
            .select('*')
            .or(`employee_id.eq.${emp.employee_id},user_id.eq.${emp.id}`)
            .gte('timestamp', `${today}T00:00:00`)
            .lte('timestamp', `${today}T23:59:59`)
            .maybeSingle();

          matchedList.push({
            id: emp.id,
            name: emp.name,
            employee_id: emp.employee_id,
            department: (profile as any)?.class || emp.department || 'Student',
            position: emp.position,
            confidence: Math.round((result.confidence || 0.88) * 100),
            avatar_url: emp.avatar_url || emp.firebase_image_url || (profile as any)?.photo_url,
            parent_name: (profile as any)?.parent_name,
            parent_phone: (profile as any)?.parent_phone,
            today_marked: !!attRec,
            today_time: attRec?.timestamp
              ? new Date(attRec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : undefined,
            faceBox: {
              x: det.detection.box.x,
              y: det.detection.box.y,
              width: det.detection.box.width,
              height: det.detection.box.height,
            },
          });
        } else {
          unknownCount++;
        }
      }

      setIdentifiedStudents(matchedList);
      setUnidentifiedFaceCount(unknownCount);

      if (matchedList.length > 0) {
        toast.success(`Identified ${matchedList.length} student(s) successfully!`);

        // If mode was instant attendance, record attendance for all identified students
        if (mode === 'attendance' || mode === 'group') {
          for (const s of matchedList) {
            if (!s.today_marked) {
              await recordAttendance(s.id, 'present', s.confidence / 100, {
                source: 'android-shared-photo',
                metadata: {
                  employee_id: s.employee_id,
                  name: s.name,
                  class: s.department,
                  force_attendance_save: true,
                },
              });
              s.today_marked = true;
              s.today_time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
          }
          toast.success(`Marked attendance for ${matchedList.length} student(s)!`);
        }
      } else {
        toast.warning(
          `Detected ${detections.length} face(s), but none matched registered student records.`
        );
      }
    } catch (err: any) {
      console.error('Identification error:', err);
      toast.error(err.message || 'Error running facial identification');
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper: crop photo from card
  const extractPhotoCrop = async (
    cardDataUrl: string,
    bbox?: { x: number; y: number; width: number; height: number }
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return resolve(null);

        let x = Math.round((bbox?.x ?? 0.03) * w);
        let y = Math.round((bbox?.y ?? 0.26) * h);
        let cw = Math.round((bbox?.width ?? 0.24) * w);
        let ch = Math.round((bbox?.height ?? 0.47) * h);

        x = Math.max(0, Math.min(x, w - 1));
        y = Math.max(0, Math.min(y, h - 1));
        cw = Math.max(1, Math.min(cw, w - x));
        ch = Math.max(1, Math.min(ch, h - y));

        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 420;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => resolve(null);
      img.src = cardDataUrl;
    });
  };

  const handleCallParent = (phone?: string) => {
    if (!phone) {
      toast.error('No parent phone number recorded for this student');
      return;
    }
    const clean = phone.replace(/[^0-9+]/g, '');
    window.open(`tel:${clean}`, '_system');
  };

  const handleWhatsAppParent = (student: IdentifiedStudent) => {
    if (!student.parent_phone) {
      toast.error('No parent phone number recorded for this student');
      return;
    }
    const clean = student.parent_phone.replace(/[^0-9]/g, '');
    const text = encodeURIComponent(
      `Dear ${student.parent_name || 'Parent'},\nThis is an official communication from PM Shri KV NFC Vigyan Vihar regarding ${student.name} (Class: ${student.department || 'N/A'}). Attendance status today: ${student.today_marked ? 'PRESENT' : 'ABSENT'}.`
    );
    window.open(`https://wa.me/${clean}?text=${text}`, '_blank');
  };

  const handleMarkPresentSingle = async (student: IdentifiedStudent) => {
    try {
      await recordAttendance(student.id, 'present', student.confidence / 100, {
        source: 'android-shared-photo',
        metadata: {
          employee_id: student.employee_id,
          name: student.name,
          class: student.department,
          force_attendance_save: true,
        },
      });
      student.today_marked = true;
      student.today_time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setIdentifiedStudents([...identifiedStudents]);
      toast.success(`Marked ${student.name} PRESENT for today!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to record attendance');
    }
  };

  if (!isOpen || !activeFile) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl max-h-[92vh] flex flex-col bg-slate-900/95 border border-cyan-500/30 rounded-3xl shadow-2xl overflow-hidden text-white"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 shadow-md shadow-cyan-500/20 text-white">
                <Share2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base sm:text-lg text-white tracking-tight flex items-center gap-2">
                  Photo Action Center
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">
                    Phone Shared
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  {files.length > 1
                    ? `Item ${activeFileIndex + 1} of ${files.length}`
                    : activeFile.name || 'Shared Media'}
                </p>
              </div>
            </div>

            <button
              onClick={closeDialog}
              className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Image Preview & Multi-photo switcher */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video sm:aspect-[16/9] flex items-center justify-center group">
              {activeFile.type.startsWith('image/') ? (
                <img
                  src={activeFile.dataUrl}
                  alt={activeFile.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <FileText className="w-12 h-12 text-cyan-400" />
                  <span className="text-sm font-medium">{activeFile.name}</span>
                </div>
              )}

              {/* Scanning Laser Line Overlay when processing */}
              {isProcessing && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-pulse absolute top-1/2 -translate-y-1/2" />
                  <div className="absolute inset-0 bg-cyan-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center p-4">
                    <Loader2 className="w-9 h-9 text-cyan-400 animate-spin mb-2" />
                    <p className="text-sm font-semibold text-cyan-200 text-center drop-shadow">
                      {processStatusText}
                    </p>
                  </div>
                </div>
              )}

              {/* Multiple photos carousel arrows */}
              {files.length > 1 && (
                <div className="absolute inset-x-2 bottom-2 flex items-center justify-between pointer-events-none">
                  <button
                    onClick={() => setActiveFileIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeFileIndex === 0}
                    className="pointer-events-auto p-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white disabled:opacity-40 backdrop-blur"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-900/80 text-white backdrop-blur">
                    {activeFileIndex + 1} / {files.length}
                  </span>
                  <button
                    onClick={() => setActiveFileIndex((prev) => Math.min(files.length - 1, prev + 1))}
                    disabled={activeFileIndex === files.length - 1}
                    className="pointer-events-auto p-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white disabled:opacity-40 backdrop-blur"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* ACTION MENU (Primary Choice) */}
            {activeMode === 'menu' && !isProcessing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Select Action for Shared Photo
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Option 1: ID Card Scan */}
                  <button
                    onClick={runIdCardExtraction}
                    className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-850 border border-cyan-500/20 hover:border-cyan-400/50 hover:bg-slate-800 transition-all text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:scale-105 transition-transform">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-cyan-100 flex items-center gap-1.5">
                        ID Card Scan
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                          AI
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Acquire student data, name, roll & crop photo
                      </p>
                    </div>
                  </button>

                  {/* Option 2: Identify Student & Full Detail Card */}
                  <button
                    onClick={() => runStudentIdentification('identify')}
                    className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-850 border border-blue-500/20 hover:border-blue-400/50 hover:bg-slate-800 transition-all text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 group-hover:scale-105 transition-transform">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-blue-100 flex items-center gap-1.5">
                        Identify Student
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">
                          Card
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Face ID match & show parent details + attendance
                      </p>
                    </div>
                  </button>

                  {/* Option 3: Instant 1-Tap Attendance */}
                  <button
                    onClick={() => runStudentIdentification('attendance')}
                    className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-850 border border-emerald-500/20 hover:border-emerald-400/50 hover:bg-slate-800 transition-all text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-105 transition-transform">
                      <CalendarCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-emerald-100">
                        Mark Attendance
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Verify identity and log Present immediately
                      </p>
                    </div>
                  </button>

                  {/* Option 4: Classroom Group Scan */}
                  <button
                    onClick={() => runStudentIdentification('group')}
                    className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-850 border border-purple-500/20 hover:border-purple-400/50 hover:bg-slate-800 transition-all text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-105 transition-transform">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-purple-100">
                        Group Class Scan
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Identify all students in photo together
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* VIEW 1: Extracted ID Card Results */}
            {activeMode === 'id_card_scan' && extractedCard && !isProcessing && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
                      Extracted Student ID Card Info
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveMode('menu')}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Change Action
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-slate-950/60 border border-cyan-500/20 space-y-3">
                  <div className="flex items-center gap-3">
                    {extractedCard.photoDataUrl && (
                      <img
                        src={extractedCard.photoDataUrl}
                        alt="Extracted portrait"
                        className="w-16 h-16 rounded-xl object-cover border border-cyan-500/40 shadow-md"
                      />
                    )}
                    <div className="flex-1 space-y-1">
                      <input
                        type="text"
                        value={extractedCard.name || ''}
                        onChange={(e) =>
                          setExtractedCard({ ...extractedCard, name: e.target.value })
                        }
                        placeholder="Student Full Name"
                        className="w-full text-base font-bold bg-transparent border-b border-slate-700 focus:border-cyan-400 outline-none text-white pb-0.5"
                      />
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                        <div>
                          <span className="text-slate-500">Roll / ID:</span>{' '}
                          <input
                            type="text"
                            value={extractedCard.roll_number || ''}
                            onChange={(e) =>
                              setExtractedCard({
                                ...extractedCard,
                                roll_number: e.target.value,
                                employee_id: e.target.value,
                              })
                            }
                            className="bg-transparent border-b border-slate-800 text-cyan-300 outline-none w-20"
                          />
                        </div>
                        <div>
                          <span className="text-slate-500">Class:</span>{' '}
                          <input
                            type="text"
                            value={extractedCard.department || ''}
                            onChange={(e) =>
                              setExtractedCard({
                                ...extractedCard,
                                department: e.target.value,
                              })
                            }
                            className="bg-transparent border-b border-slate-800 text-cyan-300 outline-none w-20"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Guardian Name</span>
                      <input
                        type="text"
                        value={extractedCard.parent_name || ''}
                        onChange={(e) =>
                          setExtractedCard({ ...extractedCard, parent_name: e.target.value })
                        }
                        placeholder="Parent / Guardian"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500/50"
                      />
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Guardian Phone</span>
                      <input
                        type="text"
                        value={extractedCard.parent_phone || ''}
                        onChange={(e) =>
                          setExtractedCard({ ...extractedCard, parent_phone: e.target.value })
                        }
                        placeholder="+91..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-cyan-500/50"
                      />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <button
                    onClick={handleRegisterExtractedStudent}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 font-semibold text-sm shadow-lg shadow-cyan-500/20 text-white transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Quick Save Student
                  </button>
                  <button
                    onClick={openInFullRegistration}
                    className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold text-sm text-slate-200 transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in Full Form
                  </button>
                </div>
              </div>
            )}

            {/* VIEW 2: Student Identification & Full Detail Card */}
            {(activeMode === 'identify_student' ||
              activeMode === 'instant_attendance' ||
              activeMode === 'group_scan') &&
              !isProcessing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
                        {identifiedStudents.length > 0
                          ? `Identified Students (${identifiedStudents.length})`
                          : 'Identification Results'}
                      </span>
                    </div>
                    <button
                      onClick={() => setActiveMode('menu')}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Change Action
                    </button>
                  </div>

                  {identifiedStudents.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-slate-950/60 border border-amber-500/30 text-center space-y-3">
                      <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
                      <p className="text-sm font-medium text-slate-300">
                        {unidentifiedFaceCount > 0
                          ? `Detected ${unidentifiedFaceCount} face(s), but no registered student matches in system.`
                          : 'No registered student face could be identified.'}
                      </p>
                      <button
                        onClick={() => {
                          closeDialog();
                          navigate('/register');
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold border border-amber-500/30"
                      >
                        <UserPlus className="w-4 h-4" />
                        Register New Student with this Photo
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {identifiedStudents.map((student) => (
                        <div
                          key={student.id}
                          className="p-4 rounded-2xl bg-slate-950/70 border border-blue-500/30 shadow-lg space-y-3.5"
                        >
                          {/* Student Header */}
                          <div className="flex items-start gap-3.5">
                            <div className="relative">
                              <img
                                src={student.avatar_url || activeFile.dataUrl}
                                alt={student.name}
                                className="w-14 h-14 rounded-2xl object-cover border-2 border-blue-500/40 shadow"
                              />
                              <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-emerald-500 text-white">
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-bold text-base text-white truncate">
                                  {student.name}
                                </h4>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap">
                                  {student.confidence}% Match
                                </span>
                              </div>

                              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                                <span>Class: <strong className="text-slate-200">{student.department || '—'}</strong></span>
                                <span>•</span>
                                <span>Roll / ID: <strong className="text-slate-200">{student.employee_id}</strong></span>
                              </div>

                              {/* Attendance Badge */}
                              <div className="mt-1.5 flex items-center gap-2">
                                {student.today_marked ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    <Check className="w-3 h-3" />
                                    Marked Present Today {student.today_time ? `(${student.today_time})` : ''}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleMarkPresentSingle(student)}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors"
                                  >
                                    <CalendarCheck className="w-3 h-3" />
                                    Not Marked — Tap to Mark Present
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Guardian Details & Quick Communication Row */}
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                            <div className="min-w-0">
                              <p className="text-[11px] text-slate-400">Guardian Contact</p>
                              <p className="font-semibold text-slate-200 truncate">
                                {student.parent_name || 'Guardian'} {student.parent_phone ? `(${student.parent_phone})` : ''}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleCallParent(student.parent_phone)}
                                className="p-2 rounded-xl bg-slate-800 hover:bg-emerald-600/30 hover:text-emerald-400 text-slate-300 transition-colors"
                                title="Call Guardian"
                              >
                                <PhoneCall className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleWhatsAppParent(student)}
                                className="p-2 rounded-xl bg-slate-800 hover:bg-emerald-600/30 hover:text-emerald-400 text-slate-300 transition-colors"
                                title="WhatsApp Guardian"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-900/90 text-xs text-slate-400">
            <span>Presences Smart School AI</span>
            <button
              onClick={closeDialog}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default SharedMediaActionModal;
