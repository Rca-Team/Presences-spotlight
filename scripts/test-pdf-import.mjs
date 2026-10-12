import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = fs.readFileSync('src/services/enrollment/pdfParser.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseCardText, detectCardGrid, textInRegion, splitMultiCardText } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
await test('Extract all labelled student fields and preserve leading zeroes', () => {
  const card = parseCardText("PM SHRI SCHOOL\nStudent Name: Test Student\nAdmn No.: 000123\nClass: 6 Section: B\nFather's Name: Test Father\nMother Name: Test Mother\nParent Phone: +91 9999999999\nDOB: 01/02/2015\nRoll No: 007\nBlood Group: O+\nPEN No: 12345\nEmail: test@example.invalid\nAddress: Street 1\nTown\nPrincipal signature");
  assert.equal(card.name, 'Test Student'); assert.equal(card.admission_number, '000123');
  assert.equal(card.class, '6'); assert.equal(card.section, 'B'); assert.equal(card.father_name, 'Test Father');
  assert.equal(card.mother_name, 'Test Mother'); assert.equal(card.parent_phone, '+91 9999999999');
  assert.equal(card.roll_number, '007'); assert.equal(card.email, 'test@example.invalid');
  assert.equal(card.blood_group, 'O+'); assert.equal(card.pen_number, '12345'); assert.equal(card.address, 'Street 1 Town');
});
await test('Blank labels cannot consume the following field label', () => {
  const card = parseCardText('Name:\nFather Name: Parent\nDOB:\nPhone: 9999999999\nClass: VI-A');
  assert.equal(card.name, ''); assert.equal(card.father_name, 'Parent'); assert.equal(card.date_of_birth, ''); assert.equal(card.class, 'VI'); assert.equal(card.section, 'A');
});
await test('Unlabelled text never becomes an invented student identity', () => {
  const card = parseCardText('WELCOME TO SCHOOL\n2026-2027\nNameplate beside classroom');
  assert.equal(card.name, ''); assert.equal(card.admission_number, '');
});
await test('Split label/value lines and Hindi text labels are supported', () => {
  const card = parseCardText('Name:\nExample Student\nप्रवेश संख्या: 0005\nपिता का नाम: Parent Example');
  assert.equal(card.name, 'Example Student'); assert.equal(card.admission_number, '0005'); assert.equal(card.father_name, 'Parent Example');
});
await test('Real two-page PDF keeps four cards separate in a two-column layout', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 800] });
  for (let p = 0; p < 2; p++) {
    if (p) doc.addPage([600, 800]);
    for (let c = 0; c < 2; c++) {
      doc.setFontSize(12);
      doc.text(`Name: Student ${p * 2 + c + 1}`, c * 300 + 20, 70);
      doc.text(`Admission No: 00${p * 2 + c + 1}`, c * 300 + 20, 95);
      doc.text('Class: 6 Section: B', c * 300 + 20, 120);
    }
  }
  const task = getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  const students = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({scale:1});
      const content = await page.getTextContent();
      const items = content.items.filter(i => 'str' in i).map(i => { const p = viewport.convertToViewportPoint(i.transform[4], i.transform[5]); return {text:i.str,x:p[0],y:p[1],height:i.height}; });
      assert.deepEqual(detectCardGrid(items,600,800), {columns:2,rows:1});
      for (let c = 0; c < 2; c++) students.push(parseCardText(textInRegion(items,c*300,0,300,800)));
    }
  } finally { await task.destroy(); }
  assert.deepEqual(students.map(s => s.admission_number), ['001','002','003','004']);
  assert.deepEqual(students.map(s => s.name), ['Student 1','Student 2','Student 3','Student 4']);
});
await test('Real single-page PDF with 4 KVS ID cards (2×2 grid) detects all 4 students accurately', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [600, 840] });
  // Simulate Chrome browser print header & footer
  doc.setFontSize(8);
  doc.text('6/8/2026, 8:17:55 pm', 15, 12);
  doc.text('https://samagam.kvs.gov.in/mis/icard/generate-selected', 360, 12);
  doc.text('1/4', 565, 830);

  const fourStudents = [
    { name: 'AAIRA PRABHAKAR', kvId: '1000522540', father: 'MANISH PRABHAKAR', mother: 'MONA', dob: '25-07-2020', cls: '1 A', admn: '3902', pen: '22619645695', phone: '9910090846', addr: 'H.NO 33 STREET NO 2 KRISHNA NAGAR' },
    { name: 'YUVANSHI', kvId: '1000522549', father: 'YOGESH', mother: 'PREETI', dob: '18-08-2019', cls: '1 A', admn: '3907', pen: '', phone: '9868436910', addr: '437 KARKARDOOMA VILLAGE' },
    { name: 'ARJUN DHAMA', kvId: '1000522553', father: 'ANKUR DHAMA', mother: 'PREETI DHAMA', dob: '12-03-2020', cls: '1 A', admn: '3910', pen: '', phone: '9015524833', addr: 'B-235 GALI NO 3 MANDAWALI' },
    { name: 'YUVRAJ MALIK', kvId: '1000522555', father: 'ROHIT MALIK', mother: 'SHWETA MALIK', dob: '24-11-2019', cls: '1 A', admn: '3911', pen: '', phone: '8178304453', addr: 'H.NO 194 GALI NO 3GAZIPUR' },
  ];

  for (let idx = 0; idx < 4; idx++) {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ox = col * 300;
    const oy = 30 + row * 220;
    const s = fourStudents[idx];
    doc.setFontSize(9);
    doc.text('PM SHRI KENDRIYA VIDYALAYA NEW FRIENDS CENTRE', ox + 20, oy + 15);
    doc.text('VIGYAN VIHAR - SHIFT - 1', ox + 60, oy + 26);
    // Left column: Student ID, 10-digit ID, and student name caption below photo (y = oy + 135, same y as Blood Group!)
    doc.text('Student ID', ox + 15, oy + 50);
    doc.text(s.kvId, ox + 15, oy + 62);
    doc.text(s.name, ox + 12, oy + 135);
    // Right column: IDENTITY CARD & table
    doc.text('IDENTITY CARD', ox + 110, oy + 48);
    doc.text(`Father's Name : ${s.father}`, ox + 105, oy + 70);
    doc.text(`Mother's Name : ${s.mother}`, ox + 105, oy + 83);
    doc.text(`Date of Birth : ${s.dob}`, ox + 105, oy + 96);
    doc.text(`Class : ${s.cls}`, ox + 105, oy + 109);
    doc.text(`Admn No : ${s.admn}   PEN No : ${s.pen}`, ox + 105, oy + 122);
    doc.text('Blood Group : NA', ox + 105, oy + 135);
    doc.text(`Father/Mother Phone : ${s.phone}`, ox + 105, oy + 148);
    doc.text(`Address : ${s.addr}`, ox + 105, oy + 161);
  }

  const task = getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter(i => 'str' in i).map(i => {
      const p = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
      return { text: i.str, x: p[0], y: p[1], height: i.height };
    });
    const grid = detectCardGrid(items, 600, 840);
    assert.deepEqual(grid, { columns: 2, rows: 2 });
    const extracted = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const regionText = textInRegion(items, c * 300, 30 + r * 220, 300, 220);
        extracted.push(parseCardText(regionText));
      }
    }
    assert.deepEqual(extracted.map(s => s.name), ['AAIRA PRABHAKAR', 'YUVANSHI', 'ARJUN DHAMA', 'YUVRAJ MALIK']);
    assert.deepEqual(extracted.map(s => s.admission_number), ['3902', '3907', '3910', '3911']);
    assert.deepEqual(extracted.map(s => s.student_id_kv), ['1000522540', '1000522549', '1000522553', '1000522555']);
    assert.deepEqual(extracted.map(s => s.father_name), ['MANISH PRABHAKAR', 'YOGESH', 'ANKUR DHAMA', 'ROHIT MALIK']);
    assert.deepEqual(extracted.map(s => s.blood_group), ['', '', '', '']);
  } finally {
    await task.destroy();
  }
});
await test('Grid detection handles 4 cards (2×2), 8 cards (2×4), 10 cards (2×5), split tokens, and falls back for empty pages', () => {
  const items8 = Array.from({length:8},(_,i)=>({text:'Admission No: '+i,x:30+(i%2)*300,y:70+Math.floor(i/2)*200}));
  assert.deepEqual(detectCardGrid(items8,600,800),{columns:2,rows:4});

  const items10 = Array.from({length:10},(_,i)=>({text:"Father's Name",x:110+(i%2)*300,y:60+Math.floor(i/2)*150}));
  assert.deepEqual(detectCardGrid(items10,600,840),{columns:2,rows:5});

  // Split words on each card ("Admn" at x, "No" at x+28)
  const splitItems4 = [0, 1, 2, 3].flatMap(i => [
    { text: 'Admn', x: 100 + (i % 2) * 300, y: 100 + Math.floor(i / 2) * 240, height: 10 },
    { text: 'No', x: 128 + (i % 2) * 300, y: 100 + Math.floor(i / 2) * 240, height: 10 },
  ]);
  assert.deepEqual(detectCardGrid(splitItems4, 600, 800), { columns: 2, rows: 2 });

  assert.deepEqual(detectCardGrid([],600,800),{columns:1,rows:1});
});
await test('splitMultiCardText splits concatenated 4-student page text into 4 separate cards', () => {
  const combined = [1, 2, 3, 4].map(n => `PM SHRI KENDRIYA VIDYALAYA\nStudent ID\n100052254${n}\nSTUDENT ${n}\nFather's Name: FATHER ${n}\nAdmn No: 390${n}\nClass: 1 A`).join('\n');
  const chunks = splitMultiCardText(combined);
  assert.equal(chunks.length, 4);
  const parsed = chunks.map(c => parseCardText(c));
  assert.deepEqual(parsed.map(p => p.admission_number), ['3901', '3902', '3903', '3904']);
});
console.log(`${passed} PDF import tests passed`);

