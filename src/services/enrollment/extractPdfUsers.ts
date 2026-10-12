import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  callGeminiGenerateContent,
  getGeminiApiKey,
  MULTI_CARD_PAGE_PROMPT,
  parseGeminiResponse,
} from './geminiCardExtractor';
import { extractCards, MAX_DOCUMENT_BYTES } from './pdfImport';
import { parseCardText } from './pdfParser';
import type { ImportCard } from './types';

const GEMINI_INLINE_BYTES = 8 * 1024 * 1024;
const KV_PROMPT = MULTI_CARD_PAGE_PROMPT;

export type ExtractedPdfUser = Record<string, unknown> & {
  name: string; employee_id: string; class: string; section: string; department: string;
};

export interface ExtractPdfResult {
  users: ExtractedPdfUser[];
  class_detected?: string;
  total_extracted?: number;
  reason?: string;
}

function geminiKey() {
  return getGeminiApiKey();
}

function abortError() {
  return new DOMException('Extraction cancelled.', 'AbortError');
}

function parseDataUrl(fileData: string, fileType?: string) {
  const trimmed = fileData.trim();
  const match = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  const mimeHint = (fileType || '').toLowerCase();
  const mimeTypeRaw = match ? match[1].toLowerCase() : mimeHint || 'application/pdf';
  const base64 = match ? match[2] : trimmed.replace(/\s/g, '');
  if (!base64) throw new Error('A PDF or image selected on this device is required.');
  let mimeType = mimeTypeRaw;
  if (mimeType === 'application/octet-stream' || mimeType === 'application/x-pdf') mimeType = 'application/pdf';
  if (mimeType !== 'application/pdf' && !/^image\/(jpeg|jpg|png|webp|bmp)$/.test(mimeType)) {
    throw new Error('Choose a PDF, JPEG, PNG or WebP ID card.');
  }
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  return { mimeType, base64 };
}

function withPhoto(user: ExtractedPdfUser, dataUrl: string): ExtractedPdfUser {
  const image_data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const student_photo_data_url = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
  return { ...user, has_photo: true, student_photo_data_url, photo_url: student_photo_data_url, image_data };
}

function loadHtmlImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the ID-card image.'));
    image.src = src;
  });
}

function cropBox(img: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  canvas.getContext('2d')!.drawImage(img, x, y, width, height, 0, 0, 256, 320);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  canvas.width = canvas.height = 0;
  return url;
}

function cropFromBBox(img: HTMLImageElement, bbox: unknown) {
  const box = bbox as { x?: number; y?: number; width?: number; height?: number } | null;
  const nums = [box?.x, box?.y, box?.width, box?.height].map(Number);
  if (nums.some(n => Number.isNaN(n))) return '';
  let [x, y, width, height] = nums;
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (width <= 1 && height <= 1) {
    x *= naturalWidth;
    y *= naturalHeight;
    width *= naturalWidth;
    height *= naturalHeight;
  }
  if (width < 20 || height < 20) return '';
  x = Math.max(0, x);
  y = Math.max(0, y);
  width = Math.min(width, naturalWidth - x);
  height = Math.min(height, naturalHeight - y);
  return cropBox(img, x, y, width, height);
}

async function detectFaceCrops(img: HTMLImageElement) {
  try {
    const faceapi = await import('face-api.js');
    if (!faceapi.nets.tinyFaceDetector.isLoaded) await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    const faces = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })).run();
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    return faces
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
      .map(face => {
        const box = face.box;
        const pad = box.width * 0.2;
        return cropBox(
          img,
          Math.max(0, box.x - pad),
          Math.max(0, box.y - pad),
          Math.min(naturalWidth, box.width + 2 * pad),
          Math.min(naturalHeight, box.height + 2 * pad),
        );
      });
  } catch {
    return [];
  }
}

