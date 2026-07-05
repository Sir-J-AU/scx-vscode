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
import { spawn } from 'child_process';

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
let _keyRotation = 0;

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
  return {
    apiKey: primary,
    apiKeys: keys,
    baseUrl: c.get<string>('baseUrl', 'https://api.scx.ai'),
    defaultModel: c.get<string>('defaultModel', 'MiniMax-M2.7'),
    autocompleteModel: c.get<string>('autocompleteModel', 'coder'),
    fallbackChain: c.get<string[]>('fallbackChain', ['MiniMax-M2.7', 'MAGPiE', 'gpt-oss-120b']),
    autocompact: c.get<'off' | 'auto' | 'aggressive'>('autocompact', 'auto'),
    systemPrompt: c.get<string>('systemPrompt', ''),
    telemetry: c.get<'off' | 'local-only' | 'kritical-endpoint'>('telemetry', 'off'),
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
// .5227 — each model carries its RECOMMENDED default temperature (temp): reasoners + the coder run
// cold for determinism; multimodal/creative models run warmer. Selecting a model snaps the slider
// to this default (until the operator overrides it), so every model gets a sane temperature.
type ScxModel = { id: string; detail: string; temp: number };
const SCX_MODEL_CATALOG: ScxModel[] = [
  { id: 'MiniMax-M2.7', detail: '192K · default agentic', temp: 0.3 },
  { id: 'MAGPiE', detail: '131K · near o4-mini reasoning', temp: 0.2 },
  { id: 'gpt-oss-120b', detail: '131K · cheapest reasoner', temp: 0.2 },
  { id: 'DeepSeek-V3.1', detail: '131K · hardest problems', temp: 0.2 },
  { id: 'coder', detail: '196K · algorithms + debugging', temp: 0.1 },
  { id: 'gemma-4-31B-it', detail: '131K · multimodal', temp: 0.6 },
  { id: 'Llama-4-Maverick-17B-128E-Instruct', detail: '131K · multimodal', temp: 0.6 },
  { id: 'Meta-Llama-3.3-70B-Instruct', detail: '131K · dense', temp: 0.4 },
  { id: 'Qwen3-32B', detail: '32K · 119 languages', temp: 0.3 },
];
const SCX_TEMP_FALLBACK = 0.2; // unknown/live models default cold — safest for a coding tool.
function modelTempDefault(id: string): number {
  const m = getModelCatalog().find((x) => x.id.toLowerCase() === (id || '').toLowerCase());
  return m && typeof m.temp === 'number' ? m.temp : SCX_TEMP_FALLBACK;
}

// .5227 — LIVE model list from the SCX API with a JSON cache + preseed fallback.
// On connect we GET {baseUrl}/v1/models, cache to ~/.kritical-scx/models-cache.json, and use it.
// If the fetch fails we use the cache; if no cache, the hardcoded SCX_MODEL_CATALOG (preseed).
let _liveModels: ScxModel[] | null = null;
const _modelsCachePath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.kritical-scx', 'models-cache.json');
// .5227 — heal any catalog (live or older cache written before the temp field existed) so every
// entry has a temp: backfill from the hardcoded defaults by id, else the cold fallback.
function healTemps(list: ScxModel[]): ScxModel[] {
  const byId = new Map(SCX_MODEL_CATALOG.map((m) => [m.id.toLowerCase(), m.temp]));
  return list.map((m) => ({ id: m.id, detail: m.detail, temp: typeof m.temp === 'number' ? m.temp : (byId.get((m.id || '').toLowerCase()) ?? SCX_TEMP_FALLBACK) }));
}
function getModelCatalog(): ScxModel[] {
  if (_liveModels && _liveModels.length) { return healTemps(_liveModels); }
  try { if (fs.existsSync(_modelsCachePath)) { const c = JSON.parse(fs.readFileSync(_modelsCachePath, 'utf8')); if (Array.isArray(c) && c.length) { return healTemps(c); } } } catch { /* ignore */ }
  return SCX_MODEL_CATALOG; // preseed
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
          const ids: string[] = Array.isArray(j.data) ? j.data.map((m: any) => m.id).filter(Boolean) : (Array.isArray(j.models) ? j.models.map((m: any) => m.id || m).filter(Boolean) : []);
          if (ids.length) {
            const known = new Map(SCX_MODEL_CATALOG.map((m) => [m.id.toLowerCase(), m]));
            _liveModels = ids.map((id) => { const k = known.get(id.toLowerCase()); return { id, detail: k ? k.detail : 'live', temp: k ? k.temp : SCX_TEMP_FALLBACK }; });
            try { fs.mkdirSync(path.dirname(_modelsCachePath), { recursive: true }); fs.writeFileSync(_modelsCachePath, JSON.stringify(_liveModels)); } catch { /* ignore */ }
          }
        } catch { /* keep cache/preseed */ }
      });
    });
    req.on('error', () => { /* keep cache/preseed */ });
    req.end();
  } catch { /* keep cache/preseed */ }
}

