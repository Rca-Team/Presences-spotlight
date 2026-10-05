import type { StudentDetails } from './types';

export type ParsedCard = StudentDetails & {
  roll_number: string; blood_group: string; pen_number: string; parent_email: string; student_id_kv: string;
};
const labels: Record<string, string> = {
  // "Father/Mother Phone:", "Parent's Contact No.", "Mobile No." — the old pattern
  // missed every card that printed both guardians on one label.
  parent_phone: '(?:(?:parent|father|mother|guardian)(?:\\s*[/&]\\s*(?:parent|father|mother|guardian))?(?:[’\x27]s)?\\s*(?:phone|mobile|contact|tel)(?:\\s*(?:no\\.?|number))?|contact(?:\\s*(?:no\\.?|number))?|mobile(?:\\s*(?:no\\.?|number))?|phone(?:\\s*(?:no\\.?|number))?|मोबाइल\\s*(?:नंबर|नम्बर))',
  father_name: "(?:father(?:['’]s)?\\s*(?:name)?|पिता(?:\\s*का)?\\s*नाम)",
  mother_name: "(?:mother(?:['’]s)?\\s*(?:name)?|माता(?:\\s*का)?\\s*नाम)",
  name: "(?:student(?:['’]s)?\\s*name|name\\s*of\\s*(?:the\\s*)?student|name|विद्यार्थी\\s*का\\s*नाम)",
  student_id_kv: '(?:student\\s*id(?:\\s*(?:no\\.?|number))?)',
  admission_number: '(?:admission\\s*(?:no\\.?|number|#)|adm[n.]?\\s*(?:no\\.?|number)|scholar\\s*(?:no\\.?|number)|प्रवेश\\s*(?:संख्या|क्रमांक))',
  class: '(?:class|grade|कक्षा)', section: '(?:section|sec\\.?)',
  parent_email: '(?:parent\\s*e-?mail)', email: '(?:(?:student\\s*)?e-?mail(?:\\s*(?:id|address))?)',
  date_of_birth: '(?:date\\s*of\\s*birth|d\\.?o\\.?b\\.?|जन्म\\s*तिथि)',
  address: '(?:(?:residential|home|postal)\\s*address|address|पता)',
  roll_number: '(?:roll\\s*(?:no\\.?|number))', blood_group: '(?:blood\\s*(?:group|type))',
  pen_number: '(?:pen(?:\\s*(?:no\\.?|number))?)',
};

/** Headings that must never be glued onto the previously matched field. */
const continuationStop = /^(?:principal|signature|valid(?:\s*upto| until)?|session|school|www\.|https?:|barcode|qrcode|office|page|student\s*id|identity)/i;
/** Barcodes and ID numbers (e.g. the strip under a card) are not address text. */
const digitOnlyLine = /^[\d\s\-–/().]{6,}$/;
/** Fields that take free prose — the only ones where a barcode/heading is junk. */
const freeTextFields = new Set(['address', 'name', 'father_name', 'mother_name']);
/** Headings that must not be mistaken for the student's name. */
const nameStop = /^(?:identity|student\s*id|student\s*identification|signature|session|class|section|date\s*of\s*birth|d\.?o\.?b\.?|father|mother|parent|guardian|address|blood\s*group|pen\s*(?:no|number)?|roll\s*(?:no|number)|admn|admission|scholar|school|house|team|barcode|principal|kendriya|pm\s*shri|shri|nfc|opposite|shift|phone|mobile|contact|office|government|govt|academic|board|examination|ph)/i;

/** Label-only parsing: preserve leading zeroes, leave missing fields empty. */
export function parseCardText(text: string): ParsedCard {
  const result = Object.fromEntries(Object.keys(labels).map(key => [key, ''])) as ParsedCard;
  const labelPattern = Object.values(labels).join('|');
  const normalized = text.normalize('NFKC').replace(/\r/g, '').replace(/[\t ]+/g, ' ')
    .replace(new RegExp(`(^|\\n| +)(${labelPattern}) *[:=]`, 'gi'), '\n$2:');
  let previous: keyof ParsedCard | null = null;
  for (const line of normalized.split('\n')) {
    let matched = false;
    for (const [key, pattern] of Object.entries(labels)) {
      const match = line.match(new RegExp(`^ *${pattern}(?: *[:=–-]+ *| +|$)(.*)$`, 'i'));
      if (!match) continue;
      previous = key as keyof ParsedCard;
      result[previous] = match[1].trim(); matched = true; break;
    }
    if (matched) continue;
    const value = line.trim();
    if (!value || !previous) continue;
    const unusable = digitOnlyLine.test(value) || continuationStop.test(value);
    if (!result[previous]) {
      // A label with no value on its own line takes the next line — unless that
      // line is a barcode or a heading, which would otherwise pollute the field.
      if (unusable && freeTextFields.has(previous)) { previous = null; continue; }
      result[previous] = value; continue;
    }
    if (previous === 'address' && !unusable) { result.address += ' ' + value; continue; }
    previous = null;
  }
  const combined = result.class.match(/^(\d+|[IVX]+)\s*[-/ ]\s*([A-Z])$/i);
  if (combined && !result.section) { result.class = combined[1]; result.section = combined[2].toUpperCase(); }
  const studentId = result.student_id_kv.match(/\d{4,}/);
  result.student_id_kv = studentId ? studentId[0] : '';
  if (!result.name.trim()) result.name = inferStudentName(text, result);
  return result;
}

