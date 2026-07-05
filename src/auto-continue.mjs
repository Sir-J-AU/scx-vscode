// Kritical.NodeJS.SCXCodeAgent — multi-turn auto-continuation (JS port).
//
// Ports Invoke-KritScxAutoContinue from
// ../../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1 to JS.
//
// Turns a per-turn max_tokens ceiling into an effectively unbounded response by
// looping the upstream with a "continue verbatim, no meta" prompt, stopping on a
// natural terminator (or explicit stop_reason), then deduping adjacent
// near-repeat paragraphs via SimHash (Hamming <= 3). Emits ONE HR27 row for the
// merged response (not N fragments).
//
// HR28: mechanism names only — autoContinue / naturalTerminator / dedupParagraphs.
// Uses global fetch (Node >= 20) so it carries no runtime dependency; a fetch
// implementation can be injected for tests.
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

import { simHash64, hammingDistance, addHumanPrompt, addAiResponse } from './hr27.mjs';

// port of $script:SCXNaturalTerminatorRegex (applied to a trimmed chunk)
const naturalTerminatorRegex = /(?:\.|\?|!|```|---|\}|>)$/;

/** True when the chunk ends naturally AND is short enough to be a real stop. */
export function testNaturalTerminator(chunk, perTurnCeiling) {
  const trimmed = chunk.trimEnd();
  if (!naturalTerminatorRegex.test(trimmed)) return false;
  const approxTokens = Math.ceil(chunk.length / 4);
  if (approxTokens >= 0.8 * perTurnCeiling) return false; // likely hit the ceiling, not a natural stop
  return true;
}

/** Drop paragraph blocks whose SimHash is Hamming <= 3 from the one before. */
export function dedupParagraphs(text) {
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  if (paragraphs.length < 2) return text;
  const kept = [];
  let prevHash = null;
  for (const p of paragraphs) {
    const pTrim = p.trim();
    if (pTrim.length < 40) { kept.push(p); prevHash = null; continue; }
    const h = simHash64(pTrim);
    if (prevHash && hammingDistance(prevHash, h) <= 3) continue; // near-dupe, drop
    prevHash = h;
    kept.push(p);
  }
  return kept.join('\n\n');
}

/** Pull the text payload from an Anthropic-shape OR OpenAI-shape envelope. */
export function extractResponseText(resp) {
  if (resp && Array.isArray(resp.content)) {
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (text) return text;
  }
  if (resp && typeof resp.content === 'string') return resp.content;
  if (resp && resp.choices && resp.choices[0]?.message?.content) return resp.choices[0].message.content;
  return '';
}

/** Pull the stop reason from either envelope shape. */
export function extractStopReason(resp) {
  if (resp?.stop_reason) return resp.stop_reason;
  if (resp?.choices && resp.choices[0]?.finish_reason) return resp.choices[0].finish_reason;
  return 'unknown';
}

const STOP_REASONS = new Set(['end_turn', 'stop', 'stop_sequence', 'end_of_turn', 'done']);

async function singleTurn({ messages, model, maxTokens, systemPrompt, apiBase, apiKey, fetchImpl }) {
  const body = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) body.system = systemPrompt;
  const res = await fetchImpl(`${apiBase.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey || '',
      authorization: apiKey ? `Bearer ${apiKey}` : '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`upstream ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * The auto-continuation loop. Mirrors Invoke-KritScxAutoContinue.
 * @returns {Promise<{mergedResponse, rawChunks, turnCount, stopReason, model, sessionId, wave, durationSec, totalTokensApprox, errors, dedupSaved}>}
 */
export async function autoContinue({
  prompt,
  model = 'minimax-m2.7',
  systemPrompt,
  maxContinues = 10,
  perTurnCeiling = 8192,
  continuePrompt = 'continue from exactly where you left off. no preamble, no meta.',
  sessionId,
  wave = '.5184',
  apiBase = process.env.KRIT_AGENT_UPSTREAM || 'http://127.0.0.1:4182',
  apiKey = process.env.SCX_API_KEY || process.env.KRIT_AGENT_UPSTREAM_KEY || 'sk-kritical-scx-local',
  noLog = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!prompt) throw new Error('autoContinue: prompt is required');
  if (!sessionId) sessionId = `autocontinue-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;

  const conversation = [{ role: 'user', content: prompt }];
  const chunks = [];
  let stopReason = 'unknown';
  let turnCount = 0;
  let errors = 0;
  const started = Date.now();

  for (let t = 1; t <= maxContinues; t++) {
    turnCount = t;
    let resp;
    try {
      resp = await singleTurn({ messages: conversation, model, maxTokens: perTurnCeiling, systemPrompt, apiBase, apiKey, fetchImpl });
    } catch (e) {
      errors++;
      if (errors >= 2) break;
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const chunk = extractResponseText(resp);
    stopReason = extractStopReason(resp);
    if (!chunk) break;
    chunks.push(chunk);

    const natural = testNaturalTerminator(chunk, perTurnCeiling);
    const modelSaidStop = STOP_REASONS.has(stopReason);
    if (natural || modelSaidStop) break;

    conversation.push({ role: 'assistant', content: chunk });
    conversation.push({ role: 'user', content: continuePrompt });
  }

  const merged = chunks.join('\n\n');
  const mergedDeduped = dedupParagraphs(merged);

  if (!noLog) {
    addHumanPrompt(prompt, { wave, sessionId, source: 'scx-autocontinue' });
    addAiResponse(mergedDeduped, { model, provider: 'scx', wave, sessionId, source: 'scx-autocontinue' });
  }

  return {
    mergedResponse: mergedDeduped,
    rawChunks: chunks,
    turnCount,
    stopReason,
    model,
    sessionId,
    wave,
    durationSec: Math.round((Date.now() - started) / 1000),
    totalTokensApprox: Math.ceil(mergedDeduped.length / 4),
    errors,
    dedupSaved: merged.length - mergedDeduped.length,
  };
}
