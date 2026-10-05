import { parseCardText, type ParsedCard } from './pdfParser';
import type { ImportCard } from './types';

/** "99100146I6", "+91 99100-14616" → the ten digits that actually dial. */
function normalizePhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function cardToRegistrationStudent(card: ImportCard, targetCategory?: string) {
  const fresh = parseCardText(card.text);
  // Keep every non-empty value already attached to the card, but recover from
  // the raw text anything that was dropped while building it.
  const stored = Object.fromEntries(Object.entries(card.student || {}).filter(([, value]) => String(value ?? '').trim()));
  const parsed = { ...fresh, ...stored } as ParsedCard;
  const target = targetCategory?.match(/^(\d+|[IVX]+)[\s-]+([A-Z])$/i);
  const cls = target?.[1] || parsed.class;
  const section = target?.[2]?.toUpperCase() || parsed.section;
  const parentPhone = normalizePhone(parsed.parent_phone) || parsed.parent_phone;
  return {
    ...parsed, class: cls, section, employee_id: parsed.admission_number,
    student_id: parsed.admission_number, student_id_kv: parsed.student_id_kv || parsed.admission_number,
    department: [cls, section].filter(Boolean).join('-'), position: 'Student',
    parent_name: parsed.father_name || parsed.mother_name,
    parent_phone: parentPhone, phone: parentPhone,
    student_email: parsed.email, has_photo: Boolean(card.portrait),
    photo_url: card.portrait, student_photo_data_url: card.portrait,
    image_data: card.portrait?.split(',')[1],
  };
}

/** Compatibility for old ID-card screens: never send document bytes to a Function. */
export async function extractLegacyIdCard(body: { fileData?: unknown; fileName?: string; fileType?: string; targetCategory?: string }) {
  const { extractPdfUsers } = await import('./extractPdfUsers');
  return extractPdfUsers(body);
}
