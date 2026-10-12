import { detectCardGrid, layoutCardSheet, parseCardText, textInRegion, type PositionedText } from './pdfParser';
import type { ImportCard } from './types';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface ExtractionOptions {
  portraits?: boolean;
  onProgress?: (completed: number, total: number) => void;
}
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const abortError = () => new DOMException('Extraction cancelled.', 'AbortError');

/** Documents and photos are processed locally by this legacy OCR helper. */
export async function extractCards(file: File, columns = 0, rows = 0, progress: (message: string) => void = () => {}, signal = new AbortController().signal, options: ExtractionOptions = {}): Promise<ImportCard[]> {
  if (signal.aborted) throw abortError();
  if (!file.size) throw new Error('The selected document is empty.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Use a document smaller than 25 MB. Split larger PDFs into smaller batches.');
  if (![0, 1, 2].includes(columns) || ![0, 1, 2, 3, 4].includes(rows) || Boolean(columns) !== Boolean(rows)) throw new Error('Choose a valid card grid.');
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

  async function extractPortraitFromCrop(crop: HTMLCanvasElement): Promise<string | undefined> {
    if (options.portraits === false) return undefined;
    try {
      const faceapi = await import('face-api.js');
      if (!faceapi.nets.tinyFaceDetector.isLoaded) await wait(faceapi.nets.tinyFaceDetector.loadFromUri('/models'));
      check();
      const faces = await wait(faceapi.detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.40 })).run());
      let detected = faces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
      if (detected.length === 0) {
        const retryFaces = await wait(faceapi.detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.22 })).run());
        detected = retryFaces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
      }
      if (detected.length > 0) {
        const b = detected[0].box;
        if (b.width >= 16 && b.height >= 16) {
          const padX = b.width * 0.25;
          const padY = b.height * 0.35;
          const sx = Math.max(0, b.x - padX);
          const sy = Math.max(0, b.y - padY * 0.85);
          const sw = Math.min(crop.width - sx, b.width + 2 * padX);
          const sh = Math.min(crop.height - sy, b.height + 1.85 * padY);
          const pic = document.createElement('canvas'); pic.width = 256; pic.height = 320;
          pic.getContext('2d')!.drawImage(crop, sx, sy, sw, sh, 0, 0, 256, 320);
          const portrait = pic.toDataURL('image/jpeg', 0.88);
          pic.width = pic.height = 0;
          return portrait;
        }
      }
    } catch { check(); /* Portrait extraction is optional; never fabricate a portrait. */ }
    return undefined;
  }

  async function readPage(canvas: HTMLCanvasElement, originalItems: PositionedText[], page: number, total: number) {
    let items = originalItems;
    let fullOcr = '';
    let grid = columns ? { columns, rows } : detectCardGrid(items, canvas.width, canvas.height);
    if (items.map(i => i.text).join('').trim().length < 25) {
      try {
        ocrStage = `Reading scanned page ${page} of ${total}`;
        const scanned = await recognize(canvas, true);
        fullOcr = scanned.data.text;
        items = (scanned.data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map(l => ({ text: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, height: l.bbox.y1 - l.bbox.y0 }))));
        if (!columns) grid = detectCardGrid(items, canvas.width, canvas.height);
      } catch {
        check();
      }
    }

    async function extractFromGrid(requestedCols: number, requestedRows: number): Promise<ImportCard[]> {
      const pageCards: ImportCard[] = [];
      const layout = requestedCols * requestedRows > 1 ? layoutCardSheet(canvas, requestedCols, requestedRows) : undefined;
      const active = layout ? { columns: layout.columns, rows: layout.rows } : { columns: requestedCols, rows: requestedRows };
      progress(`Page ${page} of ${total} · ${active.columns} across × ${active.rows} down`);
      const cells = layout && active.columns * active.rows > 1
        ? layout.cells
        : [{ x: 0, y: 0, width: canvas.width, height: canvas.height, ink: 1 }];

      for (let row = 0; row < active.rows; row++) for (let col = 0; col < active.columns; col++) {
        check();
        if (cards.length + pageCards.length >= 150) throw new Error('Import at most 150 cards at once. Split the PDF into smaller batches.');
        const cell = cells[row * active.columns + col];
        // An under-filled sheet leaves empty regions — skip them instead of OCR-ing blank crops.
        if (!cell || cell.ink < 0.001) continue;
        const x = cell.x, y = cell.y;
        const crop = document.createElement('canvas'); crop.width = Math.max(1, Math.ceil(cell.width)); crop.height = Math.max(1, Math.ceil(cell.height));
        try {
          crop.getContext('2d')!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
          const pdfText = textInRegion(items, x, y, crop.width, crop.height) || (active.columns === 1 && active.rows === 1 ? fullOcr : '');
          let text = pdfText;
          let student = parseCardText(pdfText);

          // Only invoke OCR when essential identity fields are missing from digital PDF text,
          // and merge OCR results without overwriting non-empty digital PDF fields.
          if (pdfText.replace(/\s/g, '').length < 20 || !student.name || (!student.admission_number && !student.student_id_kv && !student.roll_number)) {
            try {
              ocrStage = `Reading card ${row * active.columns + col + 1} on page ${page}`;
              const ocrText = (await recognize(crop)).data.text;
              const ocrStudent = parseCardText(ocrText);
              for (const key of Object.keys(ocrStudent) as (keyof typeof student)[]) {
                if (!student[key] && ocrStudent[key]) {
                  (student as any)[key] = ocrStudent[key];
                }
              }
              text = [pdfText, ocrText].filter(Boolean).join('\n');
            } catch {
              check();
            }
          }

          // Read the KV details table separately from the photo caption, so OCR
          // cannot merge the student's name into a parent's row.
          if (/identity\s*card|father\s*name|admn\s*no/i.test(text) && crop.width / crop.height > 1.25 && crop.width / crop.height < 1.9 && (!student.name || !student.admission_number)) {
            const region = document.createElement('canvas');
            try {
              const readRegion = async (rx: number, ry: number, rw: number, rh: number) => {
                const scale = Math.max(1, Math.min(4, 1400 / (crop.width * rw)));
                region.width = Math.ceil(crop.width * rw * scale);
                region.height = Math.ceil(crop.height * rh * scale);
                region.getContext('2d')!.drawImage(crop, crop.width * rx, crop.height * ry, crop.width * rw, crop.height * rh, 0, 0, region.width, region.height);
                return (await recognize(region)).data.text;
              };
              ocrStage = `Reading details of card ${row * active.columns + col + 1} on page ${page}`;
              const detailText = await readRegion(0.31, 0.30, 0.59, 0.49);
              const detail = parseCardText(detailText);
              const caption = (await readRegion(0.025, 0.65, 0.25, 0.065)).trim().replace(/\s+/g, ' ');
              const identity = await readRegion(0.04, 0.22, 0.20, 0.105);
              for (const field of ['father_name', 'mother_name', 'date_of_birth', 'class', 'section', 'admission_number', 'pen_number', 'blood_group', 'parent_phone', 'address'] as const) {
                if (!student[field] && detail[field]) student[field] = detail[field];
              }
              if (!student.name && /^[A-Z][A-Z .'’-]{2,50}$/i.test(caption) && !/student|identity|signature|principal/i.test(caption)) student.name = caption;
              const id = identity.match(/\d{8,12}/)?.[0];
              if (id && !student.student_id_kv) student.student_id_kv = id;
              text += `\n\nSeparate details region:\n${detailText}`;
            } catch {
              check();
            } finally { region.width = region.height = 0; }
          }

          if (!student.admission_number && (student.student_id_kv || student.roll_number || student.pen_number)) {
            student.admission_number = student.student_id_kv || student.roll_number || student.pen_number;
            student.employee_id = student.admission_number;
          }
          if (!student.name && !student.admission_number) continue;
          if (text.trim().length < 5) continue;

          const portrait = await extractPortraitFromCrop(crop);
          check();
          pageCards.push({ id: crypto.randomUUID(), student, page, text, preview: crop.toDataURL('image/jpeg', 0.75), portrait });
        } finally { crop.width = crop.height = 0; }
      }
      return pageCards;
    }

    let extractedPageCards = await extractFromGrid(grid.columns, grid.rows);

    // If a multi-card grid (e.g. default 2×4) sliced a single-card page into fragments
    // and found 0 cards, automatically retry with auto-detected grid and 1×1 full page.
    if (extractedPageCards.length === 0 && grid.columns * grid.rows > 1) {
      const detected = detectCardGrid(items, canvas.width, canvas.height);
      if (detected.columns !== grid.columns || detected.rows !== grid.rows) {
        extractedPageCards = await extractFromGrid(detected.columns, detected.rows);
      }
      if (extractedPageCards.length === 0 && (detected.columns !== 1 || detected.rows !== 1)) {
        extractedPageCards = await extractFromGrid(1, 1);
      }
    }

    // Last-resort fallback: if a non-blank page still yielded 0 parsed cards (e.g. outlined fonts
    // or non-standard template), emit a review card with the page preview and portrait so the
    // user is never left with 0 cards scanned.
    if (extractedPageCards.length === 0 && cards.length < 150) {
      const singleLayout = layoutCardSheet(canvas, 1, 1);
      const hasInk = (singleLayout.cells[0]?.ink ?? 0) >= 0.002;
      const fallbackText = (textInRegion(items, 0, 0, canvas.width, canvas.height) || fullOcr || '').trim();
      if (hasInk || fallbackText.length > 0) {
        const student = parseCardText(fallbackText);
        if (!student.admission_number && (student.student_id_kv || student.roll_number || student.pen_number)) {
          student.admission_number = student.student_id_kv || student.roll_number || student.pen_number;
          student.employee_id = student.admission_number;
        }
        const portrait = await extractPortraitFromCrop(canvas);
        check();
        extractedPageCards.push({
          id: crypto.randomUUID(),
          student,
          page,
          text: fallbackText || `Page ${page}`,
          preview: canvas.toDataURL('image/jpeg', 0.75),
          portrait,
        });
      }
    }

    cards.push(...extractedPageCards);
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