// .5213 — read-only MCP-server summary for the panel's 🔌 MCP button (Codex config.toml).
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
  const body: ScxCompletionRequest = { model, messages, max_tokens: maxTokens, temperature };
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
  const modelChain = [cfg.defaultModel, ...cfg.fallbackChain.filter((m) => m !== cfg.defaultModel)];
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
        if (e instanceof ScxHttpError && (e.isRateLimit || e.isServerError)) {
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
  const catalog: Array<{ label: string; description: string; detail: string }> = [
    { label: 'MiniMax-M2.7', description: '192K ctx · default agentic', detail: '230B sparse MoE (10B active) — AUD $0.68 in / $3.20 out per 1M' },
    { label: 'MAGPiE',        description: '131K ctx · near o4-mini reasoning', detail: '117B MoE from scx.ai — AUD $0.75 in / $1.75 out per 1M' },
    { label: 'gpt-oss-120b',  description: '131K ctx · cheapest reasoner',      detail: '117B open-weight MoE — AUD $0.30 in / $0.98 out per 1M' },
    { label: 'DeepSeek-V3.1', description: '131K ctx · reserve for hard problems', detail: '671B MoE (37B active) — AUD $4.50 in / $7.25 out per 1M' },
    { label: 'coder',          description: '196K ctx · algorithms + debugging', detail: 'SCX coder — AUD $0.85 in / $3.75 out per 1M' },
    { label: 'gemma-4-31B-it', description: '131K ctx · multimodal + thinking',  detail: 'Google Gemma 4 31B — AUD $0.54 in / $1.63 out per 1M' },
    { label: 'Llama-4-Maverick-17B-128E-Instruct', description: '131K ctx · multimodal', detail: 'Llama 4 Maverick 400B MoE — AUD $0.95 in / $2.90 out per 1M' },
    { label: 'Meta-Llama-3.3-70B-Instruct', description: '131K ctx · dense',      detail: '70B → 405B-class perf — AUD $0.95 in / $1.95 out per 1M' },
    { label: 'Qwen3-32B',     description: '32K ctx · 119 languages',            detail: 'Qwen3 32B dense — AUD $0.65 in / $1.55 out per 1M' },
  ];
  const picked = await vscode.window.showQuickPick(catalog, {
    title: 'Kritical SCXCode — pick default model',
    placeHolder: `Current: ${cfg.defaultModel}. Pick to change kritical.scxcode.defaultModel.`,
  });
  if (!picked) return;
  await vscode.workspace.getConfiguration('kritical.scxcode').update('defaultModel', picked.label, vscode.ConfigurationTarget.Global);
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
        const messagesForApi: ScxMessage[] = [...history];
        if (ctxPrefix && messagesForApi.length > 0) {
          messagesForApi[messagesForApi.length - 1] = { role: 'user', content: ctxPrefix + msg.text };
        }
        attached = '';
        const { res, modelUsed, keyIndex, shards } = await scxMux(messagesForApi, cfg.concurrency, cfg.maxTokens);
        const replyText = res.content.map((c) => c.text).join('');
        history.push({ role: 'assistant', content: replyText });
        panel.webview.postMessage({ type: 'reply', text: replyText, model: modelUsed, keyIndex, shards, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, autoContextChars: ctxPrefix.length });
      } catch (e) {
        panel.webview.postMessage({ type: 'error', error: (e as Error).message });
      }
    } else if (msg.type === 'clear') {
      history.length = 0;
      panel.webview.postMessage({ type: 'cleared' });
    } else if (msg.type === 'pickModel') {
      await vscode.commands.executeCommand('kritical.scxcode.pickModel');
      panel.webview.postMessage({ type: 'config', model: getConfig().defaultModel, keyCount: getConfig().apiKeys.length });
    } else if (msg.type === 'setConfig') {
      try { await vscode.workspace.getConfiguration('kritical.scxcode').update(msg.key, msg.value, vscode.ConfigurationTarget.Global); }
      catch (e) { panel.webview.postMessage({ type: 'error', error: 'Setting update failed: ' + (e as Error).message }); }
    } else if (msg.type === 'uploadFile') {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Attach to SCXCode' });
      if (picked && picked[0]) {
        try {
          const bytes = await vscode.workspace.fs.readFile(picked[0]);
          let content = Buffer.from(bytes).toString('utf8');
          if (content.length > 24000) { content = content.slice(0, 24000) + '\n…(truncated)'; }
          const name = picked[0].path.split('/').pop() || 'file';
          attached += `\n\n## Attached file: ${name}\n\`\`\`\n${content}\n\`\`\`\n`;
          panel.webview.postMessage({ type: 'fileAttached', name, chars: content.length });
        } catch (e) { panel.webview.postMessage({ type: 'error', error: 'File read failed: ' + (e as Error).message }); }
      }
    } else if (msg.type === 'attachRepo') {
      const found = await vscode.workspace.findFiles('**/*.{ts,js,py,ps1,psm1,al,md,json,yaml,yml}', '**/{node_modules,out,.git,.alpackages}/**', 80);
      const rel = found.map((f) => vscode.workspace.asRelativePath(f)).sort();
      attached += `\n\n## Workspace files (${rel.length}):\n${rel.join('\n')}\n`;
      panel.webview.postMessage({ type: 'fileAttached', name: `repo (${rel.length} files)`, chars: attached.length });
    } else if (msg.type === 'listMcp') {
      panel.webview.postMessage({ type: 'notice', text: mcpSummary() });
    } else if (msg.type === 'config') {
      const cfg = getConfig();
      panel.webview.postMessage({ type: 'config', model: cfg.defaultModel, models: getModelCatalog(), keyCount: cfg.apiKeys.length,
        autoContext: cfg.autoContext, maxTokens: cfg.maxTokens, concurrency: cfg.concurrency, temperature: cfg.temperature, provider: cfg.provider });
    }
  });
  panel.webview.postMessage({ type: 'ready' });
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
  <label>Length <select id="len"><option value="800">Short</option><option value="1500">Medium</option><option value="4096">Long</option><option value="8192">Maximum</option></select></label>
  <label>Streams <select id="streams"><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="6">6</option><option value="8">8</option></select></label>
  <label>Context <select id="ctx"><option value="off">Off</option><option value="file">File</option><option value="file+selection">File+Sel</option><option value="workspace-tree">Workspace</option></select></label>
  <button class="adv-btn" id="advBtn" title="Advanced options">⚙</button>
