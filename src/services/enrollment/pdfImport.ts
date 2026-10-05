import { detectCardGrid, layoutCardSheet, parseCardText, textInRegion, type PositionedText } from './pdfParser';
import type { ImportCard } from './types';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface ExtractionOptions { portraits?: boolean; onProgress?: (completed: number, total: number) => void }
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const abortError = () => new DOMException('Extraction cancelled.', 'AbortError');

/** Documents and photos never leave the device. Only OCR language assets download. */
export async function extractCards(file: File, columns = 0, rows = 0, progress: (message: string) => void = () => {}, signal = new AbortController().signal, options: ExtractionOptions = {}): Promise<ImportCard[]> {
  if (signal.aborted) throw abortError();
  if (!file.size) throw new Error('The selected document is empty.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Use a document smaller than 25 MB. Split larger PDFs into smaller batches.');
  if (![0, 1, 2, 3, 4].includes(columns) || ![0, 1, 2, 3, 4, 5, 6].includes(rows) || Boolean(columns) !== Boolean(rows)) throw new Error('Choose a valid card grid.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Choose a PDF, JPEG, PNG or WebP ID card.');
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
  let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
  let loading: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let renderTask: import('pdfjs-dist').RenderTask | undefined;
  let rejectAbort: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  // Mark the cancellation promise handled even if cancellation happens between awaits.
  void cancelled.catch(() => {});
  const abort = () => { rejectAbort(abortError()); renderTask?.cancel(); void worker?.terminate(); void loading?.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const wait = <T,>(work: Promise<T>) => Promise.race([work, cancelled]);
  const check = () => { if (signal.aborted) throw abortError(); };
  const cards: ImportCard[] = [];
  let ocrStage = '';
  async function recognize(canvas: HTMLCanvasElement, withLayout = false) {
    check();
    if (!worker) {
      progress('Preparing local OCR. The first scanned document downloads a language model…');
      const { createWorker, OEM } = await import('tesseract.js');
      const initializing = createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: ocrWorkerUrl, corePath: ocrCoreUrl, workerBlobURL: false,
        logger: event => { if (!signal.aborted && event.status === 'recognizing text') progress(`${ocrStage} · ${Math.round(event.progress * 100)}%`); },
      }).then(value => { if (signal.aborted) { void value.terminate(); throw abortError(); } worker = value; return value; });
      await wait(initializing);
    }
    return wait(worker!.recognize(canvas, {}, { text: true, blocks: withLayout }));
  }
  async function readPage(canvas: HTMLCanvasElement, originalItems: PositionedText[], page: number, total: number) {
    let items = originalItems;
    let fullOcr = '';
    let grid = columns ? { columns, rows } : detectCardGrid(items, canvas.width, canvas.height);
    if (!columns && items.map(i => i.text).join('').trim().length < 30) {
      ocrStage = `Reading scanned page ${page} of ${total}`;
      const scanned = await recognize(canvas, true);
      fullOcr = scanned.data.text;
      items = (scanned.data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map(l => ({ text: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, height: l.bbox.y1 - l.bbox.y0 }))));
      grid = detectCardGrid(items, canvas.width, canvas.height);
    }
    // Multi-card sheets are cut on the printed content box and gutters instead
    // of equal page slices, so margins and headers never slice a card in half.
    // The layout may also shrink when a page holds fewer cards than requested.
    const layout = grid.columns * grid.rows > 1 ? layoutCardSheet(canvas, grid.columns, grid.rows) : undefined;
    const active = layout ? { columns: layout.columns, rows: layout.rows } : grid;
    progress(`Page ${page} of ${total} · ${active.columns} across × ${active.rows} down`);
    const cells = layout && active.columns * active.rows > 1
      ? layout.cells
      : [{ x: 0, y: 0, width: canvas.width, height: canvas.height, ink: 1 }];
    for (let row = 0; row < active.rows; row++) for (let col = 0; col < active.columns; col++) {
      check();
      if (cards.length >= 150) throw new Error('Import at most 150 cards at once. Split the PDF into smaller batches.');
      const cell = cells[row * active.columns + col];
      // An under-filled sheet leaves empty regions — skip them instead of OCR-ing blank crops.
      if (cell.ink < 0.001) continue;
      const x = cell.x, y = cell.y;
      const crop = document.createElement('canvas'); crop.width = Math.max(1, Math.ceil(cell.width)); crop.height = Math.max(1, Math.ceil(cell.height));
      try {
        crop.getContext('2d')!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        let text = textInRegion(items, x, y, crop.width, crop.height) || (active.columns === 1 && active.rows === 1 ? fullOcr : '');
        let student = parseCardText(text);
        if (text.replace(/\s/g, '').length < 30 || (!student.name && !student.admission_number)) {
          ocrStage = `Reading card ${row * active.columns + col + 1} on page ${page}`;
          text = (await recognize(crop)).data.text;
          student = parseCardText(text);
        }
        if (text.trim().length < 5) continue;
        let portrait: string | undefined;
        if (options.portraits !== false) {
          try {
            const faceapi = await import('face-api.js');
            if (!faceapi.nets.tinyFaceDetector.isLoaded) await wait(faceapi.nets.tinyFaceDetector.loadFromUri('/models'));
            check();
            const faces = await wait(faceapi.detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })).run());
            if (faces.length === 1) {
              const b = faces[0].box, pad = b.width * 0.2;
              const sx = Math.max(0, b.x - pad), sy = Math.max(0, b.y - pad);
              const pic = document.createElement('canvas'); pic.width = 256; pic.height = 320;
              pic.getContext('2d')!.drawImage(crop, sx, sy, Math.min(crop.width - sx, b.width + 2 * pad), Math.min(crop.height - sy, b.height + 2 * pad), 0, 0, 256, 320);
              portrait = pic.toDataURL('image/jpeg', 0.85); pic.width = pic.height = 0;
            }
          } catch { check(); /* Portrait extraction is optional; never fabricate a portrait. */ }
        }
        check();
        cards.push({ id: crypto.randomUUID(), student, page, text, preview: crop.toDataURL('image/jpeg', 0.75), portrait });
      } finally { crop.width = crop.height = 0; }
    }
    options.onProgress?.(page, total);
  }
  try {
    if (isPdf) {
      const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      loading = pdfjs.getDocument({ data: await wait(file.arrayBuffer()), isEvalSupported: false });
      pdf = await wait(loading.promise);
      if (pdf.numPages > 30) throw new Error('Import at most 30 pages per batch. Split the PDF and retry.');
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        check(); progress(`Reading page ${pageNumber} of ${pdf.numPages}`);
        const page = await wait(pdf.getPage(pageNumber));
        const canvas = document.createElement('canvas');
        try {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(3, 2600 / Math.max(base.width, base.height)) });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          renderTask = page.render({ canvasContext: canvas.getContext('2d')!, viewport }); await wait(renderTask.promise); renderTask = undefined;
          const content = await wait(page.getTextContent());
          const items = content.items.filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in item).map(item => {
            const p = viewport.convertToViewportPoint(item.transform[4], item.transform[5]); return { text: item.str, x: p[0], y: p[1], height: item.height * viewport.scale };
          });
          await readPage(canvas, items, pageNumber, pdf.numPages);
        } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      }
    } else {
      const url = URL.createObjectURL(file), image = new Image(), canvas = document.createElement('canvas');
      try {
        await wait(new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This image could not be opened. Try JPEG or PNG.')); image.src = url; }));
        const scale = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        await readPage(canvas, [], 1, 1);
      } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 0; }
    }
    return cards;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (error instanceof Error && /password/i.test(error.message)) throw new Error('This PDF is password protected. Export an unlocked copy and retry.');
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await worker?.terminate().catch(() => {});
    await loading?.destroy().catch(() => {});
  }
}
