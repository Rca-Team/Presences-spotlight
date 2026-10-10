import type { StudentDetails } from './types';

export type ParsedCard = StudentDetails & {
  roll_number: string;
  blood_group: string;
  pen_number: string;
  parent_email: string;
  student_id_kv: string;
  employee_id?: string;
  phone?: string;
  department?: string;
};
interface LabelDef {
  key: keyof ParsedCard | 'class_and_sec' | 'guardian_name';
  pattern: RegExp;
  priority: number;
}

const LABEL_DEFS: LabelDef[] = [
  // Compound labels (highest priority to prevent accidental partial capture)
  { key: 'class_and_sec', pattern: /\b(?:class\s*(?:&|\/|and|-)\s*sec(?:tion)?|class\s*sec(?:tion)?)\b/i, priority: 100 },
  { key: 'guardian_name', pattern: /\b(?:father\s*[\/&]\s*mother\s*name|parent(?:['’]s)?\s*name|guardian(?:['’]s)?\s*name)\b/i, priority: 95 },

  // Specific single fields
  { key: 'parent_phone', pattern: /\b(?:(?:parent|father|mother|guardian)(?:['’]s)?\s*(?:phone|mob(?:ile)?|contact|tel|whatsapp)(?:\s*(?:no\.?|num(?:ber)?|#))?|father['’]s\s*mob\.?|mother['’]s\s*mob\.?|mob(?:ile)?\s*(?:no\.?|num(?:ber)?|#)|contact\s*(?:no\.?|num(?:ber)?|#)|phone\s*(?:no\.?|num(?:ber)?|#)|tel\s*(?:no\.?|num(?:ber)?|#)|whatsapp\s*(?:no\.?|num(?:ber)?|#)|मोबाइल\s*(?:नंबर|नम्बर|नं\.?))\b/i, priority: 90 },
  { key: 'father_name', pattern: /\b(?:father(?:['’]s)?\s*name|f\.?\s*name|पिता(?: का)?\s*नाम)\b/i, priority: 85 },
  { key: 'mother_name', pattern: /\b(?:mother(?:['’]s)?\s*name|m\.?\s*name|माता(?: का)?\s*नाम)\b/i, priority: 85 },
  { key: 'student_id_kv', pattern: /\b(?:(?:student|pupil|kv|ubi)\s*(?:identification\s*)?id(?:\s*(?:no\.?|num(?:ber)?|#))?|ubi\s*id(?:\s*(?:no\.?|num(?:ber)?|#))?|kv\s*id(?:\s*(?:no\.?|num(?:ber)?|#))?|student\s*unique\s*id|identity\s*no\.?)\b/i, priority: 80 },
  { key: 'admission_number', pattern: /\b(?:admission\s*(?:no\.?|num(?:ber)?|#)|admn?\.?\s*(?:no\.?|num(?:ber)?|#)|adm\b|scholar\s*(?:no\.?|num(?:ber)?|#)|s\.?r\.?\s*(?:no\.?|num(?:ber)?|#)|reg(?:n|istration)?\.?\s*(?:no\.?|num(?:ber)?|#)|प्रवेश\s*(?:संख्या|क्रमांक))\b/i, priority: 75 },
  { key: 'name', pattern: /\b(?:(?:student|pupil|candidate)(?:['’]s)?\s*name|name\s*of\s*(?:the\s*)?(?:student|pupil|candidate)|name\b|विद्यार्थी\s*का\s*नाम|छात्र(?: का)?\s*नाम)\b/i, priority: 70 },
  { key: 'roll_number', pattern: /\b(?:roll(?:\s*(?:no\.?|num(?:ber)?|#))?|r\.?\s*no\.?|क्रमांक|रोल\s*(?:नंबर|नं)?)\b/i, priority: 65 },
  { key: 'blood_group', pattern: /\b(?:blood\s*(?:group|grp\.?|type)|b\.?\s*g\.?|b\.?\s*grp\.?|रक्त\s*समूह)\b/i, priority: 65 },
  { key: 'date_of_birth', pattern: /\b(?:date\s*of\s*birth|d\.?o\.?b\.?|birth\s*date|जन्म\s*तिथि)\b/i, priority: 65 },
  { key: 'pen_number', pattern: /\b(?:pen(?:\s*(?:no\.?|num(?:ber)?|#))?|p\.?e\.?n\.?(?:\s*(?:no\.?|num(?:ber)?|#))?|permanent\s*edu(?:cation)?\s*(?:no\.?|number))\b/i, priority: 65 },
  { key: 'class', pattern: /\b(?:class\b|grade\b|std\.?\b|standard\b|कक्षा)\b/i, priority: 60 },
  { key: 'section', pattern: /\b(?:sec(?:tion)?\.?\b|वर्ग|अनुभाग)\b/i, priority: 60 },
  { key: 'parent_email', pattern: /\b(?:parent\s*e-?mail(?:\s*(?:id|address))?)\b/i, priority: 50 },
  { key: 'email', pattern: /\b(?:(?:student\s*)?e-?mail(?:\s*(?:id|address))?)\b/i, priority: 45 },

  // Generic fallbacks
  { key: 'parent_phone', pattern: /\b(?:mob(?:ile)?|phone|contact|tel)\b/i, priority: 30 },
  { key: 'address', pattern: /\b(?:(?:residential|present|perm(?:anent)?|home|postal|res\.?)\s*address|address\b|पता)\b/i, priority: 25 },
];

const continuationStop = /^(?:principal|signature|valid(?:\s*upto| until)?|session|school|www\.|https?:|barcode|qrcode|office|page|student\s*id|identity)/i;
const digitOnlyLine = /^[\d\s\-–/().]{6,}$/;
const nameStop = /^(?:identity|student\s*id|student\s*identification|signature|session|class|section|date\s*of\s*birth|d\.?o\.?b\.?|father|mother|parent|guardian|address|blood\s*group|pen\s*(?:no|number)?|roll\s*(?:no|number)|admn?|admission|scholar|school|house|team|barcode|principal|kendriya|pm\s*shri|shri|nfc|opposite|shift|phone|mobile|contact|office|government|govt|academic|board|examination|ph|res\.)/i;

const CLASS_PATTERN = '(?:1[0-2]|[1-9]|VIII|VII|XII|XI|VI|IV|IX|III|II|I|X|NURSERY|KG|LKG|UKG)';

function cleanSalutations(val: string): string {
  if (!val) return '';
  return val.replace(/\b(?:mr|mrs|ms|miss|shri|smt|dr|late|master|baby)\.?\s+/gi, '')
    .replace(/^[:=–#\s.-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAdmissionNumber(val: string): string {
  if (!val) return '';
  return val.replace(/^[:=–#\s.-]+/, '')
    .replace(/\s*(?:d\.?o\.?b|dob|class|roll|blood|pen|father|mother|mob|phone).*$/i, '')
    .replace(/^no\.?\s*/i, '')
    .trim();
}

function cleanBloodGroup(val: string): string {
  if (!val) return '';
  const m = val.match(/\b(A|B|AB|O)\s*([+-]|(?:\+|-)?\s*ve)\b/i);
  if (m) {
    const type = m[1].toUpperCase();
    const sign = m[2].toLowerCase().includes('-') ? '-' : '+';
    return `${type}${sign}`;
  }
  return val.replace(/^[:=–#\s.-]+/, '').toUpperCase().replace(/\s+/g, '');
}

function cleanSection(val: string): string {
  if (!val) return '';
  const m = val.replace(/^[:=–#\s.-]+/, '').trim().match(/^([A-Za-z])/);
  return m ? m[1].toUpperCase() : '';
}

function cleanClass(val: string): string {
  if (!val) return '';
  const cleaned = val.replace(/^[:=–#\s.-]+/, '').replace(/^class\s*/i, '').trim();
  const m = cleaned.match(new RegExp(`^(${CLASS_PATTERN})(?:st|nd|rd|th)?`, 'i'));
  return m ? m[1].toUpperCase() : cleaned;
}

function cleanPhone(val: string): string {
  if (!val) return '';
  const digits = val.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function cleanDateOfBirth(val: string): string {
  if (!val) return '';
  const m = val.match(/\b([0-3]?\d)[\/.-]([0-1]?\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\/.-]((?:19|20)\d{2})\b/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    let month = m[2];
    const year = m[3];
    const monthNames: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    if (isNaN(Number(month))) {
      month = monthNames[month.slice(0, 3).toLowerCase()] || '01';
    } else {
      month = month.padStart(2, '0');
    }
    return `${day}/${month}/${year}`;
  }
  return val.trim();
}

function parseClassAndSec(val: string): { class: string; section: string } {
  if (!val) return { class: '', section: '' };
  const m = val.match(new RegExp(`^(${CLASS_PATTERN})(?:st|nd|rd|th)?[\\s\\/-]+([A-Z])(?:\\b.*)?$`, 'i'));
  if (m) {
    return { class: m[1].toUpperCase(), section: m[2].toUpperCase() };
  }
  return { class: val.trim(), section: '' };
}

function splitLineByLabels(line: string): { key: LabelDef['key']; value: string }[] {
  const matches: { key: LabelDef['key']; start: number; end: number; priority: number; text: string }[] = [];
  for (const def of LABEL_DEFS) {
    const rx = new RegExp(def.pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = rx.exec(line)) !== null) {
      matches.push({
        key: def.key,
        start: match.index,
        end: match.index + match[0].length,
        priority: def.priority,
        text: match[0],
      });
    }
  }

  // Filter overlapping matches: prefer higher priority, then longer span
  const filtered: typeof matches = [];
  matches.sort((a, b) => a.start - b.start || b.priority - a.priority || (b.end - b.start) - (a.end - a.start));
  for (const m of matches) {
    const overlaps = filtered.some(existing => (m.start < existing.end && m.end > existing.start));
    if (!overlaps) {
      filtered.push(m);
    }
  }

  filtered.sort((a, b) => a.start - b.start);
  if (!filtered.length) return [];

  const segments: { key: LabelDef['key']; value: string }[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const curr = filtered[i];
    const valStart = curr.end;
    const valEnd = (i + 1 < filtered.length) ? filtered[i + 1].start : line.length;
    let value = line.substring(valStart, valEnd).trim();
    value = value.replace(/^[:=–#\s.-]+/, '').trim();
    segments.push({ key: curr.key, value });
  }
  return segments;
}

/** Robust parsing: separates adjacent fields on the same line, recovers missing entities, cleans values. */
export function parseCardText(text: string): ParsedCard {
  const result: ParsedCard = {
    name: '', employee_id: '', admission_number: '', student_id_kv: '',
    class: '', section: '', department: '', roll_number: '',
    father_name: '', mother_name: '', parent_name: '',
    parent_phone: '', phone: '', student_email: '', parent_email: '', email: '',
    date_of_birth: '', blood_group: '', pen_number: '', address: '',
  };

  const lines = text.normalize('NFKC').replace(/\r/g, '').replace(/\t/g, ' ').split('\n');
  let previous: keyof ParsedCard | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const segments = splitLineByLabels(line);
    if (segments.length > 0) {
      for (const seg of segments) {
        if (seg.key === 'class_and_sec') {
          const parsed = parseClassAndSec(seg.value);
          if (parsed.class) result.class = parsed.class;
          if (parsed.section) result.section = parsed.section;
          previous = 'class';
        } else if (seg.key === 'guardian_name') {
          if (!result.father_name) result.father_name = cleanSalutations(seg.value);
          else if (!result.mother_name) result.mother_name = cleanSalutations(seg.value);
          previous = 'father_name';
        } else {
          result[seg.key as keyof ParsedCard] = seg.value;
          previous = seg.key as keyof ParsedCard;
        }
      }
      continue;
    }

    if (previous) {
      const unusable = digitOnlyLine.test(line) || continuationStop.test(line);
      if (!result[previous] && !unusable) {
        result[previous] = line;
        continue;
      }
      if (previous === 'address' && !unusable) {
        result.address += ' ' + line;
        continue;
      }
      previous = null;
    }
  }

  // Combined class field resolution
  if (result.class && !result.section) {
    const combined = parseClassAndSec(result.class);
    if (combined.section) {
      result.class = combined.class;
      result.section = combined.section;
    }
  }

  // Syntactic Entity Recovery Pass (fill any gaps from unlabelled or smudged text)
  recoverMissingEntities(text, result);

  // Field normalization and cleaning
  result.name = cleanSalutations(result.name);
  if (!result.name) result.name = inferStudentName(text, result);
  result.father_name = cleanSalutations(result.father_name);
  result.mother_name = cleanSalutations(result.mother_name);
  result.parent_name = result.father_name || result.mother_name || result.parent_name;
  result.admission_number = cleanAdmissionNumber(result.admission_number);
  result.employee_id = result.admission_number;
  result.class = cleanClass(result.class);
  result.section = cleanSection(result.section);
  result.parent_phone = cleanPhone(result.parent_phone);
  result.phone = result.parent_phone;
  result.blood_group = cleanBloodGroup(result.blood_group);
  result.date_of_birth = cleanDateOfBirth(result.date_of_birth);
  result.department = [result.class, result.section].filter(Boolean).join('-');

  return result;
}

function recoverMissingEntities(text: string, result: ParsedCard): void {
  // 1. Phone number (10-digit Indian mobile starting with 6-9)
  if (!result.parent_phone) {
    const m = text.match(/(?:(?:\+?91|0)[\s-]?)?([6-9]\d{9})\b/);
    if (m && m[1] !== result.student_id_kv && m[1] !== result.pen_number) {
      result.parent_phone = m[1];
    }
  }

  // 2. Date of birth
  if (!result.date_of_birth) {
    const m = text.match(/\b([0-3]?\d)[\/.-]([0-1]?\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\/.-]((?:19|20)\d{2})\b/i);
    if (m) {
      result.date_of_birth = cleanDateOfBirth(m[0]);
    }
  }

  // 3. Blood group
  if (!result.blood_group) {
    const m = text.match(/\b(A|B|AB|O)\s*([+-]|(?:\+|-)?\s*ve)\b/i);
    if (m) {
      result.blood_group = cleanBloodGroup(m[0]);
    }
  }

  // 4. PEN number (11 digits)
  if (!result.pen_number) {
    const m = text.match(/\b(\d{11})\b/);
    if (m && m[1] !== result.student_id_kv) {
      result.pen_number = m[1];
    }
  }

  // 5. Student ID (KV / UBI 10-14 digits)
  if (!result.student_id_kv) {
    const matches = text.match(/\b(\d{10,14})\b/g) || [];
    for (const num of matches) {
      if (num !== result.parent_phone && num !== result.pen_number) {
        result.student_id_kv = num;
        break;
      }
    }
  }

  // 6. Class & section
  if (!result.class || !result.section) {
    const m = text.match(new RegExp(`\\b(?:class\\s*)?(${CLASS_PATTERN})[\\s\\/-]+([A-Z])\\b`, 'i'));
    if (m) {
      if (!result.class) result.class = m[1].toUpperCase();
      if (!result.section) result.section = m[2].toUpperCase();
    }
  }

  // 7. Admission Number
  if (!result.admission_number) {
    const m = text.match(/(?:admn?\.?|adm|scholar|admission)[\s.:#-]*([A-Z0-9/-]{3,12})\b/i);
    if (m) {
      result.admission_number = m[1];
    }
  }
}

/**
 * Resilient student name discovery: detects names under photo captions, below headers,
 * handles single names, dotted initials, and multi-word names while rejecting headings.
 */
function inferStudentName(text: string, parsed: ParsedCard): string {
  const lines = text.normalize('NFKC').replace(/\r/g, '').replace(/\t/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';

  const used = new Set(Object.values(parsed).map(v => String(v).trim()).filter(Boolean));
  const word = /^[\p{L}][\p{L}'’.-]*$/u;
  const candidates: { text: string; index: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    candidates.push({ text: lines[i], index: i });
    if (i + 1 < lines.length && word.test(lines[i]) && word.test(lines[i + 1]) && !/\d/.test(lines[i] + lines[i + 1])) {
      candidates.push({ text: `${lines[i]} ${lines[i + 1]}`, index: i });
    }
  }

  let best = '';
  let bestScore = 2;

  for (const { text: raw, index } of candidates) {
    const candidate = raw.replace(/^\d[\d\s-]{3,}\d\s+/, '').replace(/\s+\d[\d\s-]{3,}\d$/, '').trim();
    if (candidate.length < 3 || /\d/.test(candidate) || /[:=]/.test(candidate)) continue;
    if (used.has(candidate) || used.has(raw)) continue;
    if (nameStop.test(candidate)) continue;

    const words = candidate.split(/\s+/);
    if (words.length < 1 || words.length > 5 || !words.every(w => word.test(w))) continue;

    let score = 0;
    if (candidate === candidate.toUpperCase()) score += 4;
    else if (/^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)*$/u.test(candidate)) score += 3;
    if (words.length >= 1 && words.length <= 3) score += 2;
    if (index < 8) score += 2;
    if (index > 0 && /identity\s*card/i.test(lines[index - 1])) score += 3;
    if (index + 1 < lines.length && /student\s*id/i.test(lines[index + 1])) score += 3;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
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
    if (columns >= 1 && rows >= 1 && columns <= 2 && rows <= 4 && columns * rows <= anchors.length + 2) return { columns, rows };
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
