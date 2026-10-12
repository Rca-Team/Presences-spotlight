import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Globe,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
  FileUp,
  Sparkles,
  CheckCircle2,
  X,
  Layers,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { fetchTeacherCategories } from '@/utils/teacherAccess';
import { CLASSES, SECTIONS } from '@/constants/schoolConfig';

export interface ExtractedStudentCard {
  name: string; employee_id: string; student_id_kv?: string; class: string; section: string; department: string;
  roll_number?: string; father_name?: string; mother_name?: string; parent_name?: string;
  parent_phone?: string; parent_email?: string; student_email?: string; phone?: string;
  blood_group?: string; date_of_birth?: string; pen_number?: string; address?: string;
  barcode?: string; has_photo?: boolean; student_photo_data_url?: string;
}
interface ReviewCard { id: string; student: ExtractedStudentCard; preview: string; text: string; page: number; fileName?: string }
interface ClassPDFIDCardImporterProps {
  isOpen: boolean; onClose: () => void;
  onImportDrafts: (students: ExtractedStudentCard[], batchName: string) => void | Promise<void>;
  initialClass?: string;
  saveLabel?: string;
}
const editableFields: [keyof ExtractedStudentCard, string][] = [
  ['name', 'Student name'], ['employee_id', 'Admission number'], ['student_id_kv', 'Student ID'], ['class', 'Class'], ['section', 'Section'],
  ['father_name', 'Father’s name'], ['mother_name', 'Mother’s name'], ['parent_phone', 'Parent phone'],
  ['date_of_birth', 'Date of birth'], ['roll_number', 'Roll number'], ['blood_group', 'Blood group'],
  ['student_email', 'Student email'], ['parent_email', 'Parent email'], ['pen_number', 'PEN number'], ['address', 'Address'],
];

const SUPPORTED_EXT_REGEX = /\.(?:pdf|mht|mhtml|html|htm|png|jpe?g|webp|bmp|gif)$/i;
const SUPPORTED_MIME_REGEX = /^(?:application\/pdf|multipart\/related|message\/rfc822|application\/x-mimearchive|text\/html|image\/(?:png|jpe?g|webp|bmp|gif))$/i;
const REVIEW_PAGE_SIZE = 40;

function isSupportedFile(f: File): boolean {
  return SUPPORTED_EXT_REGEX.test(f.name) || SUPPORTED_MIME_REGEX.test(f.type);
}

function getFileTypeLabel(f: File): 'PDF' | 'MHT' | 'IMAGE' {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return 'PDF';
  if (/\.(?:mht|mhtml|html|htm)$/i.test(f.name) || /multipart|rfc822|mimearchive|html/i.test(f.type)) return 'MHT';
  return 'IMAGE';
}

