import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
let source = fs.readFileSync('src/services/enrollment/bulkPdfExtractor.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
source = source.replace(/import\.meta\.env/g, '({})');
source = 'const functions = globalThis.saveFunctions; const ExecutionMethod = { POST: "POST" };\n' + source;
let calls = 0;
let response = { status: 'completed', responseStatusCode: 200, responseBody: JSON.stringify({ saved: ['001'], failed: [] }) };
globalThis.saveFunctions = {
  async createExecution(request) {
    calls++;
    assert.equal(request.async, false);
    assert.equal(request.functionId, 'presences-backend');
    assert.equal(JSON.parse(request.body).action, 'idcards.save');
    return response;
  },
  async getExecution() { throw new Error('Polling cannot retrieve a response body.'); },
};
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { idCardFunction } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
assert.deepEqual(await idCardFunction({ action: 'idcards.save' }), { saved: ['001'], failed: [] });
response = { status: 'completed', responseStatusCode: 403, responseBody: '{"error":"Administrator access required"}' };
await assert.rejects(idCardFunction({ action: 'idcards.save' }), /Administrator access required/);
response = { status: 'completed', responseStatusCode: 200, responseBody: '' };
await assert.rejects(idCardFunction({ action: 'idcards.save' }), /some records may already be saved/);
const controller = new AbortController(); controller.abort();
await assert.rejects(idCardFunction({ action: 'idcards.save' }, controller.signal), error => error.name === 'AbortError');
assert.equal(calls, 3);
console.log('PASS: synchronous save response, server rejection, unconfirmed result and cancellation; no result polling.');
