// Kritical SCXCode — VS Code extension entry point.
// Apache 2.0 (c) Kritical Pty Ltd 2026.
//
// Minimum-viable spine: activation, config resolution, chat webview registration,
// model picker, connection test, and slash-command dispatch. Chat rendering is
// delegated to a webview panel (chat.html) that talks back via postMessage.
//
// SCX auth: reads config kritical.scxcode.apiKey (which defaults to HKCU env
// SCX_API_KEY via VS Code's ${env:...} substitution).
//
// Failover: on 429/5xx, walks kritical.scxcode.fallbackChain in order.

import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execFileSync } from 'child_process';
import * as tomlLib from '@iarna/toml';

interface ScxMessage { role: 'user' | 'assistant' | 'system'; content: string; }
interface ScxCompletionRequest { model: string; messages: ScxMessage[]; max_tokens?: number; system?: string; temperature?: number; }
interface ScxCompletionResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// ────────────────────────────────────────────────────────────────
// config resolution
// ────────────────────────────────────────────────────────────────

// .5211 (Lens/Brain bug-hunt, DeepSeek-verified) — single cached output channel instead of
// creating a new "Kritical SCXCode" channel on every command (was 4 duplicate channels).
let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) { _outputChannel = vscode.window.createOutputChannel('Kritical SCXCode'); }
  return _outputChannel;
}
// .5211 — real rotating key pointer (was hardcoded to apiKeys[1]/index 2, so 3+ keys never rotated).
// .5231b (re-hunt) — persist the pointer across VS Code restarts. It was module-scoped only, so a
// crash / update / window reload reset it to 0, silently reverting the operator's manual "Switch SCX
// key" selection (e.g. back onto an exhausted key1) with no indication. Mirror it to a tiny file in
// ~/.kritical-scx so the last-selected key survives a restart. Best-effort: any I/O error is ignored
// and the in-memory pointer still works.
const _keyRotationStatePath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'key-rotation.json');
function loadKeyRotation(): number {
  try {
    const raw = JSON.parse(fs.readFileSync(_keyRotationStatePath, 'utf8'));
    const n = Number(raw && raw.rotation);
    if (Number.isInteger(n) && n >= 0) { return n; }
  } catch { /* no state yet / unreadable — start at 0 */ }
  return 0;
}
function saveKeyRotation(rotation: number): void {
  try {
    fs.mkdirSync(path.dirname(_keyRotationStatePath), { recursive: true });
    const tmp = `${_keyRotationStatePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ rotation, ts: new Date().toISOString() }));
    fs.renameSync(tmp, _keyRotationStatePath);   // atomic — never leave a truncated state file
  } catch { /* best effort — never break a key switch */ }
}
let _keyRotation = loadKeyRotation();

function getConfig() {
  const c = vscode.workspace.getConfiguration('kritical.scxcode');
  // VS Code auto-substitutes ${env:SCX_API_KEY} for the apiKey default.
  const primary = c.get<string>('apiKey', '').replace(/^\$\{env:SCX_API_KEY\}$/, process.env.SCX_API_KEY ?? '');
  // .5165e — multi-key rotation. Look up SCX_API_KEY_2..SCX_API_KEY_9.
  const keys: string[] = [];
  if (primary) keys.push(primary);
  for (let i = 2; i <= 9; i++) {
    const k = process.env[`SCX_API_KEY_${i}`];
    if (k && !keys.includes(k)) keys.push(k);
  }
  // .5231 (bughunt-confirmed) — rotate the STABLE deduped key list so the switch-selected key is
  // primary, WITHOUT mutating process.env.SCX_API_KEY (which corrupted the set via re-dedup + lost keys).
  const rot = keys.length ? _keyRotation % keys.length : 0;
  const rotatedKeys = rot ? keys.slice(rot).concat(keys.slice(0, rot)) : keys;
  return {
    apiKey: rotatedKeys[0] || primary,
    apiKeys: rotatedKeys,
    baseUrl: c.get<string>('baseUrl', 'https://api.scx.ai'),
    defaultModel: c.get<string>('defaultModel', 'MiniMax-M2.7'),
    autocompleteModel: c.get<string>('autocompleteModel', 'coder'),
    fallbackChain: c.get<string[]>('fallbackChain', ['MiniMax-M2.7', 'MAGPiE', 'gpt-oss-120b']),
    autocompact: c.get<'off' | 'auto' | 'aggressive'>('autocompact', 'auto'),
    systemPrompt: c.get<string>('systemPrompt', ''),
    telemetry: c.get<'off' | 'local-only' | 'kritical-endpoint'>('telemetry', 'off'),
    storageBackend: c.get<'auto' | 'sqlite' | 'mssql'>('storageBackend', 'auto'),
    sqliteStorePath: c.get<string>('sqliteStorePath', ''),
    mssqlServer: c.get<string>('mssqlServer', '.\\SQLEXPRESS'),
    mssqlDatabase: c.get<string>('mssqlDatabase', 'KriticalSCXCodeStore'),
    modelCatalogPath: c.get<string>('modelCatalogPath', 'C:\\KriticalSCX\\config\\models\\scx-model-catalog.json'),
    // .5165e — auto-context wiring
    autoContext: c.get<'off' | 'file' | 'file+selection' | 'workspace-tree'>('autoContext', 'file+selection'),
    autoContextMaxChars: c.get<number>('autoContextMaxChars', 8000),
    // .5165h — provider selection + claude-code CLI fallback path
    provider: c.get<'auto' | 'scx-native' | 'claude-code-cli'>('provider', 'auto'),
    claudeCliPath: c.get<string>('claudeCliPath', 'claude'),
    // .5210 — operator-selectable response length (was hardcoded 800/1200/1500).
    maxTokens: c.get<number>('maxTokens', 1500),
    // .5213 UI wave — synthetic-context concurrency (mux) + sampling temperature.
    concurrency: c.get<number>('concurrency', 1),
    temperature: c.get<number>('temperature', 0.2),
  };
}

// .5213 — the SCX model catalog surfaced in the in-panel dropdown (label + one-line detail).
// .5228 — each model carries a default temperature (temp) + tempSrc marking WHERE it came from so we
// never silently pretend a guess is authoritative:
//   'rec' = the model/provider PUBLISHES a recommended sampling temperature — we use it verbatim.
//   'def' = no published recommendation found — we use a neutral general-purpose 0.7 (NOT cold 0.2).
//   'api' = the live /v1/models response carried a temperature default — that wins over both.
// The webview temp control shows the source so the operator knows a value is a recommendation vs a fallback.
type ScxModel = { id: string; detail: string; temp: number; tempSrc?: 'rec' | 'def' | 'api' };
const SCX_TEMP_NEUTRAL = 0.7; // general-purpose default when no published recommendation exists.
const SCX_MODEL_CATALOG: ScxModel[] = [
  { id: 'MiniMax-M2.7', detail: '192K · default agentic', temp: 1.0, tempSrc: 'rec' },          // MiniMax M2 docs: temperature=1.0, top_p=0.95
  { id: 'MAGPiE', detail: '131K · near o4-mini reasoning', temp: 0.7, tempSrc: 'def' },
  { id: 'gpt-oss-120b', detail: '131K · cheapest reasoner', temp: 1.0, tempSrc: 'rec' },         // gpt-oss reference: temperature 1.0
  { id: 'DeepSeek-V3.1', detail: '131K · hardest problems', temp: 0.6, tempSrc: 'rec' },         // DeepSeek general recommendation 0.6 (0.0 for pure code/math)
  { id: 'coder', detail: '196K · algorithms + debugging', temp: 0.2, tempSrc: 'rec' },           // code-completion: low temp for determinism
  { id: 'gemma-4-31B-it', detail: '131K · multimodal', temp: 1.0, tempSrc: 'rec' },              // Gemma default temperature 1.0
  { id: 'Llama-4-Maverick-17B-128E-Instruct', detail: '131K · multimodal', temp: 0.6, tempSrc: 'rec' }, // Llama 4 default 0.6
  { id: 'Meta-Llama-3.3-70B-Instruct', detail: '131K · dense', temp: 0.6, tempSrc: 'rec' },      // Llama 3.x default 0.6
  { id: 'Qwen3-32B', detail: '32K · 119 languages', temp: 0.7, tempSrc: 'rec' },                 // Qwen3 non-thinking recommended 0.7 (0.6 thinking)
];
const SCX_TEMP_FALLBACK = SCX_TEMP_NEUTRAL; // unknown/live models -> neutral 0.7, never a silent cold guess.
function modelTempDefault(id: string): number {
  const m = getModelCatalog().find((x) => x.id.toLowerCase() === (id || '').toLowerCase());
  return m && typeof m.temp === 'number' ? m.temp : SCX_TEMP_FALLBACK;
}
function modelTempSrc(id: string): string {
  const m = getModelCatalog().find((x) => x.id.toLowerCase() === (id || '').toLowerCase());
  return (m && m.tempSrc) ? m.tempSrc : 'def';
}

// .5227 — LIVE model list from the SCX API with a JSON cache + preseed fallback.
// On connect we GET {baseUrl}/v1/models, cache to ~/.kritical-scx/models-cache.json, and use it.
// If the fetch fails we use the cache; if no cache, the hardcoded SCX_MODEL_CATALOG (preseed).
let _liveModels: ScxModel[] | null = null;
const _modelsCachePath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'models-cache.json');
const _modelsFullCatalogPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'models-catalog.full.json');
const _installModelCatalogPath = 'C:\\KriticalSCX\\config\\models\\scx-model-catalog.json';
const _installModelCatalogHistoryDir = 'C:\\KriticalSCX\\config\\models\\history';
const _modelsCacheBak = _modelsCachePath + '.bak';
function safeSlug(value: string): string {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'unknown';
}
function configuredModelCatalogPath(): string {
  const raw = vscode.workspace.getConfiguration('kritical.scxcode').get<string>('modelCatalogPath', _installModelCatalogPath);
  return raw && raw.trim() ? raw.trim() : _installModelCatalogPath;
}
function modelCatalogCandidates(): string[] {
  const configured = configuredModelCatalogPath();
  return Array.from(new Set([
    configured,
    configured + '.bak',
    _modelsFullCatalogPath,
    _modelsFullCatalogPath + '.bak',
  ].filter(Boolean)));
}
// .5228 — atomic + idempotent + backup write for ANY API-derived cache (never leave a half-written or
// empty cache that could blank the dropdown). Write temp file -> validate -> rotate current to .bak -> rename.
function writeCacheAtomic(pathTarget: string, data: any, historyDetail?: string): void {
  try {
    const json = JSON.stringify(data);
    if (!json || json === '[]' || json === 'null') { return; }        // never persist an empty/blank cache
    const tmp = pathTarget + '.tmp';
    fs.mkdirSync(path.dirname(pathTarget), { recursive: true });
    fs.writeFileSync(tmp, json);
    JSON.parse(fs.readFileSync(tmp, 'utf8'));                          // validate round-trip before committing
    if (fs.existsSync(pathTarget)) {
      try { fs.copyFileSync(pathTarget, pathTarget + '.bak'); } catch { /* best effort */ }
      if (historyDetail) {
        try {
          fs.mkdirSync(_installModelCatalogHistoryDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').replace('Z', 'Z');
          const hist = path.join(_installModelCatalogHistoryDir, `${safeSlug('scx')}-${safeSlug(historyDetail)}-${stamp}.previous.json`);
          fs.copyFileSync(pathTarget, hist);
        } catch { /* best effort */ }
      }
    }
    fs.renameSync(tmp, pathTarget);
  } catch { /* keep prior cache */ }
}
function writeModelCatalogCache(rows: any[], source: string, statusCode?: number): void {
  if (!Array.isArray(rows) || !rows.length) { return; }
  const chatRows = rows.filter((r: any) => !NON_CHAT_MODEL.test(String((typeof r === 'string') ? r : (r?.id || r?.model || r?.name || ''))));
  const payload = {
    captured_utc: new Date().toISOString(),
    provider: 'scx',
    server: 'scx',
    source,
    status: statusCode || null,
    count: rows.length,
    chat_count: chatRows.length,
    canonical_path: configuredModelCatalogPath(),
    mirror_path: _modelsFullCatalogPath,
    backup_history_dir: _installModelCatalogHistoryDir,
    models: rows,
  };
  writeCacheAtomic(configuredModelCatalogPath(), payload, 'models-catalog');
  writeCacheAtomic(_modelsFullCatalogPath, payload, 'models-catalog-user-mirror');
}
// read a cache with fallback to its .bak, then to null (caller falls back to preseed) — never throws.
function readCacheOrBak(pathTarget: string): ScxModel[] | null {
  for (const p of [pathTarget, pathTarget + '.bak']) {
    try { if (fs.existsSync(p)) { const c = JSON.parse(fs.readFileSync(p, 'utf8')); if (Array.isArray(c) && c.length) { return c; } } } catch { /* try next */ }
  }
  return null;
}
// .5228 — heal any catalog (live, or an older cache) with the CORRECT precedence so a stale cached copy
// of an old hardcoded temp can never mask a catalog update:
//   1. a genuine API-advertised temp (tempSrc === 'api') persists — the API is authoritative.
//   2. otherwise the CURRENT hardcoded catalog value by id wins (catalog edits always propagate).
//   3. otherwise the entry's own temp, else neutral 0.7.
function healTemps(list: ScxModel[]): ScxModel[] {
  const byId = new Map(SCX_MODEL_CATALOG.map((m) => [m.id.toLowerCase(), m]));
  return list.map((m) => {
    const k = byId.get((m.id || '').toLowerCase());
    if (m.tempSrc === 'api' && typeof m.temp === 'number') {
      return { id: m.id, detail: m.detail || (k ? k.detail : 'live'), temp: m.temp, tempSrc: 'api' };
    }
    if (k) { return { id: m.id, detail: k.detail, temp: k.temp, tempSrc: k.tempSrc || 'def' }; }
    const temp = typeof m.temp === 'number' ? m.temp : SCX_TEMP_FALLBACK;
    return { id: m.id, detail: m.detail || 'live', temp, tempSrc: m.tempSrc || 'def' };
  });
}
// .5231 — a model is CHAT-capable unless it's an embedding / speech / moderation model.
// Those live in /v1/models but 400 ("Unsupported model") on /v1/messages, so they must NEVER
// appear in the chat picker — selecting one was the root cause of the "Unsupported model" error.
const NON_CHAT_MODEL = /(embed|e5-mistral|whisper|opir|moderation|rerank|guard)/i;
function isChatModel(m: ScxModel): boolean { return !NON_CHAT_MODEL.test(m.id); }
function rowsToScxModels(rows: any[]): ScxModel[] {
  const known = new Map(SCX_MODEL_CATALOG.map((m) => [m.id.toLowerCase(), m]));
  return rows.map((r: any) => {
    const id = typeof r === 'string' ? r : (r?.id || r?.model || r?.name);
    if (!id) { return null; }
    const k = known.get(String(id).toLowerCase());
    const apiTemp = (typeof r === 'object') ? (r.default_temperature ?? r.temperature ?? (r.params && r.params.temperature)) : undefined;
    if (typeof apiTemp === 'number') { return { id: String(id), detail: k ? k.detail : 'live', temp: apiTemp, tempSrc: 'api' }; }
    return { id: String(id), detail: k ? k.detail : 'live', temp: k ? k.temp : SCX_TEMP_FALLBACK, tempSrc: k ? (k.tempSrc || 'def') : 'def' };
  }).filter(Boolean) as ScxModel[];
}
function getModelCatalog(): ScxModel[] {
  let list: ScxModel[];
  if (_liveModels && _liveModels.length) { list = healTemps(_liveModels); }
  else {
    const fullRows = readFullModelRows();
    const fullModels = fullRows.length ? rowsToScxModels(fullRows) : [];
    const cached = fullModels.length ? fullModels : readCacheOrBak(_modelsCachePath);
    list = cached ? healTemps(cached) : SCX_MODEL_CATALOG;
  }
  const chat = list.filter(isChatModel);
  return chat.length ? chat : SCX_MODEL_CATALOG.filter(isChatModel); // never blank the dropdown
}

// .5231 — map a requested model to the EXACT id the current endpoint advertises (case-insensitive).
// Kills the direct-SCX ("MAGPiE") vs local-proxy ("magpie") case-mismatch class of 400s. Falls back to
// the first chat model when the requested id isn't offered at all.
function normalizeModelId(id: string): string {
  const cat = getModelCatalog();
  const exact = cat.find((m) => m.id === id);
  if (exact) { return exact.id; }
  const ci = cat.find((m) => m.id.toLowerCase() === (id || '').toLowerCase());
  if (ci) { return ci.id; }
  return cat.length ? cat[0].id : id; // last resort — a known-good chat model
}

function readFullModelRows(): any[] {
  for (const p of modelCatalogCandidates()) {
    try {
      if (!fs.existsSync(p)) { continue; }
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : parsed.models;
      if (Array.isArray(rows) && rows.length) { return rows; }
    } catch { /* try next */ }
  }
  return [];
}

function modelContextTokens(id: string): number {
  const rows = readFullModelRows();
  const row = rows.find((m: any) => String(m?.id || m?.model || m?.name || '').toLowerCase() === String(id || '').toLowerCase());
  const candidates = row ? [
    row.context_length, row.context_window, row.context, row.max_context_length,
    row.max_input_tokens, row.input_token_limit, row.input_tokens,
  ] : [];
  const live = candidates.map((v) => Number(v)).find((v) => Number.isFinite(v) && v > 0);
  if (live) { return live; }
  const known: Record<string, number> = {
    'minimax-m2.7': 192000,
    'coder': 196000,
    'gpt-oss-120b': 131000,
    'deepseek-v3.1': 131000,
    'magpie': 131000,
    'gemma-4-31b-it': 131000,
    'meta-llama-3.3-70b-instruct': 131000,
    'llama-4-maverick-17b-128e-instruct': 131000,
    'qwen3-32b': 32000,
  };
  return known[String(id || '').toLowerCase()] || 108000;
}

function estimateTokens(text: string): number {
  return Math.ceil(String(text || '').length / 4);
}

function summarizeForCompaction(messages: ScxMessage[]): string {
  return messages.map((m, i) => {
    const compact = m.content.replace(/\s+/g, ' ').trim().slice(0, 700);
    return `${i + 1}. ${m.role}: ${compact}${m.content.length > 700 ? ' ...' : ''}`;
  }).join('\n');
}

function compactMessagesForSend(history: ScxMessage[], model: string, extraChars = 0):
    { messages: ScxMessage[]; compactedTurns: number } {
  const cfg = getConfig();
  if (cfg.autocompact === 'off' || history.length < 9) {
    return { messages: [...history], compactedTurns: 0 };
  }
  const contextTokens = modelContextTokens(model);
  const threshold = cfg.autocompact === 'aggressive' ? 0.50 : 0.72;
  const reserve = Math.max(cfg.maxTokens + 1500, 3500);
  const budget = Math.max(4000, Math.floor(contextTokens * threshold) - reserve);
  const estimated = history.reduce((sum, m) => sum + estimateTokens(m.content), 0) + estimateTokens('x'.repeat(extraChars));
  if (estimated <= budget) {
    return { messages: [...history], compactedTurns: 0 };
  }

  const keep = cfg.autocompact === 'aggressive' ? 5 : 7; // odd count keeps user/assistant alternation after summary pair
  const recent = history.slice(-keep);
  const old = history.slice(0, Math.max(0, history.length - keep));
  if (!old.length) {
    return { messages: [...history], compactedTurns: 0 };
  }
  const summary = [
    '## Kritical SCXCode Auto-Context Flush',
    `Compacted ${old.length} earlier turns locally before sending to avoid resending stale full history.`,
    'Preserve decisions, constraints, file names, commands, errors, and current objective from this summary:',
    summarizeForCompaction(old),
  ].join('\n');
  return {
    messages: [
      { role: 'user', content: summary },
      { role: 'assistant', content: 'Acknowledged. I will treat the compacted prior-context summary as the earlier conversation state.' },
      ...recent,
    ],
    compactedTurns: old.length,
  };
}

// .5231 — publish the currently-selected model to a shared file the codex wrapper reads, so
// "SCX Codex" launches on the SAME model the chat panel is using (operator .5231 request).
const _currentModelPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'current-model.json');
let _lastPublishedModel = '';
function publishCurrentModel(id: string): void {
  if (!id || id === _lastPublishedModel) { return; }
  _lastPublishedModel = id;
  try {
    fs.mkdirSync(path.dirname(_currentModelPath), { recursive: true });
    // .5231b (re-hunt) — write atomically: a plain writeFileSync that's interrupted (disk full, crash,
    // permission flip mid-write) leaves current-model.json truncated ("{" only), which the codex wrapper
    // then fails to JSON.parse and silently falls back to the default model instead of the operator's
    // selection. Write to a temp sibling then rename (atomic on the same volume) so a reader only ever
    // sees a complete file or the previous complete file — never a half-written one.
    const tmp = `${_currentModelPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ id, ts: new Date().toISOString() }));
    fs.renameSync(tmp, _currentModelPath);
  } catch { /* best effort — never break a chat send */ }
}

