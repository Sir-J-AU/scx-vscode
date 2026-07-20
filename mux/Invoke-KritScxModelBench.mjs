// Kritical SCX — MODEL BENCHMARK / MUX-TUNING HARNESS. Runs one agentic-coding task across N SCX models,
// captures REAL stats (latency, prompt/completion/reasoning tokens) and computes TRUE cost from the live
// per-token pricing in sources/api.scx.ai/v1/models.json — then compares the outputs side by side.
//
// "Both directions": pass two (or more) model ids; the harness runs the same task through each and emits a
// head-to-head comparison so you can diff outputs + cost + speed. Extensible: add tasks, add models.
//
//   SCX_API_KEY=... node mux/Invoke-KritScxModelBench.mjs --models MiniMax-M2.7,gpt-oss-120b,DeepSeek-V3.1 \
//                                                         --task ./mux/bench-tasks/slugify.txt --maxTokens 700
//   (no --task -> uses the built-in representative code-gen task)
//
// Emits: JSON (--out) + a markdown row block. HR1: reads SCX_API_KEY only, never any other provider key.
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.SCX_API_KEY;
if (!KEY) { console.error('SCX_API_KEY not set (HR1: SCX key only).'); process.exit(2); }

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const MODELS = String(args.models || 'MiniMax-M2.7,gpt-oss-120b,DeepSeek-V3.1').split(',').map(s => s.trim()).filter(Boolean);
const MAX_TOKENS = parseInt(args.maxTokens || '700', 10);
const OUT = args.out ? resolve(String(args.out)) : join(HERE, 'bench-result.json');

// representative agentic-coding micro-task (deterministic enough to compare correctness by eye)
const DEFAULT_TASK = `Write a single JavaScript function \`slugify(s)\` that: lowercases the input, replaces every run of non-alphanumeric characters with a single hyphen, and trims leading/trailing hyphens. Return ONLY the function body in a code block, no prose.`;
const TASK = args.task && existsSync(String(args.task)) ? readFileSync(String(args.task), 'utf8') : DEFAULT_TASK;

// ---- live pricing from the repo's models.json (single source of truth) ----
const modelsPath = join(HERE, '..', 'sources', 'api.scx.ai', 'v1', 'models.json');
let PRICING = {};
try {
  const mj = JSON.parse(readFileSync(modelsPath, 'utf8'));
  const arr = mj.data || mj.models || (Array.isArray(mj) ? mj : Object.values(mj)[0]);
  for (const m of arr) PRICING[m.id || m.name] = { prompt: +(m.pricing?.prompt || 0), completion: +(m.pricing?.completion || 0), ctx: m.context_length };
} catch (e) { console.error('WARN: could not load pricing from', modelsPath, '-', e.message); }

const usd = (n) => '$' + n.toFixed(6);

async function run(model) {
  const body = { model, max_tokens: MAX_TOKENS, temperature: 0.1,
    messages: [{ role: 'user', content: TASK }] };
  const t0 = Date.now();
  let status, j = {};
  try {
    const r = await fetch('https://api.scx.ai/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY }, body: JSON.stringify(body),
    });
    status = r.status; j = await r.json().catch(() => ({}));
  } catch (e) { status = 0; j = { error: String(e) }; }
  const ms = Date.now() - t0;
  const m = j.choices?.[0]?.message || {};
  const u = j.usage || {};
  const reasoning = u.completion_tokens_details?.reasoning_tokens || 0;
  const text = (m.content || '').trim() || (m.reasoning_content ? '[reasoning-only] ' + m.reasoning_content.slice(-400) : '');
  const price = PRICING[model] || { prompt: 0, completion: 0 };
  const cost = (u.prompt_tokens || 0) * price.prompt + (u.completion_tokens || 0) * price.completion;
  return {
    model, status, ms, finish: j.choices?.[0]?.finish_reason,
    promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0, reasoningTokens: reasoning,
    costUSD: cost, contentOnly: !!(m.content && m.content.trim()), outputLen: text.length, output: text,
  };
}

const results = [];
for (const model of MODELS) { process.stderr.write(`  running ${model} ... `); const r = await run(model); results.push(r); process.stderr.write(`${r.status} ${r.ms}ms ${usd(r.costUSD)}\n`); }

// ---- comparison table ----
const pad = (s, n) => String(s).padEnd(n);
console.log('\n# SCX Model Benchmark — task: ' + (args.task ? args.task : 'built-in slugify code-gen'));
console.log('\n| Model | HTTP | ms | prompt tok | compl tok | reasoning | cost | content? |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.model} | ${r.status} | ${r.ms} | ${r.promptTokens} | ${r.completionTokens} | ${r.reasoningTokens} | ${usd(r.costUSD)} | ${r.contentOnly ? 'yes' : 'REASONING-ONLY'} |`);
}
// cheapest / fastest
const ok = results.filter(r => r.status === 200);
if (ok.length) {
  const cheapest = ok.reduce((a, b) => a.costUSD <= b.costUSD ? a : b);
  const fastest = ok.reduce((a, b) => a.ms <= b.ms ? a : b);
  console.log(`\ncheapest: ${cheapest.model} (${usd(cheapest.costUSD)}) | fastest: ${fastest.model} (${fastest.ms}ms)`);
}
writeFileSync(OUT, JSON.stringify({ task: TASK, maxTokens: MAX_TOKENS, ranAt: new Date().toISOString(), results }, null, 2));
console.error('\nwrote ' + OUT);
