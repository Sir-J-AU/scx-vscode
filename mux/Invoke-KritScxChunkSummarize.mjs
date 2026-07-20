// Kritical SCX — CHUNK SUMMARIZER. SCX writes a one-line synthetic summary per stored chunk, so the
// chunk-store's whole-file MAP becomes a real synthetic overview the model reasons over while editing
// the focus chunk. Parallel, cheap (gpt-oss-120b). HR1: SCX_API_KEY only.
//
//   node mux/Invoke-KritScxChunkSummarize.mjs <file> [--force] [--model gpt-oss-120b]
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026.
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY = process.env.SCX_API_KEY;
if (!KEY) { console.error('SCX_API_KEY not set (HKCU). HR1: SCX only.'); process.exit(2); }
const URL = 'https://api.scx.ai/v1/chat/completions';
const DB_PATH = process.env.KRIT_CHUNK_STORE || join(homedir(), '.kritical-scx', 'chunk-store.db');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const force = args.includes('--force');
const model = (args[args.indexOf('--model') + 1] && args.includes('--model')) ? args[args.indexOf('--model') + 1] : 'gpt-oss-120b';
if (!file) { console.error('usage: Invoke-KritScxChunkSummarize.mjs <file> [--force] [--model M]'); process.exit(1); }

// NOTE: do NOT put a word-count limit here — it makes reasoning models count words in reasoning_content
// and burn the token budget before emitting `content`. A plain terse-line instruction stays clean.
const SYS = 'You summarize ONE code chunk for a file map. Reply with a single terse line describing what it does and its key symbols. No preamble, no code fence, no word count.';

async function summarizeOne(content, syms) {
  // max_tokens generous: reasoning models (gpt-oss-120b) spend tokens in reasoning_content BEFORE
  // emitting `content` — too small a cap leaves content empty (finish_reason=length).
  const body = JSON.stringify({ model, max_tokens: 400, temperature: 0.1,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: `Symbols: ${syms || '(none)'}\n\n${content.slice(0, 6000)}` }] });
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body });
    if (r.status >= 400) return null;
    const j = await r.json();
    const msg = j.choices?.[0]?.message || {};
    let text = msg.content || '';
    // fallback: reasoning models sometimes leave the answer in reasoning_content — take its last sentence,
    // but reject reasoning-noise (meta-talk / digit-glued word-counting) so the map never shows garbage.
    if (!text && msg.reasoning_content) {
      const cand = (msg.reasoning_content.split(/(?<=[.!?])\s+|\n/).filter((s) => s.trim()).pop() || '').trim();
      const noisy = /^(count|sentence|words?|so\b|the user|they want|maybe|probably|let'?s)\b/i.test(cand) || /\w\d\b/.test(cand);
      if (!noisy) text = cand;
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 180) || null;
  } catch { return null; }
}

// tiny concurrency pool
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

const d = new DatabaseSync(DB_PATH); d.exec('PRAGMA journal_mode=WAL;');
const rows = d.prepare('SELECT idx, symbols, content, summary FROM chunks WHERE file=? ORDER BY idx').all(file);
if (!rows.length) { console.error(`no chunks for ${file} — run: node store-mcp/kritical-chunk-store.mjs chunk ${file}`); process.exit(1); }
const todo = rows.filter((r) => force || !r.summary);
console.log(`[summarize] ${file}: ${todo.length}/${rows.length} chunks -> SCX (${model})`);
const upd = d.prepare('UPDATE chunks SET summary=? WHERE file=? AND idx=?');
const t0 = Date.now();
let ok = 0;
await pool(todo, 8, async (r) => { const s = await summarizeOne(r.content, r.symbols); if (s) { upd.run(s, file, r.idx); ok++; } });
console.log(`[summarize] ${ok}/${todo.length} summarized in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
