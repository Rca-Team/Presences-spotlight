import { parseCardText, type ParsedCard } from './pdfParser';
import type { ImportCard } from './types';

export interface MhtExtractOptions {
  columns?: number;
  rows?: number;
  signal?: AbortSignal;
  progress?: (message: string, percent: number) => void;
  onCard?: (card: ImportCard) => void;
}

interface MimePart {
  contentType: string;
  encoding: string;
  location: string;
  contentId: string;
  body: string;
}

function abortError() {
  return new DOMException('Extraction cancelled.', 'AbortError');
}

/** Decode RFC 2045 Quoted-Printable string into UTF-8 text. */
export function decodeQuotedPrintableText(input: string): string {
  // Remove soft line breaks
  const stripped = input.replace(/=[ \t]*\r?\n/g, '');
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let i = 0;
  while (i < stripped.length) {
    if (stripped[i] === '=' && i + 2 < stripped.length && /^[0-9A-Fa-f]{2}$/.test(stripped.slice(i + 1, i + 3))) {
      bytes.push(parseInt(stripped.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const code = stripped.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        for (const b of encoder.encode(stripped[i])) bytes.push(b);
      }
      i++;
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

/** Decode Quoted-Printable binary body to base64. */
function quotedPrintableToBase64(input: string): string {
  const stripped = input.replace(/=[ \t]*\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '=' && i + 2 < stripped.length && /^[0-9A-Fa-f]{2}$/.test(stripped.slice(i + 1, i + 3))) {
      bytes.push(parseInt(stripped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(stripped.charCodeAt(i) & 0xff);
    }
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function decodeBase64Text(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    if (typeof atob === 'function') {
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return Buffer.from(clean, 'base64').toString('utf8');
  } catch {
    return input;
  }
}

function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/^['"<]+|['">]+$/g, '')
    .replace(/^cid:/i, '')
    .replace(/\\/g, '/');
}

function basenameRef(ref: string): string {
  const norm = normalizeRef(ref).split(/[?#]/)[0];
  const parts = norm.split('/').filter(Boolean);
  return (parts.at(-1) || norm).toLowerCase();
}

/** Parse a MIME multipart/related (.mht / .mhtml) document into its constituent parts. */
export function parseMhtParts(rawText: string): { htmlParts: string[]; images: Map<string, string>; imageList: string[]; pdfBase64List: string[] } {
  const htmlParts: string[] = [];
  const images = new Map<string, string>();
  const imageList: string[] = [];
  const pdfBase64List: string[] = [];

  // Detect boundary from Content-Type header or first --boundary line
  const boundaryMatch =
    rawText.match(/boundary\s*=\s*"([^"]+)"/i) ||
    rawText.match(/boundary\s*=\s*([^\s;]+)/i);
  let boundary = boundaryMatch?.[1]?.trim();

  if (!boundary) {
    const candidateLine = rawText.match(/^(--[^\r\n]{8,80})\r?\n/m);
    if (candidateLine) boundary = candidateLine[1].slice(2);
  }

  const registerImage = (mime: string, base64: string, location: string, cid: string) => {
    const cleanB64 = base64.replace(/\s+/g, '');
    if (cleanB64.length < 64) return;
    const dataUrl = `data:${mime};base64,${cleanB64}`;
    imageList.push(dataUrl);
    if (location) {
      const norm = normalizeRef(location);
      images.set(norm, dataUrl);
      images.set(norm.toLowerCase(), dataUrl);
      const base = basenameRef(norm);
      if (base) images.set(base, dataUrl);
    }
    if (cid) {
      const normCid = normalizeRef(cid);
      images.set(normCid, dataUrl);
      images.set(normCid.toLowerCase(), dataUrl);
      images.set(`cid:${normCid}`, dataUrl);
      images.set(`cid:${normCid.toLowerCase()}`, dataUrl);
    }
  };

  if (!boundary) {
    // Single-part MHT or raw HTML file
    const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(rawText.slice(0, 2000)) || /=3D|=\r?\n/i.test(rawText);
    const bodyStart = rawText.search(/<!DOCTYPE|<html|<head|<body|<table|<div/i);
    const content = bodyStart >= 0 ? rawText.slice(bodyStart) : rawText;
    htmlParts.push(isQP ? decodeQuotedPrintableText(content) : content);
    return { htmlParts, images, imageList, pdfBase64List };
  }

  const rawSegments = rawText.split(`--${boundary}`);
  // Skip preamble (index 0) and epilogue (-- at start)
  for (let idx = 1; idx < rawSegments.length; idx++) {
    const seg = rawSegments[idx];
    if (seg.startsWith('--')) break;
    const headerEndMatch = seg.match(/\r?\n\r?\n/);
    if (!headerEndMatch || headerEndMatch.index === undefined) continue;
    const headerBlock = seg.slice(0, headerEndMatch.index).replace(/\r?\n[ \t]+/g, ' ');
    const body = seg.slice(headerEndMatch.index + headerEndMatch[0].length);

    const ctMatch = headerBlock.match(/Content-Type:\s*([^\r\n;]+)/i);
    const contentType = (ctMatch?.[1] || 'text/plain').trim().toLowerCase();
    const cteMatch = headerBlock.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i);
    const encoding = (cteMatch?.[1] || '7bit').trim().toLowerCase();
    const locMatch = headerBlock.match(/Content-Location:\s*([^\r\n]+)/i);
    const location = (locMatch?.[1] || '').trim();
    const cidMatch = headerBlock.match(/Content-ID:\s*([^\r\n]+)/i);
    const contentId = (cidMatch?.[1] || '').trim();

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      let decoded = body;
      if (encoding === 'quoted-printable') decoded = decodeQuotedPrintableText(body);
      else if (encoding === 'base64') decoded = decodeBase64Text(body);
      htmlParts.push(decoded);
    } else if (contentType.startsWith('image/')) {
      let b64 = '';
      if (encoding === 'base64') b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
      else if (encoding === 'quoted-printable') b64 = quotedPrintableToBase64(body);
      if (b64) registerImage(contentType, b64, location, contentId);
    } else if (contentType === 'application/pdf') {
      const b64 = encoding === 'base64' ? body.replace(/[^A-Za-z0-9+/=]/g, '') : quotedPrintableToBase64(body);
      if (b64) pdfBase64List.push(b64);
    }
  }

  return { htmlParts, images, imageList, pdfBase64List };
}

/** Convert an HTML element into clean line-oriented text for parseCardText. */
export function elementToStructuredText(root: Element): string {
  const lines: string[] = [];

  // 1. Extract table rows explicitly so adjacent <td>Label</td><td>Value</td> cells stay paired on one line
  const rows = Array.from(root.querySelectorAll('tr'));
  if (rows.length > 0) {
    for (const tr of rows) {
      // Skip outer layout rows that themselves contain nested tables
      if (tr.querySelector('table')) continue;
      const cells = Array.from(tr.querySelectorAll(':scope > th, :scope > td'))
        .map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (!cells.length) continue;
      if (cells.length === 2 && !cells[0].includes(':') && !cells[1].startsWith(':')) {
        lines.push(`${cells[0]}: ${cells[1]}`);
      } else if (cells.length >= 3 && /^[:=–-]$/.test(cells[1])) {
        lines.push(`${cells[0]}: ${cells.slice(2).join(' ')}`);
      } else {
        lines.push(cells.join(' '));
      }
    }
  }

  // 2. Also walk block/line nodes to capture headers, captions under photos, and non-table layouts
  const blockTags = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BR', 'SECTION', 'ARTICLE', 'HEADER', 'FIGCAPTION']);
  let buffer = '';
  const flush = () => {
    const clean = buffer.replace(/\s+/g, ' ').trim();
    if (clean) lines.push(clean);
    buffer = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += ' ' + (node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    if (tag === 'BR') {
      flush();
      return;
    }
    const isBlock = blockTags.has(tag);
    if (isBlock) flush();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (isBlock) flush();
  };

  walk(root);
  flush();

  // Deduplicate consecutive identical lines while preserving order
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.at(-1) !== line) deduped.push(line);
  }
  return deduped.join('\n');
}

function hasCardIdentity(parsed: ParsedCard): boolean {
  const id = parsed.admission_number || parsed.student_id_kv || parsed.roll_number || parsed.pen_number;
  if (parsed.name && id) return true;
  if (parsed.name && (parsed.class || parsed.father_name || parsed.mother_name || parsed.date_of_birth || parsed.parent_phone)) return true;
  if (id && (parsed.class || parsed.father_name || parsed.mother_name || parsed.date_of_birth || parsed.parent_phone)) return true;
  return false;
}

/** Render a clean visual ID-card preview thumbnail onto a canvas for review in the UI. */
async function renderCardPreviewDataUrl(student: ParsedCard, portraitUrl?: string): Promise<string> {
  if (typeof document === 'undefined') return portraitUrl || '';
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return portraitUrl || '';

  try {
    // Card background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Header bar
    ctx.fillStyle = '#059669';
    ctx.fillRect(0, 0, canvas.width, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('STUDENT IDENTITY CARD', 14, 23);

    // Draw portrait if available
    if (portraitUrl) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('image load failed'));
          i.src = portraitUrl;
        });
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(14, 48, 96, 120);
        ctx.drawImage(img, 14, 48, 96, 120);
      } catch {
        // Fallback placeholder box
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(14, 48, 96, 120);
      }
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(14, 48, 96, 120);
    }

    // Student fields
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText((student.name || 'Student').slice(0, 28), 124, 66);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    const rows = [
      ['Admn / ID', student.admission_number || student.student_id_kv || '-'],
      ['Class', [student.class, student.section].filter(Boolean).join('-') || '-'],
      ['Father', student.father_name || '-'],
      ['DOB', student.date_of_birth || '-'],
      ['Phone', student.parent_phone || '-'],
      ['Blood Grp', student.blood_group || '-'],
    ];
    rows.forEach(([label, val], idx) => {
      const y = 90 + idx * 24;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${label}:`, 124, y);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(String(val).slice(0, 26), 195, y);
    });

    return canvas.toDataURL('image/jpeg', 0.78);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Extract student ID cards from an .mht / .mhtml / .html file. */
export async function extractMhtCards(file: File, options: MhtExtractOptions = {}): Promise<ImportCard[]> {
  const check = () => { if (options.signal?.aborted) throw abortError(); };
  check();
  options.progress?.(`Reading ${file.name}…`, 5);

  const rawText = await file.text();
  check();

  // If the file is actually a PDF saved with .mht extension, delegate to pdfImport
  if (rawText.startsWith('%PDF-')) {
    const { extractCards } = await import('./pdfImport');
    const pdfFile = new File([await file.arrayBuffer()], file.name.replace(/\.mht(ml)?$/i, '.pdf'), { type: 'application/pdf' });
    return extractCards(pdfFile, options.columns || 0, options.rows || 0, msg => options.progress?.(msg, 50), options.signal, {
      onCard: options.onCard,
    });
  }

  const { htmlParts, images, imageList, pdfBase64List } = parseMhtParts(rawText);
  const cards: ImportCard[] = [];

  // 1. If the MHT archive embeds PDF parts, extract them
  if (pdfBase64List.length > 0) {
    const { extractCards } = await import('./pdfImport');
    for (let i = 0; i < pdfBase64List.length; i++) {
      check();
      const binary = typeof atob === 'function' ? atob(pdfBase64List[i]) : Buffer.from(pdfBase64List[i], 'base64').toString('binary');
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
      const pdfFile = new File([bytes], `${file.name}-part-${i + 1}.pdf`, { type: 'application/pdf' });
      const extracted = await extractCards(pdfFile, options.columns || 0, options.rows || 0, msg => options.progress?.(msg, 50), options.signal, {
        onCard: options.onCard,
      });
      cards.push(...extracted);
    }
    if (cards.length > 0) return cards;
  }

  // 2. Parse HTML parts and extract structured student ID cards
  if (typeof DOMParser !== 'undefined' && htmlParts.length > 0) {
    const parser = new DOMParser();

    for (const html of htmlParts) {
      check();
      const doc = parser.parseFromString(html, 'text/html');

      // Resolve all <img src="..."> to embedded data URLs
      const resolveImgSrc = (rawSrc: string): string => {
        if (!rawSrc) return '';
        const trimmed = rawSrc.trim();
        if (trimmed.startsWith('data:image/')) return trimmed;
        const norm = normalizeRef(trimmed);
        return (
          images.get(norm) ||
          images.get(norm.toLowerCase()) ||
          images.get(basenameRef(norm)) ||
          ''
        );
      };

      for (const img of Array.from(doc.querySelectorAll('img'))) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const resolved = resolveImgSrc(src);
        if (resolved) img.setAttribute('src', resolved);
      }

      // Count how many times each image URL appears across the document so we can
      // distinguish unique student photos from repeated school logos / signatures.
      const imgFrequency = new Map<string, number>();
      for (const img of Array.from(doc.querySelectorAll('img'))) {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          imgFrequency.set(src, (imgFrequency.get(src) || 0) + 1);
        }
      }

      // Recursive DOM walker to isolate individual student card containers
      const cardContainers: Element[] = [];
      const collectCards = (el: Element): number => {
        let childCardCount = 0;
        for (const child of Array.from(el.children)) {
          childCardCount += collectCards(child);
        }
        if (childCardCount > 0) return childCardCount;

        const text = elementToStructuredText(el);
        if (text.length < 20 || text.length > 4000) return 0;
        const parsed = parseCardText(text);
        if (hasCardIdentity(parsed)) {
          cardContainers.push(el);
          return 1;
        }
        return 0;
      };

      if (doc.body) collectCards(doc.body);

      const totalFound = cardContainers.length;
      for (let idx = 0; idx < totalFound; idx++) {
        check();
        if (cards.length >= 1000) break;
        const container = cardContainers[idx];
        const text = elementToStructuredText(container);
        const student = parseCardText(text);
        if (!student.admission_number && (student.student_id_kv || student.roll_number || student.pen_number)) {
          student.admission_number = student.student_id_kv || student.roll_number || student.pen_number;
          student.employee_id = student.admission_number;
        }
        if (!student.name && !student.admission_number) continue;

        // Find the student's portrait image inside this card container
        const candidateImgs = Array.from(container.querySelectorAll('img'))
          .map(img => ({
            src: img.getAttribute('src') || '',
            alt: (img.getAttribute('alt') || img.getAttribute('class') || img.getAttribute('id') || '').toLowerCase(),
          }))
          .filter(item => item.src.startsWith('data:image/') && item.src.length > 400 && !/barcode|qr|logo|sign|seal/i.test(item.alt));

        // Prefer images that are unique to this card (frequency <= 2) or explicitly tagged as photo/student
        candidateImgs.sort((a, b) => {
          const aPhoto = /photo|student|pupil|profile|pic/i.test(a.alt) ? 0 : 1;
          const bPhoto = /photo|student|pupil|profile|pic/i.test(b.alt) ? 0 : 1;
          if (aPhoto !== bPhoto) return aPhoto - bPhoto;
          const freqA = imgFrequency.get(a.src) || 1;
          const freqB = imgFrequency.get(b.src) || 1;
          return freqA - freqB;
        });

        let portrait: string | undefined = candidateImgs[0]?.src;
        // If multiple cards share the image (e.g. a school logo and no student photo), don't mistake the school logo for the student's portrait
        if (portrait && totalFound >= 3 && (imgFrequency.get(portrait) || 0) >= totalFound) {
          portrait = undefined;
        }

        const pageNumber = Math.min(100, Math.floor(idx / 8) + 1);
        const preview = await renderCardPreviewDataUrl(student, portrait);
        const card: ImportCard = {
          id: crypto.randomUUID(),
          student,
          page: pageNumber,
          text,
          preview,
          portrait,
        };
        cards.push(card);
        options.onCard?.(card);
        options.progress?.(
          `${cards.length} cards extracted from ${file.name}…`,
          Math.round(((idx + 1) / totalFound) * 100)
        );
      }
    }
  }

  // 3. Fallback: if the MHT HTML had no structured text cards but contains embedded card/page images,
  // run the image OCR / grid extractor on the embedded images (up to 100 images).
  if (cards.length === 0 && imageList.length > 0) {
    const { extractCards } = await import('./pdfImport');
    const maxImages = Math.min(100, imageList.length);
    for (let i = 0; i < maxImages; i++) {
      check();
      const dataUrl = imageList[i];
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) continue;
      const [, mime, b64] = match;
      // Skip tiny icon images (< 2 KB)
      if (b64.length < 2800) continue;
      const binary = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
      const ext = mime.split('/')[1] || 'jpg';
      const imgFile = new File([bytes], `mht-page-${i + 1}.${ext}`, { type: mime });
      const extracted = await extractCards(
        imgFile,
        options.columns || 0,
        options.rows || 0,
        msg => options.progress?.(`${msg} (image ${i + 1}/${maxImages})`, Math.round(((i + 1) / maxImages) * 100)),
        options.signal
      );
      for (const lc of extracted) {
        const card = { ...lc, page: i + 1 };
        cards.push(card);
        options.onCard?.(card);
      }
    }
  }

  return cards;
}
