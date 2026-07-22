// Tests for ./chatCompaction.ts — extracted 2026-07-22/23 from extension.ts
// (JS/TS modularization program, task #13). Covers the module's full public
// surface: estimateTokens, summarizeForCompaction, compactMessagesForSend.
//
// Run: node --test src/chatCompaction.test.ts   (Node 24 runs .ts natively)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens,
  summarizeForCompaction,
  compactMessagesForSend,
  type CompactableMessage,
} from './chatCompaction.ts';

function msg(role: CompactableMessage['role'], content: string): CompactableMessage {
  return { role, content };
}

function history(n: number): CompactableMessage[] {
  const out: CompactableMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push(msg(i % 2 === 0 ? 'user' : 'assistant', `msg-${i}`));
  }
  return out;
}

// ── estimateTokens ──────────────────────────────────────────────────────────

test('estimateTokens: empty/nullish input is 0', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(undefined as unknown as string), 0);
  assert.equal(estimateTokens(null as unknown as string), 0);
});

test('estimateTokens: ceil(length / 4)', () => {
  assert.equal(estimateTokens('abcd'), 1);       // 4/4 = 1
  assert.equal(estimateTokens('abcde'), 2);      // 5/4 = 1.25 -> 2
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens('a'.repeat(401)), 101);
});

// ── summarizeForCompaction ──────────────────────────────────────────────────

test('summarizeForCompaction: numbers entries 1-based, collapses whitespace, no ellipsis under 700 chars', () => {
  const out = summarizeForCompaction([msg('user', 'hello   world\n\nfoo')]);
  assert.equal(out, '1. user: hello world foo');
});

test('summarizeForCompaction: truncates to 700 chars and appends " ..." when longer', () => {
  const long = 'a'.repeat(750);
  const out = summarizeForCompaction([msg('assistant', long)]);
  assert.equal(out, `1. assistant: ${'a'.repeat(700)} ...`);
});

test('summarizeForCompaction: exactly 700 chars gets no ellipsis', () => {
  const exact = 'b'.repeat(700);
  const out = summarizeForCompaction([msg('user', exact)]);
  assert.equal(out, `1. user: ${exact}`);
});

test('summarizeForCompaction: multiple messages joined with newline, in order', () => {
  const out = summarizeForCompaction([msg('user', 'one'), msg('assistant', 'two'), msg('user', 'three')]);
  assert.equal(out, '1. user: one\n2. assistant: two\n3. user: three');
});

// ── compactMessagesForSend ───────────────────────────────────────────────────

const BIG_CONTEXT = 100_000;      // tokens
const HUGE_EXTRA_CHARS = 300_000; // forces estimated >> any budget below, regardless of mode

test('compactMessagesForSend: autocompact "off" never compacts, even over budget', () => {
  const h = history(20);
  const result = compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'off', maxTokens: 1500 }, HUGE_EXTRA_CHARS);
  assert.equal(result.compactedTurns, 0);
  assert.deepEqual(result.messages, h);
});

test('compactMessagesForSend: below the 9-turn floor never compacts, even over budget', () => {
  const h = history(8);
  const result = compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'auto', maxTokens: 1500 }, HUGE_EXTRA_CHARS);
  assert.equal(result.compactedTurns, 0);
  assert.deepEqual(result.messages, h);
});

test('compactMessagesForSend: at/above 9 turns but comfortably under budget does not compact', () => {
  const h = history(10);
  // Huge context window, no extra chars, tiny messages -> estimated well under budget.
  const result = compactMessagesForSend(h, 1_000_000, { autocompact: 'auto', maxTokens: 1500 }, 0);
  assert.equal(result.compactedTurns, 0);
  assert.deepEqual(result.messages, h);
});

test('compactMessagesForSend: "auto" over budget keeps last 7 turns, folds the rest into one summary pair', () => {
  const h = history(10);
  const result = compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'auto', maxTokens: 1500 }, HUGE_EXTRA_CHARS);

  assert.equal(result.compactedTurns, 3); // 10 - keep(7)
  assert.equal(result.messages.length, 2 + 7);
  assert.equal(result.messages[0].role, 'user');
  assert.match(result.messages[0].content, /^## Kritical SCXCode Auto-Context Flush/);
  assert.match(result.messages[0].content, /Compacted 3 earlier turns locally/);
  assert.equal(result.messages[1].role, 'assistant');
  assert.match(result.messages[1].content, /^Acknowledged\./);
  assert.deepEqual(result.messages.slice(2), h.slice(-7)); // the kept recent turns are untouched
});

test('compactMessagesForSend: "aggressive" over budget keeps only last 5 turns (lower threshold, smaller keep)', () => {
  const h = history(10);
  const result = compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'aggressive', maxTokens: 1500 }, HUGE_EXTRA_CHARS);

  assert.equal(result.compactedTurns, 5); // 10 - keep(5)
  assert.equal(result.messages.length, 2 + 5);
  assert.deepEqual(result.messages.slice(2), h.slice(-5));
});

test('compactMessagesForSend: summary body embeds summarizeForCompaction(old) verbatim', () => {
  const h = history(10);
  const result = compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'auto', maxTokens: 1500 }, HUGE_EXTRA_CHARS);
  const old = h.slice(0, 3);
  assert.ok(result.messages[0].content.includes(summarizeForCompaction(old)));
});

test('compactMessagesForSend: does not mutate the input history array', () => {
  const h = history(10);
  const snapshot = h.map((m) => ({ ...m }));
  compactMessagesForSend(h, BIG_CONTEXT, { autocompact: 'auto', maxTokens: 1500 }, HUGE_EXTRA_CHARS);
  assert.deepEqual(h, snapshot);
});