/**
 * Cards such as the PM SHRI KV identity card print the student's name as a
 * caption under the photo instead of a labelled "Name:" row, so the label pass
 * comes back empty. Rank standalone lines and pick the most plausible caption.
 */
function inferStudentName(text: string, parsed: ParsedCard): string {
  const lines = text.normalize('NFKC').replace(/\r/g, '').replace(/\t/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const used = new Set(Object.values(parsed).map(v => v.trim()).filter(Boolean));
  const labelStart = new RegExp(`^(?:${Object.values(labels).join('|')})`, 'i');
  const idAnchor = lines.findIndex(l => /student\s*(?:identification\s*)?id/i.test(l));
  const word = /^[\p{L}][\p{L}'’.-]*$/u;
  const candidates: { text: string; index: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    candidates.push({ text: lines[i], index: i });
    // OCR frequently breaks a two-word caption across lines ("ADITYA" / "TOMAR").
    if (i + 1 < lines.length && word.test(lines[i]) && word.test(lines[i + 1]) && !/\d/.test(lines[i] + lines[i + 1])) {
      candidates.push({ text: `${lines[i]} ${lines[i + 1]}`, index: i });
    }
  }
  let best = '';
  let bestScore = 4; // accept nothing below 5: a caption alone is not enough evidence
  for (const { text: raw, index } of candidates) {
    const candidate = raw
      .replace(/^\d[\d\s-]{3,}\d\s+/, '')
      .replace(/\s+\d[\d\s-]{3,}\d$/, '')
      .trim();
    if (candidate.length < 3 || /\d/.test(candidate) || /[:=]/.test(candidate)) continue;
    if (used.has(candidate) || used.has(raw)) continue;
    if (labelStart.test(candidate) || nameStop.test(candidate)) continue;
    const words = candidate.split(/\s+/);
    if (words.length < 2 || words.length > 4 || !words.every(w => word.test(w))) continue;
    let score = 0;
    if (candidate === candidate.toUpperCase()) score += 3;               // photo captions are printed in caps
    else if (/^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)+$/u.test(candidate)) score += 2;
    if (words.length <= 3) score += 1;
    if (idAnchor >= 0 && index > idAnchor && index - idAnchor <= 3) score += 2; // right under "Student ID"
    if (index > 0 && /\d{6,}/.test(lines[index - 1])) score += 1;        // directly below the ID number
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

export interface PositionedText { text: string; x: number; y: number; height?: number }
export function textInRegion(items: PositionedText[], x: number, y: number, width: number, height: number): string {
  const selected = items.filter(item => item.x >= x && item.x < x + width && item.y >= y && item.y < y + height).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; tolerance: number; items: PositionedText[] }[] = [];
  for (const item of selected) {
    const last = lines.at(-1);
    if (last && Math.abs(item.y - last.y) <= last.tolerance) last.items.push(item);
    else lines.push({ y: item.y, tolerance: Math.max(3, (item.height || 10) * 0.4), items: [item] });
  }
  return lines.map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n');
}

/** Detect regularly arranged card sheets; manual grid selection remains available. */
export function detectCardGrid(items: PositionedText[], width: number, height: number) {
  const groups = [
    items.filter(i => /^(?:admission|adm[n.]?|scholar)\s*(?:no|number|#)/i.test(i.text.trim())),
    items.filter(i => /^(?:student(?:['’]s)?\s*name|name)\s*[:=]/i.test(i.text.trim())),
    items.filter(i => /^father(?:\s*\/\s*mother)?\s*name/i.test(i.text.trim())),
    items.filter(i => /^(?:date\s*of\s*birth|d\.?o\.?b\.?|mother\s*name|pen\s*(?:no|number)|blood\s*group)\s*[:=]/i.test(i.text.trim())),
  ].filter(group => group.length >= 2).sort((a, b) => b.length - a.length);
  const cluster = (values: number[], tolerance: number) => {
    const centers: number[] = [];
    for (const value of values.sort((a, b) => a - b)) if (!centers.some(c => Math.abs(c - value) < tolerance)) centers.push(value);
    return centers;
  };
  // Try anchors from the most reliable label downwards: a sheet whose OCR only
  // recovered "Father Name" rows still detects instead of falling back to 1×1.
  for (const anchors of groups) {
    const columns = cluster(anchors.map(a => a.x), width * 0.12).length;
    const rows = cluster(anchors.map(a => a.y), height * 0.055).length;
    if (columns >= 1 && rows >= 1 && columns <= 4 && rows <= 6 && columns * rows <= anchors.length + 2) return { columns, rows };
  }
  return { columns: 1, rows: 1 };
}

export interface GridCell { x: number; y: number; width: number; height: number; /** non-white pixel ratio — blank regions are skipped */ ink: number }
export interface SheetLayout { columns: number; rows: number; cells: GridCell[] }

interface SheetAnalysis {
  scale: number; w: number; h: number;
  colInk: Float32Array; rowInk: Float32Array; integral: Float32Array;
  boundsX: { start: number; end: number } | null;
  boundsY: { start: number; end: number } | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Down-sample once and measure where the ink actually is (content box + profiles). */
function analyzeSheet(source: HTMLCanvasElement): SheetAnalysis | null {
  if (source.width < 8 || source.height < 8) return null;
  const scale = Math.min(1, 260 / source.width);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const sample = document.createElement('canvas');
  sample.width = w; sample.height = h;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) { sample.width = sample.height = 0; return null; }
  let pixels: Uint8ClampedArray | undefined;
  try {
    ctx.drawImage(source, 0, 0, w, h);
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch { pixels = undefined; } finally { sample.width = sample.height = 0; }
  if (!pixels) return null;

  const ink = new Uint8Array(w * h);
  const colInk = new Float32Array(w);
  const rowInk = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dark = pixels[i + 3] > 8 && (pixels[i] < 242 || pixels[i + 1] < 242 || pixels[i + 2] < 242) ? 1 : 0;
      ink[y * w + x] = dark; row += dark; colInk[x] += dark;
    }
    rowInk[y] = row / w;
  }
  for (let x = 0; x < w; x++) colInk[x] /= h;

  // Summed-area table so each cell's coverage costs one lookup.
  const integral = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += ink[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + run;
    }
  }
  const bounds = (profile: Float32Array) => {
    let start = -1, end = -1;
    for (let i = 0; i < profile.length; i++) if (profile[i] > 0.004) { if (start < 0) start = i; end = i + 1; }
    return start >= 0 && end - start >= 8 ? { start, end } : null;
  };
  return { scale, w, h, colInk, rowInk, integral, boundsX: bounds(colInk), boundsY: bounds(rowInk) };
}

function quantile(profile: Float32Array, start: number, end: number) {
  const values: number[] = [];
  for (let i = start; i < end; i++) values.push(profile[i]);
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.75)] || 0;
}

/** Contiguous runs of printed rows/columns — one band per card row/column. */
function bands(profile: Float32Array, start: number, end: number, minGap: number) {
  const threshold = Math.max(0.004, quantile(profile, start, end) * 0.12);
  const out: { a: number; b: number }[] = [];
  let i = start;
  while (i < end) {
    while (i < end && profile[i] < threshold) i++;
    const a = i;
    while (i < end && profile[i] >= threshold) i++;
    if (i <= a) continue;
    const prev = out.at(-1);
    // A sliver thinner than a card gutter is artwork inside a card, not a gap.
    if (prev && a - prev.b < minGap) prev.b = i;
    else out.push({ a, b: i });
  }
  return out;
}

/**
 * A page holds AT MOST the requested grid. Shrink an axis when the printed
 * gutters reveal fewer card bands than asked for (a half-filled sheet), and
 * keep the request when the content bleeds across the page (invisible gutters).
 */
function fitAxis(profile: Float32Array, bounds: { start: number; end: number } | null, requested: number, pageLength: number): number {
  if (requested <= 1 || !bounds) return requested;
  const cell = (bounds.end - bounds.start) / requested;
  let found = bands(profile, bounds.start, bounds.end, Math.max(2, Math.round(cell * 0.05)));
  if (found.length === requested + 1) {
    // A printed header or footer shows up as one extra, much shorter band.
    const sizes = found.map(b => b.b - b.a);
    const smallest = sizes.indexOf(Math.min(...sizes));
    if (sizes[smallest] < cell * 0.5) found = found.filter((_, index) => index !== smallest);
  }
  if (found.length >= requested) return requested;
  if (found.length <= 1) {
    // Content covering (nearly) the whole page is a sheet whose gutters are not
    // visible; a small centred box is a single card printed on the page.
    return (bounds.end - bounds.start) / Math.max(1, pageLength) >= 0.85 ? requested : 1;
  }
  return found.length;
}

/** Cut positions for one axis: [start, …, end] in sampled pixels. */
function axisCuts(profile: Float32Array, bounds: { start: number; end: number }, count: number): number[] {
  const cell = (bounds.end - bounds.start) / count;
  const gutter = bands(profile, bounds.start, bounds.end, Math.max(2, Math.round(cell * 0.05)));
  if (gutter.length === count) return [...gutter.map(b => b.a), bounds.end];
  // Even splits, each slid onto the whitest pixel in its neighbourhood.
  const window = Math.max(2, Math.round(cell / 3));
  const cuts = [bounds.start];
  for (let i = 1; i < count; i++) {
    const ideal = clamp(Math.round(bounds.start + i * cell), bounds.start, bounds.end);
    let best = ideal, bestVal = Infinity;
    for (let p = clamp(ideal - window, bounds.start, bounds.end); p <= clamp(ideal + window, bounds.start, bounds.end); p++) {
      if (profile[p] < bestVal) { bestVal = profile[p]; best = p; }
    }
    cuts.push(bestVal <= 0.03 || bestVal <= profile[ideal] * 0.4 ? best : ideal);
  }
  cuts.push(bounds.end);
  return cuts;
}

/**
 * Cut a card sheet into cells on the printed content box and the white gutters
 * between cards, so page margins, headers or footers never slice a card in
 * half. Returns the grid that was actually used — a page may hold fewer cards
 * than the maximum that was requested (e.g. 2×2 on a 2×4 sheet).
 */
export function layoutCardSheet(source: HTMLCanvasElement, columns: number, rows: number): SheetLayout {
  const equalFallback = (): SheetLayout => {
    const cells: GridCell[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const x = Math.round(c * source.width / columns), y = Math.round(r * source.height / rows);
      cells.push({ x, y, width: Math.round((c + 1) * source.width / columns) - x, height: Math.round((r + 1) * source.height / rows) - y, ink: 1 });
    }
    return { columns, rows, cells };
  };
  if (columns < 1 || rows < 1) return equalFallback();
  const analysis = analyzeSheet(source);
  if (!analysis) return equalFallback();
  const { scale, w, h, colInk, rowInk, integral, boundsX, boundsY } = analysis;
  if (!boundsX || !boundsY) return equalFallback();

  const fittedColumns = fitAxis(colInk, boundsX, columns, analysis.w);
  const fittedRows = fitAxis(rowInk, boundsY, rows, analysis.h);
  const xs = axisCuts(colInk, boundsX, fittedColumns).map(cut => Math.round(cut / scale));
  const ys = axisCuts(rowInk, boundsY, fittedRows).map(cut => Math.round(cut / scale));

  const cells: GridCell[] = [];
  for (let r = 0; r < fittedRows; r++) for (let c = 0; c < fittedColumns; c++) {
    const x0 = clamp(xs[c], 0, source.width), y0 = clamp(ys[r], 0, source.height);
    const x1 = clamp(xs[c + 1], x0 + 1, source.width), y1 = clamp(ys[r + 1], y0 + 1, source.height);
    const sx0 = clamp(Math.round(x0 / scale), 0, w), sx1 = clamp(Math.max(sx0 + 1, Math.round(x1 / scale)), 1, w);
    const sy0 = clamp(Math.round(y0 / scale), 0, h), sy1 = clamp(Math.max(sy0 + 1, Math.round(y1 / scale)), 1, h);
    const area = (sx1 - sx0) * (sy1 - sy0);
    const sum = integral[sy1 * (w + 1) + sx1] - integral[sy0 * (w + 1) + sx1] - integral[sy1 * (w + 1) + sx0] + integral[sy0 * (w + 1) + sx0];
    cells.push({ x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), ink: area > 0 ? sum / area : 0 });
  }
  return { columns: fittedColumns, rows: fittedRows, cells };
}
