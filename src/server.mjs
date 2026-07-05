// Kritical.NodeJS.SCXCodeAgent — bridge daemon.
//
// Fastify HTTP server (127.0.0.1) that fronts a LiteLLM upstream and augments it
// with multi-turn auto-continuation, web tools, and HR27 write-through. Every
// augmented call still returns a valid Anthropic/OpenAI envelope so callers
// don't know they went through anything.
//
// Per HR29 (.5184): additive layer. Stop it and downstream agents go direct to
//   their real provider APIs. The kill switch is printed on every liveliness probe.
// Per HR27 (.5182): every served prompt + response written to documentation/{human,ai}/.
// Per HR28 (.5183): mechanism-named identifiers only.
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
// Contact: sales@kritical.net — ph. 1300 274 655

import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { autoContinue } from './auto-continue.mjs';
import { extractResponseText } from './auto-continue.mjs';
import { addHumanPrompt, addAiResponse, emitIngestEvent } from './hr27.mjs';
import { webSearch } from './tools/web-search.mjs';
import { webFetch } from './tools/web-fetch.mjs';
import { deepResearch } from './tools/deep-research.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const VERSION = '0.1.0';
const HOST = process.env.KRITICAL_AGENT_HOST || '127.0.0.1';
const PORT = parseInt(process.env.KRITICAL_AGENT_PORT || process.env.KRITICAL_AGENT_PORT_ANTHROPIC || '4180', 10);
// The LiteLLM subprocess the daemon proxies to (spawned by the installer). Kept
// separate from the daemon's own front port so both layers can coexist.
const UPSTREAM = (process.env.KRIT_AGENT_UPSTREAM || 'http://127.0.0.1:4182').replace(/\/$/, '');
const UPSTREAM_KEY = process.env.KRIT_AGENT_UPSTREAM_KEY || process.env.SCX_API_KEY || 'sk-kritical-scx-local';

// -----------------------------------------------------------------------------
// Kritical brand banner (once per process)
// -----------------------------------------------------------------------------

let bannerEmitted = false;
export function showBanner() {
  if (bannerEmitted) return;
  bannerEmitted = true;
  console.log('');
  console.log('  Kritical.NodeJS.SCXCodeAgent — multi-provider bridge (HR29 additive)');
  console.log('  Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655 · https://kritical.net');
  console.log('');
}

// -----------------------------------------------------------------------------
// Provider slot detection (key present -> live; absent -> dormant)
// -----------------------------------------------------------------------------

export function detectProviderSlots() {
  const slot = (keyEnv, apiBase) => ({ keyPresent: !!process.env[keyEnv], keyEnv, apiBase });
  return {
    scx: slot('SCX_API_KEY', 'https://api.scx.ai/v1'),
    anthropic: slot('ANTHROPIC_API_KEY', 'https://api.anthropic.com'),
    openai: slot('OPENAI_API_KEY', 'https://api.openai.com/v1'),
    generic: { keyPresent: !!process.env.GENERIC_API_KEY, keyEnv: 'GENERIC_API_KEY', apiBase: process.env.GENERIC_API_BASE || null },
  };
}

const KILL_SWITCH = {
  stop_daemon: 'POST /admin/kill',
  fully_disable: 'pwsh ./install/Install-KritScxCodeAgent.ps1 -Mode Remove',
  with_daemon_off: 'downstream agents (Claude Code / Codex / SCX PS module) talk to their real APIs directly — unaffected',
};

// -----------------------------------------------------------------------------
// Upstream passthrough (global fetch — no runtime dep)
// -----------------------------------------------------------------------------

