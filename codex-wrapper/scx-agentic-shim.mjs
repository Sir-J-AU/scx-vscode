// Kritical SCX agentic flatten-shim.
//
// Localhost Responses proxy that lets codex (wire_api="responses") drive SCX agentically.
// Codex serialises its shell/apply_patch tools as types SCX rejects (namespace/custom/local_shell/
// freeform). SCX accepts `function` tools and emits `function_call`. This shim rewrites the outbound
// `tools` to `function`, forwards to SCX, and streams the response back (SSE passthrough in v1).
//
// HR1/HR29: SCX_API_KEY only; never reads OPENAI_*/ANTHROPIC_*; binds localhost only.
// See ../docs/SCX-AGENTIC-BRIDGE-SPEC.md §3. No dependencies (Node >= 20 global fetch).
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

import http from 'node:http';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { augmentWithCorpus } from './scx-corpus-augment.mjs';

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.KRIT_SHIM_PORT || '4199', 10);
const UPSTREAM = (process.env.KRIT_SHIM_UPSTREAM || 'https://api.scx.ai/v1').replace(/\/$/, '');
const KEY = process.env.SCX_API_KEY || '';
const LOG = process.env.KRIT_SHIM_LOG || join(tmpdir(), 'krit-shim.log');
const DEBUG = process.env.KRIT_SHIM_DEBUG === '1';
const MODEL_CATALOG_CACHE = process.env.KRIT_SCX_MODEL_CATALOG_CACHE
  || 'C:\\KriticalSCX\\config\\models\\scx-model-catalog.json';
const MODEL_CATALOG_USER_MIRROR = process.env.KRIT_SCX_MODEL_CATALOG_USER_MIRROR
  || join(homedir(), '.kritical-scx', 'models-catalog.full.json');
const MODEL_CATALOG_HISTORY_DIR = process.env.KRIT_SCX_MODEL_CATALOG_HISTORY_DIR
  || 'C:\\KriticalSCX\\config\\models\\history';

