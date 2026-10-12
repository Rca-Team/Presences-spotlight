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
    const url = String(import.meta.env.VITE_SUPABASE_URL || 'https://cvdcbcsonlianbfeessy.supabase.co').replace(/\/$/, '');
    const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZGNiY3NvbmxpYW5iZmVlc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDE5NzQsImV4cCI6MjA3NjcxNzk3NH0.p_3_fF3lR_7z-x73Q87H3qE4I3w-aF7r9g-g8fG-h7I');
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
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isMht = /\.(?:mht|mhtml|html|htm)$/i.test(file.name) || /^(?:multipart\/related|message\/rfc822|application\/x-mimearchive|text\/html)$/i.test(file.type);
  const isImage = /^image\/(png|jpe?g|webp|bmp|gif)$/i.test(file.type) || /\.(?:png|jpe?g|webp|bmp|gif)$/i.test(file.name);

  if (!isPdf && !isMht && !isImage) {
    throw new Error('Choose a student ID-card PDF, MHT/MHTML, or image file.');
  }
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Use a non-empty PDF up to 50 MB.');

  if (isMht) {
    options.progress(`Extracting cards from ${file.name}…`, 5);
    const { extractMhtCards } = await import('./mhtImport');
    let count = 0;
    await extractMhtCards(file, {
      columns: options.columns || 0,
      rows: options.rows || 0,
      signal: options.signal,
      progress: (msg, pct) => options.progress(msg, pct),
      onCard: card => {
        count++;
        options.onCard(card);
      },
    });
    options.progress(`${count} cards scanned from ${file.name}`, 100);
    return;
  }

  if (isImage) {
    options.progress(`Scanning image ${file.name}…`, 10);
    const { extractCards } = await import('./pdfImport');
    let count = 0;
    await extractCards(
      file,
      options.columns || 0,
      options.rows || 0,
      msg => options.progress(msg, 50),
      options.signal,
      {
        onCard: card => {
          count++;
          options.onCard(card);
        },
      }
    );
    options.progress(`${count} cards scanned from ${file.name}`, 100);
    return;
  }

  options.progress('Preparing PDF pages…', 0);
  const { PDFDocument } = await import('pdf-lib');
  let pdf;
  try { pdf = await PDFDocument.load(await file.arrayBuffer()); }
  catch { throw new Error('PDF is damaged or password protected. Export an unlocked PDF.'); }
  const totalPages = pdf.getPageCount();
  if (totalPages > 100) throw new Error('Use a PDF with at most 100 pages.');
  let count = 0;
  let useCloudExtractor = true;

  for (let page = 1; page <= totalPages; page++) {
    if (options.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(pdf, [page - 1]);
    single.addPage(copied);
    const bytes = await single.save();
    if (bytes.length > 12 * 1024 * 1024) throw new Error(`Page ${page} exceeds 12 MB. Compress this page and retry.`);

    let rawCards: Record<string, string>[] = [];

    if (useCloudExtractor) {
      try {
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read PDF page.'));
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        });
        options.progress(`Extracting page ${page} of ${totalPages}…`, (page - 1) / totalPages * 100);
        const result: { cards: Record<string, string>[] } = await idCardFunction({ action: 'idcards.extract', fileData, page: 1 }, options.signal);
        if (result && Array.isArray(result.cards)) {
          rawCards = result.cards;
        }
      } catch (edgeErr: any) {
        if (options.signal.aborted) throw edgeErr;
        useCloudExtractor = false;
        console.info('[BulkPdfExtractor] Using high-performance on-device extractor.');
      }
    }

    if (!useCloudExtractor || rawCards.length === 0) {
      // Process remaining pages (page..totalPages) in a single shared pdfjs + OCR pass for smooth 100-page extraction
      const { extractCards } = await import('./pdfImport');
      await extractCards(
        file,
        options.columns || 0,
        options.rows || 0,
        msg => options.progress(msg, (page - 1) / totalPages * 100),
        options.signal,
        {
          startPage: page,
          onCard: lc => {
            if (count >= 1000) throw new Error('1000 cards scanned. Save these and split the remaining pages into another batch.');
            options.onCard(lc);
            count++;
          },
          onProgress: (completedPage, total) => {
            options.progress(`${count} cards scanned · page ${completedPage}/${total}`, (completedPage / total) * 100);
          },
        }
      );
      break;
    }

    for (const raw of rawCards) {
      if (count >= 1000) throw new Error('1000 cards scanned. Save these and split the remaining pages into another batch.');
      const student = { ...parseCardText(''), ...raw };
      options.onCard({ id: crypto.randomUUID(), student, page, preview: '', text: Object.entries(raw).map(([key, value]) => `${key}: ${value}`).join('\n') });
      count++;
    }
    options.progress(`${count} cards scanned · page ${page}/${totalPages}`, page / totalPages * 100);
  }
}
