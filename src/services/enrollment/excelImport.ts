import { parseCardText, type ParsedCard } from './pdfParser';
import type { ImportCard } from './types';

export interface ExcelExtractOptions {
  signal?: AbortSignal;
  progress?: (message: string, percent: number) => void;
  onCard?: (card: ImportCard) => void;
}

type ColumnRole =
  | 'ignore'
  | 'roll_number'
  | 'admission_number'
  | 'name'
  | 'father_name'
  | 'mother_name'
  | 'date_of_birth'
  | 'class'
  | 'section'
  | 'class_and_sec'
  | 'address'
  | 'parent_phone'
  | 'blood_group'
  | 'pen_number'
  | 'student_id_kv'
  | 'email'
  | 'parent_email';

function abortError() {
  return new DOMException('Extraction cancelled.', 'AbortError');
}

/** Classify a single Excel header cell, handling line wraps like "SECTIO\nN" or "Roll\nNo." and ignoring "MOBILE NO.-2" & "PHOTOS NO.". */
export function classifyExcelHeader(rawCell: unknown): ColumnRole | null {
  const raw = String(rawCell ?? '').trim();
  if (!raw) return null;
  // Remove all whitespace (including newlines from wrapped cells like "SECTIO\nN") and lowercase
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  const norm = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  // 1. Explicitly ignored columns: Photo number & Second phone number
  if (/^(?:photos?(?:no|num|number|sr|id|#)?\.?|img(?:no|number)?\.?|image(?:no|number)?\.?|pic(?:no|number)?\.?|photograph(?:no|number)?\.?)$/.test(compact)) {
    return 'ignore';
  }
  if (/(?:mobile|mob|phone|contact|tel|cell|whatsapp).*(?:[-._#]*2|ii|sec(?:ond)?|alt(?:ernate)?|other)\.?$/.test(compact)) {
    return 'ignore';
  }
  if (/^(?:mob2|m2|phone2|tel2|contact2|secondphone|secondmobile|alternatemobile)$/.test(compact)) {
    return 'ignore';
  }

  // 2. Roll Number
  if (/^(?:roll(?:no|num|number|#)?\.?|r\.?no\.?|classroll(?:no)?\.?)$/.test(compact)) {
    return 'roll_number';
  }

  // 3. Admission Number (e.g. "ADM.NO.", "ADMN NO", "Admission No.")
  if (/^(?:adm(?:n|ission)?\.?(?:no|num|number|#)?\.?|scholar(?:no|num|number)?\.?|s\.?r\.?(?:no|number)?\.?|reg(?:n|istration)?\.?(?:no|number)?\.?|employeeid|empid)$/.test(compact)) {
    return 'admission_number';
  }

  // 4. Student Name (e.g. "STUDENT NAME", "NAME")
  if (/^(?:student(?:s|'s|’s)?name|nameofthestudent|nameofstudent|pupil(?:s|'s|’s)?name|candidatename|fullname|name)$/.test(compact)) {
    return 'name';
  }

  // 5. Father's Name (e.g. "FATHERS NAME", "FATHER'S NAME", "FATHER NAME")
  if (/^(?:father(?:s|'s|’s)?name|f\.?name|parent(?:s|'s|’s)?name|guardian(?:s|'s|’s)?name)$/.test(compact)) {
    return 'father_name';
  }

  // 6. Mother's Name
  if (/^(?:mother(?:s|'s|’s)?name|m\.?name)$/.test(compact)) {
    return 'mother_name';
  }

  // 7. Date of Birth (e.g. "D.O.B", "D.O.B.", "DOB", "Date of Birth")
  if (/^(?:d\.?o\.?b\.?|dateofbirth|birthdate)$/.test(compact)) {
    return 'date_of_birth';
  }

  // 8. Combined Class & Section
  if (/^(?:class(?:&|\/|and|-)sec(?:tion)?|classsec(?:tion)?)$/.test(compact)) {
    return 'class_and_sec';
  }

  // 9. Class
  if (/^(?:class|std\.?|standard|grade)$/.test(compact)) {
    return 'class';
  }

  // 10. Section (including wrapped "SECTIO\nN" -> compact "section")
  if (/^(?:sec(?:tion)?\.?)$/.test(compact)) {
    return 'section';
  }

  // 11. Address
  if (/^(?:(?:res(?:idential)?|perm(?:anent)?|present|home|postal|local)?address|addr\.?)$/.test(compact)) {
    return 'address';
  }

  // 12. Primary Mobile / Phone Number (e.g. "MOBILE NO.-1", "MOBILE NO.1", "MOBILE NO.", "PHONE")
  if (/^(?:(?:mobile|mob|phone|contact|tel|whatsapp|father(?:s|'s|’s)?mob(?:ile)?|parent(?:s|'s|’s)?(?:phone|mob(?:ile)?|contact))(?:no|num|number|#)?\.?(?:[-._#]*1)?\.?)$/.test(compact)) {
    return 'parent_phone';
  }

  // 13. Blood Group (including wrapped "BLOOD\nGROUP" -> compact "bloodgroup")
  if (/^(?:blood(?:group|grp|type)\.?|b\.?g\.?|b\.?grp\.?)$/.test(compact)) {
    return 'blood_group';
  }

  // 14. PEN Number & Student KV/UBI ID & Emails
  if (/^(?:pen(?:no|num|number|#)?\.?|p\.?e\.?n\.?)$/.test(compact)) {
    return 'pen_number';
  }
  if (/^(?:(?:student|pupil|kv|ubi)(?:unique)?id(?:no|number)?\.?)$/.test(compact)) {
    return 'student_id_kv';
  }
  if (/^(?:parent(?:s|'s|’s)?e?-?mail(?:id|address)?)$/.test(compact)) {
    return 'parent_email';
  }
  if (/^(?:(?:student(?:s|'s|’s)?)?e?-?mail(?:id|address)?)$/.test(compact)) {
    return 'email';
  }

  // Partial fallback checks on normalized text
  if (norm.includes('photo') && (norm.includes('no') || norm.includes('num'))) return 'ignore';
  if ((norm.includes('mobile') || norm.includes('phone')) && /\b2\b|-2\b/.test(norm)) return 'ignore';

  return null;
}

/** Format Excel serial date or date string into DD-MM-YYYY. */
export function normalizeExcelDate(val: unknown): string {
  if (val == null || val === '') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    const d = String(val.getUTCDate()).padStart(2, '0');
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const y = val.getUTCFullYear();
    return `${d}-${m}-${y}`;
  }
  const str = String(val).trim();
  if (!str) return '';

  // Excel serial date number (e.g. 38000..47000 for years ~2004..2028)
  if (/^\d{5}(?:\.\d+)?$/.test(str)) {
    const serial = Math.floor(Number(str));
    if (serial >= 18000 && serial <= 60000) {
      const utcMs = (serial - 25569) * 86400 * 1000;
      const dt = new Date(utcMs);
      if (!isNaN(dt.getTime())) {
        const d = String(dt.getUTCDate()).padStart(2, '0');
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const y = dt.getUTCFullYear();
        return `${d}-${m}-${y}`;
      }
    }
  }

  // YYYY-MM-DD
  const iso = str.match(/^((?:19|20)\d{2})[\/.-]([0-1]?\d)[\/.-]([0-3]?\d)$/);
  if (iso) {
    return `${iso[3].padStart(2, '0')}-${iso[2].padStart(2, '0')}-${iso[1]}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY or DD-MMM-YYYY
  const dmy = str.match(/^([0-3]?\d)[\/.-]([0-1]?\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\/.-](\d{2,4})$/i);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    let month = dmy[2];
    let year = dmy[3];
    if (year.length === 2) {
      const yNum = Number(year);
      year = yNum > 50 ? `19${year}` : `20${year}`;
    }
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    if (isNaN(Number(month))) {
      month = monthNames[month.slice(0, 3).toLowerCase()] || '01';
    } else {
      month = month.padStart(2, '0');
    }
    return `${day}-${month}-${year}`;
  }

  return str;
}

function cleanExcelCell(val: unknown): string {
  if (val == null) return '';
  return String(val)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanExcelPhone(val: unknown): string {
  if (val == null) return '';
  // Strip trailing ".0" if Excel stored phone as float
  const raw = String(val).trim().replace(/\.0+$/, '');
  // If multiple numbers are separated by "/" or "," inside MOBILE NO.-1, take the first 10-digit number
  const firstPart = raw.split(/[\/,;]/)[0].trim();
  const digits = firstPart.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function cleanExcelId(val: unknown): string {
  if (val == null) return '';
  return String(val).trim().replace(/\.0+$/, '').trim();
}

/** Render a lightweight SVG data URL preview for each Excel student record so 100+ rows render instantaneously. */
function createExcelCardPreviewSvg(student: ParsedCard): string {
  const esc = (s: string) =>
    String(s || '-')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const name = esc((student.name || 'STUDENT').slice(0, 28));
  const adm = esc(student.admission_number || student.student_id_kv || '-');
  const clsSec = esc([student.class, student.section].filter(Boolean).join('-') || '-');
  const roll = esc(student.roll_number || '-');
  const father = esc((student.father_name || '-').slice(0, 26));
  const dob = esc(student.date_of_birth || '-');
  const phone = esc(student.parent_phone || '-');
  const bg = esc(student.blood_group || '-');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220">
    <rect width="360" height="220" rx="14" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
    <rect width="360" height="34" rx="14" fill="#059669"/>
    <rect y="20" width="360" height="14" fill="#059669"/>
    <text x="14" y="22" fill="#ffffff" font-family="sans-serif" font-size="11" font-weight="bold">EXCEL ID CARD RECORD · ADM #${adm}</text>
    <text x="14" y="56" fill="#34d399" font-family="sans-serif" font-size="14" font-weight="bold">${name}</text>
    <text x="14" y="78" fill="#94a3b8" font-family="sans-serif" font-size="11">Class: <tspan fill="#f8fafc" font-weight="bold">${clsSec}</tspan>   Roll No: <tspan fill="#f8fafc" font-weight="bold">${roll}</tspan>   Blood: <tspan fill="#f8fafc" font-weight="bold">${bg}</tspan></text>
    <text x="14" y="102" fill="#94a3b8" font-family="sans-serif" font-size="11">Father: <tspan fill="#e2e8f0">${father}</tspan></text>
    <text x="14" y="124" fill="#94a3b8" font-family="sans-serif" font-size="11">D.O.B: <tspan fill="#e2e8f0">${dob}</tspan>   Mobile: <tspan fill="#e2e8f0">${phone}</tspan></text>
    <text x="14" y="148" fill="#94a3b8" font-family="sans-serif" font-size="10">Address: <tspan fill="#cbd5e1">${esc((student.address || '-').slice(0, 42))}</tspan></text>
    <text x="14" y="166" fill="#cbd5e1" font-family="sans-serif" font-size="10">${esc((student.address || '').slice(42, 88))}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Parse a 2D array of worksheet rows (ignoring school banner & heading rows) into ParsedCard records. */
export function parseExcelRows(rows: unknown[][], fallbackSheetName = ''): { student: ParsedCard; rowNumber: number; text: string }[] {
  if (!rows || !rows.length) return [];

  // 1. Find the header row within the first 30 rows by counting recognized column headers.
  // School banner rows ("PM SHRI KV NFC VIGYAN VIHAR ,DELHI") and title rows ("STUDENTS DETAIL FOR I CARD")
  // only have 1 non-empty cell and 0-1 header matches, so they are automatically skipped!
  let headerRowIndex = -1;
  let bestScore = 0;
  let columnMap = new Map<number, ColumnRole>();

  const maxScanRows = Math.min(rows.length, 30);
  for (let r = 0; r < maxScanRows; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const candidateMap = new Map<number, ColumnRole>();
    let recognizedCount = 0;
    let hasIdentityCol = false;

    for (let c = 0; c < row.length; c++) {
      const role = classifyExcelHeader(row[c]);
      if (role) {
        candidateMap.set(c, role);
        if (role !== 'ignore') recognizedCount++;
        if (role === 'admission_number' || role === 'name') hasIdentityCol = true;
      }
    }

    if (recognizedCount >= 2 && hasIdentityCol && recognizedCount > bestScore) {
      bestScore = recognizedCount;
      headerRowIndex = r;
      columnMap = candidateMap;
    }
  }

  if (headerRowIndex < 0) return [];

  // Extract optional class/section hint from worksheet tab name (e.g. "XI-A" or "Class 6 B")
  const sheetHint = fallbackSheetName.trim().match(/^(?:class\s*)?(\d+|[IVX]+)[\s_-]+([A-Z])$/i);

  const results: { student: ParsedCard; rowNumber: number; text: string }[] = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    // Check if this row is a repeated table header row on a page break
    let repeatedHeaders = 0;
    for (let c = 0; c < row.length; c++) {
      const role = classifyExcelHeader(row[c]);
      if (role && role !== 'ignore') repeatedHeaders++;
    }
    if (repeatedHeaders >= 3) continue;

    const rawRecord: Partial<Record<ColumnRole, string>> = {};
    for (const [colIdx, role] of columnMap.entries()) {
      if (role === 'ignore') continue; // Strictly ignore PHOTOS NO. and MOBILE NO.-2
      const cellVal = row[colIdx];
      if (cellVal == null || String(cellVal).trim() === '') continue;

      if (role === 'date_of_birth') {
        rawRecord.date_of_birth = normalizeExcelDate(cellVal);
      } else if (role === 'parent_phone') {
        rawRecord.parent_phone = cleanExcelPhone(cellVal);
      } else if (role === 'admission_number' || role === 'roll_number' || role === 'pen_number' || role === 'student_id_kv') {
        rawRecord[role] = cleanExcelId(cellVal);
      } else {
        rawRecord[role] = cleanExcelCell(cellVal);
      }
    }

    const name = (rawRecord.name || '').replace(/^(?:mr|mrs|ms|miss|master|baby|shri|smt)\.?\s+/i, '').trim();
    const adm = (rawRecord.admission_number || rawRecord.student_id_kv || '').trim();

    // Skip empty, total, or signature footer rows
    if (!name && !adm) continue;
    if (/^(?:total|grand\s*total|signature|principal|class\s*teacher|note\b)/i.test(name)) continue;

    let cls = (rawRecord.class || '').replace(/^class\s*/i, '').trim();
    let sec = (rawRecord.section || '').trim().toUpperCase();

    if (rawRecord.class_and_sec && (!cls || !sec)) {
      const m = rawRecord.class_and_sec.match(/^(\d+|[IVX]+)(?:st|nd|rd|th)?[\s\/-]+([A-Z])$/i);
      if (m) {
        if (!cls) cls = m[1].toUpperCase();
        if (!sec) sec = m[2].toUpperCase();
      } else if (!cls) {
        cls = rawRecord.class_and_sec;
      }
    }

    // Also handle combined class in CLASS cell (e.g. "11 A" or "6-B")
    if (cls && !sec) {
      const m = cls.match(/^(\d+|[IVX]+)(?:st|nd|rd|th)?[\s\/-]+([A-Z])$/i);
      if (m) {
        cls = m[1].toUpperCase();
        sec = m[2].toUpperCase();
      }
    }

    if (!cls && sheetHint) cls = sheetHint[1].toUpperCase();
    if (!sec && sheetHint) sec = sheetHint[2].toUpperCase();

    const fatherName = (rawRecord.father_name || '').replace(/^(?:mr|shri|late|dr)\.?\s+/i, '').trim();
    const motherName = (rawRecord.mother_name || '').replace(/^(?:mrs|smt|late|dr)\.?\s+/i, '').trim();
    const phone = rawRecord.parent_phone || '';
    const dob = rawRecord.date_of_birth || '';
    const address = rawRecord.address || '';
    const rollNo = rawRecord.roll_number || '';
    const bloodGroup = (rawRecord.blood_group || '').toUpperCase().replace(/\s+/g, '');
    const penNo = rawRecord.pen_number || '';
    const studentIdKv = rawRecord.student_id_kv || '';

    const base = parseCardText('');
    const student: ParsedCard = {
      ...base,
      name,
      admission_number: adm,
      employee_id: adm,
      student_id_kv: studentIdKv,
      roll_number: rollNo,
      father_name: fatherName,
      mother_name: motherName,
      parent_name: fatherName || motherName,
      date_of_birth: dob,
      class: cls,
      section: sec,
      department: [cls, sec].filter(Boolean).join('-'),
      address,
      parent_phone: phone,
      phone,
      blood_group: bloodGroup,
      pen_number: penNo,
      email: rawRecord.email || '',
      student_email: rawRecord.email || '',
      parent_email: rawRecord.parent_email || '',
    };

    const textLines = [
      `Student Name: ${student.name}`,
      `Admission No: ${student.admission_number}`,
      student.roll_number ? `Roll No: ${student.roll_number}` : '',
      student.father_name ? `Father Name: ${student.father_name}` : '',
      student.mother_name ? `Mother Name: ${student.mother_name}` : '',
      student.date_of_birth ? `DOB: ${student.date_of_birth}` : '',
      student.class ? `Class: ${student.class}` : '',
      student.section ? `Section: ${student.section}` : '',
      student.parent_phone ? `Parent Phone: ${student.parent_phone}` : '',
      student.blood_group ? `Blood Group: ${student.blood_group}` : '',
      student.address ? `Address: ${student.address}` : '',
    ].filter(Boolean).join('\n');

    results.push({ student, rowNumber: r + 1, text: textLines });
  }

  return results;
}

/** Extract student ID card records from an Excel (.xlsx, .xls) or CSV (.csv) file. */
export async function extractExcelCards(file: File, options: ExcelExtractOptions = {}): Promise<ImportCard[]> {
  const check = () => { if (options.signal?.aborted) throw abortError(); };
  check();
  options.progress?.(`Reading spreadsheet ${file.name}…`, 10);

  const XLSX = await import('xlsx');
  check();
  const buffer = await file.arrayBuffer();
  check();

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const cards: ImportCard[] = [];

  for (const sheetName of workbook.SheetNames) {
    check();
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    const parsedRows = parseExcelRows(rows, sheetName);
    for (let i = 0; i < parsedRows.length; i++) {
      check();
      if (cards.length >= 1000) break;
      const { student, rowNumber, text } = parsedRows[i];
      const card: ImportCard = {
        id: crypto.randomUUID(),
        student,
        page: rowNumber,
        text,
        preview: createExcelCardPreviewSvg(student),
      };
      cards.push(card);
      options.onCard?.(card);
    }
    options.progress?.(
      `${cards.length} students extracted from ${file.name}`,
      Math.min(99, Math.round(((workbook.SheetNames.indexOf(sheetName) + 1) / workbook.SheetNames.length) * 100))
    );
  }

  options.progress?.(`${cards.length} students extracted from ${file.name}`, 100);
  return cards;
}
