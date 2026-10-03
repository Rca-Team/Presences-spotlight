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
  const normalized = text.replace(/\r/g, '').replace(/[\t ]+/g, ' ')
    .replace(new RegExp(` +(?=(?:${allLabels}) *[:=])`, 'gi'), '\n');
  const result = Object.fromEntries(Object.keys(patterns).map(k => [k, ''])) as StudentDetails;
  let current: keyof StudentDetails | null = null;
  for (const line of normalized.split('\n')) {
    let matched = false;
    for (const [field, pattern] of Object.entries(patterns)) {
      const match = line.match(new RegExp(`^ *${pattern} *(?:[:=–-]+ *)?(.*)$`, 'i'));
      if (!match) continue;
      current = field as keyof StudentDetails;
      result[current] = match[1].trim(); matched = true; break;
    }
    if (!matched && current === 'address' && line.trim()) result.address += ' ' + line.trim();
  }
  const combined = result.class.match(/^(\d+|[IVX]+)\s*[-/]\s*([A-Z])$/i);
  if (combined && !result.section) { result.class = combined[1]; result.section = combined[2].toUpperCase(); }
  return result;
}
