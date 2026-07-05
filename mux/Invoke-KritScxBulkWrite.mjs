// Kritical SCX — BULK FILE WRITER.
// SCX (MiniMax / DeepSeek / gpt-oss) writes the bulk; the operator lenses + patches the drafts live.
// For each task: ground on real source files, call SCX, stage the generated file as a draft for review.
// HR1: SCX_API_KEY only. No other provider key, ever.
//
//   node mux/Invoke-KritScxBulkWrite.mjs [batch.json]
//   (default batch is embedded below). Drafts land under <stage>/ — nothing in the repo is overwritten.
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const KEY = process.env.SCX_API_KEY;
if (!KEY) { console.error('SCX_API_KEY not set (HKCU). Aborting — HR1: SCX only.'); process.exit(2); }
const URL = 'https://api.scx.ai/v1/chat/completions';
// Repo the ctx files are read from. Override with KRIT_BULK_REPO to ground on a sister repo.
const REPO = process.env.KRIT_BULK_REPO || 'C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical.SCXCode';
const STAGE = 'C:/Users/joshl/AppData/Local/Temp/claude/C--/ba4a3c54-64ce-4d9a-8fc4-89f1e70a856e/scratchpad/scx-drafts';

// Real proven ceilings (docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md) — size grounding to the model.
const CEIL = { 'MiniMax-M2.7': 195000, 'DeepSeek-V3.1': 129000, 'gpt-oss-120b': 108000 };

function readCtx(files, budgetTok) {
  const budget = budgetTok * 4; // chars
  let used = 0; const parts = [];
  for (const f of files) {
    let body = '';
    try { body = readFileSync(join(REPO, f), 'utf8'); } catch { body = '(file not found)'; }
    const block = `===== ${f} =====\n${body}\n`;
    if (used + block.length > budget) { parts.push(`===== ${f} (truncated) =====\n${body.slice(0, Math.max(0, budget - used))}\n`); break; }
    parts.push(block); used += block.length;
  }
  return parts.join('\n');
}

async function scx(model, system, user, maxTokens) {
  const body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.25 });
  const t0 = Date.now();
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body });
    const txt = await r.text();
    if (r.status >= 400) return { ok: false, err: `HTTP ${r.status}: ${txt.slice(0, 200)}`, ms: Date.now() - t0 };
    const j = JSON.parse(txt);
    const out = j.choices?.[0]?.message?.content || '';
    return { ok: true, out, usage: j.usage, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, err: String(e.message || e), ms: Date.now() - t0 }; }
}

// Strip a leading/trailing ``` fence if the model wrapped the whole file.
function unfence(s) {
  const m = s.match(/^\s*```[a-zA-Z0-9]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s.trim() + '\n';
}

const SYS = 'You are a senior engineer on the Kritical SCXCode project (SCX-in-VS-Code: a TypeScript VS Code extension + a Node flatten-shim that lets OpenAI Codex drive Southern Cross AI agentically + a PowerShell wrapper + Python mux automations + a node:sqlite local store). Write production-quality, complete files. Match the existing code style. Output ONLY the file contents — no explanation, no markdown fence, no preamble.';

// Default batch — real "finish it in full" deliverables. Each grounds on actual source.
const BATCH = [
  {
    out: 'README.md', model: 'MiniMax-M2.7', maxTokens: 3500,
    ctx: ['src/package.json', 'CLAUDE.md', 'docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md', 'docs/SCX-BUGHUNT-FIXES-5231.md', 'codex-wrapper/kritical-codex.ps1', 'mux/Invoke-KritScxMuxMatrix.py'],
    prompt: 'Write a comprehensive top-level README.md for the Kritical.SCXCode monorepo. Cover: what it is (sovereign SCX inside VS Code, agentic Codex-on-SCX via the flatten-shim, PowerShell client, MCP server, Node agent, mux automations, the Lens Looking Glass), the surfaces/directory map, quick-start for each surface, the agentic-codex flow (kritical-codex.ps1 -> scx-agentic-shim.mjs -> SCX), the multi-model mux (real proven ceilings: DeepSeek 129k / MiniMax 195k / gpt-oss 108k), HR1/HR29 safety (SCX_API_KEY only, additive layers), and the Kritical brand line. Ground every claim in the provided source. Markdown, polished, no fluff.',
  },
  {
    out: 'store-mcp/kritical-local-store.test.mjs', model: 'DeepSeek-V3.1', maxTokens: 2600,
    ctx: ['store-mcp/kritical-local-store.mjs'],
    prompt: 'Write a self-contained Node test file (node:test, `node --test`) for store-mcp/kritical-local-store.mjs. It must run OFFLINE with zero network: create a temp SQLite db via the KRIT_LOCAL_STORE env override, mine a tiny fixture dir it creates in the OS temp dir, then assert search()/symbols()/stats() behave (including the .5231 empty-keyword guard returning empty, not throwing). Import the module the way its exports allow; if it has no exports, drive it via child_process spawning `node kritical-local-store.mjs <cmd>`. Clean up temp files in a finally. Node 22+ (node:sqlite/DatabaseSync). Output only the test file.',
  },
  {
    out: 'mux/Invoke-KritScxMuxMatrix.test.py', model: 'gpt-oss-120b', maxTokens: 2200,
    ctx: ['mux/Invoke-KritScxMuxMatrix.py'],
    prompt: 'Write a self-contained pytest/unittest file for mux/Invoke-KritScxMuxMatrix.py that runs OFFLINE (no SCX network calls). Test the pure logic: the MODEL_CEILINGS values, the per-model context_char_budget() sizing (MiniMax gets more chars than gpt-oss), and trim_to_budget() packing (drops oversized blocks, keeps ones that fit). Import functions from the module (use importlib if the filename has dots/dashes). Do NOT call run_model_stream or anything that hits the network. Output only the test file.',
  },
];

async function main() {
  const batchArg = process.argv[2];
  const batch = batchArg ? JSON.parse(readFileSync(batchArg, 'utf8')) : BATCH;
  mkdirSync(STAGE, { recursive: true });
  console.log(`== SCX bulk-write: ${batch.length} tasks -> ${STAGE} ==`);
  const results = await Promise.all(batch.map(async (t) => {
    const budgetTok = Math.floor((CEIL[t.model] || 108000) * 0.5); // half the ceiling for grounding
    const grounding = readCtx(t.ctx || [], budgetTok);
    const user = `${t.prompt}\n\n===== GROUND TRUTH SOURCE =====\n${grounding}`;
    const r = await scx(t.model, SYS, user, t.maxTokens || 2500);
    if (!r.ok) { console.log(`  [FAIL] ${t.out} (${t.model}) — ${r.err}`); return { ...t, ok: false, err: r.err }; }
    const content = unfence(r.out);
    const draftPath = join(STAGE, t.out.replace(/[\\/]/g, '__') + '.draft');
    mkdirSync(dirname(draftPath), { recursive: true });
    writeFileSync(draftPath, content, 'utf8');
    console.log(`  [OK ] ${t.out} (${t.model}) — ${content.length} chars, ${r.usage?.prompt_tokens || '?'}->${r.usage?.completion_tokens || '?'} tok, ${(r.ms / 1000).toFixed(1)}s -> ${draftPath}`);
    return { ...t, ok: true, draftPath, chars: content.length };
  }));
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n== done: ${ok}/${batch.length} drafts staged. Review + patch + land the good ones. ==`);
  writeFileSync(join(STAGE, '_manifest.json'), JSON.stringify(results, null, 1));
}

main();
