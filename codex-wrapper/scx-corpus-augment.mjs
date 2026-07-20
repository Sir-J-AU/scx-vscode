// Kritical SCX — CORPUS AUTO-INJECT (storage -> agent, via the local store).
//
// Additive, opt-in module called by scx-agentic-shim.mjs between transformRequestBody() and the
// upstream forward. When KRIT_SHIM_STORE is set (local|sql|both), it grounds each agentic-codex
// request in REAL retrieved source from the corpus store — sized to the model's REAL ceiling
// AGAINST THE LIVE PAYLOAD (SCX hard-400s over-budget; it does not truncate), injected as a single
// strippable `developer` item. Default OFF -> byte-identical passthrough (HR29). SCX_API_KEY only,
// this module never reads OPENAI_*/ANTHROPIC_* (HR1).  Design: docs/design/SCXCODEX-MEGA-MERGE-DESIGN.md
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026.
import { spawn } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkText, buildContext } from '../store-mcp/kritical-chunk-store.mjs';

const STORE_MODE = process.env.KRIT_SHIM_STORE || 'off';
const STORE_SCRIPT = process.env.KRIT_LOCAL_STORE_SCRIPT
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'store-mcp', 'kritical-local-store.mjs');

// Real usable ceilings (chars = tok*4, from live needle-recall probes — docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md)
const MODEL_CEIL = {
  'gpt-oss-120b': 108_000 * 4, // deployment caps input ~108k (tightest — the wrapper default)
  'deepseek-v3.1': 129_000 * 4,
  'minimax-m2.7': 195_000 * 4, // exceeds advertised 192k
};
const DEFAULT_CEIL = 108_000 * 4; // conservative fallback = the TIGHTEST ceiling, never over-inject
const OUTPUT_RESERVE = 2_000 * 4; // leave room for the model's reply (chars)
const SAFETY_MARGIN = 4_000;      // JSON/encoding overhead fudge (chars)
const SYNTH_THRESHOLD = 24_000;   // files bigger than ~6k tokens get the synthetic chunk-map treatment

/** Deterministic, zero-latency keyword extractor (no LLM). Prefers file paths from tool calls,
 *  then salient identifiers/paths from the last user/input message. */
export function extractKeywords(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  const hits = new Set();
  const stringsDeep = (obj, depth = 0) => {
    if (depth > 4 || obj === null) return [];
    if (typeof obj === 'string') return [obj];
    if (typeof obj !== 'object') return [];
    return Object.values(obj).flatMap((v) => stringsDeep(v, depth + 1));
  };
  const PATH_RE = /\b[\w.+\-/\\]+\.(?:m?js|cjs|ts|tsx|ps1|psm1|py|json|toml|sql|md)\b/gi;
  // code-like identifiers only (a hump or underscore) — catches flattenTool / TransformBody / snake_case
  // but skips plain English words like "refactor"/"helper" so the retrieval query stays signal-rich.
  const IDENT_RE = /[A-Za-z_][A-Za-z0-9]*(?:[A-Z][a-z0-9]+|_[A-Za-z0-9]+)+/g;

  // 1. tool-call arguments — file paths + shell executables
  const toolBlobs = [
    ...(Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []),
    ...(Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.arguments) : []),
    ...(Array.isArray(parsed.input) ? parsed.input : []),
  ];
  for (const raw of toolBlobs) {
    let v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = raw; } }
    for (const s of stringsDeep(v)) {
      (s.match(PATH_RE) || []).forEach((p) => hits.add(p.replace(/\\/g, '/')));
      const exe = s.match(/^\s*(bash|sh|pwsh|powershell|node|python|pip|npm|yarn|cargo|git)\b/);
      if (exe) hits.add(exe[1]);
    }
  }
  // 2. conversation text (ALL user/input items, not just the last — the tool-call is often last) — idents + paths
  const items = Array.isArray(parsed.messages) ? parsed.messages
    : Array.isArray(parsed.input) ? parsed.input
    : (parsed.messages || parsed.input) ? [parsed.messages || parsed.input] : [];
  let text = '';
  for (const it of items) {
    if (typeof it === 'string') { text += ' ' + it; continue; }
    if (it && typeof it === 'object') {
      if (typeof it.content === 'string') text += ' ' + it.content;
      else if (Array.isArray(it.content)) text += ' ' + it.content.map((b) => (b && typeof b === 'object' ? b.text || '' : String(b || ''))).join(' ');
    }
  }
  (text.match(PATH_RE) || []).forEach((p) => hits.add(p.replace(/\\/g, '/')));
  (text.match(IDENT_RE) || []).forEach((i) => hits.add(i));
  return [...hits].filter(Boolean).slice(0, 24).join(' ').trim();
}