</div>
<div class="adv" id="adv">
  <label>Temp <input type="range" id="temp" min="0" max="1" step="0.1" value="0.2"><span id="tempVal">0.2</span></label>
  <label>Provider <select id="provider"><option value="auto">Auto (SCX→Claude CLI)</option><option value="scx-native">SCX only</option><option value="claude-code-cli">Claude CLI only</option></select></label>
</div>
<div id="chat"></div>
<div class="input">
  <div class="toolbar">
    <button class="tool-btn" id="tbUpload" title="Upload a file into the next message">📎 File</button>
    <button class="tool-btn" id="tbRepo" title="Attach a workspace file summary">📁 Repo</button>
    <button class="tool-btn" id="tbMcp" title="MCP servers &amp; tools">🔌 MCP</button>
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
// .5227 — per-model recommended temperature defaults (embedded at render). Selecting a model snaps
// the slider to its default UNLESS the operator has manually overridden the temperature this session.
const _modelTemps = ${JSON.stringify(Object.fromEntries(getModelCatalog().map((m) => [m.id, m.temp])))};
const _tempFallback = ${SCX_TEMP_FALLBACK};
let _tempUserSet = false;
function _applyModelTemp(id, post) {
  if (_tempUserSet) return;                                   // respect an explicit operator override
  var t = (_modelTemps && typeof _modelTemps[id] === 'number') ? _modelTemps[id] : _tempFallback;
  tempEl.value = String(t); tempVal.textContent = String(t);
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
document.getElementById('tbUpload').onclick = () => vscode.postMessage({ type: 'uploadFile' });
document.getElementById('tbRepo').onclick = () => vscode.postMessage({ type: 'attachRepo' });
document.getElementById('tbMcp').onclick = () => vscode.postMessage({ type: 'listMcp' });
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
    const muxLabel = m.shards > 1 ? ' · muxed ×' + m.shards : '';
    add('assistant', m.text, m.model + keyLabel + muxLabel + ' · ' + m.tokensIn + '⇢' + m.tokensOut + ' tok' + ctxLabel + ' · session ' + sessionInTokens + '⇢' + sessionOutTokens);
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
  } else if (m.type === 'fileAttached') {
    ctxChip.textContent = '📎 ' + m.name + ' (' + m.chars + 'c)';
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
<div class="footer">© 2026 Kritical Pty Ltd · Kritical SCXCode v0.1.13</div>
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
          const messagesForApi: ScxMessage[] = [...this._history];
          if (ctx && messagesForApi.length > 0) {
            messagesForApi[messagesForApi.length - 1] = {
              role: 'user',
              content: ctx + msg.text,
            };
          }
          this._attached = ''; // consumed
          const cfg = getConfig();
          const { res, modelUsed, keyIndex, shards } = await scxMux(messagesForApi, cfg.concurrency, cfg.maxTokens);
          const replyText = res.content.map((c) => c.text).join('');
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
          });
        } catch (e) {
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
          // .5211 (DeepSeek-flagged, verified) — actually ROTATE through all keys instead of
          // always jumping to apiKeys[1]/index 2. Advance a persistent pointer, wrapping around.
          _keyRotation = (_keyRotation + 1) % cfg.apiKeys.length;
          const next = cfg.apiKeys[_keyRotation];
          const newIndex = _keyRotation + 1;
          process.env.SCX_API_KEY = next;
          view.webview.postMessage({ type: 'keySwitched', newKeyIndex: newIndex });
        } catch (e) {
          view.webview.postMessage({ type: 'error', error: 'Key switch failed: ' + (e as Error).message });
        }
      } else if (msg.type === 'setConfig') {
        try {
          await vscode.workspace.getConfiguration('kritical.scxcode').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        } catch (e) {
          view.webview.postMessage({ type: 'error', error: 'Setting update failed: ' + (e as Error).message });
        }
      } else if (msg.type === 'uploadFile') {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Attach to SCXCode' });
        if (picked && picked[0]) {
          try {
            const bytes = await vscode.workspace.fs.readFile(picked[0]);
            let content = Buffer.from(bytes).toString('utf8');
            if (content.length > 24000) { content = content.slice(0, 24000) + '\n…(truncated)'; }
            const name = picked[0].path.split('/').pop() || 'file';
            this._attached += `\n\n## Attached file: ${name}\n\`\`\`\n${content}\n\`\`\`\n`;
            view.webview.postMessage({ type: 'fileAttached', name, chars: content.length });
          } catch (e) {
            view.webview.postMessage({ type: 'error', error: 'File read failed: ' + (e as Error).message });
          }
        }
      } else if (msg.type === 'attachRepo') {
        const found = await vscode.workspace.findFiles('**/*.{ts,js,py,ps1,psm1,al,md,json,yaml,yml}', '**/{node_modules,out,.git,.alpackages}/**', 80);
        const rel = found.map((f) => vscode.workspace.asRelativePath(f)).sort();
        this._attached += `\n\n## Workspace files (${rel.length}):\n${rel.join('\n')}\n`;
        view.webview.postMessage({ type: 'fileAttached', name: `repo (${rel.length} files)`, chars: this._attached.length });
      } else if (msg.type === 'listMcp') {
        view.webview.postMessage({ type: 'notice', text: mcpSummary() });
      } else if (msg.type === 'config') {
        const cfg = getConfig();
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
        });
      }
    });
    view.webview.postMessage({ type: 'ready' });
  }
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
    ['kritical.scxcode.manageMcp', cmdManageMcp],
    ['kritical.scxcode.explainFile', cmdExplainFile],
    ['kritical.scxcode.generateTests', cmdGenerateTests],
    ['kritical.scxcode.muxQuery', cmdMuxQuery],
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