async function detectPortraitInCell(source: HTMLCanvasElement, x: number, y: number, w: number, h: number): Promise<string> {
  const cell = document.createElement('canvas');
  cell.width = Math.max(1, Math.ceil(w));
  cell.height = Math.max(1, Math.ceil(h));
  try {
    cell.getContext('2d')!.drawImage(source, x, y, cell.width, cell.height, 0, 0, cell.width, cell.height);
    const faceapi = await import('face-api.js');
    if (!faceapi.nets.tinyFaceDetector.isLoaded) await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    let faces = await faceapi.detectAllFaces(cell, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 })).run();
    if (!faces.length) {
      faces = await faceapi.detectAllFaces(cell, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.20 })).run();
    }
    const best = faces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height))[0];
    if (best && best.box.width >= 14 && best.box.height >= 14) {
      const b = best.box;
      const padX = b.width * 0.25;
      const padY = b.height * 0.35;
      const sx = Math.max(0, b.x - padX);
      const sy = Math.max(0, b.y - padY * 0.85);
      const sw = Math.min(cell.width - sx, b.width + 2 * padX);
      const sh = Math.min(cell.height - sy, b.height + 1.85 * padY);
      const pic = document.createElement('canvas');
      pic.width = 256;
      pic.height = 320;
      pic.getContext('2d')!.drawImage(cell, sx, sy, sw, sh, 0, 0, 256, 320);
      const url = pic.toDataURL('image/jpeg', 0.88);
      pic.width = pic.height = 0;
      return url;
    }
    if (cell.width > cell.height * 1.1) {
      const zoom = document.createElement('canvas');
      zoom.width = 320;
      zoom.height = 400;
      try {
        zoom.getContext('2d')!.drawImage(
          cell,
          Math.round(cell.width * 0.02),
          Math.round(cell.height * 0.20),
          Math.round(cell.width * 0.34),
          Math.round(cell.height * 0.58),
          0,
          0,
          zoom.width,
          zoom.height
        );
        const zoomFaces = await faceapi.detectAllFaces(zoom, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.20 })).run();
        const bestZoom = zoomFaces.slice().sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height))[0];
        if (bestZoom && bestZoom.box.width >= 20 && bestZoom.box.height >= 20) {
          const b = bestZoom.box;
          const padX = b.width * 0.25;
          const padY = b.height * 0.35;
          const sx = Math.max(0, b.x - padX);
          const sy = Math.max(0, b.y - padY * 0.85);
          const sw = Math.min(zoom.width - sx, b.width + 2 * padX);
          const sh = Math.min(zoom.height - sy, b.height + 1.85 * padY);
          const pic = document.createElement('canvas');
          pic.width = 256;
          pic.height = 320;
          pic.getContext('2d')!.drawImage(zoom, sx, sy, sw, sh, 0, 0, 256, 320);
          const url = pic.toDataURL('image/jpeg', 0.88);
          pic.width = pic.height = 0;
          return url;
        }
      } finally {
        zoom.width = zoom.height = 0;
      }
    }
  } catch {
    // ignore
  } finally {
    cell.width = cell.height = 0;
  }
  return '';
}

async function attachPortraits(file: File, users: ExtractedPdfUser[], signal?: AbortSignal) {
  if (!users.length || users.every(user => typeof user.student_photo_data_url === 'string')) return users;
  const { layoutCardSheet } = await import('./pdfParser');
  const next = users.slice();
  const extractSheetPortraits = async (img: HTMLImageElement, expectedCards: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    try {
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const cols = expectedCards <= 1 ? 1 : 2;
      const rows = expectedCards <= 1 ? 1 : Math.min(6, Math.ceil(expectedCards / cols));
      const layout = cols * rows > 1
        ? layoutCardSheet(canvas, cols, rows, { forceExactGrid: true })
        : { cells: [{ x: 0, y: 0, width: canvas.width, height: canvas.height, ink: 1 }] };
      const out: string[] = [];
      for (const cell of layout.cells.slice(0, expectedCards)) {
        out.push(await detectPortraitInCell(canvas, cell.x, cell.y, cell.width, cell.height));
      }
      return out;
    } finally {
      canvas.width = canvas.height = 0;
    }
  };

  if (file.type.startsWith('image/')) {
    const img = await loadHtmlImage(await fileToDataUrl(file));
    const cellPortraits = await extractSheetPortraits(img, next.length);
    const faces = cellPortraits.some(Boolean) ? [] : await detectFaceCrops(img);
    for (let index = 0; index < next.length; index++) {
      if (typeof next[index].student_photo_data_url === 'string') continue;
      const crop = cellPortraits[index] || cropFromBBox(img, next[index].photo_bbox) || faces[index] || (next.length === 1 ? faces[0] : '');
      if (crop) next[index] = withPhoto(next[index], crop);
    }
    return next;
  }
  const renderedPages = await renderPdfPages(file, signal);
  const perPageCount = Math.max(1, Math.ceil(next.length / Math.max(1, renderedPages.length)));
  const portraits: string[] = [];
  for (const page of renderedPages) {
    if (signal?.aborted) throw abortError();
    const img = await loadHtmlImage(`data:${page.mimeType};base64,${page.data}`);
    const cellPortraits = await extractSheetPortraits(img, perPageCount);
    if (cellPortraits.some(Boolean)) portraits.push(...cellPortraits);
    else portraits.push(...await detectFaceCrops(img));
  }
  let portraitIndex = 0;
  for (let index = 0; index < next.length; index++) {
    if (typeof next[index].student_photo_data_url === 'string') continue;
    const p = portraits[portraitIndex++];
    if (p) next[index] = withPhoto(next[index], p);
  }
  return next;
}

