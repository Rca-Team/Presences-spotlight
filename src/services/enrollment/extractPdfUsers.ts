import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractCards, MAX_DOCUMENT_BYTES } from './pdfImport';
import { parseCardText } from './pdfParser';
import type { ImportCard } from './types';

const GEMINI_INLINE_BYTES = 8 * 1024 * 1024;
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const KV_PROMPT = `You are an expert extractor for PM SHRI Kendriya Vidyalaya student identity cards.

Each card typically includes: school header, student photo, student name, Father Name, Mother Name, Date of Birth, Class and section (format as class "6" and section "A"), Admn No (this is employee_id), PEN No, Blood Group, Father/Mother Phone, Address, optional barcode and 10-digit student ID.

Scan every page and extract every card. Return JSON only:
{"class_detected":"6-A","total_extracted":N,"users":[{
  "name":"","employee_id":"","student_id_kv":"","class":"","section":"","department":"6-A",
  "roll_number":"","father_name":"","mother_name":"","parent_name":"","parent_phone":"",
  "date_of_birth":"","pen_number":"","blood_group":"","address":"","barcode":"","has_photo":true,
  "photo_bbox":{"x":0.05,"y":0.25,"width":0.22,"height":0.38}
}]}`;

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
  return (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || (typeof localStorage !== 'undefined' ? localStorage.getItem('gemini_api_key') : '') || '').trim();
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

async function attachPortraits(file: File, users: ExtractedPdfUser[], signal?: AbortSignal) {
  if (!users.length || users.every(user => typeof user.student_photo_data_url === 'string')) return users;
  const next = users.slice();
  if (file.type.startsWith('image/')) {
    const img = await loadHtmlImage(await fileToDataUrl(file));
    const faces = await detectFaceCrops(img);
    for (let index = 0; index < next.length; index++) {
      if (typeof next[index].student_photo_data_url === 'string') continue;
      const crop = cropFromBBox(img, next[index].photo_bbox) || faces[index] || (next.length === 1 ? faces[0] : '');
      if (crop) next[index] = withPhoto(next[index], crop);
    }
    return next;
  }
  const portraits: string[] = [];
  for (const page of await renderPdfPages(file, signal)) {
    if (signal?.aborted) throw abortError();
    portraits.push(...await detectFaceCrops(await loadHtmlImage(`data:${page.mimeType};base64,${page.data}`)));
  }
  let portraitIndex = 0;
  for (let index = 0; index < next.length; index++) {
    if (typeof next[index].student_photo_data_url === 'string') continue;
    if (portraits[portraitIndex]) next[index] = withPhoto(next[index], portraits[portraitIndex++]);
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
  return new File([bytes], fileName || (mimeType === 'application/pdf' ? 'id-cards.pdf' : 'id-card.jpg'), { type: mimeType });
}

function normalizeUser(raw: any, _index: number, targetCategory?: string): ExtractedPdfUser {
  let cls = String(raw.class || '').replace(/[^0-9IVXivx]/g, '');
  let sec = String(raw.section || '').trim().toUpperCase().slice(0, 1);
  let dept = String(raw.department || '');
  const deptMatch = dept.match(/^(\d+|[IVX]+)\s*[-_/\s]\s*([A-Z])$/i);
  if ((!cls || !sec) && deptMatch) { cls = cls || deptMatch[1]; sec = sec || deptMatch[2].toUpperCase(); }
  const target = targetCategory?.match(/^(\d+|[IVX]+)[\s-]+([A-Z])$/i);
  if (target) { cls = cls || target[1]; sec = sec || target[2].toUpperCase(); }
  dept = [cls, sec].filter(Boolean).join('-');
  const employeeId = String(raw.employee_id || raw.admission_no || raw.admn_no || raw.admission_number || '').trim();
  return {
    name: String(raw.name || '').trim(),
    employee_id: employeeId,
    student_id: employeeId,
    student_id_kv: String(raw.student_id_kv || '').trim(),
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
    blood_group: String(raw.blood_group || '').trim(),
    date_of_birth: String(raw.date_of_birth || '').trim(),
    pen_number: String(raw.pen_number || '').trim(),
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
  let cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  const object = cleaned.match(/\{[\s\S]*\}/);
  if (object) return JSON.parse(object[0]);
  const array = cleaned.match(/\[[\s\S]*\]/);
  if (array) return { users: JSON.parse(array[0]) };
  throw new Error('Could not parse ID card data.');
}

async function generateContent(apiKey: string, parts: unknown[], signal?: AbortSignal) {
  let lastError = 'Gemini did not return ID card data.';
  for (const model of MODELS) {
    if (signal?.aborted) throw abortError();
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.1, max_output_tokens: 32768 },
        }),
      });
      if (!response.ok) { lastError = await response.text(); continue; }
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text as string;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError.slice(0, 280));
}

async function renderPdfPages(file: File, signal?: AbortSignal) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  const pdf = await loading.promise;
  if (pdf.numPages > 30) { await loading.destroy(); throw new Error('Import at most 30 pages per batch. Split the PDF and retry.'); }
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
