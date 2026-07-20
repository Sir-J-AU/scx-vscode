// Offline test for kritical-local-store.mjs (SCX-drafted, operator-lensed .5231).
// node --test store-mcp/kritical-local-store.test.mjs   (run from the repo root or anywhere — path is self-resolving)
import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Resolve the store script relative to THIS test file, so cwd doesn't matter.
const STORE = fileURLToPath(new URL('./kritical-local-store.mjs', import.meta.url));

let tempDir, tempDbPath, fixtureDir;

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kritical-test-'));
  tempDbPath = join(tempDir, 'test.db');
  fixtureDir = mkdtempSync(join(tmpdir(), 'kritical-fixture-'));

  const testFiles = [
    { path: 'test.js', content: `function helloWorld() {\n  console.log('Hello World');\n}\n\nconst addNumbers = (a, b) => a + b;\n\nclass TestClass {\n  constructor() {\n    this.value = 42;\n  }\n}` },
    { path: 'utils.py', content: `def calculate_sum(a, b):\n    return a + b\n\ndef process_data(data):\n    return [x * 2 for x in data]` },
    { path: 'empty.md', content: '# Empty Test File' },
  ];
  testFiles.forEach((f) => writeFileSync(join(fixtureDir, f.path), f.content));
});

after(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function runCommand(cmd, arg) {
  const result = spawnSync(process.execPath, [STORE, cmd, arg ?? ''], {
    env: { ...process.env, KRIT_LOCAL_STORE: tempDbPath },
    encoding: 'utf-8',
  });
  if (result.status !== 0) throw new Error(`Command failed: ${cmd} ${arg}\n${result.stderr}`);
  return result.stdout;
}

test('mine builds the corpus from the fixture dir', () => {
  const out = runCommand('mine', fixtureDir);
  assert.match(out, /mined 3 files/);
});

test('stats shows per-language counts + total symbols', () => {
  const out = runCommand('stats');
  assert.match(out, /js\s+1 files/);
  assert.match(out, /py\s+1 files/);
  assert.match(out, /md\s+1 files/);
  assert.match(out, /total symbols:/);
});

test('search returns matching content (case-insensitive)', () => {
  const out = runCommand('search', 'hello world');
  assert.match(out, /helloWorld/);
  assert.match(out, /Hello World/);
  assert.match(out, /test\.js/);
});

test('search with empty keywords returns cleanly (.5231 guard)', () => {
  const out = runCommand('search', '   ');
  assert.ok(out.includes('no search terms supplied'), 'empty search should hit the guard, not throw');
});

test('symbols finds a JS function', () => {
  const out = runCommand('symbols', 'helloWorld');
  assert.match(out, /helloWorld/);
  assert.match(out, /test\.js/);
});

test('symbols finds a Python function', () => {
  const out = runCommand('symbols', 'calculate');
  assert.match(out, /calculate_sum/);
  assert.match(out, /utils\.py/);
});

test('multiple search terms match across the file', () => {
  const out = runCommand('search', 'class console');
  assert.match(out, /TestClass/);
  assert.match(out, /console\.log/);
});
