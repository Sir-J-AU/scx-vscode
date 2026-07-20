// Offline tests for scx-corpus-augment.mjs (the storage->agent injection). node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { extractKeywords, fitBudget, augmentWithCorpus, buildBigFileContext } from './scx-corpus-augment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, '..', 'store-mcp', 'kritical-local-store.mjs');

test('extractKeywords pulls file paths from tool calls + identifiers from the message', () => {
  const body = {
    model: 'gpt-oss-120b',
    input: [
      { role: 'user', content: 'refactor the flattenTool helper' },
      { type: 'function_call', arguments: JSON.stringify({ command: ['bash', '-lc', 'sed -i s/a/b/ codex-wrapper/scx-agentic-shim.mjs'] }) },
    ],
  };
  const kw = extractKeywords(body);
  assert.match(kw, /scx-agentic-shim\.mjs/);
  assert.match(kw, /flattenTool/);
});

test('fitBudget never goes negative and reserves headroom', () => {
  assert.equal(fitBudget(1000, 5000), 0);              // payload already over ceiling -> 0
  assert.ok(fitBudget(500000, 1000) > 0);              // lots of room
  assert.ok(fitBudget(500000, 1000) < 500000);         // reserve+safety subtracted
});

test('augmentWithCorpus is a passthrough when OFF (HR29 default)', async () => {
  const body = { input: [{ role: 'user', content: 'hi' }] };
  const out = await augmentWithCorpus(body, { model: 'gpt-oss-120b', storeMode: 'off' });
  assert.equal(out, body);
});

test('augmentWithCorpus tolerates null / empty', async () => {
  assert.equal(await augmentWithCorpus(null, { storeMode: 'local' }), null);
  const empty = {};
  assert.equal(await augmentWithCorpus(empty, { model: 'gpt-oss-120b', storeMode: 'local' }), empty); // no keywords -> unchanged
});

test('augmentWithCorpus injects a strippable developer item grounded in the mined corpus', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'aug-db-'));
  const fx = mkdtempSync(join(tmpdir(), 'aug-fx-'));
  const dbPath = join(dbDir, 'store.db');
  writeFileSync(join(fx, 'flatten.mjs'), 'export function flattenTool(t){ return [t]; }\n');
  try {
    // mine the fixture into a temp store
    const mine = spawnSync(process.execPath, [STORE, 'mine', fx], { env: { ...process.env, KRIT_LOCAL_STORE: dbPath }, encoding: 'utf8' });
    assert.equal(mine.status, 0, mine.stderr);

    // point the augment module's spawned search at the temp store, then augment
    const prev = process.env.KRIT_LOCAL_STORE;
    process.env.KRIT_LOCAL_STORE = dbPath;
    try {
      const body = { model: 'gpt-oss-120b', input: [{ role: 'user', content: 'explain flatten.mjs flattenTool' }] };
      const out = await augmentWithCorpus(body, { model: 'gpt-oss-120b', storeMode: 'local' });
      const injected = out.input[out.input.length - 1];
      assert.equal(injected.role, 'developer');
      assert.match(injected.content, /KRITICAL-CORPUS-CONTEXT \(auto-grounded, strippable\)/);
      assert.match(injected.content, /### FILE:/);
      assert.match(injected.content, /flattenTool/);
    } finally {
      if (prev === undefined) delete process.env.KRIT_LOCAL_STORE; else process.env.KRIT_LOCAL_STORE = prev;
    }
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(fx, { recursive: true, force: true });
  }
});

test('buildBigFileContext returns SYNTHETIC CONTEXT for a file too big to inline, focused + budgeted', () => {
  // reference a genuinely huge real file by repo-relative path (resolveFile checks cwd)
  const rel = 'src/extension.ts'; // ~160KB / 2500+ lines
  const synth = buildBigFileContext(`${rel} switchKey`, 12000);
  assert.match(synth, /SYNTHETIC CONTEXT/);
  assert.match(synth, /chunks; too big to inline/);
  assert.match(synth, /FOCUS CHUNK/);
  assert.match(synth, /WHOLE-FILE MAP:/);
  assert.ok(synth.length <= 12000, `must fit the budget (got ${synth.length})`);
});

test('buildBigFileContext returns empty when no big file is referenced (falls back to search)', () => {
  assert.equal(buildBigFileContext('switchKey getConfig', 12000), '');
});