// SCX's accepted server tool types (from live probe) — everything else from a client is treated as a
// local function tool.
const SERVER_TOOLS = new Set([
  'web_search', 'code_interpreter', 'file_retrieval', 'academic_search', 'youtube_search', 'reddit_search',
  'x_search', 'mcp_search', 'trove_search', 'retrieve', 'movie_tv_search', 'trending_movies', 'trending_tv',
  'mermaid_diagram', 'coin_data', 'coin_data_by_contract', 'coin_ohlc', 'currency_converter', 'stock_chart',
  'stock_price', 'find_place_on_map', 'nearby_places_search', 'weather', 'travel_advisor', 'flight_tracker',
  'flight_live_tracker', 'datetime', 'greeting', 'text_translate', 'memory_manager',
]);
const UNSUPPORTED_OPENAI_PARAMS = new Set(['logprobs', 'top_logprobs', 'n', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed']);

function log(...a) { try { appendFileSync(LOG, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'); } catch {} }

function safeSlug(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'unknown';
}

function writeJsonAtomic(pathTarget, data, historyDetail = '') {
  try {
    const json = JSON.stringify(data, null, 2);
    const tmp = `${pathTarget}.${process.pid}.tmp`;
    mkdirSync(dirname(pathTarget), { recursive: true });
    writeFileSync(tmp, json);
    JSON.parse(json);
    if (existsSync(pathTarget)) {
      try { copyFileSync(pathTarget, `${pathTarget}.bak`); } catch { /* best effort */ }
      if (historyDetail) {
        try {
          mkdirSync(MODEL_CATALOG_HISTORY_DIR, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '');
          copyFileSync(pathTarget, join(MODEL_CATALOG_HISTORY_DIR, `${safeSlug('scx')}-${safeSlug(historyDetail)}-${stamp}.previous.json`));
        } catch { /* best effort */ }
      }
    }
    renameSync(tmp, pathTarget);
  } catch (e) {
    log('[cache] write failed', e.message);
  }
}

/** Rewrite one tool into something SCX accepts. Returns an array (namespace flattens to many). */
function flattenTool(t, dropServer) {
  if (!t || typeof t !== 'object') return [t];
  const type = t.type;
  if (SERVER_TOOLS.has(type)) return dropServer ? [] : [t];                    // plan-gated; drop on retry
  if (type === 'function') return [t];                                         // already fine
  // namespace grouping -> spread its inner tools (usually already function)
  if (type === 'namespace' && Array.isArray(t.tools)) {
    return t.tools.flatMap((inner) => {
      if (inner && inner.type === 'function') return [inner];
      const fn = inner && inner.function ? inner.function : inner;
      return [{ type: 'function', name: fn?.name || t.name || 'tool', description: fn?.description || '', parameters: fn?.parameters || { type: 'object', properties: {} } }];
    });
  }
  // local_shell / custom / freeform / anything else -> a plain function tool, name preserved
  return [{
    type: 'function',
    name: t.name || (type === 'local_shell' ? 'shell' : type) || 'tool',
    description: t.description || `Local ${type} tool`,
    parameters: t.parameters || t.input_schema || { type: 'object', properties: { input: { type: 'string' } } },
  }];
}

function transformRequestBody(body, dropServer = false) {
  if (!body || !Array.isArray(body.tools)) return body;
  const before = body.tools.map((t) => t?.type).join(',');
  const tools = body.tools.flatMap((t) => flattenTool(t, dropServer));
  const after = tools.map((t) => t?.type).join(',');
  if (before !== after) log('[req] tools', before, '->', after, dropServer ? '(server dropped)' : '');
  return { ...body, tools };
}

function normalizeScxRequestBody(body, endpoint = '') {
  if (!body || typeof body !== 'object') return { body, warnings: [] };
  const out = { ...body };
  const warnings = [];

  for (const key of UNSUPPORTED_OPENAI_PARAMS) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      delete out[key];
      warnings.push(`removed unsupported OpenAI parameter '${key}' before forwarding to SCX`);
    }
  }

  if (typeof out.temperature === 'number') {
    const clamped = Math.max(0, Math.min(1, out.temperature));
    if (clamped !== out.temperature) {
      warnings.push(`clamped temperature ${out.temperature} to SCX OpenAI-compatible range 0..1`);
      out.temperature = clamped;
    }
  }

  if (/\/responses$/.test(endpoint) && typeof out.max_tokens === 'number' && out.max_output_tokens === undefined) {
    out.max_output_tokens = out.max_tokens;
    delete out.max_tokens;
    warnings.push("mapped chat-style 'max_tokens' to responses-style 'max_output_tokens'");
  }

  if (/\/chat\/completions$/.test(endpoint) && typeof out.max_output_tokens === 'number' && out.max_tokens === undefined) {
    out.max_tokens = out.max_output_tokens;
    delete out.max_output_tokens;
    warnings.push("mapped responses-style 'max_output_tokens' to chat-style 'max_tokens'");
  }

  if (warnings.length) log('[req.param-normalize]', endpoint, warnings.join(' | '));
  return { body: out, warnings };
}

function responseHeaders(upstream, warnings = []) {
  const headers = { 'content-type': upstream.headers.get('content-type') || 'application/json' };
  if (warnings.length) {
    headers['x-kritical-scx-warnings'] = warnings.join(' | ').slice(0, 1800);
  }
  return headers;
}

function isPlanGateError(status, text) {
  return status === 400 && /current plan|model_not_in_plan|not available on your/i.test(text || '');
}

function isContextLimitError(status, text) {
  return status === 400 && /maximum context length|context_length_exceeded|reduce the length of the messages/i.test(text || '');
}

function isRetryableUpstreamStatus(status) {
  return status === 429 || status === 529 || status === 500 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.min(numeric * 1000, 60_000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 60_000));
  return null;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchWithBackoff(call, { maxAttempts = 5, baseDelayMs = 1_000 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await call();
    if (!isRetryableUpstreamStatus(last.status) || attempt === maxAttempts) return last;
    const retryAfter = parseRetryAfterMs(last.headers.get('retry-after'));
    const delay = retryAfter ?? Math.min(baseDelayMs * (2 ** (attempt - 1)), 15_000);
    log('[retry] upstream', last.status, `attempt=${attempt}/${maxAttempts}`, `sleep_ms=${delay}`);
    await sleep(delay);
  }
  return last;
}

async function remapModelsResponse(response) {
  const txt = await response.text();
  try {
    const j = JSON.parse(txt);
    const rows = Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : null);
    const nonChat = /(embed|e5-mistral|whisper|opir|moderation|rerank|guard)/i;
    const reasoningLevels = [
      { effort: 'low', description: 'Low reasoning effort' },
      { effort: 'medium', description: 'Medium reasoning effort' },
      { effort: 'high', description: 'High reasoning effort' },
    ];
    const sanitizeInputModalities = (value) => {
      const list = Array.isArray(value) ? value.map((x) => String(x).toLowerCase()) : [];
      const supported = list.filter((x) => x === 'text' || x === 'image');
      return supported.length ? [...new Set(supported)] : ['text'];
    };
    const codexRows = rows
      ? rows.map((row) => {
          if (typeof row === 'string') {
            return {
              slug: row,
              display_name: row,
              description: null,
              default_reasoning_level: null,
              supported_reasoning_levels: [],
              shell_type: 'shell_command',
              visibility: 'list',
              supported_in_api: true,
              priority: 99,
              additional_speed_tiers: [],
              service_tiers: [],
              default_service_tier: null,
              availability_nux: null,
              upgrade: null,
              base_instructions: '',
              model_messages: null,
              include_skills_usage_instructions: false,
              supports_reasoning_summaries: false,
              default_reasoning_summary: 'auto',
              support_verbosity: false,
              default_verbosity: null,
              apply_patch_tool_type: 'freeform',
              web_search_tool_type: 'text',
              truncation_policy: { mode: 'bytes', limit: 10000 },
              supports_parallel_tool_calls: false,
              supports_image_detail_original: false,
              context_window: null,
              max_context_window: null,
              auto_compact_token_limit: null,
              comp_hash: null,
              effective_context_window_percent: 95,
              experimental_supported_tools: [],
              input_modalities: ['text'],
              supports_search_tool: false,
              use_responses_lite: false,
              auto_review_model_override: null,
              tool_mode: null,
              multi_agent_version: null,
            };
          }
          const id = String(row?.id || row?.slug || row?.model || row?.name || '');
          if (!id) return row;
          const features = Array.isArray(row.supported_features) ? row.supported_features : [];
          const hasReasoning = features.some((f) => String(f).toLowerCase() === 'reasoning');
          const hasTools = features.some((f) => String(f).toLowerCase() === 'tools');
          const chatCapable = !nonChat.test(id);
          const contextWindow = Number(row.context_length || row.context_window || row.max_context_length) || null;
          const inputModalities = sanitizeInputModalities(row.input_modalities);
          return {
            slug: row.slug || id,
            display_name: row.display_name || row.name || id,
            description: row.description || null,
            default_reasoning_level: hasReasoning ? 'medium' : null,
            supported_reasoning_levels: hasReasoning ? reasoningLevels : [],
            shell_type: 'shell_command',
            visibility: chatCapable ? 'list' : 'hide',
            supported_in_api: chatCapable,
            priority: chatCapable ? 50 : 500,
            additional_speed_tiers: [],
            service_tiers: [],
            default_service_tier: null,
            availability_nux: null,
            upgrade: null,
            base_instructions: '',
            model_messages: null,
            include_skills_usage_instructions: false,
            supports_reasoning_summaries: hasReasoning,
            default_reasoning_summary: 'auto',
            support_verbosity: false,
            default_verbosity: null,
            apply_patch_tool_type: hasTools ? 'freeform' : null,
            web_search_tool_type: 'text',
            truncation_policy: { mode: 'bytes', limit: 10000 },
            supports_parallel_tool_calls: hasTools,
            supports_image_detail_original: inputModalities.includes('image'),
            context_window: contextWindow,
            max_context_window: contextWindow,
            auto_compact_token_limit: null,
            comp_hash: null,
            effective_context_window_percent: 95,
            experimental_supported_tools: hasTools ? ['shell_command', 'apply_patch'] : [],
            input_modalities: inputModalities,
            supports_search_tool: false,
            use_responses_lite: false,
            auto_review_model_override: null,
            tool_mode: null,
            multi_agent_version: null,
          };
        }).filter((row) => row && row.supported_in_api && row.visibility !== 'hide')
      : null;
    if (rows && rows.length) {
      const payload = {
        captured_utc: new Date().toISOString(),
        provider: 'scx',
        server: 'scx',
        source: 'scx-agentic-shim:/models',
        status: response.status,
        count: rows.length,
        chat_count: rows.filter((r) => !/(embed|e5-mistral|whisper|opir|moderation|rerank|guard)/i.test(String(typeof r === 'string' ? r : (r?.id || r?.model || r?.name || '')))).length,
        canonical_path: MODEL_CATALOG_CACHE,
        mirror_path: MODEL_CATALOG_USER_MIRROR,
        backup_history_dir: MODEL_CATALOG_HISTORY_DIR,
        models: rows,
      };
      writeJsonAtomic(MODEL_CATALOG_CACHE, payload, 'models-catalog');
      writeJsonAtomic(MODEL_CATALOG_USER_MIRROR, payload, 'models-catalog-user-mirror');
    }
    if (Array.isArray(j.data)) {
      return new Response(JSON.stringify({ ...j, data: codexRows, models: codexRows }), { status: response.status, headers: response.headers });
    }
    if (Array.isArray(j.models)) {
      return new Response(JSON.stringify({ ...j, data: codexRows, models: codexRows }), { status: response.status, headers: response.headers });
    }
  } catch {
    // Body has been consumed; rebuild it unchanged so the caller still receives the upstream payload.
  }
  return new Response(txt, { status: response.status, headers: response.headers });
}

export {
  flattenTool,
  transformRequestBody,
  isPlanGateError,
  isContextLimitError,
  isRetryableUpstreamStatus,
  parseRetryAfterMs,
  normalizeScxRequestBody,
  remapModelsResponse,
  SERVER_TOOLS,
};

// ---- telemetry ("wire the fuck out of it") — one structured JSON row per served request ----
const TELEM = process.env.KRIT_SHIM_TELEMETRY || join(tmpdir(), 'scx-shim-telemetry.jsonl');
let _seq = 0;
function telem(ev) {
  try { appendFileSync(TELEM, JSON.stringify({ ts: new Date().toISOString(), seq: ++_seq, ...ev }) + '\n'); } catch {}
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, `http://${HOST}`);
    // local liveness — lets the wrapper confirm the shim is up without a SCX round-trip
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'scx-agentic-shim', upstream: UPSTREAM }));
      return;
    }
    // .5231 (bughunt) — build the upstream target robustly. UPSTREAM already carries its own path
    // suffix (usually `/v1`) and has no trailing slash. Strip a leading `/v1` from the client path
    // ONLY when present (codex may or may not include it), then join with exactly one slash so we
    // never emit `//` or drop the separator. Paths that don't start with `/v1` pass through intact.
    const clientPath = url.pathname.replace(/^\/v1(?=\/|$)/, '');
    const target = UPSTREAM + (clientPath.startsWith('/') ? clientPath : '/' + clientPath) + url.search;

    const isResponses = req.method === 'POST' && url.pathname.endsWith('/responses');
    const isJsonRequest = req.method !== 'GET' && req.method !== 'HEAD' && /application\/json/i.test(String(req.headers['content-type'] || 'application/json'));
    let parsed = null;
    if (isJsonRequest && raw) { try { parsed = JSON.parse(raw); if (DEBUG && isResponses) log('[req.raw.tools]', JSON.stringify(parsed.tools || []).slice(0, 4000)); } catch (e) { log('[req] parse fail', e.message); } }

    const call = (bodyStr) => fetchWithBackoff(() => fetch(target, {
      method: req.method,
      // .5231 (bughunt) — forward the client's original content-type instead of hard-coding JSON,
      // so non-JSON bodies (e.g. multipart uploads) aren't mislabelled; default to JSON when absent.
      headers: { 'content-type': req.headers['content-type'] || 'application/json', authorization: `Bearer ${KEY}`, accept: req.headers['accept'] || 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyStr,
    }));

    const t0 = Date.now();
    const T = { method: req.method, endpoint: url.pathname, model: parsed && parsed.model, stream: !!(parsed && parsed.stream), retried: false, flattened: false, bytes: 0 };
    const warnings = [];
    try {
      let firstBody = raw;
      if (parsed) {
        const normalized = normalizeScxRequestBody(parsed, url.pathname);
        warnings.push(...normalized.warnings);
        T.param_warnings = warnings;
        parsed = normalized.body;
        firstBody = JSON.stringify(parsed);
      }
      if (isResponses && parsed) {
        T.tools_in = (parsed.tools || []).map((t) => t && t.type);
        const transformed = transformRequestBody(parsed);
        T.tools_out = (transformed.tools || []).map((t) => t && t.type);
        T.flattened = JSON.stringify(T.tools_in) !== JSON.stringify(T.tools_out);
        // .5231 — storage->agent: auto-ground the request in retrieved corpus (opt-in KRIT_SHIM_STORE;
        // OFF by default = byte-identical passthrough per HR29; sized to the model's real ceiling).
        const grounded = await augmentWithCorpus(transformed, { model: parsed.model });
        T.corpus_injected = grounded !== transformed;
        firstBody = JSON.stringify(grounded);
      }
      let upstream = await call(firstBody);

      // Remap SCX `/models` upstream shape {"data":[...]} -> {"models":[...]} for codex compatibility.
      const isModels = req.method === "GET" && url.pathname.endsWith("/models");
      if (isModels) {
        upstream = await remapModelsResponse(upstream);
      }

      // On a plan-gate 400 (a server tool the model's plan can't run), retry with server tools dropped.
      if (isResponses && parsed && upstream.status >= 400) {
        const errText = await upstream.text();
        if (isPlanGateError(upstream.status, errText)) {
          log('[retry] plan-gate — dropping server tools and retrying'); T.retried = true; T.plan_gate = true;
          const retryBody = transformRequestBody(normalizeScxRequestBody(parsed, url.pathname).body, true);
          // .5231 (bughunt) — telemetry must reflect the ACTUAL retried payload (server tools dropped),
          // not the first attempt's tools computed at lines 113-116.
          T.tools_out = (retryBody.tools || []).map((t) => t && t.type);
          T.flattened = JSON.stringify(T.tools_in) !== JSON.stringify(T.tools_out);
          upstream = await call(JSON.stringify(retryBody));
        } else {
          res.writeHead(upstream.status, responseHeaders(upstream, warnings));
          res.end(errText);
          log('[resp]', upstream.status, errText.slice(0, 160));
          telem({ ...T, status: upstream.status, latency_ms: Date.now() - t0, context_limit: isContextLimitError(upstream.status, errText), param_warnings: warnings, error: errText.slice(0, 200) });
          return;
        }
      }

      // .5231 (bughunt) — if the plan-gate RETRY itself failed (e.g. the upstream 502 the operator saw),
      // return it cleanly with logging + telemetry instead of opaquely streaming the error via the byte reader.
      if (T.retried && upstream.status >= 400) {
        const errText = await upstream.text();
        res.writeHead(upstream.status, responseHeaders(upstream, warnings));
        res.end(errText);
        log('[resp.retry]', upstream.status, errText.slice(0, 160));
        telem({ ...T, status: upstream.status, latency_ms: Date.now() - t0, context_limit: isContextLimitError(upstream.status, errText), param_warnings: warnings, error: errText.slice(0, 200) });
        return;
      }

      res.writeHead(upstream.status, responseHeaders(upstream, warnings));
      const reader = upstream.body?.getReader();
      if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; T.bytes += value.length; res.write(Buffer.from(value)); } }
      res.end();
      if (upstream.status >= 400) log('[resp]', upstream.status, target);
      telem({ ...T, status: upstream.status, latency_ms: Date.now() - t0, param_warnings: warnings });
    } catch (e) {
      log('[proxy] error', e.message);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `shim upstream error: ${e.message}` } }));
      telem({ ...T, status: 502, latency_ms: Date.now() - t0, error: e.message });
    }
  });
});

// Only bind the port when run directly (so tests can import the transforms without starting a server).
const runDirectly = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (runDirectly) {
  server.listen(PORT, HOST, () => {
    console.log(`Kritical SCX agentic shim -> ${UPSTREAM}  on http://${HOST}:${PORT}  (log: ${LOG})`);
    console.log(`Kill switch: stop this process; point codex base_url back to ${UPSTREAM} to go raw.`);
  });
}
