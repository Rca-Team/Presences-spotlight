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
  { key: 'parent_phone', pattern: /(?:\b(?:(?:parent|father|mother|guardian)(?:['’]s)?\s*(?:phone|mob(?:ile)?|contact|tel|whatsapp)(?:\s*(?:no\.?|num(?:ber)?|#))?|father['’]s\s*mob\.?|mother['’]s\s*mob\.?|mob(?:ile)?\s*(?:no\.?|num(?:ber)?|#)|contact\s*(?:no\.?|num(?:ber)?|#)|phone\s*(?:no\.?|num(?:ber)?|#)|tel\s*(?:no\.?|num(?:ber)?|#)|whatsapp\s*(?:no\.?|num(?:ber)?|#))\b|मोबाइल\s*(?:नंबर|नम्बर|नं\.?))/i, priority: 90 },
  { key: 'father_name', pattern: /(?:\b(?:father(?:['’]s)?\s*name|f\.?\s*name)\b|पिता(?:\s*का)?\s*नाम)/i, priority: 85 },
  { key: 'mother_name', pattern: /(?:\b(?:mother(?:['’]s)?\s*name|m\.?\s*name)\b|माता(?:\s*का)?\s*नाम)/i, priority: 85 },
  { key: 'student_id_kv', pattern: /\b(?:(?:student|pupil|kv|ubi)\s*(?:identification\s*)?id(?:\s*(?:no\.?|num(?:ber)?|#))?|ubi\s*id(?:\s*(?:no\.?|num(?:ber)?|#))?|kv\s*id(?:\s*(?:no\.?|num(?:ber)?|#))?|student\s*unique\s*id|identity\s*no\.?)\b/i, priority: 80 },
  { key: 'admission_number', pattern: /(?:\b(?:admission\s*(?:no\.?|num(?:ber)?|#)|admn?\.?\s*(?:no\.?|num(?:ber)?|#)|adm\b|scholar\s*(?:no\.?|num(?:ber)?|#)|s\.?r\.?\s*(?:no\.?|num(?:ber)?|#)|reg(?:n|istration)?\.?\s*(?:no\.?|num(?:ber)?|#))\b|प्रवेश\s*(?:संख्या|क्रमांक))/i, priority: 75 },
  { key: 'name', pattern: /(?:\b(?:(?:student|pupil|candidate)(?:['’]s)?\s*name|name\s*of\s*(?:the\s*)?(?:student|pupil|candidate)|name)\b|विद्यार्थी\s*का\s*नाम|छात्र(?:\s*का)?\s*नाम)/i, priority: 70 },
  { key: 'roll_number', pattern: /(?:\b(?:roll(?:\s*(?:no\.?|num(?:ber)?|#))?|r\.?\s*no\.?)\b|क्रमांक|रोल\s*(?:नंबर|नं\.?)?)/i, priority: 65 },
  { key: 'blood_group', pattern: /(?:\b(?:blood\s*(?:group|grp\.?|type)|b\.?\s*g\.?|b\.?\s*grp\.?)\b|रक्त\s*समूह)/i, priority: 65 },
  { key: 'date_of_birth', pattern: /(?:\b(?:date\s*of\s*birth|d\.?o\.?b\.?|birth\s*date)\b|जन्म\s*तिथि)/i, priority: 65 },
  { key: 'pen_number', pattern: /\b(?:pen(?:\s*(?:no\.?|num(?:ber)?|#))?|p\.?e\.?n\.?(?:\s*(?:no\.?|num(?:ber)?|#))?|permanent\s*edu(?:cation)?\s*(?:no\.?|number))\b/i, priority: 65 },
  { key: 'class', pattern: /(?:\b(?:class|grade|std\.?|standard)\b|कक्षा)/i, priority: 60 },
  { key: 'section', pattern: /(?:\bsec(?:tion)?\.?\b|वर्ग|अनुभाग)/i, priority: 60 },
  { key: 'parent_email', pattern: /\b(?:parent\s*e-?mail(?:\s*(?:id|address))?)\b/i, priority: 50 },
  { key: 'email', pattern: /\b(?:(?:student\s*)?e-?mail(?:\s*(?:id|address))?)\b/i, priority: 45 },

  // Generic fallbacks
  { key: 'parent_phone', pattern: /\b(?:mob(?:ile)?|phone|contact|tel)\b/i, priority: 30 },
  { key: 'address', pattern: /(?:\b(?:(?:residential|present|perm(?:anent)?|home|postal|res\.?)\s*address|address)\b|पता)/i, priority: 25 },
];

const continuationStop = /^(?:principal|signature|valid(?:\s*upto| until)?|session|school|www\.|https?:|barcode|qrcode|office|page|student\s*id|identity)/i;
const digitOnlyLine = /^[\d\s\-–/().]{6,}$/;
const nameStop = /\b(?:welcome|identity|card|student|pupil|identification|signature|session|class|section|date|birth|d\.?o\.?b\.?|father|mother|parent|guardian|address|blood|group|pen|roll|admn?|admission|scholar|school|vidyalaya|sangathan|region|house|team|barcode|principal|kendriya|pm\s*shri|shri|nfc|opposite|shift|phone|mobile|contact|office|government|govt|academic|board|examination|nameplate|classroom|beside|valid|upto|india|ministry|education|autonomous|body|under|centre|center|vihar|nagar|colony|sector|phase|block|road|marg|station|police|delhi|new\s*delhi)\b/i;

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
  const m = val.match(/\b(A1B|A2B|A1|A2|AB|A|B|O)\s*([+-]|(?:\+|-)?\s*ve)\b/i);
  if (m) {
    const type = m[1].toUpperCase();
    const sign = m[2].toLowerCase().includes('-') ? '-' : '+';
    return `${type}${sign}`;
  }
  const stripped = val.replace(/^[:=–#\s.-]+/, '').toUpperCase().replace(/\s+/g, '');
  if (/^(?:NA|N\/A|NIL|NONE|NOTAVAILABLE|-+)$/i.test(stripped)) return '';
  return stripped;
}

function isValidContinuation(field: keyof ParsedCard, candidate: string): boolean {
  const text = candidate.trim();
  if (!text || continuationStop.test(text)) return false;
  switch (field) {
    case 'pen_number':
    case 'student_id_kv':
      return /^\d[\d\s-]{6,15}\d$/.test(text);
    case 'admission_number':
    case 'roll_number':
      return text.length <= 20 && /\d/.test(text) && /^[A-Za-z0-9\s/._-]+$/.test(text);
    case 'date_of_birth':
      return /\b\d{1,2}[\/.-](?:\d{1,2}|[A-Za-z]{3,9})[\/.-]\d{2,4}\b/.test(text);
    case 'blood_group':
      return /^(?:A1B|A2B|A1|A2|AB|A|B|O)\s*(?:[+-]|(?:\+|-)?\s*ve)$/i.test(text);
    case 'parent_phone':
    case 'phone':
      return text.replace(/\D/g, '').length >= 8;
    case 'email':
    case 'parent_email':
    case 'student_email':
      return /\S+@\S+\.\S+/.test(text);
    case 'class':
      return new RegExp(`^(?:class\\s*)?(${CLASS_PATTERN})(?:st|nd|rd|th)?(?:[\\s\\/-]+[A-Z])?$`, 'i').test(text);
    case 'section':
      return /^[A-Za-z]$/.test(text);
    case 'name':
    case 'father_name':
    case 'mother_name':
    case 'parent_name':
      return !digitOnlyLine.test(text) && !/\d/.test(text) && /\p{L}/u.test(text);
    case 'address':
      return !digitOnlyLine.test(text);
    default:
      return !digitOnlyLine.test(text);
  }
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
  const trimmed = val.replace(/^[:=–#\s.-]+/, '').replace(/\s+/g, ' ').trim();
  if (/^\+?\d[\d\s()-]{8,16}\d$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function cleanDateOfBirth(val: string): string {
  if (!val) return '';
  const cleaned = val.replace(/^[:=–#\s.-]+/, '').trim();
  const m = cleaned.match(/\b([0-3]?\d)([\/.-])([0-1]?\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\/.-]((?:19|20)\d{2})\b/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    const sep = m[2] === '-' ? '-' : '/';
    let month = m[3];
    const year = m[4];
    const monthNames: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    if (isNaN(Number(month))) {
      month = monthNames[month.slice(0, 3).toLowerCase()] || '01';
    } else {
      month = month.padStart(2, '0');
    }
    return `${day}${sep}${month}${sep}${year}`;
  }
  return cleaned;
}

function parseClassAndSec(val: string): { class: string; section: string } {
  if (!val) return { class: '', section: '' };
  const m = val.match(new RegExp(`^(${CLASS_PATTERN})(?:st|nd|rd|th)?[\\s\\/-]+([A-Z])(?:\\b.*)?$`, 'i'));
  if (m) {
    return { class: m[1].toUpperCase(), section: m[2].toUpperCase() };
  }
  return { class: val.trim(), section: '' };
}

function splitLineByLabels(line: string): { prefix: string; segments: { key: LabelDef['key']; value: string }[] } {
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
  if (!filtered.length) return { prefix: '', segments: [] };

  const prefix = filtered[0].start > 0 ? line.substring(0, filtered[0].start).trim() : '';
  const segments: { key: LabelDef['key']; value: string }[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const curr = filtered[i];
    const valStart = curr.end;
    const valEnd = (i + 1 < filtered.length) ? filtered[i + 1].start : line.length;
    let value = line.substring(valStart, valEnd).trim();
    value = value.replace(/^[:=–#\s.-]+/, '').trim();
    segments.push({ key: curr.key, value });
  }
  return { prefix, segments };
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
  const prefixes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const { prefix, segments } = splitLineByLabels(line);
    if (prefix) {
      prefixes.push(prefix);
      if (previous && !(result as any)[previous] && isValidContinuation(previous, prefix)) {
        (result as any)[previous] = prefix;
      } else if (previous === 'address' && isValidContinuation('address', prefix)) {
        result.address += ' ' + prefix;
      }
    }
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
          if (seg.value || !(result as any)[seg.key]) {
            (result as any)[seg.key] = seg.value;
          }
          previous = seg.key as keyof ParsedCard;
        }
      }
      continue;
    }

    if (previous) {
      if (!(result as any)[previous] && isValidContinuation(previous, line)) {
        (result as any)[previous] = line;
        continue;
      }
      if (previous === 'address' && isValidContinuation('address', line)) {
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
  const enrichedText = prefixes.length ? `${prefixes.join('\n')}\n${text}` : text;
  recoverMissingEntities(enrichedText, result);

  // Field normalization and cleaning
  result.name = cleanSalutations(result.name);
  if (!result.name) result.name = inferStudentName(enrichedText, result);
  result.father_name = cleanSalutations(result.father_name);
  result.mother_name = cleanSalutations(result.mother_name);
  result.parent_name = result.father_name || result.mother_name || result.parent_name;
  result.admission_number = cleanAdmissionNumber(result.admission_number);
  result.employee_id = result.admission_number || result.student_id_kv;
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

  // 2. Date of birth (only recover unlabelled DOB if explicit DOB label wasn't intentionally blank)
  if (!result.date_of_birth && !/\b(?:date\s*of\s*birth|d\.?o\.?b\.?|birth\s*date)\s*[:=]\s*(?:\n|$)/i.test(text)) {
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
    if (m && !/^(?:no|number|card|form|date)$/i.test(m[1])) {
      result.admission_number = m[1];
    }
  }
}

/**
 * Resilient student name discovery: detects names under photo captions, below headers,
 * handles single names, dotted initials, and multi-word names while rejecting headings.
 */
function inferStudentName(text: string, parsed: ParsedCard): string {
  // If an explicit Name: label was present and blank, do not invent a name from other lines.
  if (/(?:^|\n)\s*(?:(?:student|pupil|candidate)(?:['’]s)?\s*name|name)\s*[:=]\s*(?:\n|$)/i.test(text)) {
    return '';
  }
  const hasCardContext = Boolean(
    parsed.admission_number || parsed.student_id_kv || parsed.father_name ||
    parsed.mother_name || parsed.date_of_birth || parsed.parent_phone ||
    parsed.pen_number || parsed.blood_group || parsed.roll_number ||
    /\b(?:identity\s*card|student\s*id|admn?\s*no|admission\s*no|father(?:['’]s)?\s*name|mother(?:['’]s)?\s*name|blood\s*group|pen\s*no)\b/i.test(text)
  );
  if (!hasCardContext) return '';

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
    if (words.length >= 2 && words.length <= 3) score += 3;
    else if (words.length === 1) score += 1;
    if (index < 8) score += 2;
    if (index > 0 && /identity\s*card|student\s*id/i.test(lines[index - 1])) score += 4;
    else if (index > 1 && /^\d{8,14}$/.test(lines[index - 1]) && /student\s*id|identity\s*card/i.test(lines[index - 2])) score += 4;
    if (index + 1 < lines.length && /student\s*id|identity\s*card/i.test(lines[index + 1])) score += 3;
    if (words.length > 1 && index + 2 < lines.length && /student\s*id|identity\s*card/i.test(lines[index + 2])) score += 3;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export interface PositionedText { text: string; x: number; y: number; height?: number }

function groupItemsIntoLines(items: PositionedText[]): string[] {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; tolerance: number; items: PositionedText[] }[] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(item.y - last.y) <= last.tolerance) last.items.push(item);
    else lines.push({ y: item.y, tolerance: Math.max(3, (item.height || 10) * 0.4), items: [item] });
  }
  return lines.map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '));
}

export function textInRegion(items: PositionedText[], x: number, y: number, width: number, height: number): string {
  const selected = items.filter(item => item.x >= x && item.x < x + width && item.y >= y && item.y < y + height);
  if (!selected.length) return '';

  // Detect horizontal two-zone ID cards (e.g., KVS Samagam layout where the left ~29%
  // holds Student ID, 10-digit ID, Portrait Photo, and Student Name caption below photo,
  // while the right ~71% holds the Father/Mother/DOB/Class/Admn/Blood/Phone/Address table).
  // Keeping the left photo column grouped before the right details table prevents the
  // student's name under the photo from being interleaved into Blood Group, PEN, or Address.
  const splitX = x + width * 0.295;
  const headerBottomY = y + height * 0.21;
  const bodyItems = selected.filter(i => i.y >= headerBottomY);
  const leftBody = bodyItems.filter(i => i.x < splitX);
  const rightBody = bodyItems.filter(i => i.x >= splitX);
  const rightHasDetailTable = rightBody.some(i => /\b(?:father|mother|birth|d\.?o\.?b|admn|admission|blood|address)\b/i.test(i.text));
  const leftHasDetailTable = leftBody.some(i => /\b(?:father|mother|birth|d\.?o\.?b|blood|address)\b/i.test(i.text));

  if (rightHasDetailTable && !leftHasDetailTable && leftBody.length > 0 && width > height * 0.9) {
    const headerItems = selected.filter(i => i.y < headerBottomY);
    return [
      ...groupItemsIntoLines(headerItems),
      ...groupItemsIntoLines(leftBody),
      ...groupItemsIntoLines(rightBody),
    ].filter(Boolean).join('\n');
  }

  return groupItemsIntoLines(selected).join('\n');
}

/** Build local phrase tokens from PositionedText items so split words ("Admn" + "No", "Father's" + "Name") match. */
function buildAnchorCandidates(items: PositionedText[], width: number, height: number): PositionedText[] {
  const filtered = items.filter(i => {
    const t = i.text.trim();
    if (!t) return false;
    // Ignore browser print header/footer margins (e.g. timestamp, URL, page 1/4)
    if ((i.y < height * 0.032 || i.y > height * 0.968) && (/https?:\/\/|^\d+\/\d+$|\b\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(t))) {
      return false;
    }
    return true;
  });

  const sorted = filtered.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; tolerance: number; items: PositionedText[] }[] = [];
  for (const item of sorted) {
    const last = rows.at(-1);
    if (last && Math.abs(item.y - last.y) <= last.tolerance) last.items.push(item);
    else rows.push({ y: item.y, tolerance: Math.max(3, (item.height || 10) * 0.45), items: [item] });
  }

  const phrases: PositionedText[] = [];
  const maxGap = Math.max(12, width * 0.075);
  for (const row of rows) {
    const lineItems = row.items.slice().sort((a, b) => a.x - b.x);
    let current: PositionedText | null = null;
    let lastRight = 0;
    for (const item of lineItems) {
      const estCharW = Math.max(4, (item.height || 10) * 0.55);
      const itemWidth = item.text.length * estCharW;
      if (current && item.x - lastRight <= maxGap) {
        current.text += ' ' + item.text.trim();
        lastRight = Math.max(lastRight, item.x + itemWidth);
      } else {
        if (current) phrases.push(current);
        current = { text: item.text.trim(), x: item.x, y: item.y, height: item.height };
        lastRight = item.x + itemWidth;
      }
    }
    if (current) phrases.push(current);
  }

  return [...filtered, ...phrases];
}

function dedupeCardAnchors(matches: PositionedText[], width: number, height: number): PositionedText[] {
  const deduped: PositionedText[] = [];
  const tolX = Math.max(15, width * 0.16);
  const tolY = Math.max(12, height * 0.052);
  for (const m of matches.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!deduped.some(existing => Math.abs(existing.x - m.x) < tolX && Math.abs(existing.y - m.y) < tolY)) {
      deduped.push(m);
    }
  }
  return deduped;
}

/** Detect regularly arranged card sheets (1..4 columns × 1..6 rows); manual grid selection remains available. */
export function detectCardGrid(items: PositionedText[], width: number, height: number) {
  if (!items.length || width <= 0 || height <= 0) return { columns: 1, rows: 1 };
  const candidates = buildAnchorCandidates(items, width, height);

  const patterns: RegExp[] = [
    /\b(?:admission|adm[n.]?|scholar|s\.?r\.?|reg(?:n|istration)?)\s*(?:no\.?|number|#)/i,
    /\bidentity\s*card\b/i,
    /\b(?:student|pupil|kv|ubi)\s*id\b/i,
    /\bfather(?:['’`]?s)?(?:\s*\/\s*mother(?:['’`]?s)?)?\s*name\b/i,
    /\bmother(?:['’`]?s)?\s*name\b/i,
    /\b(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?)\b/i,
    /\bblood\s*(?:group|grp)\b/i,
    /\bfather\s*\/\s*mother\s*(?:phone|mobile|contact)\b/i,
    /^(?:student(?:['’`]?s)?\s*name|name)\s*[:=]/i,
    /\bpen\s*(?:no\.?|number|#)\b/i,
    /^100\d{7}$/,
  ];

  const groups = patterns
    .map(rx => dedupeCardAnchors(candidates.filter(i => rx.test(i.text.trim())), width, height))
    .filter(group => group.length >= 2)
    .sort((a, b) => b.length - a.length);

  const cluster = (values: number[], tolerance: number) => {
    const centers: number[] = [];
    for (const value of values.slice().sort((a, b) => a - b)) {
      if (!centers.some(c => Math.abs(c - value) < tolerance)) centers.push(value);
    }
    return centers;
  };

  for (const anchors of groups) {
    const columns = cluster(anchors.map(a => a.x), width * 0.14).length;
    const rows = cluster(anchors.map(a => a.y), height * 0.052).length;
    if (columns >= 1 && rows >= 1 && columns <= 4 && rows <= 6 && columns * rows >= 2 && columns * rows <= anchors.length + 2) {
      return { columns, rows };
    }
  }
  return { columns: 1, rows: 1 };
}

export interface GridCell { x: number; y: number; width: number; height: number; /** non-white pixel ratio — blank regions are skipped */ ink: number }
export interface SheetLayout { columns: number; rows: number; cells: GridCell[] }

interface SheetAnalysis {
  scale: number; w: number; h: number;
  colInk: Float32Array; rowInk: Float32Array; integral: Float32Array;
  leftRowInk: Float32Array; rightRowInk: Float32Array;
  leftBannerRow: Float32Array; rightBannerRow: Float32Array; fullBannerRow: Float32Array;
  boundsX: { start: number; end: number } | null;
  boundsY: { start: number; end: number } | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Down-sample once and measure where the ink and colored card headers actually are. */
function analyzeSheet(source: HTMLCanvasElement): SheetAnalysis | null {
  if (source.width < 8 || source.height < 8) return null;
  const scale = Math.min(1, 300 / source.width);
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
  const rowInk = new Float32Array(h);
  const leftRowInk = new Float32Array(h);
  const rightRowInk = new Float32Array(h);
  const leftBannerRow = new Float32Array(h);
  const rightBannerRow = new Float32Array(h);
  const fullBannerRow = new Float32Array(h);
  const midX = Math.max(1, Math.floor(w / 2));

  for (let y = 0; y < h; y++) {
    let row = 0, lRow = 0, rRow = 0, lBan = 0, rBan = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      const dark = a > 8 && (r < 242 || g < 242 || b < 242) ? 1 : 0;
      ink[y * w + x] = dark;
      row += dark;
      if (x < midX) lRow += dark;
      else rRow += dark;

      // Detect colored or dark card header banner pixels (e.g. KVS purple/blue/maroon headers)
      if (dark) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const isBannerPixel = (maxC - minC >= 28 && minC < 210) || (maxC < 105);
        if (isBannerPixel) {
          if (x < midX) lBan++;
          else rBan++;
        }
      }
    }
    rowInk[y] = row / w;
    leftRowInk[y] = lRow / midX;
    rightRowInk[y] = rRow / Math.max(1, w - midX);
    leftBannerRow[y] = lBan / midX;
    rightBannerRow[y] = rBan / Math.max(1, w - midX);
    fullBannerRow[y] = (lBan + rBan) / w;
  }

  // Strip thin browser print headers/footers (e.g. Chrome date/URL at top < 5.5% and page 1/4 at bottom > 94.5%)
  // so they never stretch boundsY across empty half-pages or pollute colInk across vertical gutters.
  let activeY0 = 0;
  let activeY1 = h;
  const rawRowBands: { a: number; b: number }[] = [];
  {
    let y = 0;
    while (y < h) {
      while (y < h && rowInk[y] <= 0.003) y++;
      const a = y;
      while (y < h && rowInk[y] > 0.003) y++;
      if (y > a) rawRowBands.push({ a, b: y });
    }
    if (rawRowBands.length >= 2) {
      const first = rawRowBands[0];
      const second = rawRowBands[1];
      if (first.a < h * 0.06 && (first.b - first.a) < h * 0.032 && (second.a - first.b) >= Math.max(2, h * 0.008)) {
        activeY0 = second.a;
        for (let y = 0; y < activeY0; y++) {
          rowInk[y] = 0; leftRowInk[y] = 0; rightRowInk[y] = 0;
          leftBannerRow[y] = 0; rightBannerRow[y] = 0; fullBannerRow[y] = 0;
        }
      }
      const last = rawRowBands.at(-1)!;
      const prev = rawRowBands.at(-2)!;
      if (last.b > h * 0.94 && (last.b - last.a) < h * 0.032 && (last.a - prev.b) >= Math.max(2, h * 0.008) && prev.b > activeY0) {
        activeY1 = prev.b;
        for (let y = activeY1; y < h; y++) {
          rowInk[y] = 0; leftRowInk[y] = 0; rightRowInk[y] = 0;
          leftBannerRow[y] = 0; rightBannerRow[y] = 0; fullBannerRow[y] = 0;
        }
      }
    }
  }

  const colInk = new Float32Array(w);
  const activeHeight = Math.max(1, activeY1 - activeY0);
  for (let x = 0; x < w; x++) {
    let col = 0;
    for (let y = activeY0; y < activeY1; y++) col += ink[y * w + x];
    colInk[x] = col / activeHeight;
  }

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
  return {
    scale, w, h, colInk, rowInk, integral,
    leftRowInk, rightRowInk, leftBannerRow, rightBannerRow, fullBannerRow,
    boundsX: bounds(colInk), boundsY: bounds(rowInk),
  };
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

function countBannerHeaders(bannerProfile: Float32Array, start: number, end: number, minSeparation: number): number {
  const runs: { a: number; b: number }[] = [];
  const threshold = 0.22;
  let i = start;
  while (i < end) {
    while (i < end && bannerProfile[i] < threshold) i++;
    const a = i;
    while (i < end && bannerProfile[i] >= threshold) i++;
    if (i <= a) continue;
    const prev = runs.at(-1);
    if (prev && a - prev.b < minSeparation) prev.b = i;
    else runs.push({ a, b: i });
  }
  return runs.filter(r => r.b - r.a >= 2).length;
}

/**
 * Visually auto-detect multi-card grid (columns × rows) directly from a rendered page/image canvas.
 * Combines whitespace gutter analysis and colored/dark card header banner detection so scanned PDFs,
 * browser-printed sheets (e.g. 2×2 = 4 cards or 2×5 = 10 cards), and images split accurately even
 * before OCR runs.
 */
export function detectCanvasCardGrid(source: HTMLCanvasElement): { columns: number; rows: number } {
  const analysis = analyzeSheet(source);
  if (!analysis || !analysis.boundsX || !analysis.boundsY) return { columns: 1, rows: 1 };
  const { w, h, colInk, rowInk, leftRowInk, rightRowInk, leftBannerRow, rightBannerRow, fullBannerRow, boundsX, boundsY } = analysis;
  const spanX = boundsX.end - boundsX.start;
  const spanY = boundsY.end - boundsY.start;
  if (spanX < 16 || spanY < 16) return { columns: 1, rows: 1 };

  // 1. Detect columns (1, 2, or 3)
  let columns = 1;
  const colBands = bands(colInk, boundsX.start, boundsX.end, Math.max(2, Math.round(spanX * 0.015)))
    .filter(b => (b.b - b.a) >= spanX * 0.22);
  if (colBands.length >= 2 && colBands.length <= 3) {
    columns = colBands.length;
  } else {
    // Check if there is a vertical low-ink gutter near the horizontal midpoint of boundsX
    const midStart = Math.round(boundsX.start + spanX * 0.43);
    const midEnd = Math.round(boundsX.start + spanX * 0.57);
    let minMidInk = Infinity;
    for (let x = midStart; x <= midEnd; x++) {
      if (colInk[x] < minMidInk) minMidInk = colInk[x];
    }
    const leftQ = quantile(colInk, boundsX.start, midStart);
    const rightQ = quantile(colInk, midEnd, boundsX.end);
    if (leftQ >= 0.03 && rightQ >= 0.03 && minMidInk <= Math.min(leftQ, rightQ) * 0.18) {
      columns = 2;
    }
  }

  // 2. Detect rows (1..6) using whitespace gutters first
  const minRowGap = Math.max(2, Math.round(spanY * 0.008));
  const minCardH = Math.max(6, Math.round(spanY * 0.09));
  const fullRowBands = bands(rowInk, boundsY.start, boundsY.end, minRowGap).filter(b => (b.b - b.a) >= minCardH);
  const leftBands = bands(leftRowInk, boundsY.start, boundsY.end, minRowGap).filter(b => (b.b - b.a) >= minCardH);
  const rightBands = bands(rightRowInk, boundsY.start, boundsY.end, minRowGap).filter(b => (b.b - b.a) >= minCardH);

  let rows = fullRowBands.length;
  if (columns === 2 && leftBands.length >= 2 && leftBands.length <= 6 && Math.abs(leftBands.length - rightBands.length) <= 1) {
    rows = Math.max(rows, leftBands.length, rightBands.length);
  }

  // 3. Also check colored/dark header banners (e.g. purple KVS header bars on each card)
  const minHeaderSep = Math.max(8, Math.round(h * 0.09));
  const leftHeaders = countBannerHeaders(leftBannerRow, boundsY.start, boundsY.end, minHeaderSep);
  const rightHeaders = countBannerHeaders(rightBannerRow, boundsY.start, boundsY.end, minHeaderSep);
  const fullHeaders = countBannerHeaders(fullBannerRow, boundsY.start, boundsY.end, minHeaderSep);

  if (leftHeaders >= 2 && rightHeaders >= 2 && Math.abs(leftHeaders - rightHeaders) <= 1) {
    columns = Math.max(columns, 2);
    const bannerRows = Math.max(leftHeaders, rightHeaders);
    if (bannerRows <= 6 && (rows <= 1 || Math.abs(rows - bannerRows) <= 1)) {
      rows = Math.max(rows, bannerRows);
    }
  } else if (columns === 1 && fullHeaders >= 2 && fullHeaders <= 6 && rows <= 1) {
    rows = fullHeaders;
  }

  columns = clamp(columns, 1, 4);
  rows = clamp(rows, 1, 6);
  return { columns, rows };
}

/**
 * A page holds AT MOST the requested grid. Shrink an axis when the printed
 * gutters reveal fewer card bands than asked for (a half-filled sheet), and
 * keep the request when the content bleeds across the page (invisible gutters).
 */
function fitAxis(profile: Float32Array, bounds: { start: number; end: number } | null, requested: number, pageLength: number): number {
  if (requested <= 1 || !bounds) return requested;
  const span = bounds.end - bounds.start;
  const cell = span / requested;
  let found = bands(profile, bounds.start, bounds.end, Math.max(2, Math.round(cell * 0.04)))
    .filter(b => (b.b - b.a) >= cell * 0.30);
  if (found.length === requested + 1) {
    // A printed header or footer shows up as one extra, much shorter band.
    const sizes = found.map(b => b.b - b.a);
    const smallest = sizes.indexOf(Math.min(...sizes));
    if (sizes[smallest] < cell * 0.5) found = found.filter((_, index) => index !== smallest);
  }
  if (found.length >= requested) return requested;
  if (found.length <= 1) {
    // Only collapse to 1 if the total printed span is too small to hold more than 1 card.
    // Never collapse a 2×2 (4 cards/page) sheet just because 2 rows occupy ~40-80% of the page!
    return span / Math.max(1, pageLength) >= 0.28 ? requested : 1;
  }
  // If found has fewer bands than requested (e.g. 2 bands when 4 were requested), check whether
  // any band is actually multiple cards touching without a visible white gutter.
  const maxBandSize = Math.max(...found.map(b => b.b - b.a));
  if (maxBandSize >= cell * 1.55) {
    return requested;
  }
  return found.length;
}

/** Cut positions for one axis: [start, …, end] in sampled pixels. */
function axisCuts(profile: Float32Array, bounds: { start: number; end: number }, count: number): number[] {
  const span = bounds.end - bounds.start;
  const cell = span / count;
  const gutter = bands(profile, bounds.start, bounds.end, Math.max(2, Math.round(cell * 0.04)))
    .filter(b => (b.b - b.a) >= cell * 0.30);
  if (gutter.length === count) {
    const cuts = [gutter[0].a];
    for (let i = 1; i < count; i++) {
      cuts.push(Math.round((gutter[i - 1].b + gutter[i].a) / 2));
    }
    cuts.push(gutter[count - 1].b);
    return cuts;
  }
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

/**
 * Split a concatenated multi-card text block into individual card text blocks
 * whenever multiple student records appear in a single region/page.
 */
export function splitMultiCardText(text: string): string[] {
  const lines = text.normalize('NFKC').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) return [text];

  const chunks: string[][] = [];
  let current: string[] = [];
  let seenKeys = new Set<string>();

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      seenKeys = new Set<string>();
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isSchoolHeader = /\b(?:pm\s*shri|kendriya\s*vidyalaya)\b/i.test(line) && !/oppos|station|road|marg/i.test(line);
    const isStudentIdHeader = /^student\s*id\b/i.test(line);
    const { segments } = splitLineByLabels(line);
    const primaryKeys = segments.map(s => s.key).filter(k =>
      ['admission_number', 'student_id_kv', 'father_name', 'mother_name', 'name'].includes(String(k))
    );

    const hasCompleteCardSoFar =
      seenKeys.has('admission_number') ||
      seenKeys.has('student_id_kv') ||
      (seenKeys.has('father_name') && seenKeys.has('date_of_birth')) ||
      (seenKeys.has('name') && seenKeys.has('father_name'));

    if (hasCompleteCardSoFar && (isSchoolHeader || isStudentIdHeader || primaryKeys.some(k => seenKeys.has(String(k))))) {
      flush();
    }

    current.push(line);
    for (const seg of segments) {
      seenKeys.add(String(seg.key));
    }
  }
  flush();

  const validChunks = chunks
    .map(c => c.join('\n'))
    .filter(chunk => {
      const parsed = parseCardText(chunk);
      return Boolean(parsed.name || parsed.admission_number || parsed.student_id_kv);
    });

  return validChunks.length >= 2 ? validChunks : [text];
}

