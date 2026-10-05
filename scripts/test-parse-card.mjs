import { parseCardText } from '../src/services/enrollment/pdfParser';

const sample = `PM SHRI KENDRIYA VIDYALAYA NEW FRIENDS CENTRE
VIGYAN VIHAR - SHIFT - 1
PM SHRI KV NFC VIGYAN VIHAR, OPPOSITE VIVEK VIHAR POLICE STATION.
Ph: 011-22151215
Student ID
1000536073
ADITYA TOMAR
IDENTITY CARD
Session : 2026-27
Father Name: SUDHIR KUMAR
Mother Name: NISHA
Date of Birth: 09-03-2011
Class: 11 A
Admn No: 10486
PEN No: 20467167894
Blood Group: A-
Father/Mother Phone: 9910014616
Address: A-1/67/18 EAST GOKULPURI EAST
EAST DELHI Delhi110094
91429116010486
Signature of Principal`;

// Same card where OCR splits the label from its value across lines.
const split = `Student ID 1000536073
ADITYA
TOMAR
IDENTITY CARD
Father Name
SUDHIR KUMAR
Mother Name
NISHA
Date of Birth
09-03-2011
Class
11 A
Admn No
10486
Father/Mother Phone
9910014616
Address
A-1/67/18 EAST GOKULPURI
EAST DELHI Delhi110094
Signature of Principal`;

const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : `  (wanted ${JSON.stringify(wanted)})`}`);
  return ok;
};

let ok = true;
const a = parseCardText(sample);
ok = expect('name', a.name, 'ADITYA TOMAR') && ok;
ok = expect('father_name', a.father_name, 'SUDHIR KUMAR') && ok;
ok = expect('mother_name', a.mother_name, 'NISHA') && ok;
ok = expect('date_of_birth', a.date_of_birth, '09-03-2011') && ok;
ok = expect('class', a.class, '11') && ok;
ok = expect('section', a.section, 'A') && ok;
ok = expect('admission_number', a.admission_number, '10486') && ok;
ok = expect('pen_number', a.pen_number, '20467167894') && ok;
ok = expect('blood_group', a.blood_group, 'A-') && ok;
ok = expect('parent_phone', a.parent_phone, '9910014616') && ok;
ok = expect('address', a.address, 'A-1/67/18 EAST GOKULPURI EAST EAST DELHI Delhi110094') && ok;
ok = expect('student_id_kv', a.student_id_kv, '1000536073') && ok;

const b = parseCardText(split);
ok = expect('split name', b.name, 'ADITYA TOMAR') && ok;
ok = expect('split father', b.father_name, 'SUDHIR KUMAR') && ok;
ok = expect('split mother', b.mother_name, 'NISHA') && ok;
ok = expect('split dob', b.date_of_birth, '09-03-2011') && ok;
ok = expect('split class', b.class, '11') && ok;
ok = expect('split section', b.section, 'A') && ok;
ok = expect('split admission', b.admission_number, '10486') && ok;
ok = expect('split phone', b.parent_phone, '9910014616') && ok;
ok = expect('split address', b.address, 'A-1/67/18 EAST GOKULPURI EAST DELHI Delhi110094') && ok;

console.log(ok ? '\nALL PASS' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
