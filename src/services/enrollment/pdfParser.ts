import type { StudentDetails } from './types';

// Read only explicitly labelled fields. OCR guesses must never invent identity data.
export function parseCardText(text: string): StudentDetails {
  const patterns: Record<keyof StudentDetails, string> = {
    name: '(?:student(?:[’\x27]s)?\\s*name|name)',
    admission_number: '(?:admission\\s*(?:no\\.?|number|#)|adm\\.?\\s*no\\.?|scholar\\s*(?:no\\.?|number))',
    class: '(?:class|grade)', section: '(?:section|sec\\.?)',
    father_name: '(?:father(?:[’\x27]s)?\\s*name|father)', mother_name: '(?:mother(?:[’\x27]s)?\\s*name|mother)',
    parent_phone: '(?:parent\\s*(?:phone|mobile)|contact(?:\\s*no\\.?)?|mobile(?:\\s*no\\.?)?|phone(?:\\s*no\\.?)?)',
    date_of_birth: '(?:date\\s*of\\s*birth|d\\.?o\\.?b\\.?)', address: '(?:address)',
  };
  const allLabels = Object.values(patterns).join('|');
  const normalized = text.replace(/\r/g, '').replace(/[\t ]+/g, ' ');
  return Object.fromEntries(Object.entries(patterns).map(([field, pattern]) => {
    const match = normalized.match(new RegExp(`(?:^|\\n)\\s*${pattern}\\s*[:=–-]?\\s*(.*?)(?=\\s+(?:${allLabels})\\s*[:=]|\\n|$)`, 'i'));
    return [field, match?.[1]?.trim() || ''];
  })) as StudentDetails;
}
