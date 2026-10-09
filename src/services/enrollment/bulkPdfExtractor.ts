import { functions, account } from '@/integrations/appwrite/client';
import { ExecutionMethod } from 'appwrite';
import { parseCardText } from './pdfParser';
import type { ImportCard } from './types';
export interface BulkPdfOptions {
  columns: number; rows: number; signal: AbortSignal;
  progress: (message: string, percent: number) => void;
  onCard: (card: ImportCard) => void;
}
export async function idCardFunction<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const check = () => { if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError'); };
  check();
  if (body.action === 'idcards.extract') {
    const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
    if (!url || !key) throw new Error('Configure the Supabase project URL and public key for the PDF extractor.');
    const jwt = await account.createJWT();
    check();
    const response = await fetch(`${url}/functions/v1/extract-pdf-users`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', apikey: key, 'x-appwrite-user-jwt': jwt.jwt },
      body: JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Supabase extractor returned an invalid response (${response.status}). Check its deployment logs.`); }
    if (!response.ok || data.error) throw new Error(data.error || `Supabase extraction failed (${response.status}).`);
    return data as T;
  }
  // Appwrite only returns response bodies for synchronous executions.
  const execution = await functions.createExecution({ functionId: 'presences-backend', body: JSON.stringify(body), async: false, xpath: '/', method: ExecutionMethod.POST });
  check();
  let data;
  try { data = JSON.parse(execution.responseBody); } catch { throw new Error(`Student save returned no confirmation (${execution.responseStatusCode}). Refresh the student list before retrying; some records may already be saved.`); }
  if (execution.status === 'failed' || execution.responseStatusCode >= 400 || data.error) throw new Error(data.error || 'Appwrite ID-card request failed.');
  return data as T;
}
export async function extractBulkPdf(file: File, options: BulkPdfOptions) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a student ID-card PDF.');
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Use a non-empty PDF up to 50 MB.');
  options.progress('Preparing PDF pages…', 0);
  const { PDFDocument } = await import('pdf-lib');
  let pdf;
  try { pdf = await PDFDocument.load(await file.arrayBuffer()); }
  catch { throw new Error('PDF is damaged or password protected. Export an unlocked PDF.'); }
  const totalPages = pdf.getPageCount();
  if (totalPages > 30) throw new Error('Use a PDF with at most 30 pages.');
  let count = 0;
  for (let page = 1; page <= totalPages; page++) {
    if (options.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(pdf, [page - 1]);
    single.addPage(copied);
    const bytes = await single.save();
    if (bytes.length > 12 * 1024 * 1024) throw new Error(`Page ${page} exceeds 12 MB. Compress this page and retry.`);
    const fileData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read PDF page.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    });
    let rawCards: Record<string, string>[] = [];
    try {
      options.progress(`Extracting page ${page}…`, (page - 1) / totalPages * 100);
      const result: { cards: Record<string, string>[] } = await idCardFunction({ action: 'idcards.extract', fileData, page: 1 }, options.signal);
      if (result && Array.isArray(result.cards)) {
        rawCards = result.cards;
      }
    } catch (edgeErr: any) {
      if (options.signal.aborted) throw edgeErr;
      console.warn(`[BulkPdfExtractor] Cloud extractor notice on page ${page}, falling back to on-device extractor:`, edgeErr?.message);
      options.progress(`Scanning page ${page} on device…`, (page - 1) / totalPages * 100);
      try {
        const { extractCards } = await import('./pdfImport');
        const pageBlob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        const pageFile = new File([pageBlob], `page-${page}.pdf`, { type: 'application/pdf' });
        const localCards = await extractCards(pageFile, options.columns || 0, options.rows || 0, () => {}, options.signal);
        for (const lc of localCards) {
          if (count >= 150) throw new Error('150 cards scanned. Save these and split the remaining pages into another batch.');
          options.onCard(lc);
          count++;
        }
        continue;
      } catch (localErr: any) {
        if (options.signal.aborted) throw localErr;
        console.warn(`[BulkPdfExtractor] On-device extractor also failed for page ${page}:`, localErr?.message);
        throw edgeErr;
      }
    }

    for (const raw of rawCards) {
      if (count >= 150) throw new Error('150 cards scanned. Save these and split the remaining pages into another batch.');
      const student = { ...parseCardText(''), ...raw };
      options.onCard({ id: crypto.randomUUID(), student, page, preview: '', text: Object.entries(raw).map(([key, value]) => `${key}: ${value}`).join('\n') });
      count++;
    }
    options.progress(`${count} cards scanned · page ${page}/${totalPages}`, page / totalPages * 100);
  }
}