export function ClassPDFIDCardImporter({ isOpen, onClose, onImportDrafts, initialClass, saveLabel = 'Import Enrolled Students' }: ClassPDFIDCardImporterProps) {
  const { toast } = useToast();
  const { isAdmin, isPrincipal, isTeacher, userId } = useUserRole();
  const isAdminOrPrincipal = isAdmin || isPrincipal;
  const isAuthorized = isAdminOrPrincipal;
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState(initialClass || 'auto');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const [columns, setColumns] = useState(0);
  const [rows, setRows] = useState(0);

  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const abort = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { if (initialClass) setSelectedClass(initialClass); }, [initialClass]);
  useEffect(() => { if (!isOpen) abort.current?.abort(); }, [isOpen]);
  useEffect(() => {
    if (!userId || !isTeacher || isAdminOrPrincipal) return;
    let active = true;
    fetchTeacherCategories(userId).then(classes => { if (active) { setTeacherClasses(classes); setSelectedClass(current => classes.includes(current) ? current : classes[0] || ''); } }).catch(() => { if (active) setError('Could not load your assigned classes. Reopen the importer to retry.'); });
    return () => { active = false; };
  }, [userId, isTeacher, isAdminOrPrincipal, isOpen]);

  const busy = extracting || saving;
  const classAllowed = isAdminOrPrincipal || teacherClasses.includes(selectedClass);
  const chosen = useMemo(() => cards.filter(c => selected.has(c.id)), [cards, selected]);
  const duplicateIds = useMemo(
    () => new Set(
      chosen
        .filter((c, i, all) => c.student.employee_id.trim() && all.findIndex(other => other.student.employee_id.trim().toLowerCase() === c.student.employee_id.trim().toLowerCase()) !== i)
        .map(c => c.student.employee_id.trim().toLowerCase())
    ),
    [chosen]
  );
  const invalid = chosen.some(c => !c.student.name.trim() || !c.student.employee_id.trim()) || duplicateIds.size > 0;
  const clear = () => { setCards([]); setSelected(new Set()); setError(''); setPercent(0); setStage(''); setReviewPage(1); };
  const close = () => { if (saving) return; abort.current?.abort(); clear(); setFiles([]); onClose(); };

  const handleFilesSelect = (incoming?: FileList | File[]) => {
    if (!incoming || !incoming.length) return;
    clear();
    const list = Array.from(incoming);
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const item of list) {
      if (!isSupportedFile(item)) {
        rejected.push(`${item.name} (unsupported format)`);
        continue;
      }
      if (!item.size) {
        rejected.push(`${item.name} (empty file)`);
        continue;
      }
      if (item.size > 50 * 1024 * 1024) {
        rejected.push(`${item.name} (exceeds 50 MB per-file limit)`);
        continue;
      }
      valid.push(item);
    }

    if (rejected.length > 0) {
      setError(`Skipped unsupported or oversized files: ${rejected.join(', ')}. Supported formats: PDF (up to 100 pages), MHT/MHTML, PNG, JPG, WebP, BMP.`);
    }

    if (valid.length > 0) {
      setFiles(prev => {
        const existingKeys = new Set(prev.map(f => `${f.name}:${f.size}:${f.lastModified}`));
        const additions = valid.filter(f => !existingKeys.has(`${f.name}:${f.size}:${f.lastModified}`));
        return [...prev, ...additions];
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    if (e.dataTransfer.files?.length) {
      handleFilesSelect(e.dataTransfer.files);
    }
  };

  const removeFileAt = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    clear();
  };

  async function confirm() {
    if (!chosen.length || invalid || busy || !classAllowed) return;
    setSaving(true); setError('');
    try {
      const students = chosen.map(({ student }) => ({
        ...student,
        department: [student.class.trim(), student.section.trim()].filter(Boolean).join('-'),
        student_id_kv: student.student_id_kv?.trim() || '',
        parent_name: student.father_name || student.mother_name || student.parent_name,
        name: student.name.trim(),
        employee_id: student.employee_id.trim(),
      }));
      await onImportDrafts(students, `Class ${selectedClass === 'auto' ? 'ID Cards' : selectedClass} (${students.length} students)`);
      toast({ title: 'Import successful', description: `${students.length} student records imported to biometric enrollment.` });
      clear(); setFiles([]); onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the import. Your reviewed cards are still here; retry after correcting the error.');
    } finally { if (mounted.current) setSaving(false); }
  }

  async function extract() {
    if (!files.length || !isAuthorized || !classAllowed || busy) return;
    const controller = new AbortController(); abort.current = controller;
    clear(); setExtracting(true);
    const seenIds = new Set<string>();
    const fileErrors: string[] = [];
    let totalExtracted = 0;

    try {
      const [{ extractBulkPdf }, { cardToRegistrationStudent }] = await Promise.all([
        import('@/services/enrollment/bulkPdfExtractor'), import('@/services/enrollment/localIdCardExtraction'),
      ]);

      for (let i = 0; i < files.length; i++) {
        if (controller.signal.aborted) break;
        const currentFile = files[i];
        const filePrefix = files.length > 1 ? `[File ${i + 1}/${files.length}: ${currentFile.name}] ` : '';

        try {
          await extractBulkPdf(currentFile, {
            columns,
            rows,
            signal: controller.signal,
            progress: (message, value) => {
              if (mounted.current && !controller.signal.aborted) {
                const overallPercent = ((i + Math.min(100, Math.max(0, value)) / 100) / files.length) * 100;
                setStage(`${filePrefix}${message}`);
                setPercent(overallPercent);
              }
            },
            onCard: card => {
              if (!mounted.current || controller.signal.aborted) return;
              totalExtracted++;
              const student = cardToRegistrationStudent(card, selectedClass === 'auto' ? undefined : selectedClass) as ExtractedStudentCard;
              setCards(current => [...current, { id: card.id, student, preview: card.preview, text: card.text, page: card.page, fileName: currentFile.name }]);
              const normalizedId = student.employee_id.trim().toLowerCase();
              if (student.name.trim() && normalizedId && !card.text.startsWith('SCAN FAILED:') && !seenIds.has(normalizedId)) {
                seenIds.add(normalizedId);
                setSelected(current => new Set([...current, card.id]));
              }
            },
          });
        } catch (fileErr) {
          if (controller.signal.aborted) throw fileErr;
          const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
          fileErrors.push(`${currentFile.name}: ${msg}`);
        }
      }

      if (mounted.current && !controller.signal.aborted) {
        setPercent(100);
        setStage(`${totalExtracted} card${totalExtracted === 1 ? '' : 's'} scanned across ${files.length} file${files.length === 1 ? '' : 's'}`);
        if (fileErrors.length > 0) {
          setError(fileErrors.join(' | '));
        } else if (totalExtracted === 0) {
          setError('No readable student ID cards were found. Try selecting a specific column/row grid or uploading a clearer scan.');
        }
      }
    } catch (failure) {
      if (mounted.current) {
        if (controller.signal.aborted) setStage('Scan cancelled. Completed cards are available for review.');
        else setError(failure instanceof Error ? failure.message : 'Scan failed. Completed cards remain available.');
      }
    } finally { if (mounted.current) setExtracting(false); }
  }

  function edit(id: string, field: keyof ExtractedStudentCard, value: string) {
    setCards(current => current.map(card => card.id === id ? { ...card, student: { ...card.student, [field]: value } } : card));
  }

  const filteredCards = useMemo(
    () => cards.filter(c => `${c.student.name} ${c.student.employee_id} ${c.fileName || ''}`.toLowerCase().includes(search.toLowerCase())),
    [cards, search]
  );
  const totalReviewPages = Math.max(1, Math.ceil(filteredCards.length / REVIEW_PAGE_SIZE));
  const safeReviewPage = Math.min(reviewPage, totalReviewPages);
  const visibleCards = useMemo(
    () => filteredCards.slice((safeReviewPage - 1) * REVIEW_PAGE_SIZE, safeReviewPage * REVIEW_PAGE_SIZE),
    [filteredCards, safeReviewPage]
  );

  const totalSizeMB = files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024);

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="max-w-5xl max-h-[92dvh] flex flex-col p-0 overflow-hidden rounded-3xl bg-slate-950/95 border-white/10 text-white backdrop-blur-2xl shadow-2xl">
        {/* Sleek Header */}
        <DialogHeader className="p-5 sm:p-6 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-cyan-500/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Bulk ID Card Importer
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px] font-mono">
                  Multi-Format · 100 Pages/File
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Upload multiple PDFs (up to 100 pages per file), MHT/MHTML web archives, or ID card images to extract student records and portraits.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!isAuthorized ? (
          <div className="p-12 text-center space-y-4">
            <div className="h-14 w-14 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h3 className="text-base font-semibold text-white">Administrator Access Required</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Sign in as a school administrator or principal to bulk-import student records from ID cards.
            </p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-5 sm:p-6 space-y-5">
            {/* Upload Zone & Configurations */}
            <div className="rounded-2xl sm:rounded-3xl bg-white/[0.03] border border-white/10 p-5 space-y-4">
              {/* Dropzone File Target */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative rounded-2xl border-2 border-dashed transition-all p-6 text-center cursor-pointer ${
                  isDragging
                    ? 'border-emerald-400 bg-emerald-500/10'
                    : files.length > 0
                    ? 'border-emerald-500/40 bg-emerald-950/20'
                    : 'border-white/15 bg-white/[0.02] hover:border-emerald-500/40 hover:bg-white/[0.04]'
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept=".pdf,.mht,.mhtml,.html,.htm,.png,.jpg,.jpeg,.webp,.bmp,.gif,application/pdf,multipart/related,message/rfc822,application/x-mimearchive,text/html,image/png,image/jpeg,image/webp,image/bmp,image/gif"
                  disabled={busy}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={(e) => {
                    handleFilesSelect(e.target.files || undefined);
                    e.target.value = '';
                  }}
                />

                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <FileUp className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {files.length > 0
                        ? 'Click or drop to add more PDFs, Images, or .MHT files'
                        : 'Click or drag & drop student card PDFs, Images, or .MHT files here'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Supports multiple files · PDFs up to 100 pages per file · .MHT / .MHTML · JPG, PNG, WebP, BMP (up to 50 MB/file)
                    </p>
                  </div>
                </div>
              </div>

              {/* Queued Files List */}
              {files.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-slate-300 px-1">
                    <span className="font-semibold">
                      {files.length} file{files.length > 1 ? 's' : ''} queued ({totalSizeMB.toFixed(2)} MB total)
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 h-7 px-2 text-xs"
                      onClick={() => {
                        setFiles([]);
                        clear();
                      }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Clear all
                    </Button>
                  </div>
                  <div className="max-h-36 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                    {files.map((item, idx) => {
                      const kind = getFileTypeLabel(item);
                      return (
                        <div
                          key={`${item.name}-${item.size}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/90 border border-white/10 px-3 py-2 text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                              {kind === 'PDF' ? <FileText className="h-4 w-4" /> : kind === 'MHT' ? <Globe className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-white truncate">{item.name}</p>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                <span className="font-mono text-emerald-400">{kind}</span>
                                <span>·</span>
                                <span>{(item.size / (1024 * 1024)).toFixed(2)} MB</span>
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Remove ${item.name}`}
                            className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                            onClick={() => removeFileAt(idx)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Layout & Class Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Target Class & Section
                  </label>
                  <select
                    aria-label="Target class and section"
                    value={selectedClass}
                    disabled={busy}
                    onChange={e => { setSelectedClass(e.target.value); clear(); }}
                    className="w-full bg-slate-900 border border-white/15 rounded-xl px-3 h-10 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    {isAdminOrPrincipal ? (
                      <>
                        <option value="auto">Detect from each card</option>
                        {CLASSES.flatMap(cls => SECTIONS.map(sec => (
                          <option key={`${cls}-${sec}`} value={`${cls}-${sec}`}>Class {cls}-{sec}</option>
                        )))}
                      </>
                    ) : (
                      <>
                        <option value="" disabled>Select assigned class</option>
                        {teacherClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Columns Across
                  </label>
                  <select
                    aria-label="Cards across"
                    disabled={busy}
                    value={columns}
                    onChange={e => {
                      const nextCols = Number(e.target.value);
                      setColumns(nextCols);
                      if (nextCols === 0) setRows(0);
                      else if (rows === 0) setRows(nextCols === 1 ? 1 : 4);
                      clear();
                    }}
                    className="w-full bg-slate-900 border border-white/15 rounded-xl px-3 h-10 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value={0}>Auto-detect</option>
                    {[1, 2].map(n => <option key={n} value={n}>{n} column{n > 1 ? 's' : ''}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Rows Down
                  </label>
                  <select
                    aria-label="Cards down"
                    disabled={busy}
                    value={rows}
                    onChange={e => {
                      const nextRows = Number(e.target.value);
                      setRows(nextRows);
                      if (nextRows === 0) setColumns(0);
                      else if (columns === 0) setColumns(nextRows === 1 ? 1 : 2);
                      clear();
                    }}
                    className="w-full bg-slate-900 border border-white/15 rounded-xl px-3 h-10 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value={0}>Auto-detect</option>
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} row{n > 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Action Trigger */}
              <div className="pt-2">
                <Button
                  disabled={!files.length || busy || !classAllowed}
                  onClick={() => void extract()}
                  className="w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition-all"
                >
                  {extracting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning ID Cards ({files.length} file{files.length > 1 ? 's' : ''})...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Scan & Extract Student Records {files.length > 1 ? `(${files.length} Files)` : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Progress Status */}
            {stage && (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5" role="status">
                <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
                  <span className="flex items-center gap-2">
                    {extracting && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />}
                    {stage}
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">{Math.round(percent)}%</span>
                </div>
                <Progress value={percent} className="h-2 bg-white/10" />
                {extracting && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { abort.current?.abort(); setStage('Extraction cancelled. Completed cards are available for review.'); }}
                    className="text-xs text-slate-400 hover:text-rose-400 h-7 px-2"
                  >
                    Cancel extraction
                  </Button>
                )}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div role="alert" className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-2xl text-xs sm:text-sm flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Extracted Records Review List */}
            {!!cards.length && (
              <div className="space-y-4 pt-2">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1">
                      {selected.size} of {cards.length} cards selected
                    </Badge>
                    {totalReviewPages > 1 && (
                      <span className="text-xs text-slate-400">
                        Showing page {safeReviewPage} of {totalReviewPages} ({filteredCards.length} matching)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        placeholder="Search name, ID, or file..."
                        value={search}
                        onChange={e => { setSearch(e.target.value); setReviewPage(1); }}
                        className="pl-9 h-9 bg-slate-900 border-white/15 rounded-xl text-xs text-white"
                      />
                    </div>
                    <Button
                      disabled={saving}
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(selected.size === cards.length ? new Set() : new Set(cards.map(c => c.id)))}
                      className="rounded-xl border-white/15 bg-white/5 text-xs text-slate-300 hover:text-white h-9"
                    >
                      {selected.size === cards.length ? 'Deselect all' : 'Select all'}
                    </Button>
                  </div>
                </div>

                {invalid && (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl" role="status">
                    Selected records require both Student Name and Admission Number. Check duplicate or empty fields.
                  </p>
                )}

                <div className="space-y-3">
                  {visibleCards.map(card => {
                    const isSelected = selected.has(card.id);
                    return (
                      <article
                        key={card.id}
                        className={`grid md:grid-cols-[180px_1fr] gap-4 rounded-2xl p-4 border transition-all ${
                          isSelected
                            ? 'bg-white/[0.04] border-emerald-500/30 shadow-md'
                            : 'bg-white/[0.01] border-white/10 opacity-70'
                        }`}
                      >
                        <div className="space-y-2">
                          {card.preview ? (
                            <img
                              src={card.preview}
                              alt={`Student card ${card.page}`}
                              loading="lazy"
                              className="w-full max-h-56 object-contain rounded-xl bg-black/40 border border-white/10"
                            />
                          ) : (
                            <div className="w-full h-36 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-xs text-slate-400">
                              Page {card.page}
                            </div>
                          )}
                          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 gap-1">
                            <span className="truncate" title={card.fileName ? `${card.fileName} · Page ${card.page}` : `Page ${card.page}`}>
                              {card.fileName ? `${card.fileName} · P.${card.page}` : `Page ${card.page}`}
                            </span>
                            <Badge variant="outline" className={`text-[10px] py-0 px-1.5 shrink-0 ${card.student.has_photo ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'}`}>
                              {card.student.has_photo ? 'Portrait Found' : 'No Portrait'}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-center pb-2 border-b border-white/10">
                            <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={busy}
                                onChange={e => setSelected(current => {
                                  const next = new Set(current);
                                  if (e.target.checked) next.add(card.id);
                                  else next.delete(card.id);
                                  return next;
                                })}
                                className="rounded border-white/20 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40 h-4 w-4"
                              />
                              <span>Include for Biometric Enrollment</span>
                            </label>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              aria-label={`Remove ${card.student.name || 'card'}`}
                              onClick={() => {
                                setCards(current => current.filter(c => c.id !== card.id));
                                setSelected(current => {
                                  const next = new Set(current);
                                  next.delete(card.id);
                                  return next;
                                });
                              }}
                              className="h-8 w-8 p-0 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {editableFields.map(([field, label]) => (
                              <label key={field} className={`text-[11px] text-slate-400 ${field === 'address' ? 'col-span-2 sm:col-span-3' : ''}`}>
                                {label}
                                <Input
                                  value={String(card.student[field] || '')}
                                  disabled={busy || (!isAdminOrPrincipal && (field === 'class' || field === 'section'))}
                                  onChange={e => edit(card.id, field, e.target.value)}
                                  className="mt-1 h-8 bg-slate-900 border-white/10 text-white rounded-xl text-xs focus:border-emerald-500/50"
                                  aria-invalid={field === 'employee_id' && duplicateIds.has(card.student.employee_id.trim().toLowerCase())}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* Pagination Controls for large 100-page batches */}
                {totalReviewPages > 1 && (
                  <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-slate-400">
                    <span>
                      Cards {(safeReviewPage - 1) * REVIEW_PAGE_SIZE + 1}–{Math.min(filteredCards.length, safeReviewPage * REVIEW_PAGE_SIZE)} of {filteredCards.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={safeReviewPage <= 1}
                        onClick={() => setReviewPage(p => Math.max(1, p - 1))}
                        className="h-8 rounded-xl border-white/15 bg-white/5 text-xs text-slate-300"
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={safeReviewPage >= totalReviewPages}
                        onClick={() => setReviewPage(p => Math.min(totalReviewPages, p + 1))}
                        className="h-8 rounded-xl border-white/15 bg-white/5 text-xs text-slate-300"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Modal Action Bar */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-slate-950/80 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={close}
            className="rounded-2xl border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-xs sm:text-sm"
          >
            Close
          </Button>

          {isAuthorized && chosen.length > 0 && (
            <Button
              disabled={busy || invalid || !classAllowed}
              onClick={() => void confirm()}
              className="rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 px-5 active:scale-95 transition-all"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                  Saving Enrollment...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 w-4 h-4" />
                  {saveLabel} ({chosen.length})
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ClassPDFIDCardImporter;