// .5231 (operator request) — when the configured model isn't actually available, we auto-substitute a
// VALID one, PERSIST it so it stops erroring, and TELL the operator it was corrected (with a one-click
// way to pick a different one). No silent wrong-selection, no hard error thrown at the user.
let _lastCorrectionNotified = '';
function notifyModelCorrected(from: string, to: string): void {
  try { vscode.workspace.getConfiguration('kritical.scxcode').update('defaultModel', to, vscode.ConfigurationTarget.Global); } catch { /* non-fatal */ }
  publishCurrentModel(to);
  const sig = `${from}->${to}`;
  if (sig === _lastCorrectionNotified) { return; } // don't spam the same correction
  _lastCorrectionNotified = sig;
  vscode.window.showWarningMessage(
    `Model "${from}" isn't available on this SCX endpoint — switched to "${to}". Pick another if you prefer.`,
    'Pick model',
  ).then((pick) => { if (pick === 'Pick model') { vscode.commands.executeCommand('kritical.scxcode.pickModel'); } });
}
function fetchLiveModels(): void {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) { return; }
  try {
    const url = new URL('/v1/models', baseUrl);
    const req = https.request({ method: 'GET', hostname: url.hostname, path: url.pathname, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'authorization': `Bearer ${apiKey}` } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          const rows: any[] = Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : []);
          // .5228 — honour a temperature the API itself advertises (default_temperature / temperature /
          // params.temperature) — that is authoritative over our hardcoded guess.
          const next: ScxModel[] = rowsToScxModels(rows);
          if (next.length) {
            _liveModels = next;
            writeCacheAtomic(_modelsCachePath, next); // reduced picker cache
            writeModelCatalogCache(rows, `vscode-extension:${url.href}`, res.statusCode); // full-fidelity API metadata
          }  // only replace on a non-empty fetch
        } catch { /* keep cache/preseed — dropdown never blanks */ }
      });
    });
    req.on('error', () => { /* keep cache/preseed */ });
    req.end();
  } catch { /* keep cache/preseed */ }
}

// .5213 — read-only MCP-server summary for the panel's 🔌 MCP button (Codex config.toml).
// .5230 — real file+folder attach from the local machine. Accepts files AND folders (folders recurse),
// reads text files (skips node_modules/.git/out/dist/binaries), caps per-file + total so a huge folder
// can't blow the context. Shared by both the panel and the sidebar upload handlers.
async function collectAttachments(uris: vscode.Uri[]): Promise<{ block: string; fileCount: number; chars: number }> {
  const MAX_FILES = 80, MAX_TOTAL = 220000, PER_FILE = 24000;
  const textExt = /\.(ts|tsx|js|jsx|mjs|cjs|py|ps1|psm1|al|md|json|ya?ml|toml|html|htm|css|scss|less|liquid|txt|xml|svg|sql|sh|bat|c|cpp|h|hpp|go|rs|java|kt|rb|php|cs|vue|svelte|graphql|env|ini|cfg|conf)$/i;
  const skip = /(^|[\\/])(node_modules|\.git|out|dist|\.alpackages|\.venv|bin|obj|\.next)([\\/]|$)/i;
  const files: vscode.Uri[] = [];
  async function walk(u: vscode.Uri): Promise<void> {
    if (files.length >= MAX_FILES) { return; }
    let stat: vscode.FileStat; try { stat = await vscode.workspace.fs.stat(u); } catch { return; }
    if (stat.type === vscode.FileType.Directory) {
      if (skip.test(u.path)) { return; }
      let entries: [string, vscode.FileType][]; try { entries = await vscode.workspace.fs.readDirectory(u); } catch { return; }
      for (const [name] of entries) { if (files.length >= MAX_FILES) { break; } await walk(vscode.Uri.joinPath(u, name)); }
    } else if (stat.type === vscode.FileType.File) {
      if (!skip.test(u.path) && (textExt.test(u.path) || stat.size < 80000)) { files.push(u); }
    }
  }
  for (const u of uris) { await walk(u); }
  let block = '', chars = 0, count = 0;
  for (const f of files) {
    if (chars >= MAX_TOTAL) { break; }
    try {
      const bytes = await vscode.workspace.fs.readFile(f);
      let content = Buffer.from(bytes).toString('utf8');
      if (/�/.test(content.slice(0, 200))) { continue; } // looks binary — skip
      if (content.length > PER_FILE) { content = content.slice(0, PER_FILE) + '\n…(truncated)'; }
      const rel = vscode.workspace.asRelativePath(f);
      block += `\n\n## Attached: ${rel}\n\`\`\`\n${content}\n\`\`\`\n`;
      chars += content.length; count++;
    } catch { /* skip unreadable */ }
  }
  return { block, fileCount: count, chars };
}
function mcpSummary(): string {
  const lines: string[] = ['**MCP servers & tools**', ''];
  try {
    const cfgPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
    if (fs.existsSync(cfgPath)) {
      const toml = fs.readFileSync(cfgPath, 'utf8');
      const names = Array.from(toml.matchAll(/\[mcp_servers\.([^\]]+)\]/g)).map((mm) => mm[1]);
      lines.push(names.length ? 'Codex MCP servers: ' + names.join(', ') : 'No MCP servers found in ~/.codex/config.toml.');
    } else {
      lines.push('No ~/.codex/config.toml found on this machine.');
    }
  } catch (e) {
    lines.push('Could not read MCP config: ' + (e as Error).message);
  }
  lines.push('', '_Toggle MCP servers in the Kritical Plugin Control Panel._');
  return lines.join('\n');
}

// .5165h — resolve claude CLI path. cmd.exe doesn't inherit git-bash PATH so
// spawn('claude', shell:true) can fail with "not recognized". Walk canonical
// npm-global install locations when the configured path isn't a file.
function resolveClaudeCliPath(configured: string): string {
  // If configured path is absolute or has a slash AND exists as a file, use it.
  if (configured.includes('/') || configured.includes('\\')) {
    try { if (fs.existsSync(configured)) return configured; } catch { /* ignore */ }
  }
  if (process.platform !== 'win32') return configured;
  // On Windows, walk npm-global candidates.
  const candidates: string[] = [];
  const appdata = process.env.APPDATA;
  if (appdata) {
    candidates.push(path.join(appdata, 'npm', 'claude.cmd'));
    candidates.push(path.join(appdata, 'npm', 'claude.exe'));
  }
  const userProf = process.env.USERPROFILE;
  if (userProf) {
    candidates.push(path.join(userProf, 'AppData', 'Roaming', 'npm', 'claude.cmd'));
    candidates.push(path.join(userProf, 'AppData', 'Local', 'npm', 'claude.cmd'));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return configured; // let spawn fail with a real message
}

// .5165h — claude-code CLI local fallback. Uses local claude session auth
// (no API key needed). Invokes `claude --print --output-format text <prompt>`.
async function askClaudeCodeCli(prompt: string, systemPrompt: string): Promise<string> {
  const cfg = getConfig();
  const resolvedPath = resolveClaudeCliPath(cfg.claudeCliPath);
  // Run claude CLI from a trusted cwd (USERPROFILE) so workspace-trust-dialog
  // prompts don't stall the spawn — extension host cwd is otherwise the open
  // workspace which may not be trusted for claude-code yet.
  const safeCwd = process.env.USERPROFILE || process.env.HOME || undefined;
  const args = ['--print', '--output-format', 'text'];
  if (systemPrompt) { args.push('--append-system-prompt', systemPrompt); }
  args.push(prompt);
  // On Windows, shell:true concatenates args without escaping (DEP0190) so
  // spaces in system-prompt / prompt get split. Quote each arg ourselves and
  // pass the whole thing as a single command string via shell.
  const useShell = process.platform === 'win32';
  const quotedCmd = useShell
    ? [resolvedPath, ...args].map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')
    : '';
  return new Promise((resolve, reject) => {
    const child = useShell
      ? spawn(quotedCmd, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, cwd: safeCwd })
      : spawn(resolvedPath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: safeCwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    // .5213 (DeepSeek-flagged, verified) — clear the kill-timer on settle so it doesn't linger
    // for 180s keeping the event loop alive + firing kill() on an already-exited child.
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    child.on('error', (e) => { if (killTimer) clearTimeout(killTimer); reject(new Error(`claude CLI spawn failed: ${e.message} (configured='${cfg.claudeCliPath}', resolved='${resolvedPath}')`)); });
    child.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude CLI exit=${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`));
    });
    // 180 s cap — first spawn on cold session can be slow (Claude Code startup + workspace-scan)
    killTimer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error('claude CLI timeout after 180s'));
    }, 180_000);
  });
}

// .5165e — auto-context builder. Injects active editor file + selection + cursor
// info as a system-prefix so the model gets "where the operator is looking".
function buildAutoContext(): string {
  const cfg = getConfig();
  if (cfg.autoContext === 'off') return '';
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';
  const doc = editor.document;
  const relPath = vscode.workspace.asRelativePath(doc.uri, false);
  const lang = doc.languageId;
  const totalLines = doc.lineCount;
  const sel = editor.selection;
  const parts: string[] = [];
  parts.push(`## Auto-context (kritical.scxcode)`);
  parts.push(`- Active file: \`${relPath}\` (${lang}, ${totalLines} lines)`);
  if (!sel.isEmpty) {
    const selText = doc.getText(sel);
    parts.push(`- Selection: lines ${sel.start.line + 1}-${sel.end.line + 1} (${selText.length} chars)`);
    parts.push('```' + lang);
    parts.push(selText.slice(0, Math.min(selText.length, cfg.autoContextMaxChars)));
    parts.push('```');
  } else {
    parts.push(`- Cursor: line ${sel.active.line + 1}, col ${sel.active.character + 1} (no selection)`);
    if (cfg.autoContext === 'file' || cfg.autoContext === 'file+selection') {
      // Include a small window around the cursor (± 30 lines)
      const start = Math.max(0, sel.active.line - 30);
      const end = Math.min(totalLines - 1, sel.active.line + 30);
      const range = new vscode.Range(start, 0, end, doc.lineAt(end).range.end.character);
      const snippet = doc.getText(range);
      parts.push(`- Cursor window: lines ${start + 1}-${end + 1}`);
      parts.push('```' + lang);
      parts.push(snippet.slice(0, cfg.autoContextMaxChars));
      parts.push('```');
    }
  }
  if (cfg.autoContext === 'workspace-tree') {
    // Add top-level workspace tree (files only, up to 40 entries)
    const wsRoot = vscode.workspace.workspaceFolders?.[0];
    if (wsRoot) {
      parts.push(`- Workspace root: \`${wsRoot.name}\``);
    }
  }
  return parts.join('\n') + '\n\n';
}

// ────────────────────────────────────────────────────────────────
// SCX API — Anthropic-shape POST with fetch fallback via https.request
// ────────────────────────────────────────────────────────────────

async function scxPost(model: string, messages: ScxMessage[], maxTokens = 800, keyOverride: string | null = null): Promise<ScxCompletionResponse> {
  const { apiKey, baseUrl, systemPrompt, temperature } = getConfig();
  const useKey = keyOverride || apiKey;
  if (!useKey) throw new Error('SCX_API_KEY not set. Configure kritical.scxcode.apiKey or set HKCU env SCX_API_KEY.');
  model = normalizeModelId(model);       // .5231 — match the endpoint's exact id (direct vs proxy casing)
  publishCurrentModel(model);            // .5231 — share the live model with the codex wrapper
  // .5231 (bughunt-confirmed) — clamp to SCX's OpenAI-compatible safe [0,1] range so an
  // out-of-range config/slider value can't produce a hard 400 from the endpoint.
  const temp = Math.max(0, Math.min(1, Number.isFinite(temperature) ? temperature : 0.2));
  const body: ScxCompletionRequest = { model, messages, max_tokens: maxTokens, temperature: temp };
  if (systemPrompt) body.system = systemPrompt;

  return new Promise((resolve, reject) => {
    const url = new URL('/v1/messages', baseUrl);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'x-api-key': useKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode! >= 400) {
          reject(new ScxHttpError(res.statusCode!, buf));
          return;
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`SCX response parse failed: ${(e as Error).message}\n${buf.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

class ScxHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`SCX HTTP ${status}: ${body.slice(0, 200)}`);
  }
  get isRateLimit() { return this.status === 429; }
  get isServerError() { return this.status >= 500; }
}

// Failover: rotate SCX keys first (same daily-limit → different quotas),
// then rotate models. On 429/5xx walk the (model, key) grid.
// .5165h — final fallback: claude-code CLI (local session, no API key).
async function scxPostWithFailover(messages: ScxMessage[], maxTokens = 800): Promise<{ res: ScxCompletionResponse; modelUsed: string; keyIndex: number; attempts: string[] }> {
  const cfg = getConfig();
  const tried: string[] = [];
  let lastErr: unknown;

  // Provider = claude-code-cli: skip SCX entirely.
  if (cfg.provider === 'claude-code-cli') {
    const promptText = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    tried.push('claude-code-cli (direct)');
    const text = await askClaudeCodeCli(promptText, cfg.systemPrompt);
    return {
      res: {
        id: `claude-cli-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: 'claude-code-cli',
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      modelUsed: 'claude-code-cli',
      keyIndex: 0,
      attempts: tried,
    };
  }

  // Provider = auto or scx-native: try SCX first.
  // .5231 — normalise every model in the chain to an id the endpoint actually offers (dropping
  // unknowns + de-duping). If the operator's chosen default had to be corrected, tell them.
  const requestedPrimary = cfg.defaultModel;
  const rawChain = [cfg.defaultModel, ...cfg.fallbackChain.filter((m) => m !== cfg.defaultModel)];
  const modelChain = rawChain.map(normalizeModelId).filter((m, i, a) => a.indexOf(m) === i);
  if (modelChain.length && modelChain[0].toLowerCase() !== (requestedPrimary || '').toLowerCase()) {
    notifyModelCorrected(requestedPrimary, modelChain[0]);
  }
  const keys = cfg.apiKeys.length > 0 ? cfg.apiKeys : [cfg.apiKey];
  for (const model of modelChain) {
    for (let ki = 0; ki < keys.length; ki++) {
      const k = keys[ki];
      const label = `${model}${keys.length > 1 ? ` (key${ki + 1})` : ''}`;
      tried.push(label);
      try {
        const res = await scxPost(model, messages, maxTokens, k);
        return { res, modelUsed: model, keyIndex: ki + 1, attempts: tried };
      } catch (e) {
        lastErr = e;
        // .5231 — a 400 naming an unknown/unsupported model is RECOVERABLE: walk the fallback chain
        // instead of dying, so one bad model selection can't brick the whole panel.
        const isModelErr = e instanceof ScxHttpError && e.status === 400 && /model/i.test(e.body);
        if (e instanceof ScxHttpError && (e.isRateLimit || e.isServerError || isModelErr)) {
          continue; // try next (model, key)
        }
        throw e; // non-transient error — surface immediately
      }
    }
  }

  // .5165h — every SCX (model, key) combo exhausted. Fall through to claude-code CLI
  // when provider=auto so operator can chat during SCX daily-limit dry-outs.
  if (cfg.provider === 'auto') {
    tried.push('claude-code-cli (fallback after SCX exhaustion)');
    try {
      const promptText = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
      const text = await askClaudeCodeCli(promptText, cfg.systemPrompt);
      return {
        res: {
          id: `claude-cli-${Date.now()}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text }],
          model: 'claude-code-cli',
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        modelUsed: 'claude-code-cli',
        keyIndex: 0,
        attempts: tried,
      };
    } catch (e) {
      throw new Error(`SCX exhausted, claude-code fallback also failed: ${(e as Error).message}\nSCX attempts: ${tried.slice(0, -1).join(', ')}`);
    }
  }

  throw lastErr ?? new Error('failover exhausted (unknown reason)');
}

// ────────────────────────────────────────────────────────────────
// .5214 — synthetic-context MUX (the mux engine, wired into the panel)
// Fans out N concurrent SCX "lens" streams over the same prompt, then synthesises
// ONE answer. concurrency=1 = plain single call. This is the in-panel equivalent of
// the PowerShell Invoke-KritScxMux — same fan-out → synthesise shape, SCX-only.
// ────────────────────────────────────────────────────────────────
const MUX_LENSES = [
  'Answer directly and correctly.',
  'Focus on edge cases, failure modes, and what could go wrong.',
  'Focus on the simplest, most maintainable approach.',
  'Focus on security, performance, and hidden costs.',
  'Focus on concrete examples and exact steps.',
  'Challenge assumptions the question takes for granted.',
  'Focus on the broader architecture and how this fits the whole system.',
  'Focus on how to test and verify the answer.',
];

async function scxMux(messages: ScxMessage[], concurrency: number, maxTokens: number):
    Promise<{ res: ScxCompletionResponse; modelUsed: string; keyIndex: number; shards: number }> {
  const n = Math.max(1, Math.min(Math.floor(concurrency) || 1, 8));
  if (n === 1) {
    const single = await scxPostWithFailover(messages, maxTokens);
    return { res: single.res, modelUsed: single.modelUsed, keyIndex: single.keyIndex, shards: 1 };
  }
  const lastUser = messages.length ? messages[messages.length - 1].content : '';
  const shardCalls = Array.from({ length: n }, (_, i) => {
    const lens = MUX_LENSES[i % MUX_LENSES.length];
    const shardMsgs: ScxMessage[] = [...messages.slice(0, -1), { role: 'user', content: `${lastUser}\n\n[Focus for this stream: ${lens}]` }];
    return scxPostWithFailover(shardMsgs, Math.min(maxTokens, 700)).then(
      (r) => r.res.content.map((c) => c.text).join(''),
      (e) => `(stream failed: ${(e as Error).message})`,
    );
  });
  const shards = await Promise.all(shardCalls);
  const merged = shards.map((s, i) => `--- Stream ${i + 1} ---\n${s}`).join('\n\n');
  const synthMsgs: ScxMessage[] = [{
    role: 'user',
    content: `Question:\n${lastUser}\n\nBelow are ${n} independent answers from parallel SCX streams. Synthesise them into ONE authoritative answer — resolve disagreements, keep the strongest points, drop weak/wrong ones. Do NOT mention "streams" or "perspectives" in your answer.\n\n${merged}`,
  }];
  const synth = await scxPostWithFailover(synthMsgs, maxTokens);
  return { res: synth.res, modelUsed: synth.modelUsed, keyIndex: synth.keyIndex, shards: n };
}

// ────────────────────────────────────────────────────────────────
// commands
// ────────────────────────────────────────────────────────────────

async function cmdTestConnection() {
  fetchLiveModels(); // .5227 — refresh model cache on connect
  const cfg = getConfig();
  const out = getOutputChannel();
  out.show(true);
  out.appendLine('═══ Kritical SCXCode connection test ═══');
  out.appendLine(`  baseUrl      : ${cfg.baseUrl}`);
  out.appendLine(`  apiKey       : ${cfg.apiKey ? `SET (len=${cfg.apiKey.length}, prefix=${cfg.apiKey.slice(0, 8)})` : 'NOT SET'}`);
  out.appendLine(`  defaultModel : ${cfg.defaultModel}`);
  out.appendLine(`  fallback     : ${cfg.fallbackChain.join(' → ')}`);
  out.appendLine('');
  if (!cfg.apiKey) {
    out.appendLine('  ✗ NOT SET. Run: pwsh Install-KritScxVsCode.ps1 -Mode Install');
    return;
  }
  out.appendLine(`  → POST ${cfg.baseUrl}/v1/messages ...`);
  const t0 = Date.now();
  try {
    const { res, modelUsed, attempts } = await scxPostWithFailover([{ role: 'user', content: 'Reply just OK' }], 20);
    const ms = Date.now() - t0;
    const text = res.content.map((c) => c.text).join('');
    out.appendLine(`  ✓ HTTP 200 in ${ms}ms via ${modelUsed} (tried ${attempts.length} model${attempts.length === 1 ? '' : 's'})`);
    out.appendLine(`  response  : ${text.slice(0, 200)}`);
    out.appendLine(`  tokens    : ${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);
    vscode.window.showInformationMessage(`Kritical SCXCode ✓ ${modelUsed} in ${ms}ms`);
  } catch (e) {
    const ms = Date.now() - t0;
    out.appendLine(`  ✗ FAIL in ${ms}ms — ${(e as Error).message}`);
    vscode.window.showErrorMessage(`Kritical SCXCode ✗ ${(e as Error).message.slice(0, 100)}`);
  }
}

async function cmdPickModel() {
  const cfg = getConfig();
  const catalog: Array<{ label: string; description: string; detail: string }> = getModelCatalog().map((m) => ({
    label: m.id,
    description: `${modelContextTokens(m.id).toLocaleString()} ctx · ${m.detail || 'live catalog'}`,
    detail: `temperature ${m.temp} (${m.tempSrc || 'def'}) · source ${configuredModelCatalogPath()}`,
  }));
  const picked = await vscode.window.showQuickPick(catalog, {
    title: 'Kritical SCXCode — pick default model',
    placeHolder: `Current: ${cfg.defaultModel}. Pick to change kritical.scxcode.defaultModel.`,
  });
  if (!picked) return;
  await vscode.workspace.getConfiguration('kritical.scxcode').update('defaultModel', picked.label, vscode.ConfigurationTarget.Global);
  publishCurrentModel(picked.label); // .5231 — keep SCX Codex in sync with the picked model
  vscode.window.showInformationMessage(`Kritical SCXCode default model → ${picked.label}`);
}

async function cmdShowStatus() {
  const cfg = getConfig();
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(`## Kritical SCXCode\n`);
  md.appendMarkdown(`- **API key**: ${cfg.apiKey ? `SET (${cfg.apiKey.length} chars)` : '**NOT SET**'}\n`);
  md.appendMarkdown(`- **Base URL**: \`${cfg.baseUrl}\`\n`);
  md.appendMarkdown(`- **Default model**: \`${cfg.defaultModel}\`\n`);
  md.appendMarkdown(`- **Autocomplete model**: \`${cfg.autocompleteModel}\`\n`);
  md.appendMarkdown(`- **Failover chain**: \`${cfg.fallbackChain.join(' → ')}\`\n`);
  md.appendMarkdown(`- **Autocompact**: \`${cfg.autocompact}\`\n`);
  md.appendMarkdown(`- **Telemetry**: \`${cfg.telemetry}\`\n\n`);
  md.appendMarkdown(`Run **Kritical: Test SCX Connection** to probe the endpoint live.\n`);
  vscode.window.showInformationMessage('Kritical SCXCode — see Output panel for detail');
  const out = getOutputChannel();
  out.show(true);
  out.appendLine(md.value);
}

async function cmdExplainSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
  const sel = editor.document.getText(editor.selection);
  if (!sel) { vscode.window.showWarningMessage('No text selected'); return; }
  await runChat(`Explain this code in plain English. Structure: (1) what it does, (2) what it depends on, (3) what breaks if a caller misuses it.\n\n\`\`\`\n${sel}\n\`\`\``);
}

async function cmdRefactorSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
  const sel = editor.document.getText(editor.selection);
  if (!sel) { vscode.window.showWarningMessage('No text selected'); return; }
  await runChat(`Refactor this code following Kritical conventions: PascalCase for AL identifiers, kebab-case for JS filenames, kr-<scope>-<element> for CSS classes. Never introduce new abstractions unless they save at least 3 duplicate patterns. Provide only the refactored code, no prose.\n\n\`\`\`\n${sel}\n\`\`\``);
}

async function cmdAuditDiff() {
  await runChat('Audit the CURRENT git diff against Kritical HARD RULES from CLAUDE.md (never commit .env / real tokens / secrets; no bulk restore; no supervisor cross-invoke; test-dryrun before live). Emit REFUSED/OK per rule with one-line reason.');
}

// .5225 — the fuller command surface (the recurring "where are all the clickable options" gap).
async function cmdNewChat() {
  await vscode.commands.executeCommand('workbench.view.extension.kritical-scxcode');
  vscode.window.showInformationMessage('Kritical SCXCode — use the Clear button in the panel to start a fresh chat.');
}
function cmdOpenSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', 'kritical.scxcode');
}
function cmdManageMcp() {
  const out = getOutputChannel(); out.show(true); out.appendLine(mcpSummary());
  vscode.window.showInformationMessage('Kritical SCXCode — MCP servers listed in the Output panel. Toggle them in the Plugin Control Panel.');
}
async function cmdExplainFile() {
  const ed = vscode.window.activeTextEditor;
  if (!ed) { vscode.window.showWarningMessage('No active editor'); return; }
  const text = ed.document.getText();
  await runChat(`Explain this whole file in plain English: (1) purpose, (2) key functions + what each does, (3) dependencies, (4) anything risky.\n\n\`\`\`${ed.document.languageId}\n${text.slice(0, 20000)}\n\`\`\``);
}
async function cmdGenerateTests() {
  const ed = vscode.window.activeTextEditor;
  if (!ed) { vscode.window.showWarningMessage('No active editor'); return; }
  const sel = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
  await runChat(`Generate a focused smoke/unit test for this ${ed.document.languageId} code. Cover happy path + one failure path + one boundary. Output only the test code.\n\n\`\`\`\n${sel.slice(0, 16000)}\n\`\`\``);
}
async function cmdMuxQuery() {
  const q = await vscode.window.showInputBox({ title: 'Kritical SCXCode — Synthetic-Context Query', prompt: `Fan out to ${getConfig().concurrency} concurrent SCX streams and synthesise. Ask anything.` });
  if (!q) return;
  const out = getOutputChannel(); out.show(true);
  out.appendLine(`\n[mux] ${q}`);
  try {
    const cfg = getConfig();
    const { res, modelUsed, shards } = await scxMux([{ role: 'user', content: q }], cfg.concurrency, cfg.maxTokens);
    out.appendLine(`[reply · ${modelUsed} · muxed ×${shards}]\n${res.content.map((c) => c.text).join('')}\n`);
  } catch (e) { out.appendLine(`[error] ${(e as Error).message}`); }
}

async function runChat(prompt: string) {
  const out = getOutputChannel();
  out.show(true);
  // .5165e — auto-context prefix. Editor state gets injected as a system-prefix
  // block so the model knows what the operator is looking at.
  const ctx = buildAutoContext();
  const fullPrompt = ctx ? ctx + prompt : prompt;
  out.appendLine(`\n[chat] ${prompt.slice(0, 100)}${prompt.length > 100 ? '…' : ''}`);
  if (ctx) out.appendLine(`[auto-context] ${ctx.length} chars injected`);
  try {
    const { res, modelUsed, keyIndex } = await scxPostWithFailover([{ role: 'user', content: fullPrompt }], getConfig().maxTokens);
    const text = res.content.map((c) => c.text).join('');
    const keyLabel = keyIndex > 1 ? ` · key${keyIndex}` : '';
    out.appendLine(`\n[reply · ${modelUsed}${keyLabel} · ${res.usage.output_tokens} tok]\n${text}\n`);
  } catch (e) {
    out.appendLine(`[error] ${(e as Error).message}`);
  }
}

async function cmdOpenChat(ctx: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'krit-scxcode-chat',
    'Kritical SCXCode — Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = chatHtml();
  // .5210 BUGFIX — this handler previously read msg.history (never sent by the webview,
  // which posts {type:'chat', text}). Result: scxPostWithFailover(undefined) → 400 → every
  // send in the panel failed. Now we maintain history here and read msg.text, mirroring the sidebar.
  const history: ScxMessage[] = [];
  let attached = ''; // .5227 — panel now supports file/repo attach like the sidebar
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'chat') {
      history.push({ role: 'user', content: msg.text });
      try {
        const cfg = getConfig();
        const ctxPrefix = buildAutoContext() + attached;
        const compacted = compactMessagesForSend(history, cfg.defaultModel, ctxPrefix.length);
        const messagesForApi: ScxMessage[] = [...compacted.messages];
        if (ctxPrefix && messagesForApi.length > 0) {
          messagesForApi[messagesForApi.length - 1] = { role: 'user', content: ctxPrefix + msg.text };
        }
        attached = '';
        const { res, modelUsed, keyIndex, shards } = await scxMux(messagesForApi, cfg.concurrency, cfg.maxTokens);
        const replyText = res.content.map((c) => c.text).join('');
        if (compacted.compactedTurns > 0) {
          history.length = 0;
          history.push(...compacted.messages);
        }
        history.push({ role: 'assistant', content: replyText });
        panel.webview.postMessage({ type: 'reply', text: replyText, model: modelUsed, keyIndex, shards, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, autoContextChars: ctxPrefix.length, compactedTurns: compacted.compactedTurns });
      } catch (e) {
        // .5231 (bughunt-confirmed) — pop the orphaned user turn so a failed send doesn't leave two
        // consecutive user roles in history → next send 400s "roles must alternate" and bricks the chat.
        if (history.length && history[history.length - 1].role === 'user') history.pop();
        panel.webview.postMessage({ type: 'error', error: (e as Error).message });
      }
    } else if (msg.type === 'clear') {
      history.length = 0;
      panel.webview.postMessage({ type: 'cleared' });
    } else if (msg.type === 'pickModel') {
      await vscode.commands.executeCommand('kritical.scxcode.pickModel');
      panel.webview.postMessage({ type: 'config', model: getConfig().defaultModel, keyCount: getConfig().apiKeys.length });
    } else if (msg.type === 'switchKey') {
      // .5231 (bughunt-confirmed) — the shared chat HTML renders a 'Switch SCX key' button on 429s;
      // the panel was missing this handler entirely (only the sidebar had it), so the button was dead.
      try {
        const cfg = getConfig();
        if (cfg.apiKeys.length < 2) {
          panel.webview.postMessage({ type: 'error', error: 'Only one SCX key available (SCX_API_KEY). Set SCX_API_KEY_2..9 in HKCU or run Switch-KritScxKey.' });
        } else {
          _keyRotation = (_keyRotation + 1) % cfg.apiKeys.length;
          saveKeyRotation(_keyRotation);   // .5231b (re-hunt) — persist so the selection survives restart
          panel.webview.postMessage({ type: 'keySwitched', newKeyIndex: _keyRotation + 1 });
        }
      } catch (e) {
        panel.webview.postMessage({ type: 'error', error: 'Key switch failed: ' + (e as Error).message });
      }
    } else if (msg.type === 'setConfig') {
      try { await vscode.workspace.getConfiguration('kritical.scxcode').update(msg.key, msg.value, vscode.ConfigurationTarget.Global); }
      catch (e) { panel.webview.postMessage({ type: 'error', error: 'Setting update failed: ' + (e as Error).message }); }
    } else if (msg.type === 'uploadFile' || msg.type === 'uploadFolder') {
      const folder = msg.type === 'uploadFolder';
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: !folder, canSelectFiles: !folder, canSelectFolders: folder,
        openLabel: folder ? 'Attach this folder to SCXCode' : 'Attach file(s) to SCXCode',
        title: folder ? 'Select a folder (read recursively)' : 'Select one or more files',
        defaultUri: getAttachmentDialogDefaultUri(),
      });
      if (picked && picked.length) {
        const { block, fileCount, chars } = await collectAttachments(picked);
        if (fileCount) { attached += block; panel.webview.postMessage({ type: 'fileAttached', name: folder ? `folder · ${fileCount} file(s)` : `${fileCount} file(s)`, chars, preview: block.length > 12000 ? block.slice(0, 12000) + '\n\n_… preview truncated; the full contents are attached to your next message._' : block }); }
        else { panel.webview.postMessage({ type: 'error', error: folder ? 'No readable text files in that folder.' : 'No readable text files selected.' }); }
      }
    } else if (msg.type === 'attachRepo') {
      // .5231 — attach the ACTUAL open workspace repo (real file contents), not just a path list.
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || !folders.length) {
        panel.webview.postMessage({ type: 'error', error: 'No workspace folder is open — open your repo folder in VS Code (File → Open Folder), then click Repo.' });
      } else {
        const { block, fileCount, chars } = await collectAttachments(folders.map((f) => f.uri));
        if (fileCount) { attached += block; panel.webview.postMessage({ type: 'fileAttached', name: `repo · ${fileCount} file(s)`, chars, preview: block.length > 12000 ? block.slice(0, 12000) + '\n\n_… preview truncated; the full repo contents are attached to your next message._' : block }); }
        else { panel.webview.postMessage({ type: 'error', error: 'No readable text files found in the workspace.' }); }
      }
    } else if (msg.type === 'listMcp') {
      vscode.commands.executeCommand('kritical.scxcode.setupGui');   // .5229 — open the real MCP/Codex setup GUI
    } else if (msg.type === 'scxCodex') {
      vscode.commands.executeCommand('kritical.scxcode.scxCodex');
    } else if (msg.type === 'config') {
      const cfg = getConfig();
      let mcpCount = 0; try { mcpCount = Object.keys(readCodexConfig().mcp_servers || {}).length; } catch { /* none */ }
      panel.webview.postMessage({ type: 'config', model: cfg.defaultModel, models: getModelCatalog(), keyCount: cfg.apiKeys.length,
        autoContext: cfg.autoContext, maxTokens: cfg.maxTokens, concurrency: cfg.concurrency, temperature: cfg.temperature, provider: cfg.provider,
        baseUrl: cfg.baseUrl, apiKeySet: !!cfg.apiKey, mcpCount });
    }
  });
  panel.webview.postMessage({ type: 'ready' });
}

