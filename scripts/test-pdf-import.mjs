import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = fs.readFileSync('src/services/enrollment/pdfParser.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseCardText, detectCardGrid, textInRegion } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
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
await test('Grid detection handles eight cards and falls back for irregular anchors', () => {
  const items = Array.from({length:8},(_,i)=>({text:'Admission No: '+i,x:30+(i%2)*300,y:70+Math.floor(i/2)*200}));
  assert.deepEqual(detectCardGrid(items,600,800),{columns:2,rows:4});
  assert.deepEqual(detectCardGrid([],600,800),{columns:1,rows:1});
});
console.log(`${passed} PDF import tests passed`);
