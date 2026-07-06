// Offline tests for kritical-chunk-store.mjs — chunking + synthetic-context assembly. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, buildContext } from './kritical-chunk-store.mjs';

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