// ────────────────────────────────────────────────────────────────
// .5231 — Kritical Lens "Looking Glass" webview.
// Turns the standalone lens-looking-glass.html prototype into a REAL panel fed by
// the local SQLite corpus store (~/.kritical-scx/scxcode-store.db). The webview posts
// {type:'lensQuery'} on load; the host reads files + symbols from the store (read-only)
// and posts {type:'lensData', files, symbols} back. Findings still use sample rows for
// now — wiring dbo.v_LensFindings (SQL Server) is the next step (see FINDINGS below).
// ────────────────────────────────────────────────────────────────

// .5231 — the Looking Glass webview markup (prototype adapted for a real webview + store bridge).
// %%NONCE%% is substituted per-render. Kept as a single template literal so it bundles into out/extension.js.
// Identity preserved from the prototype: Southern Cross starfield, frosted glass cards, navy #13365C / cyan #15AFD1.
const LOOKING_GLASS_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kritical Lens — Looking Glass</title>
<style nonce="%%NONCE%%">
  /* ============================================================
     Kritical Lens — Looking Glass (.5231)
     Real VS Code webview. Corpus + symbols are LIVE from the local
     SQLite store (~/.kritical-scx/scxcode-store.db); findings are
     still prototype samples (v_LensFindings wiring is next).
     Identity mirrors src/extension.ts: Southern Cross starfield,
     frosted glass cards, Kritical navy #13365C + cyan #15AFD1.
     ============================================================ */
  :root{
    --k-navy:#13365C; --k-navy2:#0d2440; --k-navy3:#0a1c33;
    --k-cyan:#15AFD1; --k-cyan-dim:#15afd155; --k-cyan-faint:#15afd122;
    --k-ok:#3fb950; --k-warn:#e3b341; --k-err:#d72638;
    --ink:#dfeefa; --ink-dim:#93b4cc; --ink-faint:#6a8aa3;
    --panel:rgba(14,32,54,.55); --panel-solid:#0f2138;
    --bd:#1d4160; --bd-hi:#2b608a;
    --glass-blur:14px;
    --mono:'Cascadia Code',ui-monospace,'SF Mono',Consolas,monospace;
    --sans:'Segoe UI',system-ui,-apple-system,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; font-family:var(--sans); color:var(--ink);
    background:
      radial-gradient(1200px 700px at 78% -8%, #163a63 0%, transparent 60%),
      linear-gradient(160deg,var(--k-navy3) 0%, #071527 55%, #050f1c 100%);
    overflow:hidden;
  }
  #sky{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0;pointer-events:none}
  .app{position:relative;z-index:1;height:100vh;display:flex;flex-direction:column}

  /* ---- header / hero ---- */
  header{
    display:flex;align-items:center;gap:14px;padding:14px 22px;
    border-bottom:1px solid var(--k-cyan);
    background:linear-gradient(135deg, rgba(13,36,64,.85), rgba(10,28,51,.7) 60%, rgba(10,28,51,.55));
    backdrop-filter:blur(6px);
  }
  .logo{width:40px;height:40px;flex:0 0 auto;border-radius:10px;box-shadow:0 2px 12px #15afd140}
  .brand h1{margin:0;font-size:18px;letter-spacing:.3px;font-weight:700}
  .brand .sub{font-size:11px;color:var(--k-cyan);letter-spacing:.6px;text-transform:uppercase}
  .hstats{margin-left:auto;display:flex;gap:9px;flex-wrap:wrap}
  .pill{
    display:flex;align-items:center;gap:6px;background:#00000040;
    border:1px solid var(--k-cyan-dim);border-radius:20px;padding:5px 12px;
    font:11px/1 var(--mono);color:#bfe9f5;white-space:nowrap;
  }
  .pill b{color:#fff;font-weight:700}
  .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--k-ok);box-shadow:0 0 6px var(--k-ok)}
  .pill .dot.off{background:var(--k-warn);box-shadow:0 0 6px var(--k-warn)}

  /* ---- tabs ---- */
  .tabs{display:flex;gap:4px;padding:10px 22px 0}
  .tab{
    font:12px/1 var(--sans);font-weight:600;letter-spacing:.3px;color:var(--ink-dim);
    background:transparent;border:1px solid transparent;border-bottom:none;
    padding:9px 16px;border-radius:10px 10px 0 0;cursor:pointer;transition:.15s;
  }
  .tab:hover{color:var(--ink)}
  .tab.active{color:#fff;background:var(--panel);border-color:var(--bd);border-bottom:1px solid transparent;
    box-shadow:0 -2px 12px #15afd11f}
  .tab .cnt{margin-left:7px;font:10px/1 var(--mono);color:var(--k-cyan);opacity:.85}

  main{flex:1;min-height:0;padding:0 22px 18px;display:flex}
  .pane{display:none;flex:1;min-height:0}
  .pane.active{display:flex;gap:16px}

  /* ---- glass card ---- */
  .card{
    background:var(--panel);border:1px solid var(--bd);border-radius:14px;
    backdrop-filter:blur(var(--glass-blur));-webkit-backdrop-filter:blur(var(--glass-blur));
    box-shadow:0 8px 34px #0006, inset 0 1px 0 #ffffff0a;
    display:flex;flex-direction:column;min-height:0;overflow:hidden;
  }
  .card > .card-h{
    padding:13px 16px;border-bottom:1px solid var(--bd);
    display:flex;align-items:center;gap:10px;flex:0 0 auto;
    background:linear-gradient(180deg,#ffffff08,transparent);
  }
  .card-h h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#cfe9f6}
  .card-h .meta{margin-left:auto;font:11px/1 var(--mono);color:var(--ink-faint)}
  .card-body{flex:1;min-height:0;overflow:auto}
  .card-body::-webkit-scrollbar{width:10px;height:10px}
  .card-body::-webkit-scrollbar-thumb{background:#1d4160;border-radius:8px;border:2px solid transparent;background-clip:padding-box}
  .card-body::-webkit-scrollbar-thumb:hover{background:#2b608a}

  /* ---- search ---- */
  .search{position:relative;flex:1}
  .search input{
    width:100%;background:#08192c;border:1px solid var(--bd-hi);border-radius:9px;
    color:var(--ink);font:13px/1 var(--sans);padding:9px 12px 9px 32px;outline:none;transition:.15s;
  }
  .search input:focus{border-color:var(--k-cyan);box-shadow:0 0 0 3px var(--k-cyan-faint)}
  .search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.6}

  /* ============ CORPUS PANE ============ */
  .col-files{flex:0 0 46%;max-width:46%}
  .col-detail{flex:1}
  .file-row{
    display:grid;grid-template-columns:20px 1fr auto;gap:10px;align-items:center;
    padding:9px 15px;border-bottom:1px solid #ffffff08;cursor:pointer;transition:.1s;
  }
  .file-row:hover{background:#15afd10f}
  .file-row.sel{background:#15afd11c;box-shadow:inset 3px 0 0 var(--k-cyan)}
  .file-row .lang{font:10px/1 var(--mono);text-transform:uppercase;padding:3px 5px;border-radius:5px;text-align:center}
  .file-row .path{font:12.5px/1.3 var(--mono);color:var(--ink);word-break:break-all}
  .file-row .path .dir{color:var(--ink-faint)}
  .file-row .path b{color:#eaf6ff;font-weight:600}
  .file-row .loc{font:10.5px/1 var(--mono);color:var(--ink-faint);white-space:nowrap}
  .lang-ts{background:#2b4b7a;color:#a9c8ff} .lang-mjs{background:#5a4a1f;color:#f0d98a}
  .lang-js{background:#5a4a1f;color:#f0d98a} .lang-py{background:#1f5a4a;color:#8af0c8}
  .lang-ps1{background:#3a2b5a;color:#c8a9ff} .lang-psm1{background:#3a2b5a;color:#c8a9ff}
  .lang-md{background:#2a3f52;color:#a9c8dd} .lang-json{background:#4a2b3a;color:#f0a9c8}
  .lang-sql{background:#4a3a1f;color:#f0c88a} .lang-cjs{background:#5a4a1f;color:#f0d98a}
  .lang-toml{background:#3a2b2b;color:#f0b8a9}

  .detail-head{padding:15px 16px;border-bottom:1px solid var(--bd)}
  .detail-head .fp{font:13px/1.4 var(--mono);color:#eaf6ff;word-break:break-all}
  .detail-head .badges{margin-top:9px;display:flex;gap:7px;flex-wrap:wrap}
  .badge{font:10.5px/1 var(--mono);padding:4px 8px;border-radius:6px;border:1px solid var(--bd-hi);color:var(--ink-dim);background:#08192c}
  .badge b{color:#eaf6ff}
  .code{
    margin:0;padding:14px 16px;font:12px/1.55 var(--mono);color:#bcd6e8;
    white-space:pre;tab-size:2;
  }
  .code .ln{color:#3f5f78;user-select:none;display:inline-block;width:3.2em;text-align:right;margin-right:14px}
  .code .kw{color:#4fb8e8} .code .str{color:#8af0c8} .code .com{color:#5a7288;font-style:italic}
  .code .fn{color:#f0d98a} .code .sym-hi{background:#15afd130;border-radius:3px;box-shadow:0 0 0 1px #15afd155}

  /* ============ SYMBOLS PANE ============ */
  .col-symlist{flex:0 0 42%;max-width:42%}
  .sym-row{
    display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
    padding:8px 15px;border-bottom:1px solid #ffffff08;cursor:pointer;transition:.1s;
  }
  .sym-row:hover{background:#15afd10f}
  .sym-row.sel{background:#15afd11c;box-shadow:inset 3px 0 0 var(--k-cyan)}
  .sym-row .nm{font:12.5px/1.2 var(--mono);color:#eaf6ff}
  .sym-row .kind{font:9.5px/1 var(--mono);text-transform:uppercase;padding:3px 6px;border-radius:5px}
  .kind-function{background:#1f4a5a;color:#8ad8f0}
  .kind-class{background:#4a2b5a;color:#d8a9ff}
  .sym-row .loc{grid-column:1;font:10.5px/1 var(--mono);color:var(--ink-faint);margin-top:3px}
  .sym-empty{padding:30px;text-align:center;color:var(--ink-faint);font-size:13px}

  /* graph */
  .graph-wrap{flex:1;min-height:0;position:relative}
  #graph{width:100%;height:100%;display:block}
  .graph-legend{position:absolute;left:14px;bottom:12px;display:flex;gap:14px;font:11px/1 var(--mono);color:var(--ink-dim)}
  .graph-legend span{display:flex;align-items:center;gap:6px}
  .graph-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}

  /* ============ FINDINGS PANE ============ */
  .findings-col{flex:1;display:flex;flex-direction:column;gap:14px;min-height:0}
  .toggle-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .seg{display:inline-flex;background:#08192c;border:1px solid var(--bd-hi);border-radius:10px;padding:3px;gap:2px}
  .seg button{
    font:11.5px/1 var(--mono);font-weight:600;letter-spacing:.4px;
    color:var(--ink-dim);background:transparent;border:0;padding:8px 15px;border-radius:8px;cursor:pointer;transition:.15s;
  }
  .seg button:hover{color:var(--ink)}
  .seg button.on{color:#04222c;background:linear-gradient(135deg,var(--k-cyan),#0f8bad);box-shadow:0 2px 10px #15afd150}
  .seg button.on.det{background:linear-gradient(135deg,#3fb950,#2b8a3c);box-shadow:0 2px 10px #3fb95050}
  .seg button.on.inf{background:linear-gradient(135deg,#c88af0,#8a4ad8);box-shadow:0 2px 10px #8a4ad850}
  .class-note{font:11px/1.4 var(--mono);color:var(--ink-faint);flex:1;min-width:160px}
  .class-note b.det{color:#8af0c8} .class-note b.inf{color:#d8a9ff}

  .find{
    padding:12px 16px;border-bottom:1px solid #ffffff08;display:grid;
    grid-template-columns:auto 1fr;gap:12px;align-items:start;
  }
  .find:hover{background:#ffffff05}
  .sev{width:8px;align-self:stretch;border-radius:4px;margin-top:2px;min-height:38px}
  .sev-high{background:var(--k-err);box-shadow:0 0 8px #d7263866}
  .sev-med{background:var(--k-warn);box-shadow:0 0 8px #e3b34155}
  .sev-low{background:var(--ink-faint)}
  .find .top{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .find .rule{font:12px/1 var(--mono);color:#eaf6ff;font-weight:600}
  .find .tool{font:10px/1 var(--mono);padding:3px 7px;border-radius:5px;background:#08192c;border:1px solid var(--bd-hi);color:var(--k-cyan)}
  .find .cls{font:9.5px/1 var(--mono);text-transform:uppercase;padding:3px 7px;border-radius:5px;letter-spacing:.5px}
  .cls-deterministic{background:#12331f;color:#7ce0a0;border:1px solid #2b8a3c66}
  .cls-inference{background:#2a1a3a;color:#d0a0f0;border:1px solid #8a4ad866}
  .find .where{font:10.5px/1 var(--mono);color:var(--ink-faint);margin-left:auto}
  .find .msg{font:12px/1.5;color:var(--ink-dim);margin-top:3px}
  .find .tag{font:10px/1 var(--mono);color:var(--ink-faint);margin-top:5px}
  .find .tag b{color:var(--k-cyan)}
  /* confidence bar */
  .conf{margin-top:7px;display:flex;align-items:center;gap:9px}
  .conf .track{flex:1;height:7px;background:#08192c;border-radius:5px;overflow:hidden;border:1px solid #1d416088}
  .conf .fill{height:100%;border-radius:5px;transition:width .4s cubic-bezier(.2,.8,.2,1)}
  .conf .fill.det{background:linear-gradient(90deg,#2b8a3c,#3fb950)}
  .conf .fill.inf{background:linear-gradient(90deg,#8a4ad8,#c88af0)}
  .conf .val{font:11px/1 var(--mono);color:var(--ink);width:34px;text-align:right;font-weight:700}
  .conf .cap{font:9.5px/1 var(--mono);color:var(--ink-faint)}

  .summary{display:flex;gap:10px;flex-wrap:wrap}
  .sum-card{
    flex:1;min-width:120px;background:#08192c88;border:1px solid var(--bd);border-radius:11px;padding:12px 14px;
  }
  .sum-card .n{font:22px/1 var(--mono);font-weight:700;color:#fff}
  .sum-card .l{font:10.5px/1.3 var(--mono);color:var(--ink-faint);text-transform:uppercase;letter-spacing:.5px;margin-top:5px}
  .sum-card.det .n{color:#7ce0a0} .sum-card.inf .n{color:#d0a0f0}
  .sum-card.high .n{color:#f07a86}

  .foot{padding:6px 22px;font:10.5px/1.4 var(--mono);color:var(--ink-faint);border-top:1px solid var(--bd);
    display:flex;gap:16px;flex-wrap:wrap;background:#0a1c3399;backdrop-filter:blur(6px)}
  .foot b{color:var(--k-cyan)}
  .empty{padding:40px;text-align:center;color:var(--ink-faint)}
  .empty h3{color:var(--ink);margin:0 0 10px;font-size:15px}
  .empty code{background:#08192c;border:1px solid var(--bd-hi);border-radius:6px;padding:2px 7px;color:var(--k-cyan);font:12px/1.6 var(--mono)}
  .empty .cmd{display:block;margin:14px auto;max-width:560px;text-align:left;background:#08192c;border:1px solid var(--bd);border-radius:9px;padding:12px 14px;font:12px/1.7 var(--mono);color:#bcd6e8;white-space:pre-wrap}
</style>
</head>
<body>
<canvas id="sky"></canvas>
<div class="app">

  <header>
    <svg class="logo" viewBox="0 0 128 128"><rect width="128" height="128" rx="18" fill="#13365C"/><path d="M28 24 L28 104 L44 104 L44 72 L68 104 L88 104 L58 62 L86 24 L66 24 L44 54 L44 24 Z" fill="#fff"/></svg>
    <div class="brand">
      <h1>Kritical Lens — Looking Glass</h1>
      <div class="sub">One glass · the whole indexed corpus · .5231</div>
    </div>
    <div class="hstats" id="hstats"></div>
  </header>

  <div class="tabs">
    <button class="tab active" data-pane="corpus">Corpus <span class="cnt" id="tc-files"></span></button>
    <button class="tab" data-pane="symbols">Symbol Graph <span class="cnt" id="tc-syms"></span></button>
    <button class="tab" data-pane="findings">Findings <span class="cnt" id="tc-finds"></span></button>
  </div>

  <main>
    <!-- ===================== CORPUS ===================== -->
    <section class="pane active" data-pane="corpus">
      <div class="card col-files">
        <div class="card-h">
          <div class="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb9d4" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input id="fileSearch" placeholder="Search corpus — path or content (LIKE %term%) …" autocomplete="off"/>
          </div>
          <div class="meta" id="fileCount"></div>
        </div>
        <div class="card-body" id="fileList"></div>
      </div>
      <div class="card col-detail">
        <div class="card-h"><h2>File</h2><div class="meta">files.content · byte-exact source</div></div>
        <div class="card-body" id="fileDetail"><div class="empty">Looking through the glass …</div></div>
      </div>
    </section>

    <!-- ===================== SYMBOLS ===================== -->
    <section class="pane" data-pane="symbols">
      <div class="card col-symlist">
        <div class="card-h">
          <div class="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb9d4" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input id="symSearch" placeholder="Search symbols — name LIKE %term% …" autocomplete="off"/>
          </div>
          <div class="meta" id="symCount"></div>
        </div>
        <div class="card-body" id="symList"></div>
      </div>
      <div class="card col-detail">
        <div class="card-h"><h2>Symbol Graph</h2><div class="meta" id="graphMeta">click a symbol to center its call graph</div></div>
        <div class="graph-wrap">
          <canvas id="graph"></canvas>
          <div class="graph-legend">
            <span><i style="background:#15AFD1"></i>selected</span>
            <span><i style="background:#3fb950"></i>same file</span>
            <span><i style="background:#c88af0"></i>call edge</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ===================== FINDINGS ===================== -->
    <section class="pane" data-pane="findings">
      <div class="findings-col">
        <div class="card" style="flex:0 0 auto">
          <div class="card-h"><h2>v_LensFindings</h2><div class="meta">deterministic (fact / conf 100) &nbsp;·&nbsp; inference (AI / graded)</div></div>
          <div class="card-body" style="padding:14px 16px">
            <div class="summary" id="findSummary"></div>
            <div class="toggle-row" style="margin-top:14px">
              <div class="seg" id="clsSeg">
                <button data-cls="all" class="on">All</button>
                <button data-cls="deterministic" class="det">Deterministic</button>
                <button data-cls="inference" class="inf">Inference</button>
              </div>
              <div class="seg" id="sevSeg">
                <button data-sev="all" class="on">All sev</button>
                <button data-sev="high">High</button>
                <button data-sev="med">Med</button>
                <button data-sev="low">Low</button>
              </div>
              <div class="class-note" id="clsNote"></div>
            </div>
          </div>
        </div>
        <div class="card" style="flex:1;min-height:0">
          <div class="card-h"><h2>Findings</h2><div class="meta" id="findCount"></div></div>
          <div class="card-body" id="findList"></div>
        </div>
      </div>
    </section>
  </main>

  <div class="foot">
    <span>Corpus + symbols <b>LIVE</b> from the selected store · findings are prototype samples</span>
    <span>storage <b id="footBackend">auto</b> · <b id="footDb">~/.kritical-scx/scxcode-store.db</b></span>
    <span>SQLite <b>files/symbols</b> · SQL Server <b>dbo.LensSource</b> / <b>dbo.LensSymbol</b></span>
    <span id="footRepo"></span>
  </div>
</div>

<script nonce="%%NONCE%%">
/* ============================================================
   .5231 — the ONLY data seam. Corpus + symbols arrive from the
   extension host over postMessage ({type:'lensData', files, symbols});
   findings stay as prototype samples until dbo.v_LensFindings is wired.
   Local store cols:  files(path,lang,loc,fn_count,content)  symbols(path,name,kind,line)
   ============================================================ */
const vscode = acquireVsCodeApi();
let FILES = [];        // populated from the store
let SYMBOLS = [];      // populated from the store
let EDGES = [];        // derived heuristically from the loaded corpus (see buildEdges)

/* v_LensFindings rows — tool drives detection_class + confidence.
   .5231 NOTE: these remain PROTOTYPE SAMPLES. The next step is to have the host
   read dbo.v_LensFindings (SQL Server) and post them the same way as lensData. */
const DET_TOOLS = new Set(['psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv']);
const RAW_FINDINGS = [
  // ---- deterministic (parser/tool facts) ----
  {path:"install/Install-KritScxLiteLLM.ps1", tool:"psscriptanalyzer", severity:"high", rule:"PSUseDeclaredVarsMoreThanAssignments", line:22, message:"Assigning the read-only automatic variable $pid throws; breaks Get-KritLiteLLMPid.", inference_tag:"static-lint"},
  {path:"ps-module/Kritical.PS.SCXCode.psm1", tool:"psscriptanalyzer", severity:"med", rule:"PSAvoidNullOrEmptyHelpMessageAttribute", line:88, message:"$currentKey.Substring(0,8) throws when the key is null or shorter than 8 chars.", inference_tag:"static-lint"},
  {path:"src/extension.ts", tool:"semgrep", severity:"high", rule:"javascript.https.no-content-length", line:190, message:"HTTP body written without a Content-Length header; some servers reject or truncate the request.", inference_tag:"static-lint"},
  {path:"codex-wrapper/scx-agentic-shim.mjs", tool:"semgrep", severity:"med", rule:"javascript.regex.dynamic-json-test", line:69, message:"isPlanGateError JSON.stringifies the whole body per call; regex over stringified object is fragile.", inference_tag:"static-lint"},
  {path:"lens/Invoke-KritScxSecurityMine.py", tool:"secret-grep", severity:"high", rule:"hardcoded-secret-pattern", line:81, message:"Secret-shaped assignment matched: (api_key|secret|token|password) = '<12+ chars>'.", inference_tag:"regex-secret"},
  {path:"src/package.json", tool:"npm-audit", severity:"med", rule:"GHSA-xxxx-transitive", line:0, message:"Transitive dependency advisory (moderate) in a build-time package.", inference_tag:"osv-advisory"},
  {path:"litellm/kritical_scx_logger.py", tool:"detect-secrets", severity:"low", rule:"KeywordDetector", line:14, message:"Keyword 'token' near a string literal — flagged for manual triage.", inference_tag:"entropy-scan"},
  {path:"node-agent/src/server.mjs", tool:"gitleaks", severity:"low", rule:"generic-api-key", line:112, message:"Low-entropy match near 'apiKey'; likely a placeholder, verify.", inference_tag:"regex-secret"},
  {path:"store-mcp/kritical-local-store.mjs", tool:"semgrep", severity:"low", rule:"javascript.sqli.string-concat-where", line:75, message:"WHERE clause built by string join; parameters are bound (?) so low risk, but pattern flagged.", inference_tag:"static-lint"},
  // ---- inference (AI-graded opinions, DeepSeek security review) ----
  {path:"src/extension.ts", tool:"deepseek-v3.1", severity:"high", rule:"key-rotation-dedup", line:44, message:"If process.env.SCX_API_KEY equals one of SCX_API_KEY_2..9, the primary key can be added twice; dedup only guards the secondary array, not primary vs secondaries.", inference_tag:"ai-review:logic"},
  {path:"src/extension.ts", tool:"deepseek-v3.1", severity:"high", rule:"env-ref-substitution", line:39, message:"The regex /^\${env:SCX_API_KEY}$/ only matches the exact literal; any other value leaves the raw env-reference string in place instead of the resolved key.", inference_tag:"ai-review:logic"},
  {path:"codex-wrapper/scx-agentic-shim.mjs", tool:"deepseek-v3.1", severity:"med", rule:"retry-telemetry-drift", line:100, message:"A failed plan-gate retry could stream an opaque byte-reader error; telemetry tools_out/flattened reflected the first attempt, not the retried server-tools-dropped payload.", inference_tag:"ai-review:robustness"},
  {path:"mux/Invoke-KritScxSyntheticContext.py", tool:"gpt-oss-120b", severity:"high", rule:"stream-error-isolation", line:44, message:"Without per-stream try/except, one stream's HTTPError re-raised through ex.map and discarded all successful streams; synthesise from survivors instead.", inference_tag:"ai-review:robustness"},
  {path:"mux/Invoke-KritScxSyntheticContext.py", tool:"gpt-oss-120b", severity:"med", rule:"context-cap-underrun", line:170, message:"Context cap of 11000 chars (~2.7k tokens) is far under the real gpt-oss-120b ~108k ceiling — wastes usable window.", inference_tag:"ai-review:perf"},
  {path:"codex-wrapper/kritical-codex.ps1", tool:"deepseek-v3.1", severity:"high", rule:"pid-identity-check", line:86, message:"Kill-switch force-killed whatever owned :4199 at teardown; without an identity check it could nuke an innocent process. Track the launched PID.", inference_tag:"ai-review:safety"},
  {path:"lens/Invoke-KritScxSourceIngest.py", tool:"deepseek-v3.1", severity:"high", rule:"byte-exact-illusion", line:78, message:"'byte-exact' storage decoded utf-8/replace into NVARCHAR; the reassembly proof compared lossy-vs-lossy (same U+FFFD both sides) so it always passed; stored_sha was never checked.", inference_tag:"ai-review:correctness"},
  {path:"install/Install-KriticalSCX.ps1", tool:"deepseek-v3.1", severity:"med", rule:"litellm-status-predicate", line:120, message:"'litellm installed' status reused the venv-exists predicate — reports green even when litellm is absent. Drive it off an actual import litellm.", inference_tag:"ai-review:correctness"},
  {path:"lens/Invoke-KritScxCorpusMine.py", tool:"deepseek-v3.1", severity:"low", rule:"callgraph-comment-fp", line:80, message:"Call-graph edge matcher false-positives inside comments and string literals; edges may be over-counted.", inference_tag:"ai-review:precision"},
  {path:"safety/Restore-WorkingClaude.ps1", tool:"minimax-m2.7", severity:"low", rule:"blind-port-kill", line:31, message:"Rescue script force-killed the :4180 owner with no identity check; restrict to a python/litellm owner.", inference_tag:"ai-review:safety"}
];
const FINDINGS = RAW_FINDINGS.map(f => {
  const det = DET_TOOLS.has(f.tool);
  const conf = det ? 100 : (f.severity==='high'?60 : f.severity==='med'?45 : 30);
  return {...f, detection_class: det?'deterministic':'inference', confidence: conf};
});

let REPO = "Kritical.SCXCode";

/* ============================================================
   RENDERING
   ============================================================ */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function splitPath(p){ const i=p.lastIndexOf('/'); return i<0 ? ['',p] : [p.slice(0,i+1), p.slice(i+1)]; }

/* .5231 — derive lightweight call-graph edges from the loaded corpus so the graph view
   has real neighbours: for each symbol, find OTHER symbols whose name appears in this
   file's content (a cheap "references" heuristic). Deterministic; no external miner needed. */
function buildEdges(){
  EDGES = [];
  const byPath = {};
  FILES.forEach(f => { byPath[f.path] = f.content || ''; });
  const symByName = {};
  SYMBOLS.forEach(s => { (symByName[s.name] = symByName[s.name] || []).push(s); });
  const names = Object.keys(symByName).filter(n => n.length >= 3);
  SYMBOLS.forEach(src => {
    const content = byPath[src.path] || '';
    if (!content) return;
    for (const nm of names) {
      if (nm === src.name) continue;
      // word-boundary-ish match, skip self-file duplicates handled by graph 'same file'
      if (content.indexOf(nm) !== -1) {
        const re = new RegExp('\\b' + nm.replace(/[.*+?^\${}()|[\]\\-]/g,'\\$&') + '\\b');
        if (re.test(content)) EDGES.push({ from: src.name, to: nm });
      }
    }
  });
  // cap runaway edges from very common names
  if (EDGES.length > 600) EDGES = EDGES.slice(0, 600);
}

/* ---- header stats + tab counts ---- */
function initStats(){
  const totLoc = FILES.reduce((a,f)=>a+(f.loc||0),0);
  $('#hstats').innerHTML =
    '<span class="pill"><span class="dot" id="storeDot"></span>store <b id="storeState">online</b></span>'+
    '<span class="pill">files <b>'+FILES.length+'</b></span>'+
    '<span class="pill">symbols <b>'+SYMBOLS.length+'</b></span>'+
    '<span class="pill">loc <b>'+totLoc.toLocaleString()+'</b></span>'+
    '<span class="pill">findings <b>'+FINDINGS.length+'</b></span>';
  $('#tc-files').textContent = FILES.length;
  $('#tc-syms').textContent = SYMBOLS.length;
  $('#tc-finds').textContent = FINDINGS.length;
  $('#footRepo').innerHTML = 'repo <b>'+esc(REPO)+'</b>';
}

/* ---- tabs ---- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(z=>z.classList.remove('active'));
  document.querySelectorAll('.pane').forEach(z=>z.classList.remove('active'));
  t.classList.add('active');
  document.querySelector('.pane[data-pane="'+t.dataset.pane+'"]').classList.add('active');
  if (t.dataset.pane==='symbols') requestAnimationFrame(drawGraph);
});

/* ================= CORPUS ================= */
let fileSel = null;
function highlight(text){
  return esc(text)
    .replace(/(&#x2F;&#x2F;|#).*$/gm, m=>'<span class="com">'+m+'</span>')
    .replace(/\b(function|const|let|var|return|async|await|export|import|class|def|if|for|while|new|from)\b/g, '<span class="kw">$1</span>')
    .replace(/(['"\x60])(?:\\.|(?!\1).)*\1/g, m=>'<span class="str">'+m+'</span>');
}
function renderFileDetail(f){
  const lines = (f.content||'').split('\n');
  const numbered = lines.map((ln,i)=>'<span class="ln">'+(i+1)+'</span>'+highlight(ln)).join('\n');
  const [dir,base]=splitPath(f.path);
  $('#fileDetail').innerHTML =
    '<div class="detail-head">'+
       '<div class="fp"><span style="color:var(--ink-faint)">'+esc(dir)+'</span><b style="color:#eaf6ff">'+esc(base)+'</b></div>'+
       '<div class="badges">'+
         '<span class="badge lang-'+esc(f.lang)+'" style="border:0">'+esc((f.lang||'').toUpperCase())+'</span>'+
         '<span class="badge">loc <b>'+(f.loc||0)+'</b></span>'+
         '<span class="badge">fns <b>'+(f.fns||0)+'</b></span>'+
         '<span class="badge">symbols <b>'+SYMBOLS.filter(s=>s.path===f.path).length+'</b></span>'+
         '<span class="badge">findings <b>'+FINDINGS.filter(x=>x.path===f.path).length+'</b></span>'+
       '</div>'+
     '</div>'+
     '<pre class="code">'+numbered+'</pre>';
}
function renderFileList(q){
  q=(q||'').toLowerCase().trim();
  const terms=q.split(/\s+/).filter(Boolean);
  const rows = FILES.filter(f=>{
    if(!terms.length) return true;
    const hay=(f.path+'\n'+(f.content||'')).toLowerCase();
    return terms.every(t=>hay.includes(t));   // path LIKE %t% OR content LIKE %t%
  });
  $('#fileCount').textContent = rows.length+' / '+FILES.length;
  if(!rows.length){ $('#fileList').innerHTML='<div class="empty">No files match.</div>'; return; }
  $('#fileList').innerHTML = rows.map(f=>{
    const [dir,base]=splitPath(f.path);
    return '<div class="file-row '+(f===fileSel?'sel':'')+'" data-path="'+esc(f.path)+'">'+
       '<span class="lang lang-'+esc(f.lang)+'">'+esc(f.lang)+'</span>'+
       '<span class="path"><span class="dir">'+esc(dir)+'</span><b>'+esc(base)+'</b></span>'+
       '<span class="loc">'+(f.loc||0)+' loc</span></div>';
  }).join('');
  document.querySelectorAll('#fileList .file-row').forEach(r=>r.onclick=()=>{
    fileSel = FILES.find(f=>f.path===r.dataset.path);
    document.querySelectorAll('#fileList .file-row').forEach(z=>z.classList.remove('sel'));
    r.classList.add('sel'); renderFileDetail(fileSel);
  });
}
$('#fileSearch').addEventListener('input', e=>renderFileList(e.target.value));

/* ================= SYMBOLS + GRAPH ================= */
let symSel = null;
function renderSymList(q){
  q=(q||'').toLowerCase().trim();
  const rows = SYMBOLS.filter(s=>!q || s.name.toLowerCase().includes(q));   // name LIKE %q%
  $('#symCount').textContent = rows.length+' / '+SYMBOLS.length;
  if(!rows.length){ $('#symList').innerHTML='<div class="sym-empty">No symbols match.</div>'; return; }
  $('#symList').innerHTML = rows.slice(0,400).map(s=>{
    const [dir,base]=splitPath(s.path);
    return '<div class="sym-row '+(s===symSel?'sel':'')+'" data-name="'+esc(s.name)+'" data-path="'+esc(s.path)+'">'+
       '<span class="nm">'+esc(s.name)+'</span>'+
       '<span class="kind kind-'+esc(s.kind)+'">'+esc(s.kind)+'</span>'+
       '<span class="loc"><span style="opacity:.7">'+esc(dir)+'</span>'+esc(base)+'<span style="color:var(--k-cyan)">:'+s.line+'</span></span>'+
     '</div>';
  }).join('');
  document.querySelectorAll('#symList .sym-row').forEach(r=>r.onclick=()=>{
    symSel = SYMBOLS.find(s=>s.name===r.dataset.name && s.path===r.dataset.path);
    document.querySelectorAll('#symList .sym-row').forEach(z=>z.classList.remove('sel'));
    r.classList.add('sel'); requestAnimationFrame(drawGraph);
  });
}
$('#symSearch').addEventListener('input', e=>renderSymList(e.target.value));

/* ---- call graph (center selected symbol; neighbours = call edges) ---- */
const gc = $('#graph'); let gctx;
function drawGraph(){
  if(!gc.offsetWidth) return;
  const dpr = window.devicePixelRatio||1;
  const W=gc.width=gc.offsetWidth*dpr, H=gc.height=gc.offsetHeight*dpr;
  gctx=gc.getContext('2d'); gctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H/2;
  if(!symSel){
    gctx.fillStyle='#6a8aa3'; gctx.font=(13*dpr)+'px monospace'; gctx.textAlign='center';
    gctx.fillText('Select a symbol to center its call graph', cx, cy);
    $('#graphMeta').textContent='click a symbol to center its call graph';
    return;
  }
  const name=symSel.name;
  const outN = EDGES.filter(e=>e.from===name).map(e=>({name:e.to, dir:'out'}));
  const inN  = EDGES.filter(e=>e.to===name).map(e=>({name:e.from, dir:'in'}));
  const sameFile = SYMBOLS.filter(s=>s.path===symSel.path && s.name!==name).slice(0,6).map(s=>({name:s.name, dir:'file'}));
  const seen=new Set([name]); const neigh=[];
  [...outN,...inN,...sameFile].forEach(n=>{ if(!seen.has(n.name)){seen.add(n.name); neigh.push(n);} });
  neigh.length = Math.min(neigh.length, 14); // keep the ring readable
  $('#graphMeta').textContent = name+'() — '+outN.length+' refs out · '+inN.length+' referrers · '+sameFile.length+' in-file';

  const R = Math.min(W,H)*0.33;
  const pos = neigh.map((n,i)=>{ const a=-Math.PI/2 + i*(2*Math.PI/Math.max(neigh.length,1));
    return {...n, x:cx+Math.cos(a)*R, y:cy+Math.sin(a)*R}; });
  pos.forEach(p=>{
    gctx.strokeStyle = p.dir==='file' ? 'rgba(63,185,80,.35)' : 'rgba(200,138,240,.55)';
    gctx.lineWidth = (p.dir==='file'?1.2:1.8)*dpr;
    gctx.beginPath(); gctx.moveTo(cx,cy); gctx.lineTo(p.x,p.y); gctx.stroke();
    if(p.dir!=='file'){
      const ang=Math.atan2(p.y-cy, p.x-cx), ex=p.x-Math.cos(ang)*22*dpr, ey=p.y-Math.sin(ang)*22*dpr;
      gctx.fillStyle='rgba(200,138,240,.8)'; gctx.beginPath();
      gctx.moveTo(ex,ey);
      gctx.lineTo(ex-Math.cos(ang-0.4)*8*dpr, ey-Math.sin(ang-0.4)*8*dpr);
      gctx.lineTo(ex-Math.cos(ang+0.4)*8*dpr, ey-Math.sin(ang+0.4)*8*dpr);
      gctx.closePath(); gctx.fill();
    }
  });
  pos.forEach(p=>drawNode(p.x,p.y,p.name, p.dir==='file'?'#3fb950':'#c88af0', false, dpr));
  drawNode(cx,cy,name+'()','#15AFD1',true,dpr);
}
function drawNode(x,y,label,color,big,dpr){
  const r=(big?9:6)*dpr;
  const grd=gctx.createRadialGradient(x,y,0,x,y,r*3);
  grd.addColorStop(0,color+'cc'); grd.addColorStop(1,color+'00');
  gctx.fillStyle=grd; gctx.beginPath(); gctx.arc(x,y,r*3,0,6.29); gctx.fill();
  gctx.fillStyle=color; gctx.beginPath(); gctx.arc(x,y,r,0,6.29); gctx.fill();
  gctx.fillStyle=big?'#eaf6ff':'#cfe9f6'; gctx.font=((big?13:11)*dpr)+'px monospace';
  gctx.textAlign='center'; gctx.textBaseline='top';
  gctx.fillText(label, x, y+r+4*dpr);
  gctx.textBaseline='alphabetic';
}
window.addEventListener('resize', ()=>{ if($('.pane[data-pane=symbols]').classList.contains('active')) requestAnimationFrame(drawGraph); });

/* ================= FINDINGS ================= */
let clsFilter='all', sevFilter='all';
function renderFindSummary(){
  const det=FINDINGS.filter(f=>f.detection_class==='deterministic');
  const inf=FINDINGS.filter(f=>f.detection_class==='inference');
  const high=FINDINGS.filter(f=>f.severity==='high');
  const avgInf = Math.round(inf.reduce((a,f)=>a+f.confidence,0)/Math.max(inf.length,1));
  $('#findSummary').innerHTML =
    '<div class="sum-card"><div class="n">'+FINDINGS.length+'</div><div class="l">total findings</div></div>'+
    '<div class="sum-card det"><div class="n">'+det.length+'</div><div class="l">deterministic · conf 100</div></div>'+
    '<div class="sum-card inf"><div class="n">'+inf.length+'</div><div class="l">inference · avg '+avgInf+'</div></div>'+
    '<div class="sum-card high"><div class="n">'+high.length+'</div><div class="l">high severity</div></div>';
}
function renderFindings(){
  const rows=FINDINGS.filter(f=>
    (clsFilter==='all'||f.detection_class===clsFilter) &&
    (sevFilter==='all'||f.severity===sevFilter)
  ).sort((a,b)=> (b.detection_class==='deterministic')-(a.detection_class==='deterministic') || b.confidence-a.confidence);
  $('#findCount').textContent = rows.length+' shown';
  if(!rows.length){ $('#findList').innerHTML='<div class="empty">No findings for this filter.</div>'; return; }
  $('#findList').innerHTML = rows.map(f=>{
    const det=f.detection_class==='deterministic';
    const [dir,base]=splitPath(f.path);
    return '<div class="find">'+
      '<div class="sev sev-'+f.severity+'"></div>'+
      '<div>'+
        '<div class="top">'+
          '<span class="rule">'+esc(f.rule)+'</span>'+
          '<span class="tool">'+esc(f.tool)+'</span>'+
          '<span class="cls cls-'+f.detection_class+'">'+f.detection_class+'</span>'+
          '<span class="where"><span style="opacity:.6">'+esc(dir)+'</span>'+esc(base)+'<span style="color:var(--k-cyan)">:'+f.line+'</span></span>'+
        '</div>'+
        '<div class="msg">'+esc(f.message)+'</div>'+
        '<div class="tag">inference_tag <b>'+esc(f.inference_tag)+'</b> · severity '+f.severity+'</div>'+
        '<div class="conf">'+
          '<span class="cap">confidence</span>'+
          '<div class="track"><div class="fill '+(det?'det':'inf')+'" style="width:'+f.confidence+'%"></div></div>'+
          '<span class="val">'+f.confidence+'</span>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function updateClsNote(){
  const map={
    all:'Showing <b>both</b> classes. Deterministic = <b class="det">parser/tool facts</b> (conf 100); inference = <b class="inf">AI-graded opinions</b> (severity → 60/45/30).',
    deterministic:'<b class="det">Deterministic</b> — PSScriptAnalyzer, semgrep, npm-audit, gitleaks, detect-secrets, osv & secret/danger greps. Reproducible facts, fixed confidence <b>100</b>.',
    inference:'<b class="inf">Inference</b> — DeepSeek / gpt-oss / MiniMax security review. Model opinions, confidence graded by severity (high <b>60</b> · med <b>45</b> · low <b>30</b>).'
  };
  $('#clsNote').innerHTML = map[clsFilter];
}
document.querySelectorAll('#clsSeg button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#clsSeg button').forEach(z=>z.classList.remove('on'));
  b.classList.add('on'); clsFilter=b.dataset.cls; updateClsNote(); renderFindings();
});
document.querySelectorAll('#sevSeg button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#sevSeg button').forEach(z=>z.classList.remove('on'));
  b.classList.add('on'); sevFilter=b.dataset.sev; renderFindings();
});

/* ============================================================
   .5231 — STORE BRIDGE. Ask the host for real corpus data on load,
   then (re)render everything from it. Findings render immediately
   (they're local samples) so the Findings tab is never blank.
   ============================================================ */
function renderAll(){
  buildEdges();
  initStats();
  renderFileList('');
  renderSymList('');
  renderFindSummary(); updateClsNote(); renderFindings();
}
function showCorpusMessage(html){
  $('#fileList').innerHTML = '';
  $('#fileDetail').innerHTML = html;
  $('#symList').innerHTML = '<div class="sym-empty">No symbols — the store has no data yet.</div>';
  $('#fileCount').textContent = '0 / 0';
  $('#symCount').textContent = '0 / 0';
}
function emptyStateHtml(reason, dbPath, backend){
  const why = reason==='missing'
    ? 'No selected corpus store was found at:'
    : 'The selected corpus store exists but has no mined files/symbols yet:';
  return '<div class="empty">'+
    '<h3>The glass is empty</h3>'+
    '<p>'+why+'</p>'+
    '<p>Backend: <b>'+esc(backend||'auto')+'</b></p>'+
    '<p><code>'+esc(dbPath||'~/.kritical-scx/scxcode-store.db')+'</code></p>'+
    '<p>Populate it by mining a repo with SQLite or the SQL Server Lens ingest:</p>'+
    '<div class="cmd">node store-mcp/kritical-local-store.mjs mine &lt;repoRoot&gt;\n\n'+
    '# then reopen: Kritical SCX: Open Lens Looking Glass</div>'+
    '<p style="margin-top:14px;color:var(--ink-faint)">SQLite reads files/symbols directly. SQL Server reads byte-exact dbo.LensSource content plus dbo.LensSymbol from KriticalSCXCodeStore.</p>'+
    '</div>';
}

function getAttachmentDialogDefaultUri(): vscode.Uri {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot) { return workspaceRoot; }
  const home = os.homedir();
  return vscode.Uri.file(home || process.cwd());
}
function markStore(state, dim){
  const dot=$('#storeDot'), lbl=$('#storeState');
  if(lbl) lbl.textContent = state;
  if(dot) dot.className = 'dot' + (dim?' off':'');
}

window.addEventListener('message', ev => {
  const m = ev.data || {};
  if (m.type === 'lensData') {
    FILES = m.files || [];
    SYMBOLS = m.symbols || [];
    if (m.backend) $('#footBackend').textContent = m.backend;
    if (m.dbPath) $('#footDb').textContent = m.dbPath.replace(/\\/g,'/');
    renderAll();
    markStore('online', false);
  } else if (m.type === 'lensEmpty') {
    FILES = []; SYMBOLS = [];
    initStats();
    if (m.backend) $('#footBackend').textContent = m.backend;
    if (m.dbPath) $('#footDb').textContent = m.dbPath.replace(/\\/g,'/');
    showCorpusMessage(emptyStateHtml(m.reason, m.dbPath, m.backend));
    renderFindSummary(); updateClsNote(); renderFindings();  // findings still render (samples)
    markStore(m.reason==='missing'?'no store':'empty', true);
  } else if (m.type === 'lensError') {
    FILES = []; SYMBOLS = [];
    initStats();
    if (m.backend) $('#footBackend').textContent = m.backend;
    showCorpusMessage('<div class="empty"><h3>Could not read the store</h3><p>'+esc(m.error||'unknown error')+'</p><p><code>'+esc(m.dbPath||'')+'</code></p></div>');
    renderFindSummary(); updateClsNote(); renderFindings();
    markStore('error', true);
  }
});

/* first paint: findings + shell render immediately; corpus/symbols fill on lensData */
renderFindSummary(); updateClsNote(); renderFindings();
initStats();
vscode.postMessage({ type: 'lensQuery' });

/* ============================================================
   Southern Cross starfield — ported from src/extension.ts.
   Local 2D canvas, CSP-safe, purely decorative.
   ============================================================ */
try { (function(){
  const c=$('#sky'), x=c.getContext('2d'); let W,H,stars=[],t=0;
  const cross=[[.62,.30,2.6],[.72,.68,2.2],[.80,.44,1.8],[.55,.56,1.5],[.68,.50,1.1]]; // Crux
  function size(){
    W=c.width=c.offsetWidth*devicePixelRatio; H=c.height=c.offsetHeight*devicePixelRatio;
    stars=[]; for(let i=0;i<90;i++) stars.push({x:Math.random()*W,y:Math.random()*H,
      r:Math.random()*1.1*devicePixelRatio+.2,p:Math.random()*6.28,s:Math.random()*.5+.2});
  }
  function draw(){
    t+=.016; x.clearRect(0,0,W,H);
    for(const st of stars){ const a=.18+.30*(0.5+0.5*Math.sin(t*st.s+st.p));
      x.beginPath(); x.arc(st.x,st.y,st.r,0,6.29); x.fillStyle='rgba(191,233,245,'+a+')'; x.fill(); }
    const ox=W*0.62, oy=0, sc=Math.min(W,H)*0.42;
    const px=cross.map(p=>[ox+ (p[0]-.62)*sc*1.6, oy + p[1]*sc ]);
    x.strokeStyle='rgba(21,175,209,.22)'; x.lineWidth=1*devicePixelRatio;
    x.beginPath(); x.moveTo(px[0][0],px[0][1]); x.lineTo(px[1][0],px[1][1]);
    x.moveTo(px[2][0],px[2][1]); x.lineTo(px[3][0],px[3][1]); x.stroke();
    for(let j=0;j<cross.length;j++){ const g=.5+.4*Math.sin(t*1.2+j); const r=cross[j][2]*devicePixelRatio;
      const grd=x.createRadialGradient(px[j][0],px[j][1],0,px[j][0],px[j][1],r*4);
      grd.addColorStop(0,'rgba(21,175,209,'+g+')'); grd.addColorStop(1,'rgba(21,175,209,0)');
      x.fillStyle=grd; x.beginPath(); x.arc(px[j][0],px[j][1],r*4,0,6.29); x.fill();
      x.fillStyle='rgba(230,250,255,'+g+')'; x.beginPath(); x.arc(px[j][0],px[j][1],r,0,6.29); x.fill(); }
    requestAnimationFrame(draw);
  }
  size(); draw(); window.addEventListener('resize',size);
})(); } catch(e){ /* decorative — must never break the viewer */ }
</script>
</body>
</html>`;

type LensFile = { path: string; lang: string; loc: number; fns: number; content: string };
type LensSymbol = { name: string; path: string; line: number; kind: string };
type LensBackend = 'sqlite' | 'mssql';
type LensStore = { files: LensFile[]; symbols: LensSymbol[]; dbPath: string; backend: LensBackend };

function sqliteLensStorePath(): string {
  const cfg = getConfig();
  return cfg.sqliteStorePath || process.env.KRIT_LOCAL_STORE || path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'scxcode-store.db');
}

function mssqlLensStoreLabel(): string {
  const cfg = getConfig();
  return `${cfg.mssqlServer}/${cfg.mssqlDatabase}`;
}

// .5231 — read the corpus store read-only via node:sqlite DatabaseSync (extension host is Node ≥ 22).
// Lazy-require node:sqlite so a Node build without the flag can't break activation of the whole extension.
// Columns mirror the local store schema: files(path,lang,loc,sha,fn_count,content,mined_utc),
// symbols(path,name,kind,line). Returns null when the DB is missing so the webview shows an empty-state.
function readSqliteLensStore(): LensStore | null {
  const dbPath = sqliteLensStorePath();
  if (!fs.existsSync(dbPath)) { return null; }
  let DatabaseSync: any;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { throw new Error('node:sqlite unavailable in this VS Code Node runtime: ' + (e as Error).message); }
  const db = new DatabaseSync(dbPath, { readonly: true });
  try {
    const files: LensFile[] = db.prepare('SELECT path, lang, loc, fn_count, content FROM files ORDER BY path').all()
      .map((r: any) => ({ path: r.path, lang: r.lang, loc: r.loc | 0, fns: r.fn_count | 0, content: r.content || '' }));
    const symbols: LensSymbol[] = db.prepare('SELECT name, path, line, kind FROM symbols ORDER BY name').all()
      .map((r: any) => ({ name: r.name, path: r.path, line: r.line | 0, kind: r.kind || 'function' }));
    return { files, symbols, dbPath, backend: 'sqlite' };
  } finally {
    try { db.close(); } catch { /* best effort */ }
  }
}

function readSqlcmdJson(server: string, database: string, query: string): any[] {
  const out = execFileSync('sqlcmd', ['-S', server, '-d', database, '-E', '-W', '-h', '-1', '-y', '0', '-Y', '0', '-Q', `SET NOCOUNT ON; ${query}`], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  }).trim();
  const json = out.replace(/\r?\n/g, '').trim();
  if (!json) { return []; }
  return JSON.parse(json);
}

function decodeSqlHexText(hex: unknown): string {
  if (typeof hex !== 'string' || !hex) { return ''; }
  try { return Buffer.from(hex, 'hex').toString('utf8'); }
  catch { return ''; }
}

function readMssqlLensStore(): LensStore | null {
  const cfg = getConfig();
  const label = mssqlLensStoreLabel();
  const fileQuery = `
IF OBJECT_ID('dbo.LensSource') IS NOT NULL
BEGIN
  SELECT TOP (500) path, ISNULL(NULLIF(ext,''),'txt') AS lang, line_count AS loc, CAST(0 AS int) AS fn_count, CONVERT(varchar(max), DECOMPRESS(content_gz), 2) AS content_hex FROM dbo.LensSource ORDER BY path FOR JSON PATH
END
ELSE IF OBJECT_ID('dbo.LensCorpusFile') IS NOT NULL
BEGIN
  SELECT TOP (500) path, ISNULL(NULLIF(lang,''),'txt') AS lang, loc, function_count AS fn_count, CAST('' AS nvarchar(max)) AS content FROM dbo.LensCorpusFile ORDER BY path FOR JSON PATH
END
ELSE
BEGIN
  SELECT CAST('' AS nvarchar(4000)) AS path, CAST('txt' AS nvarchar(32)) AS lang, CAST(0 AS int) AS loc, CAST(0 AS int) AS fn_count, CAST('' AS nvarchar(max)) AS content WHERE 1=0 FOR JSON PATH
END`;
  const symbolQuery = `
IF OBJECT_ID('dbo.LensSymbol') IS NOT NULL
BEGIN
  SELECT TOP (2000) name, path, start_line AS line, kind FROM dbo.LensSymbol ORDER BY name FOR JSON PATH
END
ELSE
BEGIN
  SELECT CAST('' AS nvarchar(4000)) AS name, CAST('' AS nvarchar(4000)) AS path, CAST(0 AS int) AS line, CAST('symbol' AS nvarchar(64)) AS kind WHERE 1=0 FOR JSON PATH
END`;
  const files = readSqlcmdJson(cfg.mssqlServer, cfg.mssqlDatabase, fileQuery)
    .map((r: any) => ({ path: r.path, lang: r.lang || 'txt', loc: r.loc | 0, fns: r.fn_count | 0, content: r.content || decodeSqlHexText(r.content_hex) }));
  const symbols = readSqlcmdJson(cfg.mssqlServer, cfg.mssqlDatabase, symbolQuery)
    .map((r: any) => ({ name: r.name, path: r.path, line: r.line | 0, kind: r.kind || 'symbol' }));
  return { files, symbols, dbPath: label, backend: 'mssql' };
}

function readLensStore(): LensStore | null {
  const cfg = getConfig();
  if (cfg.storageBackend === 'sqlite') { return readSqliteLensStore(); }
  if (cfg.storageBackend === 'mssql') { return readMssqlLensStore(); }
  const sqlite = readSqliteLensStore();
  if (sqlite && (sqlite.files.length || sqlite.symbols.length)) { return sqlite; }
  try {
    const mssql = readMssqlLensStore();
    if (mssql && (mssql.files.length || mssql.symbols.length)) { return mssql; }
  } catch { /* auto mode: SQL Server is optional */ }
  return sqlite;
}

async function cmdLookingGlass(ctx: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'krit-scxcode-looking-glass',
    'Kritical Lens — Looking Glass',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = lookingGlassHtml();
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'lensQuery') {
      try {
        const store = readLensStore();
        if (!store) {
          const cfg = getConfig();
          panel.webview.postMessage({ type: 'lensEmpty', reason: 'missing', dbPath: cfg.storageBackend === 'mssql' ? mssqlLensStoreLabel() : sqliteLensStorePath(), backend: cfg.storageBackend });
          return;
        }
        if (!store.files.length && !store.symbols.length) {
          panel.webview.postMessage({ type: 'lensEmpty', reason: 'empty', dbPath: store.dbPath, backend: store.backend });
          return;
        }
        panel.webview.postMessage({ type: 'lensData', files: store.files, symbols: store.symbols, dbPath: store.dbPath, backend: store.backend });
      } catch (e) {
        const cfg = getConfig();
        panel.webview.postMessage({ type: 'lensError', error: (e as Error).message, dbPath: cfg.storageBackend === 'mssql' ? mssqlLensStoreLabel() : sqliteLensStorePath(), backend: cfg.storageBackend });
      }
    }
  });
}

function lookingGlassHtml(): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  return LOOKING_GLASS_HTML.replace(/%%NONCE%%/g, nonce);
}

function chatHtml(): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Kritical SCXCode</title>
<style nonce="${nonce}">
:root {
  /* Canonical Kritical brand palette per Kritical-Branding/public/brand-spec.json (2026-06-25).
     Supersedes earlier #F2B500 gold — brand-spec confirmed secondary = #15AFD1 cyan. */
  --kr-primary: #13365C;
  --kr-accent: #15AFD1;
  --kr-user-bg: #15AFD1;
  --kr-bg: var(--vscode-editor-background, #1e1e1e);
  --kr-fg: var(--vscode-editor-foreground, #e5e5e5);
  --kr-panel: var(--vscode-editorWidget-background, #252526);
  --kr-border: var(--vscode-panel-border, #3e3e42);
  --kr-danger: #D72638;
  --kr-mono: var(--vscode-editor-font-family, ui-monospace, Consolas, monospace);
}
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family, system-ui, sans-serif); margin: 0; background: var(--kr-bg); color: var(--kr-fg); font-size: var(--vscode-font-size, 13px); display: flex; flex-direction: column; height: 100vh; }
.top { background: var(--kr-primary); color: #fff; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid var(--kr-accent); flex-shrink: 0; }
.top .brand { font-weight: 600; letter-spacing: 0.3px; display: flex; align-items: center; gap: 6px; }
.top .brand::before { content: '◆'; color: var(--kr-accent); font-size: 14px; }
.model-select { margin-left: auto; max-width: 210px; background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 3px; font-size: 11px; padding: 2px 4px; font-family: var(--kr-mono); }
.top .clear-btn { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 3px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.top .clear-btn:hover { background: rgba(255,255,255,0.15); }
.tagline { background: var(--kr-primary); color: rgba(255,255,255,0.82); font-size: 10px; padding: 0 12px 6px; font-style: italic; flex-shrink: 0; }
.controls { display: flex; gap: 12px; align-items: center; padding: 5px 12px; background: var(--kr-panel); border-bottom: 1px solid var(--kr-border); flex-wrap: wrap; flex-shrink: 0; }
.controls label { font-size: 11px; opacity: 0.85; display: flex; gap: 4px; align-items: center; }
.controls select, .adv select, .adv input { background: var(--kr-bg); color: var(--kr-fg); border: 1px solid var(--kr-border); border-radius: 3px; font-size: 11px; padding: 1px 3px; }
/* .5228 — Windows/Chromium renders native <option> popups with OS list colors (white bg), which produced
   white-on-white unreadable text that only appeared on hover. Force VS Code dropdown/list theme colors so
   every option is readable in the closed control AND the open popup, in any theme. */
select option, .model-select option { background: var(--vscode-dropdown-listBackground, var(--vscode-editorWidget-background, #252526)); color: var(--vscode-dropdown-foreground, var(--vscode-editor-foreground, #e5e5e5)); }
select option:checked { background: var(--vscode-list-activeSelectionBackground, #094771); color: var(--vscode-list-activeSelectionForeground, #ffffff); }
/* the closed model-select sits on the navy header; give it explicit dark-on-light so its own text never
   collapses into the header when a light theme flips --vscode vars. */
.model-select:focus { outline: 1px solid var(--kr-accent); }
.adv-btn { margin-left: auto; background: transparent; border: 1px solid var(--kr-border); color: var(--kr-fg); border-radius: 3px; cursor: pointer; padding: 1px 7px; font-size: 12px; }
.adv-btn:hover, .adv-btn.on { border-color: var(--kr-accent); color: var(--kr-accent); }
.adv { display: none; gap: 14px; align-items: center; padding: 5px 12px; background: var(--kr-panel); border-bottom: 1px solid var(--kr-border); flex-shrink: 0; }
.adv.open { display: flex; }
.adv label { font-size: 11px; display: flex; gap: 6px; align-items: center; }
.toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.tool-btn { background: var(--kr-bg); color: var(--kr-fg); border: 1px solid var(--kr-border); border-radius: 3px; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.tool-btn:hover { border-color: var(--kr-accent); }
.ctx-chip { font-size: 10px; opacity: 0.7; font-family: var(--kr-mono); margin-left: auto; }
#chat { padding: 12px; overflow-y: auto; flex: 1 1 auto; }
.msg { padding: 8px 10px; margin: 6px 0; border-radius: 5px; max-width: 92%; word-wrap: break-word; }
.msg.user { background: var(--kr-user-bg); color: #ffffff; margin-left: auto; }
.msg.assistant { background: var(--kr-panel); color: var(--kr-fg); border: 1px solid var(--kr-border); }
.msg.error { background: var(--kr-danger); color: #fff; }
.msg.assistant pre { background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; font-family: var(--kr-mono); font-size: 12px; position: relative; }
.msg.assistant code { font-family: var(--kr-mono); background: rgba(255,255,255,0.05); padding: 0 3px; border-radius: 2px; }
.msg.assistant pre code { background: transparent; padding: 0; }
.scx-status { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 4px 10px; opacity: 0.85; border-bottom: 1px solid var(--kr-border); background: rgba(21,175,209,0.04); }
.scx-status .dot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
.scx-status .dot.on { background: #42c26b; box-shadow: 0 0 6px #42c26b88; }
.scx-status .dot.off { background: #e3b341; }
.scx-status .cap { color: var(--kr-accent); }
.msg.attach { background: transparent; border: 1px solid var(--kr-border); border-left: 3px solid var(--kr-accent); padding: 0; max-width: 100%; overflow: hidden; }
.attach-head { padding: 7px 10px; cursor: pointer; font-size: 12px; user-select: none; display: flex; align-items: center; gap: 5px; }
.attach-head:hover { background: rgba(255,255,255,0.03); }
.attach-caret { color: var(--kr-accent); font-size: 10px; width: 10px; display: inline-block; }
.attach-hint { margin-left: auto; opacity: 0.5; font-size: 10px; }
.attach-body { display: none; padding: 4px 10px 8px; border-top: 1px solid var(--kr-border); max-height: 420px; overflow: auto; }
.attach-body.open { display: block; }
.attach-body pre { background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; font-family: var(--kr-mono); font-size: 12px; position: relative; }
.attach-body code { font-family: var(--kr-mono); background: rgba(255,255,255,0.05); padding: 0 3px; border-radius: 2px; }
.attach-body pre code { background: transparent; padding: 0; }
.attach-body .copy-btn { position: absolute; top: 4px; right: 4px; font-size: 10px; opacity: 0.6; cursor: pointer; background: var(--kr-panel); border: 1px solid var(--kr-border); color: var(--kr-fg); border-radius: 3px; padding: 1px 5px; }
.copy-btn { position: absolute; top: 4px; right: 4px; background: var(--kr-primary); color: #fff; border: 0; padding: 2px 6px; font-size: 10px; border-radius: 3px; cursor: pointer; opacity: 0.7; }
.copy-btn:hover { opacity: 1; }
.meta { font-size: 10px; opacity: 0.65; margin-top: 4px; font-family: var(--kr-mono); }
.error-actions { margin-top: 6px; display: flex; gap: 6px; }
.error-actions button { background: #fff; color: var(--kr-danger); border: 0; padding: 3px 10px; font-size: 11px; border-radius: 3px; cursor: pointer; font-weight: 600; }
.input { padding: 8px 12px; background: var(--kr-panel); border-top: 1px solid var(--kr-border); display: flex; flex-direction: column; flex-shrink: 0; }
.input-row { display: flex; gap: 6px; }
.input textarea { flex: 1; padding: 6px 8px; border: 1px solid var(--kr-border); border-radius: 4px; font-family: var(--vscode-font-family); font-size: 13px; background: var(--kr-bg); color: var(--kr-fg); resize: none; min-height: 38px; max-height: 200px; }
.input button.send { padding: 6px 14px; background: var(--kr-primary); color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-weight: 500; }
.input button.send:hover { background: #1a4574; }
.input button.send:disabled { opacity: 0.5; cursor: not-allowed; }
.footer { position: fixed; bottom: 0; right: 12px; font-size: 10px; opacity: 0.4; padding: 2px 6px; font-family: var(--kr-mono); pointer-events: none; }
.spinner { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--kr-accent); animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
</style></head><body>
<div class="top">
  <div class="brand">Kritical SCXCode</div>
  <select class="model-select" id="model" title="SCX model"></select>
  <button class="clear-btn" id="clear" title="Clear chat">Clear</button>
</div>
<div class="tagline">The IT &amp; IT Security Experts — if it's too hard for everyone else, just give us a call.</div>
<div class="controls">
  <label title="Response length cap (max output tokens): Short 800 · Medium 1500 · Long 4096 · Maximum 8192.">Length <select id="len"><option value="800">Short</option><option value="1500">Medium</option><option value="4096">Long</option><option value="8192">Maximum</option></select></label>
  <label title="Concurrent SCX 'lens' streams to fan out and synthesise (synthetic-context muxing). 1 = single reply; higher = more voices merged into one answer, costs more tokens.">Streams <select id="streams"><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="6">6</option><option value="8">8</option></select></label>
  <label title="How much editor context is auto-attached to each message. Off = none · File = the whole active file · File + Selection = the active file plus your highlighted selection (Sel) · Workspace = a workspace file tree summary.">Context <select id="ctx"><option value="off">Off</option><option value="file">File</option><option value="file+selection">File + Selection</option><option value="workspace-tree">Workspace</option></select></label>
  <button class="adv-btn" id="advBtn" title="Advanced options">⚙</button>
</div>
<div class="adv" id="adv">
  <label title="Sampling temperature (SCX OpenAI-compatible safe range 0–1). The source marker shows whether this is the model's published recommendation (rec), a neutral default when none is published (def), the live API value (api), or your manual override (you).">Temp <input type="range" id="temp" min="0" max="1" step="0.05" value="0.7"><span id="tempVal">0.7</span> <span id="tempSrc" style="opacity:0.6;font-size:10px;"></span></label>
  <label>Provider <select id="provider"><option value="auto">Auto (SCX→Claude CLI)</option><option value="scx-native">SCX only</option><option value="claude-code-cli">Claude CLI only</option></select></label>
</div>
<div class="scx-status" id="scxStatus" title="Live SCX connection status">
  <span class="dot" id="scxDot"></span><span id="scxStatusText">connecting…</span>
</div>
<div id="chat"></div>
<div class="input">
  <div class="toolbar">
    <button class="tool-btn" id="tbFiles" title="Attach one or more FILES from your machine (multi-select). Their real contents are read into the next message.">📄 Files</button>
    <button class="tool-btn" id="tbFolder" title="Attach a FOLDER from your machine (read recursively; node_modules/.git skipped). Real file contents are read into the next message.">📁 Folder</button>
    <button class="tool-btn" id="tbRepo" title="Attach a summary of the open workspace's files">🗂 Repo</button>
    <button class="tool-btn" id="tbMcp" title="MCP servers &amp; tools">🔌 MCP</button>
    <button class="tool-btn" id="tbCodex" title="Open SCX Codex (Kritical/SCX-branded Codex CLI) in a terminal — never touches your real codex config">✦ SCX Codex</button>
    <span class="ctx-chip" id="ctxChip"></span>
  </div>
  <div class="input-row">
    <textarea id="in" placeholder="Ask anything… (Shift+Enter for newline)"></textarea>
    <button class="send" id="send">Send</button>
  </div>
</div>
<script nonce="${nonce}">
// .5227 — tolerate running outside the VS Code host (static render / visual test harness): never hard-crash.
const vscode = (typeof acquireVsCodeApi !== 'undefined') ? acquireVsCodeApi() : { postMessage: function () {}, getState: function () {}, setState: function () {} };
const chat = document.getElementById('chat');
const input = document.getElementById('in');
const send = document.getElementById('send');
const modelEl = document.getElementById('model');
// .5227 — PRESEED the model dropdown at load so it is NEVER blank, even before the host sends
// the (possibly live) model list. The config message then replaces these with the authoritative list.
(${JSON.stringify(getModelCatalog())}).forEach(function (mo) { var o = document.createElement('option'); o.value = mo.id; o.textContent = mo.id + (mo.detail ? ' — ' + mo.detail : ''); modelEl.appendChild(o); });
const clearBtn = document.getElementById('clear');
let sessionInTokens = 0;
let sessionOutTokens = 0;

// Minimal markdown → HTML: fenced code, inline code, bold, italic, links, line breaks.
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderMarkdown(text) {
  const parts = [];
  const codeBlockRe = /\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g;
  let lastIndex = 0, m;
  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push({ kind: 'text', body: text.slice(lastIndex, m.index) });
    parts.push({ kind: 'code', lang: m[1] || '', body: m[2] });
    lastIndex = codeBlockRe.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ kind: 'text', body: text.slice(lastIndex) });
  const html = parts.map(p => {
    if (p.kind === 'code') {
      const id = 'c' + Math.random().toString(36).slice(2, 8);
      return '<pre><button class="copy-btn" data-copy="' + id + '">copy</button><code id="' + id + '" data-lang="' + esc(p.lang) + '">' + esc(p.body) + '</code></pre>';
    }
    return esc(p.body)
      .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>')
      .replace(/\\[([^\\]]+)\\]\\(([^\\)]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\\n/g, '<br/>');
  }).join('');
  return html;
}

function add(role, text, meta, opts) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant') {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  if (meta) {
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = meta;
    div.appendChild(m);
  }
  if (opts && opts.showKeySwitch) {
    const actions = document.createElement('div');
    actions.className = 'error-actions';
    const btn = document.createElement('button');
    btn.textContent = 'Switch SCX key';
    btn.onclick = () => vscode.postMessage({ type: 'switchKey' });
    actions.appendChild(btn);
    div.appendChild(actions);
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  // Wire copy buttons for any newly-rendered code blocks
  div.querySelectorAll('.copy-btn').forEach(b => {
    b.onclick = () => {
      const target = document.getElementById(b.dataset.copy);
      if (target) navigator.clipboard.writeText(target.textContent);
      b.textContent = 'copied ✓';
      setTimeout(() => (b.textContent = 'copy'), 1500);
    };
  });
}

// .5231 — web-rendered local file preview: a collapsible card that renders the attached file
// contents (syntax-fenced code + copy buttons) right in the panel, using the local machine's files.
function addAttachPreview(name, chars, preview) {
  const div = document.createElement('div');
  div.className = 'msg attach';
  const head = document.createElement('div');
  head.className = 'attach-head';
  head.innerHTML = '<span class="attach-caret">▸</span> 📎 <strong>' + esc(name) + '</strong> · ' + chars + ' chars <span class="attach-hint">click to preview</span>';
  const body = document.createElement('div');
  body.className = 'attach-body';
  body.innerHTML = renderMarkdown(preview);
  head.onclick = () => {
    const open = body.classList.toggle('open');
    head.querySelector('.attach-caret').textContent = open ? '▾' : '▸';
  };
  div.appendChild(head); div.appendChild(body);
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
  body.querySelectorAll('.copy-btn').forEach(b => {
    b.onclick = () => { const t = document.getElementById(b.dataset.copy); if (t) navigator.clipboard.writeText(t.textContent); b.textContent = 'copied ✓'; setTimeout(() => (b.textContent = 'copy'), 1500); };
  });
}

// .5213 UI wave — control elements + wiring. Each change persists to config via the host.
const lenEl = document.getElementById('len');
const streamsEl = document.getElementById('streams');
const ctxEl = document.getElementById('ctx');
const tempEl = document.getElementById('temp');
const tempVal = document.getElementById('tempVal');
const providerEl = document.getElementById('provider');
const advBtn = document.getElementById('advBtn');
const advPanel = document.getElementById('adv');
const ctxChip = document.getElementById('ctxChip');
// .5228 — per-model temperature defaults + SOURCE (embedded at render). Selecting a model snaps the
// slider to its default UNLESS the operator overrode temperature this session. The source marker tells
// the operator whether the value is a published recommendation, a neutral default, or from the live API.
const _modelTemps = ${JSON.stringify(Object.fromEntries(getModelCatalog().map((m) => [m.id, m.temp])))};
const _modelTempSrcs = ${JSON.stringify(Object.fromEntries(getModelCatalog().map((m) => [m.id, m.tempSrc || 'def'])))};
const _tempFallback = ${SCX_TEMP_FALLBACK};
const _tempSrcLabel = { rec: 'recommended', def: 'neutral default', api: 'from API' };
const tempSrcEl = document.getElementById('tempSrc');
let _tempUserSet = false;
function _applyModelTemp(id, post) {
  if (_tempUserSet) { if (tempSrcEl) tempSrcEl.textContent = '(your override)'; return; }  // respect operator override
  var t = (_modelTemps && typeof _modelTemps[id] === 'number') ? _modelTemps[id] : _tempFallback;
  var s = (_modelTempSrcs && _modelTempSrcs[id]) ? _modelTempSrcs[id] : 'def';
  tempEl.value = String(t); tempVal.textContent = String(t);
  if (tempSrcEl) tempSrcEl.textContent = '(' + (_tempSrcLabel[s] || 'default') + ')';
  if (post) vscode.postMessage({ type: 'setConfig', key: 'temperature', value: t });
}
modelEl.onchange = () => { vscode.postMessage({ type: 'setConfig', key: 'defaultModel', value: modelEl.value }); _applyModelTemp(modelEl.value, true); };
lenEl.onchange = () => vscode.postMessage({ type: 'setConfig', key: 'maxTokens', value: parseInt(lenEl.value, 10) });
streamsEl.onchange = () => vscode.postMessage({ type: 'setConfig', key: 'concurrency', value: parseInt(streamsEl.value, 10) });
ctxEl.onchange = () => vscode.postMessage({ type: 'setConfig', key: 'autoContext', value: ctxEl.value });
providerEl.onchange = () => vscode.postMessage({ type: 'setConfig', key: 'provider', value: providerEl.value });
tempEl.oninput = () => { tempVal.textContent = tempEl.value; };
tempEl.onchange = () => { _tempUserSet = true; vscode.postMessage({ type: 'setConfig', key: 'temperature', value: parseFloat(tempEl.value) }); };
advBtn.onclick = () => { advPanel.classList.toggle('open'); advBtn.classList.toggle('on'); };
document.getElementById('tbFiles').onclick = () => vscode.postMessage({ type: 'uploadFile' });
document.getElementById('tbFolder').onclick = () => vscode.postMessage({ type: 'uploadFolder' });
document.getElementById('tbRepo').onclick = () => vscode.postMessage({ type: 'attachRepo' });
document.getElementById('tbMcp').onclick = () => vscode.postMessage({ type: 'listMcp' });
document.getElementById('tbCodex').onclick = () => vscode.postMessage({ type: 'scxCodex' });
clearBtn.onclick = () => {
  chat.innerHTML = '';
  sessionInTokens = 0; sessionOutTokens = 0;
  vscode.postMessage({ type: 'clear' });
};

send.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  add('user', text);
  input.value = '';
  send.disabled = true;
  vscode.postMessage({ type: 'chat', text });
};
input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); }
};

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'reply') {
    sessionInTokens += (m.tokensIn || 0);
    sessionOutTokens += (m.tokensOut || 0);
    const keyLabel = m.keyIndex > 1 ? ' · key' + m.keyIndex : '';
    const ctxLabel = m.autoContextChars > 0 ? ' · ctx ' + m.autoContextChars + 'c' : '';
    const compactLabel = m.compactedTurns > 0 ? ' · flushed ' + m.compactedTurns + ' old turns' : '';
    const muxLabel = m.shards > 1 ? ' · 🔀 ' + m.shards + '-stream synthesis' : '';
    add('assistant', m.text, m.model + keyLabel + muxLabel + ' · ' + m.tokensIn + '⇢' + m.tokensOut + ' tok' + ctxLabel + compactLabel + ' · session ' + sessionInTokens + '⇢' + sessionOutTokens);
    if (m.model) modelEl.value = m.model;
    send.disabled = false;
  } else if (m.type === 'error') {
    const is429 = /429|rate.limit|Daily token limit/i.test(m.error);
    add('error', m.error, null, { showKeySwitch: is429 });
    send.disabled = false;
  } else if (m.type === 'cleared') {
    // no-op — chat already cleared client-side
  } else if (m.type === 'ready') {
    vscode.postMessage({ type: 'config' });
  } else if (m.type === 'config') {
    if (Array.isArray(m.models) && m.models.length) {
      modelEl.innerHTML = '';
      m.models.forEach(function (mo) { var o = document.createElement('option'); o.value = mo.id; o.textContent = mo.id + (mo.detail ? ' — ' + mo.detail : ''); modelEl.appendChild(o); });
    }
    if (m.model) modelEl.value = m.model;
    if (typeof m.maxTokens === 'number') lenEl.value = String(m.maxTokens);
    if (typeof m.concurrency === 'number') streamsEl.value = String(m.concurrency);
    if (m.autoContext) ctxEl.value = m.autoContext;
    if (m.provider) providerEl.value = m.provider;
    // .5227 — load respects the persisted temperature; per-model snapping happens on interactive model change.
    if (typeof m.temperature === 'number') { tempEl.value = String(m.temperature); tempVal.textContent = String(m.temperature); }
    if (m.keyCount > 1) modelEl.title = 'SCX model · ' + m.keyCount + ' keys available';
    // .5231 — connection / capability status strip
    var _dot = document.getElementById('scxDot'), _st = document.getElementById('scxStatusText');
    if (_st) {
      var host = (m.baseUrl || '').replace(/^https?:\\/\\//, '') || 'SCX';
      var connected = !!m.apiKeySet;
      _dot.className = 'dot ' + (connected ? 'on' : 'off');
      var keyN = m.keyCount || 1;
      _st.innerHTML = (connected ? '● SCX connected' : '○ SCX key not set') + ' · ' + host + ' · ' + esc(m.model || '') +
        ' · ' + keyN + ' key' + (keyN > 1 ? 's' : '') +
        ' · <span class="cap">' + (m.mcpCount || 0) + ' MCP</span>' +
        ' · <span class="cap">edits files ✓</span>' +
        ' · <span class="cap">agentic via SCX Codex ✓</span>';
    }
  } else if (m.type === 'fileAttached') {
    ctxChip.textContent = '📎 ' + m.name + ' (' + m.chars + 'c)';
    if (m.preview) { addAttachPreview(m.name, m.chars, m.preview); }
  } else if (m.type === 'notice') {
    add('assistant', m.text);
  } else if (m.type === 'keySwitched') {
    add('assistant', '_🔑 Switched to key #' + m.newKeyIndex + ' — retry your last message._');
    send.disabled = false;
  }
});

// .5210 RACE FIX — the extension posts {type:'ready'} from resolveWebviewView, but that can
// fire before this script's message listener attaches, dropping it → the model badge stayed
// stuck on its hardcoded default. Request config ourselves on load so the badge always reflects
// the real defaultModel (and the '…' placeholder resolves).
vscode.postMessage({ type: 'config' });
</script>
<div class="footer">© 2026 Kritical Pty Ltd · Kritical SCXCode</div>
</body></html>`;
}

// ────────────────────────────────────────────────────────────────
// activation
// ────────────────────────────────────────────────────────────────

// .5165g — Sidebar WebviewViewProvider so the activity-bar view actually
// renders the chat panel (not just an empty container).
class KriticalChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kritical.scxcode.chat';
  private _view?: vscode.WebviewView;
  private _history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private _attached = ''; // .5213 — uploaded-file / attached-repo context prepended to the next message

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = chatHtml();
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'chat') {
        this._history.push({ role: 'user', content: msg.text });
        try {
          // Prepend auto-context from the active editor + any attached file/repo context.
          const ctx = buildAutoContext() + this._attached;
          const cfg = getConfig();
          const compacted = compactMessagesForSend(this._history, cfg.defaultModel, ctx.length);
          const messagesForApi: ScxMessage[] = [...compacted.messages];
          if (ctx && messagesForApi.length > 0) {
            messagesForApi[messagesForApi.length - 1] = {
              role: 'user',
              content: ctx + msg.text,
            };
          }
          this._attached = ''; // consumed
          const { res, modelUsed, keyIndex, shards } = await scxMux(messagesForApi, cfg.concurrency, cfg.maxTokens);
          const replyText = res.content.map((c) => c.text).join('');
          if (compacted.compactedTurns > 0) {
            this._history = [...compacted.messages];
          }
          this._history.push({ role: 'assistant', content: replyText });
          view.webview.postMessage({
            type: 'reply',
            text: replyText,
            model: modelUsed,
            keyIndex,
            shards,
            tokensIn: res.usage.input_tokens,
            tokensOut: res.usage.output_tokens,
            autoContextChars: ctx.length,
            compactedTurns: compacted.compactedTurns,
          });
        } catch (e) {
          // .5231 (bughunt-confirmed) — pop the orphaned user turn so a failed send doesn't leave two
          // consecutive user roles → next send 400s "roles must alternate" and bricks the conversation.
          if (this._history.length && this._history[this._history.length - 1].role === 'user') this._history.pop();
          view.webview.postMessage({ type: 'error', error: (e as Error).message });
        }
      } else if (msg.type === 'clear') {
        this._history = [];
        view.webview.postMessage({ type: 'cleared' });
      } else if (msg.type === 'pickModel') {
        vscode.commands.executeCommand('kritical.scxcode.pickModel');
      } else if (msg.type === 'switchKey') {
        // Rotate to the next healthy SCX key file via the PS helper OR by
        // walking through SCX_API_KEY_2..SCX_API_KEY_9 promoting the next.
        try {
          const cfg = getConfig();
          if (cfg.apiKeys.length < 2) {
            view.webview.postMessage({ type: 'error', error: 'Only one SCX key available (SCX_API_KEY). Set SCX_API_KEY_2..9 in HKCU or run Switch-KritScxKey.' });
            return;
          }
          // .5231 (bughunt-confirmed) — advance the rotation pointer ONLY. getConfig() now rotates the
          // stable key list by _keyRotation, so we must NOT mutate process.env.SCX_API_KEY (that re-dedup
          // dropped the promoted key and shrank the set). Pointer advance = next key becomes primary.
          _keyRotation = (_keyRotation + 1) % cfg.apiKeys.length;
          saveKeyRotation(_keyRotation);   // .5231b (re-hunt) — persist so the selection survives restart
          view.webview.postMessage({ type: 'keySwitched', newKeyIndex: _keyRotation + 1 });
        } catch (e) {
          view.webview.postMessage({ type: 'error', error: 'Key switch failed: ' + (e as Error).message });
        }
      } else if (msg.type === 'setConfig') {
        try {
          await vscode.workspace.getConfiguration('kritical.scxcode').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        } catch (e) {
          view.webview.postMessage({ type: 'error', error: 'Setting update failed: ' + (e as Error).message });
        }
      } else if (msg.type === 'uploadFile' || msg.type === 'uploadFolder') {
        const folder = msg.type === 'uploadFolder';
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: !folder, canSelectFiles: !folder, canSelectFolders: folder,
          openLabel: folder ? 'Attach this folder to SCXCode' : 'Attach file(s) to SCXCode',
          title: folder ? 'Select a folder (read recursively)' : 'Select one or more files',
          defaultUri: getAttachmentDialogDefaultUri(),
        });
        if (picked && picked.length) {
          const { block, fileCount, chars } = await collectAttachments(picked);
          if (fileCount) { this._attached += block; view.webview.postMessage({ type: 'fileAttached', name: folder ? `folder · ${fileCount} file(s)` : `${fileCount} file(s)`, chars, preview: block.length > 12000 ? block.slice(0, 12000) + '\n\n_… preview truncated; the full contents are attached to your next message._' : block }); }
          else { view.webview.postMessage({ type: 'error', error: folder ? 'No readable text files in that folder.' : 'No readable text files selected.' }); }
        }
      } else if (msg.type === 'attachRepo') {
        // .5231 — attach the ACTUAL open workspace repo (real file contents), not just a path list.
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || !folders.length) {
          view.webview.postMessage({ type: 'error', error: 'No workspace folder is open — open your repo folder in VS Code (File → Open Folder), then click Repo.' });
        } else {
          const { block, fileCount, chars } = await collectAttachments(folders.map((f) => f.uri));
          if (fileCount) { this._attached += block; view.webview.postMessage({ type: 'fileAttached', name: `repo · ${fileCount} file(s)`, chars, preview: block.length > 12000 ? block.slice(0, 12000) + '\n\n_… preview truncated; the full repo contents are attached to your next message._' : block }); }
          else { view.webview.postMessage({ type: 'error', error: 'No readable text files found in the workspace.' }); }
        }
      } else if (msg.type === 'listMcp') {
        vscode.commands.executeCommand('kritical.scxcode.setupGui');   // .5229 — open the real MCP/Codex setup GUI
      } else if (msg.type === 'scxCodex') {
        vscode.commands.executeCommand('kritical.scxcode.scxCodex');
      } else if (msg.type === 'config') {
        const cfg = getConfig();
        let mcpCount = 0; try { mcpCount = Object.keys(readCodexConfig().mcp_servers || {}).length; } catch { /* none */ }
        view.webview.postMessage({
          type: 'config',
          model: cfg.defaultModel,
          models: getModelCatalog(),
          keyCount: cfg.apiKeys.length,
          autoContext: cfg.autoContext,
          maxTokens: cfg.maxTokens,
          concurrency: cfg.concurrency,
          temperature: cfg.temperature,
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          apiKeySet: !!cfg.apiKey,
          mcpCount,
        });
      }
    });
    view.webview.postMessage({ type: 'ready' });
  }
}

// .5228 — SCX CODEX inside VS Code (the recurring "where is SCX Codex in the plugin" ask).
// Opens an integrated terminal running the Kritical/SCX-branded Codex wrapper. The wrapper is HR29-safe
// (reads SCX_API_KEY from HKCU, routes via the local LiteLLM proxy, restores env on exit) — it NEVER
// touches the operator's real `codex` config, so this coexists with a plain `codex` install.
function resolveCodexWrapper(context: vscode.ExtensionContext): string | null {
  const override = vscode.workspace.getConfiguration('kritical.scxcode').get<string>('codexWrapperPath', '');
  const candidates: string[] = [];
  if (override) { candidates.push(override); }
  for (const f of vscode.workspace.workspaceFolders || []) {
    candidates.push(path.join(f.uri.fsPath, 'codex-wrapper', 'kritical-codex.ps1'));
    candidates.push(path.join(f.uri.fsPath, 'Kritical.SCXCode', 'codex-wrapper', 'kritical-codex.ps1'));
  }
  candidates.push(path.join(context.extensionPath, 'codex-wrapper', 'kritical-codex.ps1'));
  // last resort: the known repo location on this machine
  candidates.push(path.join(process.env.USERPROFILE || '', 'OneDrive - Kritical Pty Ltd', 'Github', 'Kritical.SCXCode', 'codex-wrapper', 'kritical-codex.ps1'));
  for (const c of candidates) { try { if (c && fs.existsSync(c)) { return c; } } catch { /* next */ } }
  return null;
}
function cmdScxCodex(context: vscode.ExtensionContext) {
  const wrapper = resolveCodexWrapper(context);
  if (!wrapper) {
    vscode.window.showWarningMessage(
      'SCX Codex wrapper (kritical-codex.ps1) not found. Set "kritical.scxcode.codexWrapperPath" to its location.',
      'Open Settings',
    ).then((pick) => { if (pick === 'Open Settings') { vscode.commands.executeCommand('workbench.action.openSettings', 'kritical.scxcode.codexWrapperPath'); } });
    return;
  }
  const term = vscode.window.createTerminal({ name: 'SCX Codex', iconPath: new vscode.ThemeIcon('sparkle') });
  // -NoExit keeps the Codex session interactive; the wrapper self-sets/-restores SCX env per HR29.
  term.sendText(`pwsh -NoExit -File "${wrapper}"`, true);
  term.show();
  getOutputChannel().appendLine('SCX Codex launched via ' + wrapper);
}
// .5228 — honest sideload "update" path. A VSIX installed from disk cannot use VS Code's marketplace
// auto-update; this command finds the newest built SCXCode-*.vsix next to the extension/repo, compares
// it to the running version, and offers to install it.
function cmdCheckUpdate(context: vscode.ExtensionContext) {
  const running = (() => { try { return JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
  const searchDirs = [context.extensionPath];
  for (const f of vscode.workspace.workspaceFolders || []) {
    searchDirs.push(path.join(f.uri.fsPath, 'src'));
    searchDirs.push(path.join(f.uri.fsPath, 'Kritical.SCXCode', 'src'));
  }
  searchDirs.push(path.join(process.env.USERPROFILE || '', 'OneDrive - Kritical Pty Ltd', 'Github', 'Kritical.SCXCode', 'src'));
  let best: { file: string; ver: string } | null = null;
  const verNum = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const gt = (a: string, b: string) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) { return (x[i] || 0) > (y[i] || 0); } } return false; };
  for (const d of searchDirs) {
    try {
      for (const fn of fs.readdirSync(d)) {
        const m = fn.match(/^SCXCode-(\d+\.\d+\.\d+)\.vsix$/);
        if (m && (!best || gt(m[1], best.ver))) { best = { file: path.join(d, fn), ver: m[1] }; }
      }
    } catch { /* dir missing */ }
  }
  if (!best) { vscode.window.showInformationMessage(`SCXCode ${running} — no newer .vsix found on disk to update from.`); return; }
  if (!gt(best.ver, running)) { vscode.window.showInformationMessage(`SCXCode ${running} is up to date (newest .vsix on disk is ${best.ver}).`); return; }
  vscode.window.showInformationMessage(`SCXCode update available: ${running} → ${best.ver}. Install now?`, 'Install', 'Cancel').then((pick) => {
    if (pick !== 'Install') { return; }
    const term = vscode.window.createTerminal({ name: 'SCXCode Update' });
    term.sendText(`code-insiders --install-extension "${best!.file}" --force`, true);
    term.show();
    vscode.window.showInformationMessage(`Installing SCXCode ${best!.ver}. Reload window when the install completes.`, 'Reload').then((p) => { if (p === 'Reload') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
  });
}

// ==========================================================================
// .5229 — SHARED SETUP GUI. A real end-to-end config screen for MCP servers + SCX Codex options that
// writes the SAME ~/.codex/config.toml the `codex` CLI reads, so configuring here configures Codex too.
// Every write is SURGICAL (merge into the parsed config, keep the operator's plugins/marketplaces/notify)
// and BACKED UP (config.toml.bak-<ts>) before the file is replaced — never clobber a working config.
// ==========================================================================
function codexConfigPath(): string { return path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml'); }
function readCodexConfig(): any {
  try { const p = codexConfigPath(); if (fs.existsSync(p)) { return tomlLib.parse(fs.readFileSync(p, 'utf8')); } } catch { /* return empty on parse error */ }
  return {};
}
function writeCodexConfigSafe(obj: any): { ok: boolean; error?: string; backup?: string } {
  try {
    const p = codexConfigPath();
    const out = tomlLib.stringify(obj as any);
    tomlLib.parse(out); // validate the round-trip before committing
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let backup = '';
    if (fs.existsSync(p)) { backup = p + '.bak-' + Date.now(); fs.copyFileSync(p, backup); }
    const tmp = p + '.tmp'; fs.writeFileSync(tmp, out); fs.renameSync(tmp, p);   // atomic
    return { ok: true, backup };
  } catch (e: any) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}
function probeProxy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = require('http').request({ host: '127.0.0.1', port: 4180, path: '/health/liveliness', method: 'GET', timeout: 1500 }, (r: any) => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); }); req.end();
  });
}
function cmdSetupGui(context: vscode.ExtensionContext, tab?: string) {
  const panel = vscode.window.createWebviewPanel('kriticalScxSetup', 'Kritical SCX — Setup', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const post = (m: any) => panel.webview.postMessage(m);
  function snapshot() {
    const cfg = getConfig();
    const codex = readCodexConfig();
    const mcp = codex.mcp_servers || {};
    return {
      type: 'data', tab: tab || 'codex',
      models: getModelCatalog().map((m) => m.id),
      codex: {
        model: codex.model || '', sandbox_mode: codex.sandbox_mode || 'workspace-write',
        model_reasoning_effort: codex.model_reasoning_effort || 'medium', approval_policy: codex.approval_policy || 'on-request',
        model_reasoning_summary: codex.model_reasoning_summary || 'auto', model_verbosity: codex.model_verbosity || 'medium',
      },
      mcp: Object.keys(mcp).map((name) => ({ name, command: mcp[name].command || '', args: Array.isArray(mcp[name].args) ? mcp[name].args.join(' ') : '', env: mcp[name].env ? JSON.stringify(mcp[name].env) : '' })),
      scxcode: {
        baseUrl: cfg.baseUrl, defaultModel: cfg.defaultModel, apiKeySet: !!cfg.apiKey, keyCount: cfg.apiKeys.length, temperature: cfg.temperature,
        storageBackend: cfg.storageBackend, sqliteStorePath: cfg.sqliteStorePath, sqliteResolvedPath: sqliteLensStorePath(),
        mssqlServer: cfg.mssqlServer, mssqlDatabase: cfg.mssqlDatabase,
        autoContext: cfg.autoContext, autoContextMaxChars: cfg.autoContextMaxChars, concurrency: cfg.concurrency, maxTokens: cfg.maxTokens,
        modelCatalogPath: cfg.modelCatalogPath, modelCatalogResolvedPath: configuredModelCatalogPath(),
      },
      modelCatalog: {
        path: configuredModelCatalogPath(),
        candidates: modelCatalogCandidates(),
        count: readFullModelRows().length,
      },
      codexConfigPath: codexConfigPath(),
    };
  }
  let logoUri = '';
  try { logoUri = 'data:image/png;base64,' + fs.readFileSync(path.join(context.extensionPath, 'media', 'kritical-symbol.png')).toString('base64'); } catch { /* fallback handled in html */ }
  panel.webview.html = setupGuiHtml(logoUri);
  panel.webview.onDidReceiveMessage(async (m) => {
    if (m.type === 'load') { post(snapshot()); probeProxy().then((r) => post({ type: 'proxy', running: r })); }
    else if (m.type === 'saveCodex') {
      const codex = readCodexConfig();
      codex.model = m.model || undefined; codex.sandbox_mode = m.sandbox_mode; codex.model_reasoning_effort = m.reasoning; codex.approval_policy = m.approval;
      codex.model_reasoning_summary = m.summary; codex.model_verbosity = m.verbosity;
      const r = writeCodexConfigSafe(codex); post({ type: 'saved', section: 'codex', ...r });
    } else if (m.type === 'saveMcp') {
      const codex = readCodexConfig();
      const servers: any = {};
      for (const s of (m.servers || [])) {
        if (!s.name) { continue; }
        const entry: any = { command: s.command || '' };
        if (s.args) { entry.args = String(s.args).split(/\s+/).filter(Boolean); }
        if (s.env) { try { entry.env = JSON.parse(s.env); } catch { /* skip bad env json */ } }
        servers[s.name] = entry;
      }
      codex.mcp_servers = servers;
      const r = writeCodexConfigSafe(codex); post({ type: 'saved', section: 'mcp', ...r });
    } else if (m.type === 'saveScxcode') {
      try {
        const c = vscode.workspace.getConfiguration('kritical.scxcode');
        await c.update('baseUrl', m.baseUrl, vscode.ConfigurationTarget.Global);
        await c.update('defaultModel', m.defaultModel, vscode.ConfigurationTarget.Global);
        await c.update('storageBackend', m.storageBackend || 'auto', vscode.ConfigurationTarget.Global);
        await c.update('sqliteStorePath', m.sqliteStorePath || '', vscode.ConfigurationTarget.Global);
        await c.update('mssqlServer', m.mssqlServer || '.\\SQLEXPRESS', vscode.ConfigurationTarget.Global);
        await c.update('mssqlDatabase', m.mssqlDatabase || 'KriticalSCXCodeStore', vscode.ConfigurationTarget.Global);
        await c.update('modelCatalogPath', m.modelCatalogPath || _installModelCatalogPath, vscode.ConfigurationTarget.Global);
        await c.update('autoContext', m.autoContext || 'file+selection', vscode.ConfigurationTarget.Global);
        await c.update('autoContextMaxChars', Number(m.autoContextMaxChars) || 8000, vscode.ConfigurationTarget.Global);
        await c.update('concurrency', Number(m.concurrency) || 1, vscode.ConfigurationTarget.Global);
        await c.update('maxTokens', Number(m.maxTokens) || 1500, vscode.ConfigurationTarget.Global);
        post({ type: 'saved', section: 'scxcode', ok: true });
      } catch (e: any) { post({ type: 'saved', section: 'scxcode', ok: false, error: e.message }); }
    } else if (m.type === 'launchCodex') { vscode.commands.executeCommand('kritical.scxcode.scxCodex'); }
    else if (m.type === 'testProxy') { probeProxy().then((r) => post({ type: 'proxy', running: r })); }
  });
}
function setupGuiHtml(logoUri: string): string {
  const logoTag = logoUri
    ? `<img class="logo" src="${logoUri}" alt="Kritical">`
    : `<svg class="logo" viewBox="0 0 128 128"><rect width="128" height="128" rx="18" fill="#13365C"/><path d="M28 24 L28 104 L44 104 L44 72 L68 104 L88 104 L58 62 L86 24 L66 24 L44 54 L44 24 Z" fill="#fff"/></svg>`;
  // .5231 — pretty pass. HTML5 in-app graphics rendered on the LOCAL GPU/CPU (2D canvas — no external
  // assets, CSP-safe): an animated Southern Cross constellation over a slow starfield (SCX = Southern
  // Cross AI). Glass panels, cyan-glow selectors. Codex "Model" is now a validated dropdown from the SAME
  // model list, defaulting to "(follow chat panel selection)" so SCX Codex tracks the chat model.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--k-navy:#13365C;--k-navy2:#0d2440;--k-cyan:#15AFD1;--k-cyan-dim:#15afd155;--k-ok:#3fb950;--k-err:#d72638;
    --bg:var(--vscode-editor-background,#1e1e1e);--fg:var(--vscode-editor-foreground,#e5e5e5);
    --panel:var(--vscode-editorWidget-background,#252526);--bd:var(--vscode-panel-border,#3e3e42);
    --in-bg:var(--vscode-input-background,#1a1a1a);}
  *{box-sizing:border-box;}
  body{font-family:var(--vscode-font-family,system-ui);background:var(--bg);color:var(--fg);margin:0;font-size:13px;}
  .hero{position:relative;overflow:hidden;background:linear-gradient(135deg,var(--k-navy2),var(--k-navy) 60%,#0a1c33);border-bottom:1px solid var(--k-cyan);}
  .hero canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .hero .inner{position:relative;z-index:2;padding:18px 20px;display:flex;align-items:center;gap:12px;}
  .hero .logo{width:30px;height:30px;border-radius:7px;background:#fff;padding:3px;object-fit:contain;box-shadow:0 0 10px rgba(21,175,209,.4);}
  .hero h1{font-size:16px;margin:0;font-weight:700;letter-spacing:.3px;color:#fff;}
  .hero .sub{font-size:11px;opacity:.7;color:#bfe9f5;margin-top:1px;}
  .pill{margin-left:auto;z-index:2;display:flex;align-items:center;gap:7px;background:#00000040;border:1px solid var(--k-cyan-dim);border-radius:20px;padding:5px 12px;font:11px/1 var(--vscode-editor-font-family,monospace);color:#bfe9f5;}
  .dot{width:8px;height:8px;border-radius:50%;background:#888;box-shadow:0 0 0 0 transparent;}
  .dot.on{background:var(--k-ok);animation:pulse 1.8s infinite;} .dot.off{background:#8a5;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 #3fb95088;}70%{box-shadow:0 0 0 7px #3fb95000;}100%{box-shadow:0 0 0 0 #3fb95000;}}
  .tabs{display:flex;gap:4px;padding:10px 16px 0;background:var(--bg);}
  .tab{padding:8px 16px;cursor:pointer;border:1px solid transparent;border-bottom:none;background:transparent;color:var(--fg);opacity:.7;font-size:12px;border-radius:8px 8px 0 0;transition:.15s;}
  .tab:hover{opacity:1;background:#ffffff08;}
  .tab.active{opacity:1;color:var(--k-cyan);background:var(--panel);border-color:var(--bd);font-weight:600;box-shadow:inset 0 -2px 0 var(--k-cyan);}
  .wrap{padding:16px;max-width:760px;}
  .pane{display:none;} .pane.active{display:block;animation:fade .2s ease;}
  @keyframes fade{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:18px 18px 20px;box-shadow:0 2px 14px #0003;}
  h3{margin:0 0 4px;color:var(--k-cyan);font-size:14px;display:flex;align-items:center;gap:7px;} h3::before{content:'';width:4px;height:15px;background:var(--k-cyan);border-radius:2px;}
  .hint{opacity:.6;font-size:11px;margin:0 0 14px;line-height:1.5;}
  label{display:block;margin:12px 0 4px;font-size:11px;font-weight:600;opacity:.8;text-transform:uppercase;letter-spacing:.4px;}
  input,select,textarea{width:100%;background:var(--in-bg);color:var(--fg);border:1px solid var(--bd);border-radius:7px;padding:8px 10px;font-size:12px;font-family:inherit;transition:.15s;}
  input:focus,select:focus{outline:none;border-color:var(--k-cyan);box-shadow:0 0 0 3px var(--k-cyan-dim);}
  select option{background:var(--vscode-dropdown-listBackground,#252526);color:var(--fg);}
  .note{font-size:10.5px;opacity:.6;margin-top:4px;} .note.warn{color:#e3b341;opacity:.95;}
  .mcp-card{border:1px solid var(--bd);border-radius:10px;padding:12px;margin:10px 0;background:#ffffff05;position:relative;}
  .mcp-card .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;}
  .mcp-card .full{grid-column:1/3;}
  .mcp-card .rm{position:absolute;top:8px;right:8px;background:transparent;border:1px solid var(--bd);color:var(--k-err);border-radius:6px;width:24px;height:24px;cursor:pointer;line-height:1;}
  .mcp-card .rm:hover{background:#d7263822;border-color:var(--k-err);}
  button.save{background:linear-gradient(135deg,var(--k-cyan),#0f8bad);color:#04222c;border:0;border-radius:8px;padding:9px 18px;cursor:pointer;font-weight:700;margin-top:16px;box-shadow:0 2px 10px #15afd140;transition:.15s;}
  button.save:hover{transform:translateY(-1px);box-shadow:0 4px 16px #15afd160;}
  button.add{background:transparent;border:1px dashed var(--k-cyan);color:var(--k-cyan);border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12px;margin-top:6px;}
  button.add:hover{background:var(--k-cyan-dim);}
  .launch{display:inline-flex;align-items:center;gap:7px;background:transparent;border:1px solid var(--k-cyan);color:var(--k-cyan);border-radius:8px;padding:8px 16px;cursor:pointer;margin-top:12px;font-weight:600;}
  .launch:hover{background:var(--k-cyan-dim);}
  .ok{color:var(--k-ok);font-size:11px;margin-left:12px;} .err{color:var(--k-err);font-size:11px;margin-left:12px;}
  .path{font-family:var(--vscode-editor-font-family,monospace);font-size:10px;opacity:.55;word-break:break-all;}
  .foot{padding:10px 18px;font-size:10px;opacity:.5;text-align:center;}
  </style></head><body>
  <div class="hero">
    <canvas id="sky"></canvas>
    <div class="inner">
      ${logoTag}
      <div><h1>Kritical SCX — Setup</h1><div class="sub">Sovereign Australian AI · Southern Cross AI</div></div>
      <div class="pill"><span class="dot" id="pdot"></span><span id="status">checking proxy…</span></div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-t="codex">✦ SCX Codex</button>
    <button class="tab" data-t="mcp">🔌 MCP servers</button>
    <button class="tab" data-t="scxcode">⚙ SCXCode</button>
  </div>
  <div class="wrap">
    <div class="pane active" id="pane-codex"><div class="card">
      <h3>SCX Codex — options</h3>
      <p class="hint">Written to <span class="path" id="cfgpath"></span> — the same file the <code>codex</code> CLI reads. Plugins &amp; marketplaces are preserved; a timestamped backup is made on every save.</p>
      <label>Model</label>
      <select id="cx-model"></select>
      <div class="note" id="cx-model-note">Defaults to <b>(follow chat panel)</b> — SCX Codex uses whatever model your chat panel is on.</div>
      <label>Sandbox mode</label><select id="cx-sandbox"><option>read-only</option><option>workspace-write</option><option>danger-full-access</option></select>
      <label>Reasoning effort</label><select id="cx-reasoning"><option>low</option><option>medium</option><option>high</option><option>xhigh</option></select>
      <label>Reasoning summary</label><select id="cx-summary"><option>auto</option><option>concise</option><option>detailed</option><option>none</option></select>
      <label>Verbosity</label><select id="cx-verbosity"><option>low</option><option>medium</option><option>high</option></select>
      <label>Approval policy</label><select id="cx-approval"><option>untrusted</option><option>on-failure</option><option>on-request</option><option>never</option></select>
      <div><button class="save" id="save-codex">Save Codex options</button><span id="msg-codex"></span></div>
      <div><button class="launch" id="launch">✦ Launch SCX Codex now</button></div>
    </div></div>
    <div class="pane" id="pane-mcp"><div class="card">
      <h3>MCP servers</h3>
      <p class="hint">Shared with <code>codex</code>. Each card is an <code>[mcp_servers.&lt;name&gt;]</code> entry — Args are space-separated; Env is JSON like <code>{"KEY":"val"}</code>.</p>
      <div id="mcp-rows"></div>
      <button class="add" id="add-mcp">+ Add MCP server</button>
      <div><button class="save" id="save-mcp">Save MCP servers</button><span id="msg-mcp"></span></div>
    </div></div>
    <div class="pane" id="pane-scxcode"><div class="card">
      <h3>SCXCode extension</h3>
      <p class="hint">The VS Code extension's own settings (stored in VS Code, not config.toml).</p>
      <label>SCX API base URL</label><input id="sx-base" placeholder="https://api.scx.ai">
      <label>Default model</label><select id="sx-model"></select>
      <div class="note" id="sx-model-note"></div>
      <label>Model catalog JSON</label><input id="sx-catalog-path" placeholder="C:\\KriticalSCX\\config\\models\\scx-model-catalog.json">
      <div class="note" id="sx-catalog-note"></div>
      <label>Auto-context</label><select id="sx-auto-context">
        <option value="off">Off</option>
        <option value="file">Active file</option>
        <option value="file+selection">Active file + selection</option>
        <option value="workspace-tree">Workspace tree</option>
      </select>
      <label>Auto-context max chars</label><input id="sx-auto-context-max" type="number" min="1000" step="1000" placeholder="8000">
      <label>Mux streams</label><input id="sx-concurrency" type="number" min="1" max="8" step="1" placeholder="1">
      <label>Max output tokens</label><input id="sx-max-tokens" type="number" min="20" step="100" placeholder="1500">
      <label>Backing store</label><select id="sx-storage">
        <option value="auto">Auto — SQLite first, SQL Server fallback</option>
        <option value="sqlite">SQLite local store</option>
        <option value="mssql">SQL Server Express big store</option>
      </select>
      <div class="note" id="sx-storage-note"></div>
      <label>SQLite store path</label><input id="sx-sqlite-path" placeholder="~/.kritical-scx/scxcode-store.db">
      <label>SQL Server instance</label><input id="sx-mssql-server" placeholder=".\\SQLEXPRESS">
      <label>SQL Server database</label><input id="sx-mssql-db" placeholder="KriticalSCXCodeStore">
      <label>API key</label><input id="sx-key" disabled>
      <div><button class="save" id="save-scxcode">Save SCXCode settings</button><span id="msg-scxcode"></span></div>
    </div></div>
  </div>
  <div class="foot">Kritical Pty Ltd · sales@kritical.net · 1300 274 655</div>

  <script>
  var vscode = acquireVsCodeApi();
  var MODELS = [];
  var FOLLOW = '\\u2063(follow chat panel selection)';
  function q(id){return document.getElementById(id);}
  // --- Southern Cross starfield (local GPU/CPU 2D canvas) — decorative, must NEVER break controls ---
  try { (function(){
    var c=q('sky'),x=c.getContext('2d'),W,H,stars=[],t=0;
    var cross=[[.62,.30,2.6],[.72,.68,2.2],[.80,.44,1.8],[.55,.56,1.5],[.68,.50,1.1]]; // Crux (5 stars, rel coords)
    function size(){W=c.width=c.offsetWidth*devicePixelRatio;H=c.height=c.offsetHeight*devicePixelRatio;
      stars=[];for(var i=0;i<70;i++){stars.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.1*devicePixelRatio+.2,p:Math.random()*6.28,s:Math.random()*.5+.2});}}
    function draw(){t+=.016;x.clearRect(0,0,W,H);
      for(var i=0;i<stars.length;i++){var st=stars[i];var a=.25+.35*(0.5+0.5*Math.sin(t*st.s+st.p));
        x.beginPath();x.arc(st.x,st.y,st.r,0,6.29);x.fillStyle='rgba(191,233,245,'+a+')';x.fill();}
      // constellation lines + stars
      var px=cross.map(function(p){return [p[0]*W,p[1]*H];});
      x.strokeStyle='rgba(21,175,209,.28)';x.lineWidth=1*devicePixelRatio;
      x.beginPath();x.moveTo(px[0][0],px[0][1]);x.lineTo(px[1][0],px[1][1]);x.moveTo(px[2][0],px[2][1]);x.lineTo(px[3][0],px[3][1]);x.stroke();
      for(var j=0;j<cross.length;j++){var g=.6+.4*Math.sin(t*1.2+j);var r=cross[j][2]*devicePixelRatio;
        var grd=x.createRadialGradient(px[j][0],px[j][1],0,px[j][0],px[j][1],r*4);
        grd.addColorStop(0,'rgba(21,175,209,'+g+')');grd.addColorStop(1,'rgba(21,175,209,0)');
        x.fillStyle=grd;x.beginPath();x.arc(px[j][0],px[j][1],r*4,0,6.29);x.fill();
        x.fillStyle='rgba(230,250,255,'+g+')';x.beginPath();x.arc(px[j][0],px[j][1],r,0,6.29);x.fill();}
      requestAnimationFrame(draw);}
    size();draw();window.addEventListener('resize',size);
  })(); } catch(e){ /* canvas is decorative — controls below must still wire up */ }
  // --- tabs ---
  document.querySelectorAll('.tab').forEach(function(tb){ tb.onclick=function(){
    document.querySelectorAll('.tab').forEach(function(z){z.classList.remove('active');});
    document.querySelectorAll('.pane').forEach(function(z){z.classList.remove('active');});
    tb.classList.add('active'); q('pane-'+tb.dataset.t).classList.add('active');
  };});
  // --- helpers: only ever offer models that exist; auto-correct silently in the UI ---
  function fillModelSelect(sel, includeFollow){ sel.innerHTML='';
    if(includeFollow){ var f=document.createElement('option'); f.value=''; f.textContent=FOLLOW; sel.appendChild(f); }
    MODELS.forEach(function(id){ var o=document.createElement('option'); o.value=id; o.textContent=id; sel.appendChild(o); });
  }
  function selectValid(sel, want, noteEl, kind){
    var ids=Array.prototype.map.call(sel.options,function(o){return o.value;});
    if(want && ids.indexOf(want)>=0){ sel.value=want; if(noteEl){noteEl.className='note';noteEl.textContent='';} return want; }
    if(!want){ sel.value=''; return ''; }
    // requested value isn't available -> pick a valid one + tell the user
    var fallback = ids.filter(function(v){return v;})[0] || '';
    sel.value = fallback;
    if(noteEl){ noteEl.className='note warn'; noteEl.textContent='"'+want+'" isn\\'t available on this endpoint — set to "'+fallback+'". Pick another if you like.'; }
    return fallback;
  }
  function mcpCard(s){ s=s||{name:'',command:'',args:'',env:''};
    var d=document.createElement('div'); d.className='mcp-card';
    d.innerHTML='<button class="rm" title="remove">\\u2715</button>'+
      '<div class="grid">'+
      '<div><label>name</label><input class="m-name" placeholder="e.g. shopify"></div>'+
      '<div><label>command</label><input class="m-cmd" placeholder="npx / path.exe"></div>'+
      '<div class="full"><label>args (space-separated)</label><input class="m-args" placeholder="-y @scope/pkg@latest"></div>'+
      '<div class="full"><label>env (JSON)</label><input class="m-env" placeholder="{\\"KEY\\":\\"value\\"}"></div>'+
      '</div>';
    d.querySelector('.m-name').value=s.name; d.querySelector('.m-cmd').value=s.command; d.querySelector('.m-args').value=s.args; d.querySelector('.m-env').value=s.env;
    d.querySelector('.rm').onclick=function(){ d.remove(); };
    return d;
  }
  q('add-mcp').onclick=function(){ q('mcp-rows').appendChild(mcpCard()); };
  q('save-codex').onclick=function(){ vscode.postMessage({type:'saveCodex',model:q('cx-model').value,sandbox_mode:q('cx-sandbox').value,reasoning:q('cx-reasoning').value,approval:q('cx-approval').value,summary:q('cx-summary').value,verbosity:q('cx-verbosity').value}); };
  q('save-mcp').onclick=function(){
    var servers=[]; q('mcp-rows').querySelectorAll('.mcp-card').forEach(function(r){ servers.push({name:r.querySelector('.m-name').value.trim(),command:r.querySelector('.m-cmd').value.trim(),args:r.querySelector('.m-args').value.trim(),env:r.querySelector('.m-env').value.trim()}); });
    vscode.postMessage({type:'saveMcp',servers:servers});
  };
  q('save-scxcode').onclick=function(){ vscode.postMessage({type:'saveScxcode',baseUrl:q('sx-base').value,defaultModel:q('sx-model').value,modelCatalogPath:q('sx-catalog-path').value.trim(),autoContext:q('sx-auto-context').value,autoContextMaxChars:q('sx-auto-context-max').value,concurrency:q('sx-concurrency').value,maxTokens:q('sx-max-tokens').value,storageBackend:q('sx-storage').value,sqliteStorePath:q('sx-sqlite-path').value.trim(),mssqlServer:q('sx-mssql-server').value.trim(),mssqlDatabase:q('sx-mssql-db').value.trim()}); };
  q('launch').onclick=function(){ vscode.postMessage({type:'launchCodex'}); };
  window.addEventListener('message',function(e){ var m=e.data;
    if(m.type==='data'){
      MODELS=(m.models||[]).map(function(x){return (x&&x.id)?x.id:x;}); q('cfgpath').textContent=m.codexConfigPath;
      fillModelSelect(q('cx-model'),true);
      selectValid(q('cx-model'), m.codex.model||'', q('cx-model-note'), 'codex');
      if(!m.codex.model){ q('cx-model-note').className='note'; q('cx-model-note').innerHTML='Defaults to <b>(follow chat panel)</b> — SCX Codex uses whatever model your chat panel is on.'; }
      q('cx-sandbox').value=m.codex.sandbox_mode; q('cx-reasoning').value=m.codex.model_reasoning_effort; q('cx-approval').value=m.codex.approval_policy;
      q('cx-summary').value=m.codex.model_reasoning_summary||'auto'; q('cx-verbosity').value=m.codex.model_verbosity||'medium';
      q('mcp-rows').innerHTML=''; (m.mcp||[]).forEach(function(s){ q('mcp-rows').appendChild(mcpCard(s)); });
      if(!(m.mcp||[]).length){ q('mcp-rows').appendChild(mcpCard()); }
      q('sx-base').value=m.scxcode.baseUrl; q('sx-key').value=m.scxcode.apiKeySet?('set · '+m.scxcode.keyCount+' key(s) in HKCU'):'NOT SET — set SCX_API_KEY';
      fillModelSelect(q('sx-model'),false);
      selectValid(q('sx-model'), m.scxcode.defaultModel, q('sx-model-note'), 'scx');
      q('sx-catalog-path').value=m.scxcode.modelCatalogPath||'';
      q('sx-catalog-path').placeholder=m.scxcode.modelCatalogResolvedPath||'C:\\\\KriticalSCX\\\\config\\\\models\\\\scx-model-catalog.json';
      q('sx-catalog-note').innerHTML='Full catalog rows: <b>'+((m.modelCatalog&&m.modelCatalog.count)||0)+'</b>. Canonical: <code>'+((m.modelCatalog&&m.modelCatalog.path)||m.scxcode.modelCatalogResolvedPath||'')+'</code>.';
      q('sx-auto-context').value=m.scxcode.autoContext||'file+selection';
      q('sx-auto-context-max').value=m.scxcode.autoContextMaxChars||8000;
      q('sx-concurrency').value=m.scxcode.concurrency||1;
      q('sx-max-tokens').value=m.scxcode.maxTokens||1500;
      q('sx-storage').value=m.scxcode.storageBackend||'auto';
      q('sx-sqlite-path').value=m.scxcode.sqliteStorePath||'';
      q('sx-sqlite-path').placeholder=m.scxcode.sqliteResolvedPath||'~/.kritical-scx/scxcode-store.db';
      q('sx-mssql-server').value=m.scxcode.mssqlServer||'.\\\\SQLEXPRESS';
      q('sx-mssql-db').value=m.scxcode.mssqlDatabase||'KriticalSCXCodeStore';
      q('sx-storage-note').innerHTML='Looking Glass uses <b>'+q('sx-storage').value+'</b>. SQLite path resolves to <code>'+(m.scxcode.sqliteResolvedPath||'~/.kritical-scx/scxcode-store.db')+'</code>; SQL Server target is <code>'+(q('sx-mssql-server').value+'/'+q('sx-mssql-db').value)+'</code>.';
      if(m.tab){ var tb=document.querySelector('.tab[data-t="'+m.tab+'"]'); if(tb) tb.click(); }
    } else if(m.type==='saved'){
      var el=q('msg-'+m.section); if(el){ if(m.ok===false){ el.className='err'; el.textContent='✗ '+(m.error||'failed'); } else { el.className='ok'; el.textContent='✓ saved'+(m.backup?(' · backup '+m.backup.split(/[\\\\/]/).pop()):''); } setTimeout(function(){el.textContent='';},6000); }
    } else if(m.type==='proxy'){ var on=m.running; q('status').textContent='LiteLLM :4180 '+(on?'running':'off'); q('pdot').className='dot '+(on?'on':'off'); }
  });
  vscode.postMessage({type:'load'});
  </script></body></html>`;
}

export function activate(context: vscode.ExtensionContext) {
  fetchLiveModels(); // .5227 — refresh the model cache from the SCX API on startup (falls back to cache/preseed)
  const cmds: Array<[string, (...args: any[]) => any]> = [
    ['kritical.scxcode.openChat', () => cmdOpenChat(context)],
    ['kritical.scxcode.pickModel', cmdPickModel],
    ['kritical.scxcode.testConnection', cmdTestConnection],
    ['kritical.scxcode.showStatus', cmdShowStatus],
    ['kritical.scxcode.explainSelection', cmdExplainSelection],
    ['kritical.scxcode.refactorSelection', cmdRefactorSelection],
    ['kritical.scxcode.auditDiff', cmdAuditDiff],
    ['kritical.scxcode.newChat', cmdNewChat],
    ['kritical.scxcode.openSettings', cmdOpenSettings],
    ['kritical.scxcode.manageMcp', () => cmdSetupGui(context, 'mcp')],
    ['kritical.scxcode.explainFile', cmdExplainFile],
    ['kritical.scxcode.generateTests', cmdGenerateTests],
    ['kritical.scxcode.muxQuery', cmdMuxQuery],
    ['kritical.scxcode.lookingGlass', () => cmdLookingGlass(context)],   // .5231 — Lens Looking Glass panel
    ['kritical.scxcode.scxCodex', () => cmdScxCodex(context)],
    ['kritical.scxcode.checkUpdate', () => cmdCheckUpdate(context)],
    ['kritical.scxcode.setupGui', () => cmdSetupGui(context)],
  ];
  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  // .5165g — REGISTER the sidebar chat webview provider so activity-bar view renders.
  const chatProvider = new KriticalChatViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KriticalChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Status bar
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sb.text = '$(comment-discussion) Kritical SCXCode';
  sb.tooltip = 'Click to open Kritical SCXCode chat';
  sb.command = 'workbench.view.extension.kritical-scxcode';
  sb.show();
  context.subscriptions.push(sb);

  const out = getOutputChannel();
  out.appendLine('Kritical SCXCode activated · ' + new Date().toISOString());
  out.appendLine('Sidebar view registered: kritical.scxcode.chat');
  out.appendLine('Run "Kritical: Test SCX Connection" from the command palette to verify auth.');
}

export function deactivate() { /* nothing to clean */ }
