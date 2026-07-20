// Offline tests for kritical-chunk-store.mjs — chunking + synthetic-context assembly. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chunkText, buildContext } from './kritical-chunk-store.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'kritical-chunk-store.mjs');

test('chunkText round-trips byte-for-byte (join with newline == original)', () => {
  const src = Array.from({ length: 600 }, (_, i) =>
    i % 60 === 0 ? `function fn${i}() {` : (i % 60 === 59 ? '}' : `  line ${i};`)).join('\n');
  const chunks = chunkText(src, { maxLines: 80, minLines: 10 });
  assert.ok(chunks.length > 3, 'a 600-line file should split into several chunks');
  assert.equal(chunks.map((c) => c.content).join('\n'), src, 'reassembly must equal the original exactly');
  // line ranges are contiguous + 1-based
  assert.equal(chunks[0].start, 1);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].start, chunks[i - 1].end + 1);
});

test('chunkText extracts top-level symbols', () => {
  const src = 'export function alpha() {\n  return 1;\n}\n\nclass Beta {\n  m() {}\n}\n';
  const chunks = chunkText(src, { minLines: 1, maxLines: 100 });
  const syms = chunks.flatMap((c) => c.symbols.split(',')).filter(Boolean);
  assert.ok(syms.includes('alpha'));
  assert.ok(syms.includes('Beta'));
});

function fakeRows(n) {
  const rows = []; let line = 1;
  for (let i = 0; i < n; i++) {
    const content = `chunk ${i} body\n`.repeat(10);
    const loc = content.split('\n').length;
    rows.push({ idx: i, start_line: line, end_line: line + loc - 1, symbols: `sym${i}`, content, summary: null });
    line += loc;
  }
  return rows;
}

test('buildContext includes the focused chunk in FULL + a map of every chunk, within budget', () => {
  const rows = fakeRows(20);
  const { text, focus } = buildContext(rows, 'sym7', 4000);
  assert.deepEqual(focus, [7]);
  assert.match(text, /FOCUS CHUNK #7/);
  assert.match(text, /WHOLE-FILE MAP:/);
  for (let i = 0; i < 20; i++) assert.match(text, new RegExp(`\\[#${i}\\]`), `map should list chunk ${i}`);
  assert.ok(text.length <= 4000, `must respect budget (got ${text.length})`);
});

test('buildContext focuses by line number too, and falls back to chunk 0', () => {
  const rows = fakeRows(10);
  const byLine = buildContext(rows, String(rows[3].start_line + 1), 8000);
  assert.deepEqual(byLine.focus, [3]);
  const fallback = buildContext(rows, 'no-such-symbol-anywhere', 8000);
  assert.deepEqual(fallback.focus, [0]);
});

test('content-addressed dedup: identical chunk bodies stored once + round-trip byte-safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-'));
  const db = join(dir, 's.db');
  const fx = join(dir, 'dup.js');
  const blk = 'function same(a,b){\n' + Array.from({ length: 30 }, (_, j) => `  const x${j}=a+${j}*b;`).join('\n') + '\n  return x0;\n}';
  writeFileSync(fx, Array(4).fill(blk).join('\n\n') + '\n'); // 4 IDENTICAL chunks
  try {
    const r = spawnSync(process.execPath, [CLI, 'chunk', fx], { env: { ...process.env, KRIT_CHUNK_STORE: db }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const d = new DatabaseSync(db);
    const chunks = d.prepare('SELECT COUNT(*) n FROM chunks').get().n;
    const blobs = d.prepare('SELECT COUNT(*) n FROM blobs').get().n;
    d.close();
    assert.ok(chunks >= 4, `expected >=4 chunks, got ${chunks}`);
    assert.ok(blobs < chunks, `blobs (${blobs}) must be fewer than chunks (${chunks}) — content-addressed dedup`);
    const out = join(dir, 'out.js');
    spawnSync(process.execPath, [CLI, 'reassemble', fx, out], { env: { ...process.env, KRIT_CHUNK_STORE: db } });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(fx, 'utf8'), 'reassembly byte-identical after dedup');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('compression tier: compressible blobs stored gz, incompressible stay raw, reassembly byte-safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gz-'));
  const db = join(dir, 's.db');
  const fx = join(dir, 'big.js');
  // one very compressible function (400 identical lines) + a small function that should stay raw
  const huge = 'function huge() {\n' + Array.from({ length: 400 }, () => '  doThing(); // repeated identical line, highly compressible').join('\n') + '\n}';
  writeFileSync(fx, huge + '\n\nfunction small() { return 1; }\n');
  try {
    const r = spawnSync(process.execPath, [CLI, 'chunk', fx], { env: { ...process.env, KRIT_CHUNK_STORE: db }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const d = new DatabaseSync(db);
    const gz = d.prepare("SELECT COUNT(*) n FROM blobs WHERE codec='gz'").get().n;
    const raw = d.prepare("SELECT COUNT(*) n FROM blobs WHERE codec='raw'").get().n;
    const stored = d.prepare('SELECT SUM(LENGTH(content)) n FROM blobs').get().n;
    d.close();
    assert.ok(gz >= 1, `the compressible chunk should be gzip-tiered (gz=${gz})`);
    assert.ok(raw >= 1, `the tiny chunk should stay raw (raw=${raw})`);
    assert.ok(stored < readFileSync(fx, 'utf8').length, `compressed store (${stored}) must be smaller than raw file (${readFileSync(fx, 'utf8').length})`);
    const out = join(dir, 'out.js');
    spawnSync(process.execPath, [CLI, 'reassemble', fx, out], { env: { ...process.env, KRIT_CHUNK_STORE: db } });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(fx, 'utf8'), 'reassembly byte-identical after gz decompression');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
