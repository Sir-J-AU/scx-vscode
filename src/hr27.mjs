// Kritical.NodeJS.SCXCodeAgent — HR27 write-through (JS port).
//
// Ports the canonical HR27 decision-logger primitives from
// ../../ps-module/KriticalDecisionLogger.psm1 to JS so the daemon can append
// every served prompt + response to the SAME documentation/{human,ai}/ store
// without shelling out to pwsh per write (brief Option B).
//
// Bit-compatible with the PS module:
//   - SHA256: lowercase hex of UTF-8 bytes.
//   - SimHash: lowercase, split on [\s\p{P}]+, tokens length >= 3, MD5 per
//     token, first 8 bytes as 64 bits, bit i = (byte[floor(i/8)] >> (i%8)) & 1,
//     sum +/-1, threshold > 0 -> '1'. Returns 64-char binary string.
//   - Hamming: per-character difference count.
//   - Row schema + folder layout identical (append-only per HR23).
//
// Honours $env:KRITICAL_LOGGER_TARGET = file | db | both | none (HR27).
// 'db'/'both' degrade to file with a one-time notice (the daemon owns no SQL
// connection in this wave; the LiteLLM logger callback owns the SQL sink).
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
// Contact: sales@kritical.net — ph. 1300 274 655

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// Repo-root / store resolution (HR27 §repo-agnostic anchor)
// -----------------------------------------------------------------------------

/** Walk up looking for a repo marker; override via $env:KRITICAL_DECISION_LOG_ROOT. */
export function resolveLoggerRoot() {
  const override = process.env.KRITICAL_DECISION_LOG_ROOT;
  if (override) return override;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    for (const marker of ['CLAUDE.md', '.git', 'README.md', 'package.json']) {
      if (existsSync(join(dir, marker)) && existsSync(join(dir, 'documentation'))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // fall back to the repo root two levels up from node-agent/src
  return resolve(__dirname, '..', '..');
}

function utcDateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

function jsonlPath(side, category, when = new Date()) {
  const root = resolveLoggerRoot();
  const dir = join(root, 'documentation', side, utcDateStamp(when));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${category}.jsonl`);
}

// -----------------------------------------------------------------------------
// Content hashing — ports Get-KriticalContentSha256 / Get-KriticalContentSimHash
// -----------------------------------------------------------------------------

export function sha256Hex(content) {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

export function simHash64(content) {
  const tokens = String(content)
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return '0'.repeat(64);

  const bits = new Array(64).fill(0);
  for (const token of tokens) {
    const md5 = createHash('md5').update(Buffer.from(token, 'utf8')).digest(); // 16 bytes
    for (let i = 0; i < 64; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      const bit = (md5[byteIdx] >> bitIdx) & 1;
      bits[i] += bit === 1 ? 1 : -1;
    }
  }
  let out = '';
  for (let i = 0; i < 64; i++) out += bits[i] > 0 ? '1' : '0';
  return out;
}

export function hammingDistance(a, b) {
  if (a.length !== b.length) {
    throw new Error(`SimHash strings must be same length (got ${a.length} vs ${b.length})`);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// -----------------------------------------------------------------------------
// Append primitives — SHA exact-dupe skip via .counters.json sidecar (HR27 §3)
// -----------------------------------------------------------------------------

let _dbNoticeShown = false;
function loggerTarget() {
  const t = (process.env.KRITICAL_LOGGER_TARGET || 'file').toLowerCase();
  if ((t === 'db' || t === 'both') && !_dbNoticeShown) {
    _dbNoticeShown = true;
    console.warn(`[hr27] KRITICAL_LOGGER_TARGET='${t}' — daemon owns no SQL sink this wave; writing JSONL only. The LiteLLM logger callback handles SQL.`);
  }
  return t;
}

function bumpCounter(counterPath, sha) {
  let counters = {};
  if (existsSync(counterPath)) {
    try { counters = JSON.parse(readFileSync(counterPath, 'utf8')); } catch { counters = {}; }
  }
  counters[sha] = (counters[sha] || 0) + 1;
  writeFileSync(counterPath, JSON.stringify(counters), 'utf8');
  return counters[sha];
}

/**
 * Append one HR27 row. Returns the row (or a { skipped, occurrence } marker on
 * exact-dupe). Never throws to the caller path — HR29: logging must not break
 * a served request.
 */
export function appendDecisionRow({ side, category, content, wave = '', sessionId = '', model, provider, source = 'scxcode-agent' }) {
  try {
    if (loggerTarget() === 'none') return { skipped: true, reason: 'target=none' };
    const when = new Date();
    const sha = sha256Hex(content);
    const file = jsonlPath(side, category, when);
    const counterPath = file.replace(/\.jsonl$/, '.counters.json');

    // exact-dupe within the same day's file -> skip write, bump counter (HR27 §3)
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8');
      if (existing.includes(`"content_sha256":"${sha}"`)) {
        const occ = bumpCounter(counterPath, sha);
        return { skipped: true, reason: 'sha-dupe', occurrence: occ, content_sha256: sha };
      }
    }

    const row = {
      id: `${side}-${category}-${sha.slice(0, 12)}-${when.getTime()}`,
      ts_utc: when.toISOString(),
      side,
      category,
      wave,
      session_id: sessionId,
      content_sha256: sha,
      simhash: simHash64(content),
      content_len: content.length,
      content_preview_120: content.slice(0, 120),
      content,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      source,
    };
    appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
    return row;
  } catch (e) {
    console.warn('[hr27] write-through failed (non-fatal):', e.message);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

export const addHumanPrompt = (content, opts = {}) =>
  appendDecisionRow({ side: 'human', category: opts.category || 'prompt', content, ...opts });

export const addAiResponse = (content, opts = {}) =>
  appendDecisionRow({ side: 'ai', category: opts.category || 'response', content, ...opts });

/**
 * Structured ingest event (brief §Ingest layer hooks — .5187 plugs in here).
 * Appends to documentation/ai/<date>/<stream>.jsonl. Best-effort, never throws.
 */
export function emitIngestEvent(stream, event) {
  try {
    if (loggerTarget() === 'none') return;
    const file = jsonlPath('ai', stream);
    appendFileSync(file, JSON.stringify({ ts_utc: new Date().toISOString(), ...event }) + '\n', 'utf8');
  } catch (e) {
    console.warn(`[hr27] ingest emit (${stream}) failed (non-fatal):`, e.message);
  }
}