async function proxyUpstream(path, { method = 'POST', body } = {}, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${UPSTREAM}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${UPSTREAM_KEY}`,
      'x-api-key': UPSTREAM_KEY,
      'anthropic-version': '2023-06-01',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function firstUserPrompt(messages) {
  if (!Array.isArray(messages)) return '';
  const u = [...messages].reverse().find((m) => m.role === 'user');
  if (!u) return '';
  return typeof u.content === 'string' ? u.content : JSON.stringify(u.content);
}

function envelopeHash(obj) {
  return createHash('sha256').update(JSON.stringify(obj || {})).digest('hex').slice(0, 16);
}

// -----------------------------------------------------------------------------
// Server factory (exported for tests; does NOT listen)
// -----------------------------------------------------------------------------

export function buildServer({ fetchImpl = globalThis.fetch, onKill } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  const slots = detectProviderSlots();

  app.get('/health/liveliness', async () => ({
    ok: true,
    service: 'kritical-scxcode-agent',
    version: VERSION,
    providers: slots,
    upstream: UPSTREAM,
    hr29_kill_switch: KILL_SWITCH,
  }));

  app.get('/health/readiness', async () => {
    try {
      const r = await fetchImpl(`${UPSTREAM}/health/liveliness`, { method: 'GET' });
      return { ready: r.ok, upstream: UPSTREAM, upstream_status: r.status };
    } catch (e) {
      return { ready: false, upstream: UPSTREAM, error: e.message };
    }
  });

  app.get('/v1/models', async (req, reply) => {
    try {
      const { status, json } = await proxyUpstream('/v1/models', { method: 'GET' }, fetchImpl);
      reply.code(status);
      return json;
    } catch (e) {
      reply.code(502);
      return { error: 'upstream_unreachable', upstream: UPSTREAM, message: e.message };
    }
  });

  const servedPassthrough = (path, shape) => async (req, reply) => {
    const t0 = Date.now();
    const body = req.body || {};
    try {
      const { status, json } = await proxyUpstream(path, { body }, fetchImpl);
      reply.code(status);
      if (status < 400) {
        const prompt = firstUserPrompt(body.messages);
        const answer = extractResponseText(json);
        if (prompt) addHumanPrompt(prompt, { wave: '.5184', source: `agent-${shape}` });
        if (answer) addAiResponse(answer, { model: body.model, provider: 'scx', wave: '.5184', source: `agent-${shape}` });
        emitIngestEvent('tool-calls', {
          shape, model: body.model, provider: 'scx', status,
          latency_ms: Date.now() - t0, prompt_len: prompt.length,
          response_envelope_hash: envelopeHash(json),
        });
      }
      return json;
    } catch (e) {
      reply.code(502);
      return { error: 'upstream_unreachable', upstream: UPSTREAM, message: e.message };
    }
  };

  app.post('/v1/messages', servedPassthrough('/v1/messages', 'anthropic'));
  app.post('/v1/chat/completions', servedPassthrough('/v1/chat/completions', 'openai'));

  app.post('/v1/auto-continue', async (req, reply) => {
    const b = req.body || {};
    if (!b.prompt) { reply.code(400); return { error: 'bad_request', message: '"prompt" is required.' }; }
    try {
      const r = await autoContinue({
        prompt: b.prompt, model: b.model, systemPrompt: b.system || b.systemPrompt,
        maxContinues: b.max_continues ?? b.maxContinues ?? 10,
        perTurnCeiling: b.per_turn_ceiling ?? b.perTurnCeiling ?? 8192,
        sessionId: b.session_id, wave: b.wave, apiBase: UPSTREAM, apiKey: UPSTREAM_KEY, fetchImpl,
      });
      // return an Anthropic-shape envelope so callers can treat it like any /v1/messages reply
      return {
        id: `msg_autocontinue_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: r.model,
        content: [{ type: 'text', text: r.mergedResponse }],
        stop_reason: r.stopReason,
        kritical_auto_continue: { turn_count: r.turnCount, duration_sec: r.durationSec, dedup_saved: r.dedupSaved, errors: r.errors },
      };
    } catch (e) {
      reply.code(502);
      return { error: 'auto_continue_failed', message: e.message };
    }
  });

  app.post('/v1/tools/web_search', async (req, reply) => {
    const r = await webSearch({ query: (req.body || {}).query, count: (req.body || {}).count, fetchImpl });
    if (!r.ok) reply.code(r.status || 502);
    return r;
  });

  app.post('/v1/tools/web_fetch', async (req, reply) => {
    const r = await webFetch({ url: (req.body || {}).url, fetchImpl });
    if (!r.ok) reply.code(r.status || 502);
    return r;
  });

  app.post('/v1/tools/deep_research', async (req, reply) => {
    const b = req.body || {};
    const r = await deepResearch({ question: b.question, maxResults: b.max_results, model: b.model, fetchImpl });
    if (!r.ok) reply.code(r.status || 502);
    return r;
  });

  // Ingest hook (brief §Ingest layer — .5187 plugs in here). Hash-based stub:
  // records the file shape without pulling in tree-sitter this wave.
  app.post('/v1/ingest/code', async (req, reply) => {
    const b = req.body || {};
    if (!b.path || b.content === undefined) { reply.code(400); return { error: 'bad_request', message: '"path" and "content" required.' }; }
    const astHash = createHash('sha256').update(String(b.content)).digest('hex');
    const imports = [...String(b.content).matchAll(/^\s*(?:import|using|#include|require)\b.*$/gim)].map((m) => m[0].trim()).slice(0, 200);
    const exports = [...String(b.content).matchAll(/^\s*export\b.*$/gim)].map((m) => m[0].trim()).slice(0, 200);
    const symbolCount = (String(b.content).match(/\b(function|class|def|const|let|var|interface|type|enum)\b/g) || []).length;
    const event = { file: b.path, language: b.language || null, ast_hash: astHash, symbol_count: symbolCount, imports, exports };
    emitIngestEvent('ast-parses', event);
    return { ok: true, ingested: event, note: 'hash-based stub; .5187 runs tree-sitter in bulk.' };
  });

  app.post('/admin/kill', async () => {
    setTimeout(() => { if (onKill) onKill('POST /admin/kill'); }, 50);
    return { shutting_down: true, hr29: true, kill_switch: KILL_SWITCH };
  });

  return app;
}

// -----------------------------------------------------------------------------
// Foreground start (used by `kritical-scxcode-agent start` and the installer)
// -----------------------------------------------------------------------------

export async function start() {
  showBanner();
  const slots = detectProviderSlots();
  console.log('[startup] Provider slots:');
  for (const [name, s] of Object.entries(slots)) {
    console.log(`  ${name.padEnd(10)} ${s.keyPresent ? 'LIVE   ' : 'dormant'}  (${s.keyEnv} ${s.keyPresent ? 'present' : 'absent'})`);
  }

  let app;
  const shutdown = async (reason) => {
    console.log(`\n[HR29 kill switch] Shutting down (${reason}). Downstream agents now go direct to their APIs — by design.`);
    try { if (app) await app.close(); } finally { process.exit(0); }
  };
  app = buildServer({ onKill: shutdown });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: HOST, port: PORT });
  console.log(`[startup] Kritical.NodeJS.SCXCodeAgent listening at http://${HOST}:${PORT}`);
  console.log(`[startup] Upstream LiteLLM: ${UPSTREAM}  (proxied for /v1/messages, /v1/chat/completions, /v1/models)`);
  console.log(`[startup] Kill switch: ${KILL_SWITCH.stop_daemon}  ·  fully disable: ${KILL_SWITCH.fully_disable}`);
  console.log(`[startup] Repo root: ${repoRoot}`);
}

// auto-start only when run directly (not when imported by tests)
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  start().catch((err) => { console.error('[fatal] Failed to start:', err); process.exit(1); });
}
