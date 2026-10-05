import { functions } from '@/integrations/appwrite/client';
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
  let execution = await functions.createExecution({ functionId: 'presences-backend', body: JSON.stringify(body), async: true, xpath: '/', method: ExecutionMethod.POST });
  const deadline = Date.now() + 120000;
  while (execution.status === 'waiting' || execution.status === 'processing' || execution.status === 'scheduled') {
    check();
    if (Date.now() > deadline) throw new Error('Appwrite request timed out. Check function executions before retrying a save.');
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    check(); execution = await functions.getExecution({ functionId: 'presences-backend', executionId: execution.$id });
  }
  check();
  let data;
  try { data = JSON.parse(execution.responseBody); } catch { throw new Error('Appwrite returned no result. Check the function deployment and execution logs.'); }
  if (execution.status === 'failed' || execution.responseStatusCode >= 400 || data.error) throw new Error(data.error || 'Appwrite ID-card request failed.');
  return data as T;
}
export async function extractBulkPdf(file: File, options: BulkPdfOptions) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a student ID-card PDF.');
  if (!file.size || file.size > 6 * 1024 * 1024) throw new Error('Use a non-empty PDF smaller than 6 MB. Split larger files.');
  const fileData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read PDF.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
  });
  let page: number | null = 1, count = 0, totalPages = 1;
  while (page !== null) {
    options.progress(`Appwrite is extracting page ${page}…`, (page - 1) / totalPages * 100);
    const result: { cards: Record<string, string>[]; pages: number; nextPage: number | null } = await idCardFunction({ action: 'idcards.extract', fileData, page }, options.signal);
    totalPages = result.pages;
    for (const raw of result.cards) {
      if (count >= 150) throw new Error('150 cards scanned. Save these and split the remaining pages into another batch.');
      const student = { ...parseCardText(''), ...raw };
      options.onCard({ id: crypto.randomUUID(), student, page, preview: '', text: Object.entries(raw).map(([key, value]) => `${key}: ${value}`).join('\n') });
      count++;
    }
    options.progress(`${count} cards scanned · page ${page}/${result.pages}`, page / result.pages * 100);
    page = result.nextPage;
  }
}