/** Chars of corpus that can be safely injected without blowing the model's real ceiling. 0 = no room. */
export function fitBudget(modelCeilChars, payloadChars) {
  return Math.max(0, modelCeilChars - payloadChars - OUTPUT_RESERVE - SAFETY_MARGIN);
}

/** Spawn the local store `search` and return its stdout (capped). Never throws (additive). */
function searchStore(keywords, maxChars) {
  return new Promise((res) => {
    // process.execPath (not 'node') + no shell: reliable on Windows AND no shell word-split/injection.
    const child = spawn(process.execPath, [STORE_SCRIPT, 'search', keywords], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { child.kill(); } catch { /* noop */ } res(v); } };
    child.stdout.on('data', (c) => { out += c.toString('utf8'); if (out.length > maxChars) finish(out.slice(0, maxChars).trim()); });
    child.on('close', () => finish(out.trim()));
    child.on('error', () => finish(''));
    setTimeout(() => finish(out.slice(0, maxChars).trim()), 8_000); // hard timeout — never block the shim
  });
}

/** Resolve a keyword token to a real file (cwd-relative or as-is). Returns { path, size } or null. */
function resolveFile(tok) {
  for (const c of [tok, join(process.cwd(), tok)]) {
    try { const st = statSync(c); if (st.isFile()) return { path: c, size: st.size }; } catch { /* not a file */ }
  }
  return null;
}

/** For any referenced file too big to inline, build its SYNTHETIC CONTEXT (focus chunk(s) FULL + a
 *  compressed whole-file map) via the chunk-store — this is the "edit massive files without choking"
 *  path. `idents` are the non-file identifiers used as the focus. Returns '' if no big files referenced. */
export function buildBigFileContext(keywords, budget) {
  const tokens = String(keywords || '').split(/\s+/).filter(Boolean);
  const bigFiles = []; const idents = [];
  for (const tok of tokens) {
    const f = resolveFile(tok);
    if (f && f.size > SYNTH_THRESHOLD) bigFiles.push(f.path);
    else if (!f) idents.push(tok);
  }
  if (!bigFiles.length) return '';
  const focus = idents.join(' ');
  const parts = []; let used = 0;
  for (const path of bigFiles) {
    if (used >= budget) break;
    let src; try { src = readFileSync(path, 'utf8'); } catch { continue; }
    const rows = chunkText(src).map((c, i) => ({ idx: i, start_line: c.start, end_line: c.end, symbols: c.symbols, content: c.content, summary: null }));
    const prefix = `### SYNTHETIC CONTEXT — ${path.replace(/\\/g, '/')} (${rows.length} chunks; too big to inline — edit the FOCUS chunk, the rest lives in storage):\n`;
    const room = budget - used - prefix.length - 2;   // reserve for the prefix so buildContext never gets sliced
    if (room < 1500) break;                            // not enough room left for a meaningful window
    const { text } = buildContext(rows, focus, room);
    const block = prefix + text + '\n';
    parts.push(block); used += block.length;
  }
  return parts.join('\n');
}

/** Auto-ground a request with retrieved corpus. HR29: OFF (default) -> unchanged. HR1: SCX key only. */
export async function augmentWithCorpus(parsed, { model = '', storeMode = STORE_MODE } = {}) {
  if (!parsed || storeMode === 'off') return parsed;            // HR29 passthrough default
  const keywords = extractKeywords(parsed);
  if (!keywords) return parsed;

  const modelKey = Object.keys(MODEL_CEIL).find((k) => String(model).toLowerCase().includes(k));
  const modelCeil = modelKey ? MODEL_CEIL[modelKey] : DEFAULT_CEIL;
  const budget = fitBudget(modelCeil, JSON.stringify(parsed).length);
  if (budget <= 0) return parsed;                               // no headroom -> inject nothing (never hard-400)

  // If the request references a file too big to inline, inject its SYNTHETIC CONTEXT (chunk map + focus
  // chunk in full) — never chokes on a massive file. Otherwise fall back to raw corpus search.
  const corpus = buildBigFileContext(keywords, budget) || await searchStore(keywords, budget);
  if (!corpus) return parsed;

  const item = { role: 'developer', content: '### KRITICAL-CORPUS-CONTEXT (auto-grounded, strippable)\n' + corpus };
  // Inject on whichever shape SCX/codex sent. Put it LAST so it sits nearest the current task.
  if (Array.isArray(parsed.input)) return { ...parsed, input: [...parsed.input, item] };
  if (typeof parsed.input === 'string') { const p = { ...parsed, input: [{ role: 'user', content: parsed.input }, item] }; return p; }
  if (Array.isArray(parsed.messages)) return { ...parsed, messages: [...parsed.messages, item] };
  return parsed; // unknown shape — leave untouched
}
