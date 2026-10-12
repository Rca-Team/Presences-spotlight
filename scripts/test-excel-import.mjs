import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { extractExcelCards, classifyExcelHeader } from '../src/services/enrollment/excelImport.ts';

// 1. Verify exact header classifications from screenshot
assert.equal(classifyExcelHeader('Roll\nNo.'), 'roll_number');
assert.equal(classifyExcelHeader('ADM.NO.'), 'admission_number');
assert.equal(classifyExcelHeader('STUDENT NAME'), 'name');
assert.equal(classifyExcelHeader('FATHERS NAME'), 'father_name');
assert.equal(classifyExcelHeader('D.O.B'), 'date_of_birth');
assert.equal(classifyExcelHeader('CLASS'), 'class');
assert.equal(classifyExcelHeader('SECTIO\nN'), 'section');
assert.equal(classifyExcelHeader('ADDRESS'), 'address');
assert.equal(classifyExcelHeader('MOBILE NO.-1'), 'parent_phone');
assert.equal(classifyExcelHeader('MOBILE NO.-2'), 'ignore');
assert.equal(classifyExcelHeader('BLOOD\nGROUP'), 'blood_group');
assert.equal(classifyExcelHeader('PHOTOS NO.'), 'ignore');

// 2. Build an actual .xlsx workbook matching the screenshot layout
const aoa = [
  ['PM SHRI KV NFC VIGYAN VIHAR ,DELHI', '', '', '', '', '', '', '', '', '', '', ''],
  ['STUDENTS DETAIL FOR I CARD', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Roll\nNo.',
    'ADM.NO.',
    'STUDENT NAME',
    'FATHERS NAME',
    'D.O.B',
    'CLASS',
    'SECTIO\nN',
    'ADDRESS',
    'MOBILE NO.-1',
    'MOBILE NO.-2',
    'BLOOD\nGROUP',
    'PHOTOS NO.',
  ],
  [
    '01',
    '10486',
    'ADITYA TOMAR',
    'SUDHIR KUMAR',
    '09-03-2011',
    '11',
    'A',
    'A-1/67/18 EAST GOKULPURI DELHI 110094',
    '9910014616',
    '8888888888',
    'A-',
    'DSC_0042',
  ],
  [
    '02',
    '00512',
    'AARAV SHARMA',
    'RAJESH SHARMA',
    '15/08/2014',
    '6',
    'B',
    'VIGYAN VIHAR DELHI',
    '+91 9876543210',
    '7777777777',
    'O+',
    'DSC_0043',
  ],
];

const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Students');
const xlsxBytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const file = new File([xlsxBytes], 'students-icard.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

const cards = await extractExcelCards(file);
assert.equal(cards.length, 2);

assert.equal(cards[0].student.roll_number, '01');
assert.equal(cards[0].student.admission_number, '10486');
assert.equal(cards[0].student.employee_id, '10486');
assert.equal(cards[0].student.name, 'ADITYA TOMAR');
assert.equal(cards[0].student.father_name, 'SUDHIR KUMAR');
assert.equal(cards[0].student.date_of_birth, '09-03-2011');
assert.equal(cards[0].student.class, '11');
assert.equal(cards[0].student.section, 'A');
assert.equal(cards[0].student.department, '11-A');
assert.equal(cards[0].student.address, 'A-1/67/18 EAST GOKULPURI DELHI 110094');
assert.equal(cards[0].student.parent_phone, '9910014616');
assert.equal(cards[0].student.blood_group, 'A-');
assert.ok(!cards[0].text.includes('8888888888'), 'Second mobile number must be ignored');
assert.ok(!cards[0].text.includes('DSC_0042'), 'Photos No. must be ignored');

assert.equal(cards[1].student.roll_number, '02');
assert.equal(cards[1].student.admission_number, '00512');
assert.equal(cards[1].student.name, 'AARAV SHARMA');
assert.equal(cards[1].student.father_name, 'RAJESH SHARMA');
assert.equal(cards[1].student.date_of_birth, '15-08-2014');
assert.equal(cards[1].student.class, '6');
assert.equal(cards[1].student.section, 'B');
assert.equal(cards[1].student.parent_phone, '9876543210');
assert.equal(cards[1].student.blood_group, 'O+');

console.log('PASS: Excel ID-card sheet ignores school/heading banner, MOBILE NO.-2, and PHOTOS NO., and extracts all student fields.');
