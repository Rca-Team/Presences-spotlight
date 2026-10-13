import { detectCanvasCardGrid, detectCardGrid, layoutCardSheet, parseCardText, splitMultiCardText, textInRegion, type PositionedText } from './pdfParser';
import { extractPageWithGemini, hasGeminiApiKey } from './geminiCardExtractor';
import type { ImportCard } from './types';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface ExtractionOptions {
  portraits?: boolean;
  onProgress?: (completed: number, total: number) => void;
  onCard?: (card: ImportCard) => void;
  startPage?: number;
  targetCategory?: string;
}
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES_PER_FILE = 100;
export const MAX_CARDS_PER_BATCH = 1000;
const abortError = () => new DOMException('Extraction cancelled.', 'AbortError');

/** Downscale preview thumbnail so 100-page imports remain lightweight in memory. */
function createPreviewDataUrl(source: HTMLCanvasElement): string {
  const maxDim = 480;
  if (source.width <= maxDim && source.height <= maxDim) {
    return source.toDataURL('image/jpeg', 0.74);
  }
  const scale = maxDim / Math.max(source.width, source.height);
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(source.width * scale));
  thumb.height = Math.max(1, Math.round(source.height * scale));
  try {
    thumb.getContext('2d')!.drawImage(source, 0, 0, thumb.width, thumb.height);
    return thumb.toDataURL('image/jpeg', 0.74);
  } finally {
    thumb.width = thumb.height = 0;
  }
}

function inferGridForCardCount(count: number, canvasWidth: number, canvasHeight: number, hintCols?: number, hintRows?: number): { columns: number; rows: number } {
  if (hintCols && hintRows && hintCols >= 1 && hintCols <= 4 && hintRows >= 1 && hintRows <= 6 && hintCols * hintRows >= count) {
    return { columns: hintCols, rows: hintRows };
  }
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return canvasWidth >= canvasHeight ? { columns: 2, rows: 1 } : { columns: 1, rows: 2 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 2, rows: 3 };
  if (count <= 8) return { columns: 2, rows: 4 };
  if (count <= 10) return { columns: 2, rows: 5 };
  return { columns: 2, rows: Math.min(6, Math.ceil(count / 2)) };
}

