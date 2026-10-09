import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
let source = fs.readFileSync('src/services/enrollment/bulkPdfExtractor.ts', 'utf8');
source = source.replace(/^import .*;\r?\n/gm, '');
const start = source.indexOf('export async function idCardFunction');
const end = source.indexOf('export async function extractBulkPdf');
source = source.slice(0, start) + 'const parseCardText = () => ({}); const idCardFunction = globalThis.pageUpload;\n' + source.slice(end);
// Resolve the real PDF library from this test rather than a data URL.
source = source.replace("await import('pdf-lib')", 'globalThis.pdfLibrary');
globalThis.pdfLibrary = { PDFDocument };
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = 'data:application/pdf;base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror()); }
};
let calls = 0;
globalThis.pageUpload = async body => {
  const page = await PDFDocument.load(Buffer.from(body.fileData, 'base64'));
  assert.equal(page.getPageCount(), 1);
  assert.equal(body.page, 1);
  assert.equal(page.getPage(0).getWidth(), 500 + calls);
  calls++;
  return { cards: [{ name: `Student ${calls}` }] };
};
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { extractBulkPdf } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const pdf = await PDFDocument.create();
pdf.addPage([500, 700]); pdf.addPage([501, 700]);
const bytes = await pdf.save();
// PDF readers permit trailing bytes; exercise the former 6 MB boundary.
const file = new File([bytes, new Uint8Array(7 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });
const cards = [];
await extractBulkPdf(file, { signal: new AbortController().signal, progress() {}, onCard: card => cards.push(card) });
assert.equal(calls, 2); assert.deepEqual(cards.map(card => card.page), [1, 2]);
await assert.rejects(extractBulkPdf(new File([new Uint8Array(51 * 1024 * 1024)], 'too-large.pdf'), { signal: new AbortController().signal }), /50 MB/);
console.log('PASS: PDF above 6 MB accepted, one-page requests preserve order and page numbers, above 50 MB rejected.');
