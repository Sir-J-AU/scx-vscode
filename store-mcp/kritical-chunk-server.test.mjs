// Offline test for the cross-agent chunk server. node --test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createChunkServer } from './kritical-chunk-server.mjs';

const TOKEN = 'test-token-abc123';
const NS = 'srvtest-' + Math.floor(Date.now() % 1e9);
let server, base, fixture, tmpBase;

before(async () => {
  server = createChunkServer({ token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  tmpBase = mkdtempSync(join(tmpdir(), 'chunk-srv-'));
  fixture = join(tmpBase, 'big.js');
  // ~240 lines across several functions so it chunks into a few pieces
  const fns = Array.from({ length: 6 }, (_, i) =>
    `export function feature${i}(a, b) {\n` + Array.from({ length: 30 }, (__, j) => `  const v${j} = a + ${j} * b; // work ${i}.${j}`).join('\n') + `\n  return v0;\n}`).join('\n\n');
  writeFileSync(fixture, fns + '\n');
});

after(() => {
  try { server.close(); } catch { /* noop */ }
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* noop */ }
  // clean the per-namespace db this test created
  const ns = NS.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  for (const ext of ['', '-wal', '-shm']) { try { rmSync(join(homedir(), '.kritical-scx', 'chunk-ns', `chunk-${ns}.db${ext}`), { force: true }); } catch { /* noop */ } }
});

const call = (verb, body, token = TOKEN) => fetch(`${base}/v1/${verb}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json() }));

test('GET /health is open + reports the service', async () => {
  const r = await fetch(`${base}/health`); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.service, 'kritical-chunk-server');
});

test('rejects requests without the bearer token (401)', async () => {
  const r = await call('context', { ns: NS, file: fixture }, null);
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
});

test('chunk -> context returns a synthetic window (focus full + map)', async () => {
  const chunked = await call('chunk', { ns: NS, file: fixture });
  assert.equal(chunked.status, 200, JSON.stringify(chunked.json));
  assert.match(chunked.json.output, /chunks/);
  assert.match(chunked.json.output, /round-trip=OK/);

  const ctx = await call('context', { ns: NS, file: fixture, focus: 'feature3', budget: 6000 });
  assert.equal(ctx.status, 200);
  assert.match(ctx.json.context, /SYNTHETIC EDIT CONTEXT/);
  assert.match(ctx.json.context, /FOCUS CHUNK/);
  assert.match(ctx.json.context, /WHOLE-FILE MAP:/);
  assert.ok(ctx.json.context.length <= 6200, `budget respected (got ${ctx.json.context.length})`);
});

test('apply edits a focus chunk + reassembles the file on disk (the edit-back loop)', async () => {
  await call('chunk', { ns: NS, file: fixture }); // ensure chunked
  const newBody = 'export function feature0(a, b) {\n  return a * b; // EDITED-VIA-SERVER\n}';
  const ap = await call('apply', { ns: NS, file: fixture, idx: 0, content: newBody });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.match(ap.json.output, /reassembled/);
  const onDisk = readFileSync(fixture, 'utf8');
  assert.match(onDisk, /return a \* b; \/\/ EDITED-VIA-SERVER/, 'the edit landed on disk');
  assert.match(onDisk, /feature5/, 'other chunks preserved');
});

test('unknown verb -> 404', async () => {
  const r = await call('nope', { ns: NS, file: fixture });
  assert.equal(r.status, 404);
});
