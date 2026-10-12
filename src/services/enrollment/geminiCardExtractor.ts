import { parseCardText, type ParsedCard } from './pdfParser';

export interface GeminiExtractedCard extends ParsedCard {
  employee_id: string;
  department: string;
  barcode?: string;
  has_photo?: boolean;
  card_bbox?: { x: number; y: number; width: number; height: number } | null;
  photo_bbox?: { x: number; y: number; width: number; height: number } | null;
}

export interface GeminiPageExtractionResult {
  cards: GeminiExtractedCard[];
  grid_columns?: number;
  grid_rows?: number;
  class_detected?: string;
  model_used?: string;
}

const PREFERRED_MODELS = [
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const EXCLUDED_MODEL_SUBSTRINGS = [
  'embedding',
  'aqa',
  'tts',
  '-image',
  'lyria',
  'transcribe',
  'robotics',
  'computer-use',
  'banana',
  'deep-research',
  'antigravity',
];

let cachedCandidateModels: string[] | null = null;
let lastWorkingModel: string | null = null;

export function getGeminiApiKey(): string {
  try {
    const viteEnv = (import.meta as any)?.env;
    if (viteEnv?.VITE_GEMINI_API_KEY) return String(viteEnv.VITE_GEMINI_API_KEY).trim();
    if (viteEnv?.GEMINI_API_KEY) return String(viteEnv.GEMINI_API_KEY).trim();
  } catch {
    // ignore in non-Vite environments
  }
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.VITE_GEMINI_API_KEY) return String(process.env.VITE_GEMINI_API_KEY).trim();
      if (process.env.GEMINI_API_KEY) return String(process.env.GEMINI_API_KEY).trim();
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('gemini_api_key');
      if (stored) return stored.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

function abortError(): DOMException {
  return new DOMException('Extraction cancelled.', 'AbortError');
}

/**
 * Dynamic ListModels discovery inspired by commit af2e2e4 / 8d5598e.
 * Queries available generateContent models for the API key and prioritizes
 * fast, active Gemini Flash models while remembering the last working model.
 */
export async function resolveCandidateGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  if (cachedCandidateModels && cachedCandidateModels.length > 0) {
    if (lastWorkingModel) {
      return [lastWorkingModel, ...cachedCandidateModels.filter(m => m !== lastWorkingModel)];
    }
    return cachedCandidateModels;
  }

  const ordered: string[] = [];
  const addUnique = (name: string) => {
    const clean = name.replace(/^models\//, '').trim();
    if (!clean) return;
    if (EXCLUDED_MODEL_SUBSTRINGS.some(sub => clean.toLowerCase().includes(sub))) return;
    if (!ordered.includes(clean)) ordered.push(clean);
  };

  try {
    const listResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal }
    );
    if (listResp.ok) {
      const listData = await listResp.json();
      const discoveredSet = new Set<string>(
        (listData.models || [])
          .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => String(m.name || '').replace(/^models\//, '').trim())
          .filter(Boolean)
      );

      // 1. Add preferred models that exist in discoveredSet first
      for (const pref of PREFERRED_MODELS) {
        if (discoveredSet.has(pref)) addUnique(pref);
      }

      // 2. Add any other discovered flash models
      for (const m of discoveredSet) {
        if (m.toLowerCase().includes('flash')) addUnique(m);
      }

      // 3. Add any other discovered pro models
      for (const m of discoveredSet) {
        if (m.toLowerCase().includes('pro')) addUnique(m);
      }
    }
  } catch (err) {
    if (signal?.aborted) throw abortError();
  }

  for (const pref of PREFERRED_MODELS) {
    addUnique(pref);
  }

  cachedCandidateModels = ordered;
  if (lastWorkingModel) {
    return [lastWorkingModel, ...ordered.filter(m => m !== lastWorkingModel)];
  }
  return ordered;
}

/**
 * Multi-strategy JSON parser inspired by commit af2e2e4.
 * Handles clean JSON, markdown fences, truncated JSON arrays, trailing commas,
 * and regex recovery of individual student card objects.
 */
