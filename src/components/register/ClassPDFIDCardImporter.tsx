import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Search, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
export function ClassPDFIDCardImporter({ isOpen, onClose, onImportDrafts, initialClass, saveLabel = 'Save reviewed drafts' }: ClassPDFIDCardImporterProps) {
  const { toast } = useToast();
  const { isAdmin, isPrincipal, isTeacher, userId } = useUserRole();
  const isAdminOrPrincipal = isAdmin || isPrincipal;
  const isAuthorized = isAdminOrPrincipal;
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState(initialClass || 'auto');
  const [file, setFile] = useState<File>();

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
  }  async function confirm() {
    if (!chosen.length || invalid || busy || !classAllowed) return;
    setSaving(true); setError('');
    try {
      const students = chosen.map(({ student }) => ({ ...student, department: [student.class.trim(), student.section.trim()].filter(Boolean).join('-'), student_id_kv: student.student_id_kv?.trim() || '', parent_name: student.father_name || student.mother_name || student.parent_name, name: student.name.trim(), employee_id: student.employee_id.trim() }));
      await onImportDrafts(students, `Class ${selectedClass === 'auto' ? 'ID Cards' : selectedClass} (${students.length} students)`);
      toast({ title: 'Import saved', description: `${students.length} reviewed student records saved successfully.` });
      clear(); setFile(undefined); onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the import. Your reviewed cards are still here; retry after correcting the error.');
    } finally { if (mounted.current) setSaving(false); }
  }
  function edit(id: string, field: keyof ExtractedStudentCard, value: string) {
    setCards(current => current.map(card => card.id === id ? { ...card, student: { ...card.student, [field]: value } } : card));
  }
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-w-5xl max-h-[92dvh] flex flex-col p-0 overflow-hidden rounded-3xl">
      <DialogHeader className="p-6 border-b bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent">
        <DialogTitle className="flex items-center gap-3"><FileText className="text-primary" />Bulk PDF ID Card Extractor</DialogTitle>
        <DialogDescription>The PDF is sent to Appwrite. Its function uses Gemini to read each page and returns student details for review before saving.</DialogDescription>
      </DialogHeader>
      {!isAuthorized ? <div className="p-10 text-center space-y-3"><ShieldAlert className="mx-auto" /><p>Sign in as a school administrator or principal to bulk-import student records.</p></div> : <div className="overflow-y-auto flex-1 p-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4 rounded-2xl bg-muted/40 p-4 border">
          <label className="text-sm">Target class and section<select aria-label="Target class and section" value={selectedClass} disabled={busy} onChange={e => { setSelectedClass(e.target.value); clear(); }} className="block w-full bg-background border rounded-xl px-3 h-10 mt-2">
            {isAdminOrPrincipal ? <><option value="auto">Read from each ID card</option>{CLASSES.flatMap(cls => SECTIONS.map(sec => <option key={`${cls}-${sec}`} value={`${cls}-${sec}`}>{cls}-{sec}</option>))}</> : <><option value="" disabled>Select assigned class</option>{teacherClasses.map(cls => <option key={cls}>{cls}</option>)}</>}
          </select></label>
          <label className="text-sm">Student ID-card PDF<Input className="mt-2 cursor-pointer" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e => { const next = e.target.files?.[0]; if (!next) return; clear(); const supported = /\.pdf$/i.test(next.name) || next.type === 'application/pdf'; if (!supported) { setFile(undefined); setError('Choose a PDF of the printed card sheet.'); return; } if (next.size > 6 * 1024 * 1024) { setFile(undefined); setError('Choose a file under 6 MB. Split larger files into smaller batches.'); return; } setFile(next); }} /></label>
          <div className="flex gap-3 sm:col-span-2">
            <label className="text-sm flex-1">Maximum columns<select aria-label="Cards across" disabled={busy} value={columns} onChange={e => { setColumns(Number(e.target.value)); clear(); }} className="block w-full border bg-background rounded-xl h-10 mt-2">{[1, 2].map(n => <option key={n}>{n}</option>)}</select></label>
            <label className="text-sm flex-1">Maximum rows<select aria-label="Cards down" disabled={busy} value={rows} onChange={e => { setRows(Number(e.target.value)); clear(); }} className="block w-full border bg-background rounded-xl h-10 mt-2">{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Up to 8 cards per page. Each page is read by the backend. Every scanned card appears below, including incomplete records.</p>          <Button disabled={!file || busy || !classAllowed} onClick={() => void extract()} className="sm:col-span-2"><Upload className="w-4 h-4 mr-2" />Extract student cards</Button>
        </div>
        {stage && <div className="space-y-2" role="status"><p className="text-sm flex items-center gap-2">{extracting && <Loader2 className="w-4 h-4 animate-spin" />}{stage}</p><Progress value={percent} />{extracting && <Button size="sm" variant="ghost" onClick={() => { abort.current?.abort(); setStage('Extraction cancelled. Choose a file or retry.'); }}>Cancel extraction</Button>}</div>}
        {error && <p role="alert" className="p-3 border border-destructive/30 bg-destructive/5 text-destructive rounded-xl text-sm">{error}</p>}
        {!!cards.length && <><div className="flex flex-wrap gap-3 items-center justify-between"><Label>{selected.size} / {cards.length} cards selected</Label><div className="flex gap-2"><Search size={17} className="self-center" /><Input placeholder="Filter name or admission number" value={search} onChange={e => setSearch(e.target.value)} /><Button disabled={saving} variant="outline" onClick={() => setSelected(selected.size === cards.length ? new Set() : new Set(cards.map(c => c.id)))}>{selected.size === cards.length ? 'Deselect all' : 'Select all'}</Button></div></div>
          {invalid && <p className="text-sm text-amber-600" role="status">Selected records need a name and admission number. Resolve duplicate admission numbers before saving.</p>}
          {cards.filter(c => `${c.student.name} ${c.student.employee_id}`.toLowerCase().includes(search.toLowerCase())).map(card => <article key={card.id} className="grid md:grid-cols-[220px_1fr] gap-4 border rounded-2xl p-4">
            <div>{card.preview ? <img src={card.preview} alt={`Student card ${card.page}`} className="w-full max-h-72 object-contain rounded-xl bg-muted" /> : <div className="w-full h-40 rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground">Card {card.page}</div>}<p className="text-xs mt-2 text-muted-foreground">Record {card.page} · {card.student.has_photo ? 'Portrait found' : 'Portrait not detected'}</p><details className="text-xs mt-2"><summary>Extracted text</summary><pre className="whitespace-pre-wrap mt-2">{card.text}</pre></details></div>
            <div><div className="flex justify-between items-center mb-3"><label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={selected.has(card.id)} disabled={busy} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(card.id); else next.delete(card.id); return next; })} />Include student</label><Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${card.student.name || 'card'}`} onClick={() => { setCards(current => current.filter(c => c.id !== card.id)); setSelected(current => { const next = new Set(current); next.delete(card.id); return next; }); }}><Trash2 size={15} /></Button></div><div className="grid grid-cols-2 gap-3">{editableFields.map(([field, label]) => <label key={field} className={`text-xs text-muted-foreground ${field === 'address' ? 'col-span-2' : ''}`}>{label}<Input value={String(card.student[field] || '')} disabled={busy || (!isAdminOrPrincipal && (field === 'class' || field === 'section'))} onChange={e => edit(card.id, field, e.target.value)} className="mt-1 h-9" aria-invalid={field === 'employee_id' && duplicateIds.has(card.student.employee_id.trim().toLowerCase())} /></label>)}</div></div>
          </article>)}</>}
      </div>}
      <div className="p-4 border-t flex justify-between gap-3"><Button variant="ghost" disabled={saving} onClick={close}>Close</Button>{isAuthorized && <Button disabled={busy || !chosen.length || invalid || !classAllowed} onClick={() => void confirm()}>{saving && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}{saveLabel} ({chosen.length})</Button>}</div>
    </DialogContent>
  </Dialog>;
}
export default ClassPDFIDCardImporter;
