// HR27 write-through — round-trip against a sandbox store. (HR21 paired test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// point the logger at an isolated sandbox BEFORE importing the module paths use env at call time
const sandbox = mkdtempSync(join(tmpdir(), 'krit-hr27-'));
process.env.KRITICAL_DECISION_LOG_ROOT = sandbox;
process.env.KRITICAL_LOGGER_TARGET = 'file';

const { sha256Hex, simHash64, hammingDistance, addHumanPrompt, addAiResponse } = await import('../src/hr27.mjs');

test('sha256Hex is lowercase hex and stable', () => {
  const h = sha256Hex('kritical');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256Hex('kritical'));
});

test('simHash64 is a 64-bit binary string and deterministic', () => {
  const a = simHash64('the sovereign australian ai stack built by kritical');
  assert.match(a, /^[01]{64}$/);
  assert.equal(a, simHash64('the sovereign australian ai stack built by kritical'));
  assert.equal(hammingDistance(a, a), 0);
});

test('near-identical text is closer than unrelated text (SimHash locality)', () => {
  // paragraph-length inputs — the regime the dedup pass actually operates on (>=40 chars)
  const base = simHash64('Kritical SCXCode routes sovereign inference through Southern Cross AI, onshore in Australia, with no prompt caching and no training on your data.');
  const near = simHash64('Kritical SCXCode routes sovereign inference through Southern Cross AI, onshore in Australia, with no prompt caching and no training on your data today.');
  const far = simHash64('Completely unrelated content about Shopify inventory levels, order fulfilment webhooks, and Pax8 subscription billing reconciliation.');
  const dNear = hammingDistance(base, near);
  const dFar = hammingDistance(base, far);
  assert.ok(dNear < dFar, `expected near(${dNear}) < far(${dFar})`);
  assert.ok(dNear <= 12, `near dist ${dNear} unexpectedly large`);
});

test('addHumanPrompt + addAiResponse write JSONL rows to the sandbox store', () => {
  const row = addHumanPrompt('what models does SCX expose?', { wave: '.5184', sessionId: 's1' });
  assert.equal(row.side, 'human');
  assert.match(row.content_sha256, /^[0-9a-f]{64}$/);
  assert.match(row.simhash, /^[01]{64}$/);

  const resp = addAiResponse('SCX exposes 12 models.', { model: 'minimax-m2.7', provider: 'scx', wave: '.5184', sessionId: 's1' });
  assert.equal(resp.side, 'ai');
  assert.equal(resp.model, 'minimax-m2.7');

  const date = new Date().toISOString().slice(0, 10);
  const humanFile = join(sandbox, 'documentation', 'human', date, 'prompt.jsonl');
  const aiFile = join(sandbox, 'documentation', 'ai', date, 'response.jsonl');
  assert.ok(existsSync(humanFile) && existsSync(aiFile));
  const parsed = JSON.parse(readFileSync(humanFile, 'utf8').trim().split('\n')[0]);
  assert.equal(parsed.content, 'what models does SCX expose?');
  assert.equal(parsed.wave, '.5184');
});

test('exact SHA duplicate is skipped, not appended twice (HR27 dedup)', () => {
  const content = 'duplicate direction line for dedup test';
  const first = addHumanPrompt(content, { category: 'direction', wave: '.5184' });
  assert.ok(!first.skipped);
  const second = addHumanPrompt(content, { category: 'direction', wave: '.5184' });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'sha-dupe');

  const date = new Date().toISOString().slice(0, 10);
  const file = join(sandbox, 'documentation', 'human', date, 'direction.jsonl');
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'only one row despite two writes');
});

test('KRITICAL_LOGGER_TARGET=none suppresses writes', () => {
  process.env.KRITICAL_LOGGER_TARGET = 'none';
  const r = addHumanPrompt('should not be written', { wave: '.5184' });
  assert.equal(r.skipped, true);
  process.env.KRITICAL_LOGGER_TARGET = 'file';
});