function cardToUser(card: ImportCard, targetCategory?: string) {
  const user = normalizeUser({
    ...parseCardText(card.text),
    ...card.student,
    employee_id: card.student.admission_number,
    has_photo: Boolean(card.portrait),
    student_photo_data_url: card.portrait,
  }, 0, targetCategory);
  return card.portrait ? withPhoto(user, card.portrait) : user;
}

function fileFromDataUrl(fileData: string, fileName?: string, fileType?: string) {
  const { mimeType, base64 } = parseDataUrl(fileData, fileType);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); } catch { throw new Error('The document could not be decoded. Select it again.'); }
  return new File([bytes as unknown as BlobPart], fileName || (mimeType === 'application/pdf' ? 'id-cards.pdf' : 'id-card.jpg'), { type: mimeType });
}

function normalizeUser(raw: any, _index: number, targetCategory?: string): ExtractedPdfUser {
  let rawClass = String(raw.class || '').trim();
  let sec = String(raw.section || '').trim().toUpperCase().slice(0, 1);
  const combinedClass = rawClass.match(/^(\d+|[IVX]+)\s*[-_/\s]\s*([A-Z])$/i);
  if (combinedClass) {
    rawClass = combinedClass[1];
    sec = sec || combinedClass[2].toUpperCase();
  }
  let cls = rawClass.replace(/[^0-9IVXivx]/g, '');
  let dept = String(raw.department || '');
  const deptMatch = dept.match(/^(\d+|[IVX]+)\s*[-_/\s]\s*([A-Z])$/i);
  if ((!cls || !sec) && deptMatch) { cls = cls || deptMatch[1]; sec = sec || deptMatch[2].toUpperCase(); }
  const target = targetCategory?.match(/^(\d+|[IVX]+)[\s-]+([A-Z])$/i);
  if (target) { cls = cls || target[1]; sec = sec || target[2].toUpperCase(); }
  dept = [cls, sec].filter(Boolean).join('-');
  const studentIdKv = String(raw.student_id_kv || '').trim();
  const employeeId = String(raw.employee_id || raw.admission_no || raw.admn_no || raw.admission_number || studentIdKv || '').trim();
  return {
    name: String(raw.name || '').trim(),
    employee_id: employeeId,
    student_id: employeeId,
    student_id_kv: studentIdKv,
    class: cls,
    section: sec,
    department: dept,
    roll_number: String(raw.roll_number || '').trim(),
    position: 'Student',
    father_name: String(raw.father_name || '').trim(),
    mother_name: String(raw.mother_name || '').trim(),
    parent_name: String(raw.parent_name || raw.father_name || raw.mother_name || '').trim(),
    parent_phone: String(raw.parent_phone || raw.phone || '').replace(/\D/g, '').slice(-10),
    parent_email: String(raw.parent_email || '').trim(),
    student_email: String(raw.email || raw.student_email || '').trim(),
    phone: String(raw.student_phone || raw.parent_phone || '').replace(/\D/g, '').slice(-10),
    blood_group: String(raw.blood_group || '').replace(/^NA$/i, '').trim(),
    date_of_birth: String(raw.date_of_birth || '').trim(),
    pen_number: String(raw.pen_number || '').replace(/^NA$/i, '').trim(),
    address: String(raw.address || '').trim(),
    barcode: String(raw.barcode || '').trim(),
    has_photo: Boolean(raw.has_photo || raw.student_photo_data_url || raw.photo_url || raw.image_data),
    photo_bbox: raw.photo_bbox || null,
    student_photo_data_url: typeof raw.student_photo_data_url === 'string' ? raw.student_photo_data_url : undefined,
    photo_url: typeof raw.photo_url === 'string' ? raw.photo_url : (typeof raw.student_photo_data_url === 'string' ? raw.student_photo_data_url : undefined),
    image_data: typeof raw.image_data === 'string' ? raw.image_data : undefined,
  };
}

function parseModelJson(raw: string): any {
  const res = parseGeminiResponse(raw);
  if (res.users.length > 0) return res;
  throw new Error('Could not parse ID card data.');
}

async function generateContent(apiKey: string, parts: unknown[], signal?: AbortSignal) {
  const { text } = await callGeminiGenerateContent(apiKey, parts, signal);
  return text;
}

async function renderPdfPages(file: File, signal?: AbortSignal) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  const pdf = await loading.promise;
  if (pdf.numPages > 100) { await loading.destroy(); throw new Error('Import at most 100 pages per file. Split the PDF and retry.'); }
  const pages: { mimeType: 'image/jpeg'; data: string }[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal?.aborted) throw abortError();
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        pages.push({ mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
  } finally { await loading.destroy(); }
  return pages;
}