/** Documents and photos are processed with Google Gemini AI + layout grid + local OCR fallback + face crop. */
export async function extractCards(
  file: File,
  columns = 0,
  rows = 0,
  progress: (message: string) => void = () => {},
  signal = new AbortController().signal,
  options: ExtractionOptions = {}
): Promise<ImportCard[]> {
  if (signal.aborted) throw abortError();
  if (!file.size) throw new Error('The selected document is empty.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Use a document smaller than 50 MB. Split larger files into smaller batches.');
  if (![0, 1, 2, 3, 4].includes(columns) || ![0, 1, 2, 3, 4, 5, 6].includes(rows) || Boolean(columns) !== Boolean(rows)) throw new Error('Choose a valid card grid.');

  const isExcel = /\.(?:xlsx|xls|csv|ods)$/i.test(file.name) || /^(?:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv|application\/csv)$/i.test(file.type);
  if (isExcel) {
    const { extractExcelCards } = await import('./excelImport');
    return extractExcelCards(file, {
      signal,
      progress: msg => progress(msg),
      onCard: options.onCard,
    });
  }

  const isMht = /\.(?:mht|mhtml|html|htm)$/i.test(file.name) || /^(?:multipart\/related|message\/rfc822|application\/x-mimearchive|text\/html)$/i.test(file.type);
  if (isMht) {
    const { extractMhtCards } = await import('./mhtImport');
    return extractMhtCards(file, {
      columns,
      rows,
      signal,
      progress: msg => progress(msg),
      onCard: options.onCard,
    });
  }

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = /^image\/(png|jpe?g|webp|bmp|gif)$/i.test(file.type) || /\.(?:png|jpe?g|webp|bmp|gif)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error('Choose a PDF, Excel (.xlsx/.xls/.csv), MHT/MHTML, JPEG, PNG, WebP or BMP ID card file.');

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

  async function extractPortraitFromCrop(crop: HTMLCanvasElement, hasPhotoHint = false): Promise<string | undefined> {
    if (options.portraits === false) return undefined;
    try {
      const faceapi = await import('face-api.js');
      if (!faceapi.nets.tinyFaceDetector.isLoaded) await wait(faceapi.nets.tinyFaceDetector.loadFromUri('/models'));
      check();

      // Fast path for landscape ID cards (e.g. 4 or 10 cards per page):
      // Only scan the left portrait zone at a fast 224 inputSize instead of 3 full-card passes
      if (crop.width > crop.height * 1.1) {
        const zoom = document.createElement('canvas');
        zoom.width = 256;
        zoom.height = 320;
        try {
          const zx = Math.round(crop.width * 0.025);
          const zy = Math.round(crop.height * 0.20);
          const zw = Math.round(crop.width * 0.32);
          const zh = Math.round(crop.height * 0.54);
          zoom.getContext('2d')!.drawImage(crop, zx, zy, zw, zh, 0, 0, zoom.width, zoom.height);
          const zoomFaces = await wait(faceapi.detectAllFaces(zoom, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.22 })).run());
          const bestZoom = zoomFaces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height))[0];
          if (bestZoom && bestZoom.box.width >= 16 && bestZoom.box.height >= 16) {
            const b = bestZoom.box;
            const padX = b.width * 0.25;
            const padY = b.height * 0.35;
            const sx = Math.max(0, b.x - padX);
            const sy = Math.max(0, b.y - padY * 0.85);
            const sw = Math.min(zoom.width - sx, b.width + 2 * padX);
            const sh = Math.min(zoom.height - sy, b.height + 1.85 * padY);
            const pic = document.createElement('canvas'); pic.width = 240; pic.height = 300;
            pic.getContext('2d')!.drawImage(zoom, sx, sy, sw, sh, 0, 0, 240, 300);
            const portrait = pic.toDataURL('image/jpeg', 0.84);
            pic.width = pic.height = 0;
            return portrait;
          }
          if (hasPhotoHint) {
            return zoom.toDataURL('image/jpeg', 0.82);
          }
        } finally {
          zoom.width = zoom.height = 0;
        }
      }

      const faces = await wait(faceapi.detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.30 })).run());
      const detected = faces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
      if (detected.length > 0) {
        const b = detected[0].box;
        if (b.width >= 14 && b.height >= 14) {
          const padX = b.width * 0.25;
          const padY = b.height * 0.35;
          const sx = Math.max(0, b.x - padX);
          const sy = Math.max(0, b.y - padY * 0.85);
          const sw = Math.min(crop.width - sx, b.width + 2 * padX);
          const sh = Math.min(crop.height - sy, b.height + 1.85 * padY);
          const pic = document.createElement('canvas'); pic.width = 240; pic.height = 300;
          pic.getContext('2d')!.drawImage(crop, sx, sy, sw, sh, 0, 0, 240, 300);
          const portrait = pic.toDataURL('image/jpeg', 0.84);
          pic.width = pic.height = 0;
          return portrait;
        }
      }
    } catch { check(); /* Portrait extraction is optional; never fabricate a portrait. */ }
    return undefined;
  }

  async function readPage(canvas: HTMLCanvasElement, originalItems: PositionedText[], page: number, total: number) {
    // 1. Primary path: Google Gemini AI multi-card extraction paired with canvas grid cropping & portrait detection
    if (hasGeminiApiKey()) {
      try {
        progress(`Extracting ID cards on page ${page} of ${total} with Google Gemini AI…`);
        const pageJpegBase64 = canvas.toDataURL('image/jpeg', 0.78).split(',')[1] || '';
        if (pageJpegBase64) {
          const geminiRes = await wait(
            extractPageWithGemini('image/jpeg', pageJpegBase64, {
              pageNumber: page,
              totalPages: total,
              targetCategory: options.targetCategory,
              signal,
            })
          );
          check();
          if (geminiRes.cards.length > 0) {
            const cardCount = geminiRes.cards.length;
            const inferredGrid =
              columns && rows && columns * rows >= cardCount
                ? { columns, rows }
                : inferGridForCardCount(cardCount, canvas.width, canvas.height, geminiRes.grid_columns, geminiRes.grid_rows);
            const layout =
              inferredGrid.columns * inferredGrid.rows > 1
                ? layoutCardSheet(canvas, inferredGrid.columns, inferredGrid.rows, { forceExactGrid: true })
                : { columns: 1, rows: 1, cells: [{ x: 0, y: 0, width: canvas.width, height: canvas.height, ink: 1 }] };
            const nonBlankCells = layout.cells.filter(c => c.ink >= 0.001);
            const activeCells = nonBlankCells.length >= cardCount ? nonBlankCells : layout.cells;

            progress(`Page ${page} of ${total} · ${cardCount} student ID card${cardCount === 1 ? '' : 's'} detected by Gemini AI`);

            const builtCards = await Promise.all(
              geminiRes.cards.map(async (rawCard, i) => {
                check();
                const gStudent = { ...rawCard };
                const cell = activeCells[i] || activeCells[0] || { x: 0, y: 0, width: canvas.width, height: canvas.height, ink: 1 };
                const crop = document.createElement('canvas');
                crop.width = Math.max(1, Math.ceil(cell.width));
                crop.height = Math.max(1, Math.ceil(cell.height));
                try {
                  crop.getContext('2d')!.drawImage(canvas, cell.x, cell.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
                  // Supplement any missing field from digital PDF text in the cell region without overwriting Gemini's values
                  if (originalItems.length > 0) {
                    const regionText = textInRegion(originalItems, cell.x, cell.y, crop.width, crop.height);
                    if (regionText) {
                      const localParsed = parseCardText(regionText);
                      for (const key of Object.keys(localParsed) as (keyof typeof localParsed)[]) {
                        if (!gStudent[key] && localParsed[key]) {
                          (gStudent as any)[key] = localParsed[key];
                        }
                      }
                    }
                  }
                  if (!gStudent.admission_number && (gStudent.student_id_kv || gStudent.roll_number || gStudent.pen_number)) {
                    gStudent.admission_number = gStudent.student_id_kv || gStudent.roll_number || gStudent.pen_number;
                    gStudent.employee_id = gStudent.admission_number;
                  }
                  const preview = createPreviewDataUrl(crop);
                  const portrait = await extractPortraitFromCrop(crop, Boolean(gStudent.has_photo));
                  check();
                  const summaryLines = [
                    gStudent.name ? `Student Name: ${gStudent.name}` : '',
                    gStudent.admission_number ? `Admn No: ${gStudent.admission_number}` : '',
                    gStudent.student_id_kv ? `Student ID: ${gStudent.student_id_kv}` : '',
                    gStudent.class ? `Class: ${gStudent.class}${gStudent.section ? ` ${gStudent.section}` : ''}` : '',
                    gStudent.father_name ? `Father's Name: ${gStudent.father_name}` : '',
                    gStudent.mother_name ? `Mother's Name: ${gStudent.mother_name}` : '',
                    gStudent.date_of_birth ? `Date of Birth: ${gStudent.date_of_birth}` : '',
                    gStudent.parent_phone ? `Father/Mother Phone: ${gStudent.parent_phone}` : '',
                    gStudent.pen_number ? `PEN No: ${gStudent.pen_number}` : '',
                    gStudent.blood_group ? `Blood Group: ${gStudent.blood_group}` : '',
                    gStudent.address ? `Address: ${gStudent.address}` : '',
                  ].filter(Boolean);
                  const cardObj: ImportCard = {
                    id: crypto.randomUUID(),
                    student: gStudent,
                    page,
                    text: summaryLines.join('\n'),
                    preview,
                    portrait,
                  };
                  return cardObj;
                } finally {
                  crop.width = crop.height = 0;
                }
              })
            );

            for (const cardObj of builtCards) {
              if (cards.length >= MAX_CARDS_PER_BATCH) {
                throw new Error(`Import at most ${MAX_CARDS_PER_BATCH} cards at once. Save these and import remaining files in the next batch.`);
              }
              cards.push(cardObj);
              options.onCard?.(cardObj);
            }
            options.onProgress?.(page, total);
            return;
          }
        }
      } catch (geminiErr) {
        check();
        console.warn(`[pdfImport] Gemini extraction note on page ${page}, falling back to local parser:`, geminiErr);
      }
    }

    let items = originalItems;
    let fullOcr = '';
    const visualGrid = columns ? { columns, rows } : detectCanvasCardGrid(canvas);
    let grid = columns ? { columns, rows } : detectCardGrid(items, canvas.width, canvas.height);
    if (!columns && grid.columns * grid.rows <= 1 && visualGrid.columns * visualGrid.rows > 1) {
      grid = visualGrid;
    }

    // Ignore browser print header/footer lines when checking if the page has digital card text
    const bodyTextLen = items
      .filter(i => i.y >= canvas.height * 0.035 && i.y <= canvas.height * 0.965)
      .map(i => i.text)
      .join('')
      .trim().length;

    if (bodyTextLen < 25 && grid.columns * grid.rows <= 1) {
      try {
        ocrStage = `Reading scanned page ${page} of ${total}`;
        const scanned = await recognize(canvas, true);
        fullOcr = scanned.data.text;
        items = (scanned.data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map(l => ({ text: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, height: l.bbox.y1 - l.bbox.y0 }))));
        if (!columns) {
          const ocrGrid = detectCardGrid(items, canvas.width, canvas.height);
          if (ocrGrid.columns * ocrGrid.rows > 1) grid = ocrGrid;
          else if (visualGrid.columns * visualGrid.rows > 1) grid = visualGrid;
        }
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
        if (cards.length + pageCards.length >= MAX_CARDS_PER_BATCH) {
          throw new Error(`Import at most ${MAX_CARDS_PER_BATCH} cards at once. Save these and import remaining files in the next batch.`);
        }
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
          pageCards.push({ id: crypto.randomUUID(), student, page, text, preview: createPreviewDataUrl(crop), portrait });
        } finally { crop.width = crop.height = 0; }
      }
      return pageCards;
    }

    let extractedPageCards = await extractFromGrid(grid.columns, grid.rows);

    // If auto-detection initially chose 1×1, check whether the page text actually contains
    // multiple student cards (e.g. 4 IDs per page or 10 IDs per page) and re-extract with the
    // matching multi-card grid or split the multi-card text blocks.
    if (!columns && grid.columns * grid.rows <= 1 && extractedPageCards.length <= 1) {
      const combinedPageText = extractedPageCards[0]?.text || textInRegion(items, 0, 0, canvas.width, canvas.height) || fullOcr;
      const textChunks = splitMultiCardText(combinedPageText);
      if (textChunks.length >= 2) {
        const n = textChunks.length;
        const inferredCols = n >= 4 ? 2 : (canvas.width >= canvas.height ? 2 : 1);
        const inferredRows = Math.max(1, Math.min(6, Math.ceil(n / inferredCols)));
        const resliced = await extractFromGrid(inferredCols, inferredRows);
        if (resliced.length >= 2) {
          extractedPageCards = resliced;
        } else {
          const basePreview = extractedPageCards[0]?.preview || createPreviewDataUrl(canvas);
          const basePortrait = extractedPageCards[0]?.portrait;
          extractedPageCards = textChunks.map((chunk, idx) => {
            const student = parseCardText(chunk);
            if (!student.admission_number && (student.student_id_kv || student.roll_number || student.pen_number)) {
              student.admission_number = student.student_id_kv || student.roll_number || student.pen_number;
              student.employee_id = student.admission_number;
            }
            return {
              id: crypto.randomUUID(),
              student,
              page,
              text: chunk,
              preview: basePreview,
              portrait: idx === 0 ? basePortrait : undefined,
            };
          }).filter(c => Boolean(c.student.name || c.student.admission_number));
        }
      }
    }

    // If a multi-card grid (e.g. 2×4) sliced a single-card page into fragments
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
    if (extractedPageCards.length === 0 && cards.length < MAX_CARDS_PER_BATCH) {
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
          preview: createPreviewDataUrl(canvas),
          portrait,
        });
      }
    }

    for (const card of extractedPageCards) {
      cards.push(card);
      options.onCard?.(card);
    }
    options.onProgress?.(page, total);
  }
  try {
    if (isPdf) {
      const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      loading = pdfjs.getDocument({ data: await wait(file.arrayBuffer()), isEvalSupported: false });
      pdf = await wait(loading.promise);
      if (pdf.numPages > MAX_PAGES_PER_FILE) throw new Error(`Import at most ${MAX_PAGES_PER_FILE} pages per file. Split the PDF and retry.`);
      const firstPage = Math.max(1, options.startPage || 1);
      const totalPages = pdf.numPages;
      const pageNumbers: number[] = [];
      for (let p = firstPage; p <= totalPages; p++) pageNumbers.push(p);

      const processSinglePdfPage = async (pageNumber: number) => {
        check();
        progress(`Reading page ${pageNumber} of ${totalPages}`);
        const page = await wait(pdf!.getPage(pageNumber));
        const canvas = document.createElement('canvas');
        try {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2.0, 1680 / Math.max(base.width, base.height)) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
          renderTask = task;
          await wait(task.promise);
          if (renderTask === task) renderTask = undefined;
          const content = await wait(page.getTextContent());
          const items = content.items
            .filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in item)
            .map(item => {
              const p = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
              return { text: item.str, x: p[0], y: p[1], height: item.height * viewport.scale };
            });
          await readPage(canvas, items, pageNumber, totalPages);
          await new Promise(resolve => setTimeout(resolve, 0));
        } finally {
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      };

      const PAGE_CONCURRENCY = hasGeminiApiKey() ? 2 : 1;
      for (let idx = 0; idx < pageNumbers.length; idx += PAGE_CONCURRENCY) {
        check();
        const batch = pageNumbers.slice(idx, idx + PAGE_CONCURRENCY);
        await Promise.all(batch.map(processSinglePdfPage));
      }
    } else {
      const url = URL.createObjectURL(file), image = new Image(), canvas = document.createElement('canvas');
      try {
        await wait(new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This image could not be opened. Try JPEG, PNG or WebP.')); image.src = url; }));
        const scale = Math.min(1, 1680 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
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
