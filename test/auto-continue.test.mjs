// Auto-continuation — gate-for-gate mirror of Test-KritScxAutoContinue.ps1,
// using a mock single-turn function (no live SCX). (HR21 paired test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KRITICAL_LOGGER_TARGET = 'none'; // no disk writes during these gates

const {
  autoContinue, testNaturalTerminator, dedupParagraphs, extractResponseText, extractStopReason,
} = await import('../src/auto-continue.mjs');

// build a mock fetch that returns a scripted sequence of Anthropic-shape chunks
function mockFetch(chunks) {
  let i = 0;
  return async () => {
    const c = chunks[Math.min(i, chunks.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      async json() { return { content: [{ type: 'text', text: c.text }], stop_reason: c.stop || 'max_tokens' }; },
      async text() { return ''; },
    };
  };
}

test('testNaturalTerminator: true for short sentence-ended chunk, false for open chunk', () => {
  assert.equal(testNaturalTerminator('All done here.', 8192), true);
  assert.equal(testNaturalTerminator('this trails off and keeps going', 8192), false);
});

test('testNaturalTerminator: false when chunk is near the ceiling even if punctuated', () => {
  const big = 'x'.repeat(400) + '.'; // ~100 tokens
  assert.equal(testNaturalTerminator(big, 100), false); // >= 80% of ceiling
});

test('extractResponseText handles Anthropic and OpenAI shapes', () => {
  assert.equal(extractResponseText({ content: [{ type: 'text', text: 'hi' }] }), 'hi');
  assert.equal(extractResponseText({ choices: [{ message: { content: 'yo' } }] }), 'yo');
});

test('extractStopReason handles both shapes', () => {
  assert.equal(extractStopReason({ stop_reason: 'end_turn' }), 'end_turn');
  assert.equal(extractStopReason({ choices: [{ finish_reason: 'stop' }] }), 'stop');
});

test('dedupParagraphs drops an adjacent near-duplicate paragraph', () => {
  const para = 'Kritical SCXCode routes sovereign inference through Southern Cross AI onshore in Australia.';
  const text = `${para}\n\n${para}\n\nA genuinely different closing paragraph about the LiteLLM bridge layer.`;
  const out = dedupParagraphs(text);
  const count = out.split('\n\n').filter((p) => p.includes('routes sovereign inference')).length;
  assert.equal(count, 1, 'adjacent duplicate collapsed to one');
  assert.ok(out.includes('different closing paragraph'));
});

test('autoContinue loops until a natural terminator, then merges', async () => {
  const fetchImpl = mockFetch([
    { text: 'part one keeps going', stop: 'max_tokens' }, // no terminator -> continue
    { text: 'part two is finished.', stop: 'max_tokens' }, // ends naturally -> stop
    { text: 'should never be reached', stop: 'max_tokens' },
  ]);
  const r = await autoContinue({ prompt: 'write a lot', model: 'minimax-m2.7', perTurnCeiling: 8192, maxContinues: 5, noLog: true, fetchImpl });
  assert.equal(r.turnCount, 2);
  assert.ok(r.mergedResponse.includes('part one keeps going'));
  assert.ok(r.mergedResponse.includes('part two is finished.'));
  assert.ok(!r.mergedResponse.includes('never be reached'));
});

test('autoContinue stops immediately on explicit end_turn', async () => {
  const fetchImpl = mockFetch([{ text: 'one shot answer with no terminator char', stop: 'end_turn' }]);
  const r = await autoContinue({ prompt: 'hi', maxContinues: 5, noLog: true, fetchImpl });
  assert.equal(r.turnCount, 1);
  assert.equal(r.stopReason, 'end_turn');
});

test('autoContinue respects the maxContinues cap', async () => {
  const fetchImpl = mockFetch([{ text: 'never terminates cleanly and runs long', stop: 'max_tokens' }]);
  const r = await autoContinue({ prompt: 'hi', maxContinues: 3, perTurnCeiling: 8192, noLog: true, fetchImpl });
  assert.equal(r.turnCount, 3);
  assert.equal(r.rawChunks.length, 3);
});