export function parseGeminiResponse(rawText: string): {
  users: any[];
  grid_columns?: number;
  grid_rows?: number;
  class_detected?: string;
} {
  if (!rawText || typeof rawText !== 'string') {
    return { users: [] };
  }

  let text = rawText.trim();
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  text = text.trim();

  const extractList = (obj: any): any[] | null => {
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj?.users)) return obj.users;
    if (Array.isArray(obj?.cards)) return obj.cards;
    if (Array.isArray(obj?.students)) return obj.students;
    return null;
  };

  // Strategy 1: Direct JSON.parse
  try {
    const direct = JSON.parse(text);
    const list = extractList(direct);
    if (list) {
      return {
        users: list,
        grid_columns: Number(direct?.grid_columns) || undefined,
        grid_rows: Number(direct?.grid_rows) || undefined,
        class_detected: direct?.class_detected,
      };
    }
  } catch {}

  // Strategy 2: Extract top-level JSON object or array substring
  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(candidate);
      const list = extractList(parsed);
      if (list) {
        return {
          users: list,
          grid_columns: Number(parsed?.grid_columns) || undefined,
          grid_rows: Number(parsed?.grid_rows) || undefined,
          class_detected: parsed?.class_detected,
        };
      }
    }
  } catch {}

  // Strategy 3: Handle truncated array/object (repair unclosed brackets)
  try {
    for (const key of ['"users"', '"cards"', '"students"']) {
      const idx = text.indexOf(key);
      if (idx !== -1) {
        const arrayStart = text.indexOf('[', idx);
        if (arrayStart !== -1) {
          let sub = text.slice(arrayStart);
          const lastObjEnd = sub.lastIndexOf('}');
          if (lastObjEnd !== -1) {
            sub = sub.slice(0, lastObjEnd + 1) + ']';
            sub = sub.replace(/,\s*\]/g, ']');
            const parsedUsers = JSON.parse(sub);
            if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
              return { users: parsedUsers };
            }
          }
        }
      }
    }
  } catch {}

  // Strategy 4: Regex-based individual student object extractor
  const recovered: any[] = [];
  const objectRegex = /\{[^{}]*?(?:"name"|"employee_id"|"admission_number"|"student_name"|"admn_no"|"student_id_kv")[^{}]*?\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(text)) !== null) {
    try {
      const sanitized = match[0].replace(/[\u0000-\u001F]+/g, ' ');
      const student = JSON.parse(sanitized);
      if (student.name || student.employee_id || student.admission_number || student.student_name || student.student_id_kv) {
        recovered.push(student);
      }
    } catch {}
  }

  if (recovered.length > 0) {
    return { users: recovered };
  }

  // Strategy 5: Block boundary splitting
  const blocks = text.split(/(?<=\})\s*,\s*(?=\{)/);
  for (const b of blocks) {
    try {
      const cleanedBlock = b.trim().replace(/^\[\s*/, '').replace(/\s*\]$/, '');
      if (cleanedBlock.startsWith('{') && cleanedBlock.endsWith('}')) {
        const item = JSON.parse(cleanedBlock);
        if (item.name || item.employee_id || item.admission_number) {
          recovered.push(item);
        }
      }
    } catch {}
  }

  return { users: recovered };
}

function cleanFieldValue(val: unknown): string {
  const s = String(val ?? '').trim();
  if (/^(?:na|n\/a|nil|none|null|undefined|-|--)$/i.test(s)) return '';
  return s;
}

