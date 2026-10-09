import { useEffect, useRef, useState } from 'react';
import { 
  FileText, 
  Loader2, 
  Search, 
  ShieldAlert, 
  Trash2, 
  Upload, 
  FileUp, 
  Sparkles, 
  CheckCircle2, 
  X, 
  Grid3X3,
  Layers,
  AlertCircle
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
interface ReviewCard { id: string; student: ExtractedStudentCard; preview: string; text: string; page: number }
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
export function ClassPDFIDCardImporter({ isOpen, onClose, onImportDrafts, initialClass, saveLabel = 'Import Enrolled Students' }: ClassPDFIDCardImporterProps) {
  const { toast } = useToast();
  const { isAdmin, isPrincipal, isTeacher, userId } = useUserRole();
  const isAdminOrPrincipal = isAdmin || isPrincipal;
  const isAuthorized = isAdminOrPrincipal;
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState(initialClass || 'auto');
  const [file, setFile] = useState<File>();
  const [isDragging, setIsDragging] = useState(false);

  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(4);

  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
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
  const chosen = cards.filter(c => selected.has(c.id));
  const duplicateIds = new Set(chosen.filter((c, i, all) => c.student.employee_id.trim() && all.findIndex(other => other.student.employee_id.trim().toLowerCase() === c.student.employee_id.trim().toLowerCase()) !== i).map(c => c.student.employee_id.trim().toLowerCase()));
  const invalid = chosen.some(c => !c.student.name.trim() || !c.student.employee_id.trim()) || duplicateIds.size > 0;
  const clear = () => { setCards([]); setSelected(new Set()); setError(''); setPercent(0); setStage(''); };
  const close = () => { if (saving) return; abort.current?.abort(); clear(); setFile(undefined); onClose(); };

  const handleFileSelect = (selectedFile?: File) => {
    if (!selectedFile) return;
    clear();
    const supported = /\.pdf$/i.test(selectedFile.name) || selectedFile.type === 'application/pdf';
    if (!supported) {
      setFile(undefined);
      setError('Please choose a valid PDF file of the printed card sheet.');
      return;
    }
    if (selectedFile.size > 50 * 1024 * 1024) {
      setFile(undefined);
      setError('PDF file size exceeds 50 MB limit.');
      return;
    }
    setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  async function confirm() {
    if (!chosen.length || invalid || busy || !classAllowed) return;
    setSaving(true); setError('');
    try {
      const students = chosen.map(({ student }) => ({ ...student, department: [student.class.trim(), student.section.trim()].filter(Boolean).join('-'), student_id_kv: student.student_id_kv?.trim() || '', parent_name: student.father_name || student.mother_name || student.parent_name, name: student.name.trim(), employee_id: student.employee_id.trim() }));
      await onImportDrafts(students, `Class ${selectedClass === 'auto' ? 'ID Cards' : selectedClass} (${students.length} students)`);
      toast({ title: 'Import successful', description: `${students.length} student records imported to biometric enrollment.` });
      clear(); setFile(undefined); onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the import. Your reviewed cards are still here; retry after correcting the error.');
    } finally { if (mounted.current) setSaving(false); }
  }

  async function extract() {
    if (!file || !isAuthorized || !classAllowed || busy) return;
    const controller = new AbortController(); abort.current = controller;
    clear(); setExtracting(true);
    try {
      const [{ extractBulkPdf }, { cardToRegistrationStudent }] = await Promise.all([
        import('@/services/enrollment/bulkPdfExtractor'), import('@/services/enrollment/localIdCardExtraction'),
      ]);
      await extractBulkPdf(file, {
        columns, rows, signal: controller.signal,
        progress: (message, value) => {
          if (mounted.current && !controller.signal.aborted) { setStage(message); setPercent(value); }
        },
        onCard: card => {
          if (!mounted.current || controller.signal.aborted) return;
          const student = cardToRegistrationStudent(card, selectedClass === 'auto' ? undefined : selectedClass) as ExtractedStudentCard;
          setCards(current => [...current, { id: card.id, student, preview: card.preview, text: card.text, page: card.page }]);
          if (student.name && student.employee_id && !card.text.startsWith('SCAN FAILED:')) {
            setSelected(current => new Set([...current, card.id]));
          }
        },
      });
    } catch (failure) {
      if (mounted.current) {
        if (controller.signal.aborted) setStage('Scan cancelled. Completed cards are available for review.');
        else setError(failure instanceof Error ? failure.message : 'PDF scan failed. Completed cards remain available.');
      }
    } finally { if (mounted.current) setExtracting(false); }
  }

  function edit(id: string, field: keyof ExtractedStudentCard, value: string) {
    setCards(current => current.map(card => card.id === id ? { ...card, student: { ...card.student, [field]: value } } : card));
  }

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
                  Smart Scanner
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Upload student ID-card sheet PDF to extract student records and portraits for enrollment.
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
                    : file
                    ? 'border-emerald-500/40 bg-emerald-950/20'
                    : 'border-white/15 bg-white/[0.02] hover:border-emerald-500/40 hover:bg-white/[0.04]'
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={busy}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
                
                {file ? (
                  <div className="flex items-center justify-between gap-3 text-left">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate max-w-md">{file.name}</p>
                        <p className="text-xs text-slate-400">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to scan
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 h-8 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(undefined);
                        clear();
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <FileUp className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Click or drag & drop student card PDF here
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Supports multi-page ID card sheets up to 50 MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

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
                    onChange={e => { setColumns(Number(e.target.value)); clear(); }}
                    className="w-full bg-slate-900 border border-white/15 rounded-xl px-3 h-10 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  >
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
                    onChange={e => { setRows(Number(e.target.value)); clear(); }}
                    className="w-full bg-slate-900 border border-white/15 rounded-xl px-3 h-10 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} row{n > 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Action Trigger */}
              <div className="pt-2">
                <Button
                  disabled={!file || busy || !classAllowed}
                  onClick={() => void extract()}
                  className="w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition-all"
                >
                  {extracting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning ID Cards...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Scan & Extract Student Records
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
                    onClick={() => { abort.current?.abort(); setStage('Extraction cancelled. Choose a file or retry.'); }}
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1">
                      {selected.size} of {cards.length} cards selected
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        placeholder="Search name or ID..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
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
                  {cards
                    .filter(c => `${c.student.name} ${c.student.employee_id}`.toLowerCase().includes(search.toLowerCase()))
                    .map(card => {
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
                                className="w-full max-h-56 object-contain rounded-xl bg-black/40 border border-white/10"
                              />
                            ) : (
                              <div className="w-full h-36 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-xs text-slate-400">
                                Page {card.page}
                              </div>
                            )}
                            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                              <span>Page {card.page}</span>
                              <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${card.student.has_photo ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'}`}>
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
