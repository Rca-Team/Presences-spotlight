import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
let handler, calls = 0, labels = ['admin'];
globalThis.Deno = { env: { get: () => undefined }, serve: fn => { handler = fn; } };
globalThis.fetch = async (_url, options) => {
  assert.equal(options.headers['x-appwrite-jwt'], 'test-session');
  return { ok: true, json: async () => ({ $id: 'verified-admin', labels }) };
};
let source = fs.readFileSync('supabase/functions/extract-pdf-users/index.ts', 'utf8');
source = source.replace("import { bulkIdCards } from '../_shared/bulk-id-cards.js';", 'const bulkIdCards = async (body, user) => { globalThis.extractedUser = user.$id; globalThis.extractCalls++; return { cards: [], page: body.page }; };');
globalThis.extractCalls = 0;
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const request = (body, token = true) => new Request('https://example.supabase.co/functions/v1/extract-pdf-users', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-appwrite-user-jwt': 'test-session' } : {}) }, body: JSON.stringify(body),
});
assert.equal((await handler(new Request('https://example.test', { method: 'OPTIONS' }))).status, 204);
assert.equal((await handler(request({ action: 'idcards.extract' }, false))).status, 401);
labels = ['student'];
assert.equal((await handler(request({ action: 'idcards.extract', labels: ['admin'] }))).status, 403);
assert.equal(globalThis.extractCalls, 0);
labels = ['admin'];
assert.equal((await handler(request({ action: 'idcards.save' }))).status, 400);
const result = await handler(request({ action: 'idcards.extract', page: 1 }));
assert.equal(result.status, 200); assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
assert.equal(globalThis.extractedUser, 'verified-admin'); assert.equal(globalThis.extractCalls, 1);
globalThis.fetch = async () => ({ ok: false });
assert.equal((await handler(request({ action: 'idcards.extract' }))).status, 401);
console.log('PASS: Supabase preflight, verified Appwrite sessions, rejected forged roles, denied save action, authorized extraction and expired-session rejection.');