export function normalizeGeminiCard(raw: any, targetCategory?: string): GeminiExtractedCard {
  const base = parseCardText('');
  let rawClass = cleanFieldValue(raw?.class);
  let rawSection = cleanFieldValue(raw?.section).toUpperCase();
  let rawDept = cleanFieldValue(raw?.department);

  // Split combined class + section like "10 A", "10-A", "1 A", "VI-B"
  const combinedClassMatch = rawClass.match(/^(\d{1,2}|[IVX]{1,4})\s*[-_/\s]\s*([A-Z])$/i);
  if (combinedClassMatch) {
    rawClass = combinedClassMatch[1].toUpperCase();
    rawSection = rawSection || combinedClassMatch[2].toUpperCase();
  }

  const deptMatch = rawDept.match(/^(?:class\s*)?(\d{1,2}|[IVX]{1,4})\s*[-_/\s]\s*([A-Z])$/i);
  if (deptMatch) {
    rawClass = rawClass || deptMatch[1].toUpperCase();
    rawSection = rawSection || deptMatch[2].toUpperCase();
  }

  if (targetCategory && targetCategory !== 'auto') {
    const targetMatch = targetCategory.match(/^(?:class\s*)?(\d{1,2}|[IVX]{1,4})\s*[-_/\s]\s*([A-Z])$/i);
    if (targetMatch) {
      rawClass = rawClass || targetMatch[1].toUpperCase();
      rawSection = rawSection || targetMatch[2].toUpperCase();
    }
  }

  rawClass = rawClass.replace(/[^0-9IVXivx]/g, '').toUpperCase();
  rawSection = rawSection.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
  const department = [rawClass, rawSection].filter(Boolean).join('-');

  const studentIdKv = cleanFieldValue(raw?.student_id_kv || raw?.student_id || raw?.kv_id).replace(/\s+/g, '');
  const admissionNumber =
    cleanFieldValue(raw?.admission_number || raw?.employee_id || raw?.admn_no || raw?.admission_no) ||
    studentIdKv;

  const rawPhone = cleanFieldValue(raw?.parent_phone || raw?.phone || raw?.mobile || raw?.father_mother_phone);
  const phoneDigits = rawPhone.replace(/\D/g, '');
  const parentPhone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : rawPhone;

  const fatherName = cleanFieldValue(raw?.father_name || raw?.fathers_name);
  const motherName = cleanFieldValue(raw?.mother_name || raw?.mothers_name);
  const parentName = cleanFieldValue(raw?.parent_name) || fatherName || motherName;

  const parseBbox = (box: any) => {
    if (!box || typeof box !== 'object') return null;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if ([x, y, width, height].some(n => Number.isNaN(n)) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  };

  return {
    ...base,
    name: cleanFieldValue(raw?.name || raw?.student_name).replace(/\s+/g, ' '),
    admission_number: admissionNumber,
    employee_id: admissionNumber,
    student_id_kv: studentIdKv,
    class: rawClass,
    section: rawSection,
    department,
    father_name: fatherName,
    mother_name: motherName,
    parent_name: parentName,
    parent_phone: parentPhone,
    date_of_birth: cleanFieldValue(raw?.date_of_birth || raw?.dob),
    pen_number: cleanFieldValue(raw?.pen_number || raw?.pen_no),
    blood_group: cleanFieldValue(raw?.blood_group),
    address: cleanFieldValue(raw?.address).replace(/\s+/g, ' '),
    roll_number: cleanFieldValue(raw?.roll_number || raw?.roll_no),
    email: cleanFieldValue(raw?.email || raw?.student_email),
    student_email: cleanFieldValue(raw?.student_email || raw?.email),
    parent_email: cleanFieldValue(raw?.parent_email),
    barcode: cleanFieldValue(raw?.barcode),
    has_photo: Boolean(raw?.has_photo ?? true),
    card_bbox: parseBbox(raw?.card_bbox),
    photo_bbox: parseBbox(raw?.photo_bbox),
  };
}

export const MULTI_CARD_PAGE_PROMPT = `You are an expert AI extractor for PM SHRI Kendriya Vidyalaya (KVS Samagam) and school student identity cards.

CRITICAL INSTRUCTIONS FOR MULTI-CARD PAGES:
1. A single page often contains MULTIPLE student ID cards arranged in a grid — for example:
   - 10 ID cards on one page (2 columns × 5 rows)
   - 8 ID cards on one page (2 columns × 4 rows)
   - 6 ID cards on one page (2 columns × 3 rows)
   - 4 ID cards on one page (2 columns × 2 rows)
   - 2 ID cards on one page (2 columns × 1 row or 1 column × 2 rows)
   - 1 ID card on one page (1 column × 1 row)
2. Count and extract EVERY SINGLE STUDENT ID CARD on the page in strict reading order: LEFT-TO-RIGHT across each row, from TOP ROW to BOTTOM ROW. Never stop after the first card!
3. On PM SHRI Kendriya Vidyalaya (KVS) ID cards:
   - Left column under the header has "Student ID" with a 10-digit number (put this in "student_id_kv", e.g. "1000522540"), the student's portrait photo, and the STUDENT'S FULL NAME in bold uppercase directly below the photo (put this in "name", e.g. "SANIA PRAKASH", "AAIRA PRABHAKAR").
   - Right column ("IDENTITY CARD") has:
     * Father's Name -> "father_name"
     * Mother's Name -> "mother_name"
     * Date of Birth -> "date_of_birth" (DD-MM-YYYY)
     * Class -> split into "class" (e.g. "10" or "1") and "section" (e.g. "A")
     * Admn No -> put in both "admission_number" and "employee_id" (preserve leading zeroes; do NOT confuse with Student ID or PEN No)
     * PEN No -> "pen_number" (leave "" if blank)
     * Blood Group -> "blood_group" (leave "" if "NA" or blank)
     * Father/Mother Phone -> "parent_phone" (10-digit phone number)
     * Address -> "address" (complete residential address)

Return ONLY valid JSON in this exact structure:
{
  "card_count": 10,
  "grid_columns": 2,
  "grid_rows": 5,
  "class_detected": "10-A",
  "users": [
    {
      "name": "",
      "admission_number": "",
      "employee_id": "",
      "student_id_kv": "",
      "class": "",
      "section": "",
      "department": "",
      "father_name": "",
      "mother_name": "",
      "parent_phone": "",
      "date_of_birth": "",
      "pen_number": "",
      "blood_group": "",
      "address": "",
      "roll_number": "",
      "has_photo": true
    }
  ]
}`;

export async function callGeminiGenerateContent(
  apiKey: string,
  parts: unknown[],
  signal?: AbortSignal
): Promise<{ text: string; model: string }> {
  const models = await resolveCandidateGeminiModels(apiKey, signal);
  let lastError = 'Gemini did not return ID card data.';

  for (const model of models) {
    if (signal?.aborted) throw abortError();
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
              maxOutputTokens: 32768,
            },
          }),
        }
      );

      if (!response.ok) {
        const errBody = await response.text();
        lastError = `${model} (${response.status}): ${errBody.slice(0, 200)}`;
        continue;
      }

      const payload = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts || [])
        .filter((part: any) => !part?.thought)
        .map((part: any) => part?.text || '')
        .join('');

      if (text && text.trim()) {
        lastWorkingModel = model;
        return { text, model };
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw abortError();
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError.slice(0, 280));
}

export async function extractPageWithGemini(
  mimeType: string,
  base64Data: string,
  options: {
    pageNumber?: number;
    totalPages?: number;
    targetCategory?: string;
    signal?: AbortSignal;
  } = {}
): Promise<GeminiPageExtractionResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('missing-key');

  const pageContext =
    options.pageNumber && options.totalPages
      ? `\nThis is page ${options.pageNumber} of ${options.totalPages}. Extract EVERY student ID card visible on this page.`
      : '\nExtract EVERY student ID card visible in this document/image.';

  const parts = [
    { text: `${MULTI_CARD_PAGE_PROMPT}${pageContext}` },
    { inlineData: { mimeType, data: base64Data } },
  ];

  const { text, model } = await callGeminiGenerateContent(apiKey, parts, options.signal);
  const parsed = parseGeminiResponse(text);
  const cards = parsed.users
    .map(u => normalizeGeminiCard(u, options.targetCategory))
    .filter(c => Boolean(c.name || c.admission_number || c.student_id_kv));

  return {
    cards,
    grid_columns: parsed.grid_columns,
    grid_rows: parsed.grid_rows,
    class_detected: parsed.class_detected || cards[0]?.department,
    model_used: model,
  };
}
