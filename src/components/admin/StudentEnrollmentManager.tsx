import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, FileText, Loader2, ScanFace, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { enrollmentApi } from '@/services/enrollment/api';
import { fieldLabels, studentFields, type ImportCard, type StudentDetails } from '@/services/enrollment/types';

type ReviewedCard = ImportCard & { existing?: StudentDetails & { revision: string }; checked?: boolean; updateApproved?: boolean; saved?: boolean; error?: string };
type Correction = { id: string; student: string; original: StudentDetails; changes: Partial<StudentDetails>; status: string };
export default function StudentEnrollmentManager() {
  const [cards, setCards] = useState<ReviewedCard[]>([]);
  const [columns, setColumns] = useState(1);
  const [rows, setRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [student, setStudent] = useState('');
  const controller = useRef<AbortController>();
  const link = `${window.location.origin}/enroll`;
  useEffect(() => () => controller.current?.abort(), []);
  const refreshCorrections = async () => { const data = await enrollmentApi<{ corrections: Correction[] }>('staff.corrections'); setCorrections(data.corrections); };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); } };
  function change(id: string, field: keyof StudentDetails, value: string) { setCards(items => items.map(c => c.id === id ? { ...c, student: { ...c.student, [field]: value }, checked: false, existing: undefined, updateApproved: false, error: undefined } : c)); }
  async function checkCards() {
    const counts = new Map<string, number>(); cards.forEach(c => counts.set(c.student.admission_number, (counts.get(c.student.admission_number) || 0) + 1));
    const reviewed: ReviewedCard[] = [];
    for (const card of cards) {
      if (card.saved) { reviewed.push(card); continue; }
      try {
        if ((counts.get(card.student.admission_number) || 0) > 1) throw new Error('Duplicate admission number in this batch. Remove or correct the duplicate.');
        const data = await enrollmentApi<{ existing: ReviewedCard['existing'] }>('staff.preview', { student: card.student });
        reviewed.push({ ...card, existing: data.existing, checked: true, error: undefined });
      } catch (e) { reviewed.push({ ...card, checked: false, error: e instanceof Error ? e.message : 'Validation failed' }); }
    }
    setCards(reviewed);
  }
  return <section className="space-y-6">
    <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-cyan-500/5 p-6"><div className="flex items-center gap-3"><FileText className="text-primary" /><div><h2 className="text-xl font-semibold">Student enrollment</h2><p className="text-sm text-muted-foreground mt-1">Import ID cards, invite parents, and review their corrections.</p></div></div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Input value={link} readOnly aria-label="School enrollment link" className="max-w-sm" /><Button variant="outline" onClick={() => void run(async () => { await navigator.clipboard.writeText(link); setMessage('School enrollment link copied.'); })}><Copy className="mr-2 h-4 w-4" />Copy parent link</Button><a href={link} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Preview parent flow</a></div>
      <div className="flex flex-wrap gap-3 mt-4"><Input placeholder="Existing student admission number" aria-label="Admission number for staff capture" value={student} onChange={e => setStudent(e.target.value)} className="max-w-sm" /><Button asChild disabled={!student.trim()} variant="outline"><Link to={`/enroll?student=${encodeURIComponent(student.trim())}`}><ScanFace className="h-4 w-4 mr-2" />Capture at school</Link></Button></div>
    </div>
    <div className="rounded-3xl border p-6 space-y-4"><h3 className="font-semibold">Upload student ID-card PDF</h3><p className="text-sm text-muted-foreground">Choose the card grid printed on each page. Text extraction and scanned-page OCR run on this device. Review every field before saving. For mixed layouts, import separate PDFs.</p><div className="flex flex-wrap items-end gap-4"><label className="text-sm">Cards across<select aria-label="Cards across" disabled={busy} className="block border rounded-lg bg-background p-2 mt-1" value={columns} onChange={e => setColumns(Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label><label className="text-sm">Cards down<select aria-label="Cards down" disabled={busy} className="block border rounded-lg bg-background p-2 mt-1" value={rows} onChange={e => setRows(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label><label className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 cursor-pointer ${busy ? 'opacity-50' : ''}`}><Upload size={16} />Choose PDF<input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
      void run(async () => { controller.current = new AbortController(); const { extractCards } = await import('@/services/enrollment/pdfImport'); const extracted = await extractCards(file, columns, rows, setMessage, controller.current.signal); setCards(extracted); setMessage(`${extracted.length} cards extracted. Review and check the records below.`); });
    }} /></label>{busy && <Button variant="ghost" onClick={() => controller.current?.abort()}>Cancel extraction</Button>}</div></div>
    {message && <p role="status" className="text-sm flex items-center gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{message}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {cards.map(card => <article key={card.id} className="rounded-3xl border p-5 grid md:grid-cols-[minmax(180px,1fr)_2fr] gap-6"><div><img src={card.preview} alt={`Original ID card from page ${card.page}`} className="rounded-xl max-h-80 w-full object-contain bg-muted" /><p className="text-xs text-muted-foreground mt-2">Page {card.page} · {card.portrait ? 'Portrait extracted' : 'Portrait unavailable; live capture is still supported'}</p><details className="text-xs mt-3"><summary>Extracted text</summary><pre className="whitespace-pre-wrap mt-2">{card.text}</pre></details></div><div><div className="grid sm:grid-cols-2 gap-3">{studentFields.map(field => <label key={field} className={`text-xs text-muted-foreground ${field === 'address' ? 'sm:col-span-2' : ''}`}>{fieldLabels[field]}<Input className="mt-1" disabled={busy || card.saved} value={card.student[field]} onChange={e => change(card.id, field, e.target.value)} /></label>)}</div>
      {card.existing && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 mt-4 text-sm"><p className="font-medium">Existing student found — approve changes before saving</p><dl className="mt-2 space-y-1">{studentFields.filter(f => card.student[f] !== card.existing![f]).map(f => <div key={f}><dt className="inline text-muted-foreground">{fieldLabels[f]}: </dt><dd className="inline">{card.existing![f] || '(blank)'} → {card.student[f] || '(blank)'}</dd></div>)}</dl><label className="flex gap-2 mt-3"><input type="checkbox" disabled={busy || card.saved} checked={Boolean(card.updateApproved)} onChange={e => setCards(items => items.map(c => c.id === card.id ? { ...c, updateApproved: e.target.checked } : c))} />Approve this update</label></div>}
      {card.error && <p role="alert" className="text-sm text-destructive mt-3">{card.error}</p>}<div className="flex justify-between mt-3"><span className="text-sm text-emerald-600">{card.saved ? 'Saved — ready for parent enrollment' : card.checked ? 'Record checked' : 'Needs review'}</span><Button variant="ghost" size="sm" disabled={busy || card.saved} onClick={() => setCards(items => items.filter(c => c.id !== card.id))}>Remove</Button></div></div></article>)}
    {!!cards.length && <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => void run(checkCards)}>Check records and duplicates</Button><Button disabled={busy || !cards.some(c => !c.saved) || cards.some(c => !c.saved && (!c.checked || (c.existing && !c.updateApproved)))} onClick={() => void run(async () => {
      for (const card of cards.filter(c => !c.saved)) {
        try { await enrollmentApi('staff.import', { student: card.student, portrait: card.portrait, approveUpdate: card.updateApproved, revision: card.existing?.revision }); setCards(items => items.map(c => c.id === card.id ? { ...c, saved: true, preview: '', portrait: undefined, text: '', error: undefined } : c)); }
        catch (e) { setCards(items => items.map(c => c.id === card.id ? { ...c, error: e instanceof Error ? e.message : 'Save failed', checked: false } : c)); }
      }
      setMessage('Batch processed. Failed cards remain available to correct and retry.');
    })}>Save reviewed students</Button><Button variant="ghost" disabled={busy} onClick={() => setCards([])}>Clear previews</Button></div>}
    <div className="rounded-3xl border p-6"><div className="flex justify-between gap-4 items-center"><h3 className="font-semibold">Parent correction requests</h3><Button variant="outline" disabled={busy} onClick={() => void run(refreshCorrections)}>Load requests</Button></div><p className="text-sm text-muted-foreground mt-2">Review requested changes before updating the school record.</p>{corrections.map(c => <div className="border rounded-xl p-4 mt-4" key={c.id}><h4 className="font-medium">{c.original.name} · {c.student}</h4><dl className="text-sm mt-3 space-y-2">{Object.entries(c.changes).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{fieldLabels[key as keyof StudentDetails]}</dt><dd>{c.original[key as keyof StudentDetails] || '(blank)'} → {value || '(blank)'}</dd></div>)}</dl><div className="flex gap-3 mt-4">{[true, false].map(approve => <Button key={String(approve)} variant={approve ? 'default' : 'outline'} disabled={busy} onClick={() => void run(async () => { await enrollmentApi('staff.review', { id: c.id, approve }); await refreshCorrections(); })}>{approve ? 'Approve correction' : 'Reject'}</Button>)}</div></div>)}</div>
  </section>;
}