function mergeUsers(groups: ExtractedPdfUser[]) {
  const seen = new Set<string>();
  return groups.filter(user => {
    const key = user.employee_id.trim().toLowerCase() || `${user.name}|${user.date_of_birth}`;
    if (seen.has(key) && user.employee_id) return false;
    seen.add(key);
    return Boolean(user.name.trim() || user.employee_id.trim());
  });
}

async function extractWithGemini(file: File, targetCategory?: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<ExtractedPdfUser[]> {
  const apiKey = geminiKey();
  if (!apiKey) throw new Error('missing-key');
  const users: ExtractedPdfUser[] = [];
  const pushParsed = (raw: string) => {
    const parsed = parseModelJson(raw);
    for (const [index, user] of (Array.isArray(parsed.users) ? parsed.users : []).entries()) {
      users.push(normalizeUser(user, index, targetCategory));
    }
  };
  if (file.type.startsWith('image/')) {
    onProgress?.('Reading ID card with Gemini…');
    const { mimeType, base64 } = parseDataUrl(await fileToDataUrl(file), file.type);
    pushParsed(await generateContent(apiKey, [{ text: `${KV_PROMPT}\nExtract every student from this ID card image.` }, { inline_data: { mime_type: mimeType, data: base64 } }], signal));
    return mergeUsers(users);
  }
  if (file.size <= GEMINI_INLINE_BYTES) {
    onProgress?.('Sending the class PDF to Gemini. It never goes to Appwrite…');
    const { base64 } = parseDataUrl(await fileToDataUrl(file));
    pushParsed(await generateContent(apiKey, [{ text: `${KV_PROMPT}\nFile: ${file.name}. Extract every student ID card across all pages.` }, { inline_data: { mime_type: 'application/pdf', data: base64 } }], signal));
    if (users.length) return mergeUsers(users);
  }
  onProgress?.('Preparing PDF pages for Gemini…');
  const pages = await renderPdfPages(file, signal);
  const batchSize = 3;
  for (let start = 0; start < pages.length; start += batchSize) {
    if (signal?.aborted) throw abortError();
    const batch = pages.slice(start, start + batchSize);
    onProgress?.(`Reading pages ${start + 1}–${start + batch.length} of ${pages.length} with Gemini…`);
    const parts: unknown[] = [{ text: `${KV_PROMPT}\nThese are pages ${start + 1}–${start + batch.length} of ${pages.length}. Extract every card.` }];
    for (const page of batch) parts.push({ inline_data: { mime_type: page.mimeType, data: page.data } });
    pushParsed(await generateContent(apiKey, parts, signal));
  }
  return mergeUsers(users);
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The document could not be read. Select it again.'));
    reader.readAsDataURL(file);
  });
}

export async function extractPdfUsersFromFile(
  file: File,
  options: { targetCategory?: string; columns?: number; rows?: number; signal?: AbortSignal; onProgress?: (message: string) => void } = {},
): Promise<ExtractPdfResult> {
  if (!file.size) throw new Error('The selected document is empty.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Use a document smaller than 25 MB. Split larger PDFs into smaller batches.');
  try {
    const users = await extractWithGemini(file, options.targetCategory, options.onProgress, options.signal);
    if (users.length) {
      let withPhotos = users;
      try { withPhotos = await attachPortraits(file, users, options.signal); } catch { /* portraits are optional */ }
      return { users: withPhotos, total_extracted: withPhotos.length, class_detected: withPhotos[0]?.department || options.targetCategory };
    }
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
    if (error instanceof Error && error.message !== 'missing-key') console.warn('Gemini ID-card extraction failed; using on-device OCR.', error);
  }
  options.onProgress?.('Reading cards on this device…');
  const cards = await extractCards(file, options.columns || 0, options.rows || 0, options.onProgress || (() => {}), options.signal);
  const users = cards.map(card => cardToUser(card, options.targetCategory));
  return { users, total_extracted: users.length, class_detected: users[0]?.department || options.targetCategory, reason: users.length ? undefined : 'No readable cards were found. Try a clearer scan or choose the printed card grid.' };
}

/** Compatibility for screens that still call extract-pdf-users. Never POSTs the PDF to Appwrite. */
export async function extractPdfUsers(body: { file?: File; fileData?: unknown; fileName?: string; fileType?: string; targetCategory?: string }): Promise<ExtractPdfResult> {
  if (typeof File !== 'undefined' && body.file instanceof File) {
    return extractPdfUsersFromFile(body.file, { targetCategory: body.targetCategory });
  }
  if (typeof body.fileData !== 'string' || body.fileData.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 256) {
    throw new Error('Choose an ID-card document smaller than 25 MB.');
  }
  return extractPdfUsersFromFile(fileFromDataUrl(body.fileData, body.fileName, body.fileType), { targetCategory: body.targetCategory });
}
