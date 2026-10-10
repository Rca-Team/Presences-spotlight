import { parseCardText, type ParsedCard } from './pdfParser';
import type { ImportCard } from './types';

/** "99100146I6", "+91 99100-14616" → the ten digits that actually dial. */
function normalizePhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function cardToRegistrationStudent(card: ImportCard, targetCategory?: string) {
  const fresh = parseCardText(card.text || '');
  const stored = Object.fromEntries(
    Object.entries(card.student || {}).filter(([, value]) => {
      const s = String(value ?? '').trim();
      return s && !s.toLowerCase().startsWith('admission_number:') && !s.toLowerCase().startsWith('scan failed');
    })
  ) as Partial<ParsedCard>;

  // Merge preferring whichever has non-empty, clean value
  const parsed: ParsedCard = { ...fresh };
  for (const [key, val] of Object.entries(stored)) {
    const k = key as keyof ParsedCard;
    const str = String(val ?? '').trim();
    if (str && (!(parsed as any)[k] || str.length > String((parsed as any)[k] || '').length)) {
      (parsed as any)[k] = str;
    }
  }

  const target = targetCategory?.match(/^(\d+|[IVX]+)[\s-]+([A-Z])$/i);
  const cls = target?.[1] || parsed.class;
  const section = target?.[2]?.toUpperCase() || parsed.section;
  const parentPhone = normalizePhone(parsed.parent_phone) || parsed.parent_phone;
  const studentName = (parsed.name || '')
    .replace(/^name[:\s-]+/i, '')
    .replace(/^admission_number[:\s-]+/i, '')
    .trim();
  const admissionNumber = (parsed.admission_number || '').replace(/^admn?[:\s-]+/i, '').trim();
  const studentId = parsed.student_id_kv || admissionNumber;
  const parentName = parsed.father_name || parsed.mother_name || parsed.parent_name || '';

  return {
    ...parsed,
    name: studentName,
    class: cls,
    section,
    employee_id: admissionNumber || studentId,
    admission_number: admissionNumber || studentId,
    student_id: admissionNumber || studentId,
    student_id_kv: studentId,
    department: [cls, section].filter(Boolean).join('-'),
    position: 'Student',
    parent_name: parentName,
    father_name: parsed.father_name || '',
    mother_name: parsed.mother_name || '',
    parent_phone: parentPhone,
    phone: parentPhone,
    student_email: parsed.email || parsed.student_email || '',
    parent_email: parsed.parent_email || '',
    date_of_birth: parsed.date_of_birth || '',
    blood_group: parsed.blood_group || '',
    roll_number: parsed.roll_number || '',
    pen_number: parsed.pen_number || '',
    address: parsed.address || '',
    has_photo: Boolean(card.portrait),
    photo_url: card.portrait,
    student_photo_data_url: card.portrait,
    image_data: card.portrait?.split(',')[1],
  };
}

/** Compatibility for old ID-card screens: never send document bytes to a Function. */
export async function extractLegacyIdCard(body: { fileData?: unknown; fileName?: string; fileType?: string; targetCategory?: string }) {
  const { extractPdfUsers } = await import('./extractPdfUsers');
  return extractPdfUsers(body);
}
