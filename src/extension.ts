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

interface ScxMessage { role: 'user' | 'assistant' | 'system'; content: string; }
interface ScxCompletionRequest { model: string; messages: ScxMessage[]; max_tokens?: number; system?: string; }
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

function getConfig() {
  const c = vscode.workspace.getConfiguration('kritical.scxcode');
  // VS Code auto-substitutes ${env:SCX_API_KEY} for the apiKey default.
  return {
    apiKey: c.get<string>('apiKey', '').replace(/^\$\{env:SCX_API_KEY\}$/, process.env.SCX_API_KEY ?? ''),
    baseUrl: c.get<string>('baseUrl', 'https://api.scx.ai'),
    defaultModel: c.get<string>('defaultModel', 'MiniMax-M2.7'),
    autocompleteModel: c.get<string>('autocompleteModel', 'coder'),
    fallbackChain: c.get<string[]>('fallbackChain', ['MiniMax-M2.7', 'MAGPiE', 'gpt-oss-120b']),
    autocompact: c.get<'off' | 'auto' | 'aggressive'>('autocompact', 'auto'),
    systemPrompt: c.get<string>('systemPrompt', ''),
    telemetry: c.get<'off' | 'local-only' | 'kritical-endpoint'>('telemetry', 'off'),
  };
}

// ────────────────────────────────────────────────────────────────
// SCX API — Anthropic-shape POST with fetch fallback via https.request
// ────────────────────────────────────────────────────────────────

async function scxPost(model: string, messages: ScxMessage[], maxTokens = 800): Promise<ScxCompletionResponse> {
  const { apiKey, baseUrl, systemPrompt } = getConfig();
  if (!apiKey) throw new Error('SCX_API_KEY not set. Configure kritical.scxcode.apiKey or set HKCU env SCX_API_KEY.');
  const body: ScxCompletionRequest = { model, messages, max_tokens: maxTokens };
  if (systemPrompt) body.system = systemPrompt;

  return new Promise((resolve, reject) => {
    const url = new URL('/v1/messages', baseUrl);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'x-api-key': apiKey,
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

// Failover: try model, on 429/5xx walk the chain.
async function scxPostWithFailover(messages: ScxMessage[], maxTokens = 800): Promise<{ res: ScxCompletionResponse; modelUsed: string; attempts: string[] }> {
  const cfg = getConfig();
  const tried: string[] = [];
  const chain = [cfg.defaultModel, ...cfg.fallbackChain.filter((m) => m !== cfg.defaultModel)];
  let lastErr: unknown;
  for (const model of chain) {
    tried.push(model);
    try {
      const res = await scxPost(model, messages, maxTokens);
      return { res, modelUsed: model, attempts: tried };
    } catch (e) {
      lastErr = e;
      if (e instanceof ScxHttpError && (e.isRateLimit || e.isServerError)) {
        continue; // try next model
      }
      throw e; // non-transient error — surface immediately
    }
  }
  throw lastErr ?? new Error('failover chain exhausted (unknown reason)');
}

// ────────────────────────────────────────────────────────────────
// commands
// ────────────────────────────────────────────────────────────────

async function cmdTestConnection() {
  const cfg = getConfig();
  const out = vscode.window.createOutputChannel('Kritical SCXCode');
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
  const out = vscode.window.createOutputChannel('Kritical SCXCode');
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

async function runChat(prompt: string) {
  const out = vscode.window.createOutputChannel('Kritical SCXCode');
  out.show(true);
  out.appendLine(`\n[chat] ${prompt.slice(0, 100)}${prompt.length > 100 ? '…' : ''}`);
  try {
    const { res, modelUsed } = await scxPostWithFailover([{ role: 'user', content: prompt }], 1500);
    const text = res.content.map((c) => c.text).join('');
    out.appendLine(`\n[reply · ${modelUsed} · ${res.usage.output_tokens} tok]\n${text}\n`);
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
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'chat') {
      try {
        const { res, modelUsed } = await scxPostWithFailover(msg.history, 1200);
        panel.webview.postMessage({ type: 'reply', text: res.content.map((c) => c.text).join(''), model: modelUsed, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens });
      } catch (e) {
        panel.webview.postMessage({ type: 'error', error: (e as Error).message });
      }
    } else if (msg.type === 'config') {
      panel.webview.postMessage({ type: 'config', config: getConfig() });
    }
  });
  panel.webview.postMessage({ type: 'ready' });
}

function chatHtml(): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Kritical SCXCode</title>
<style nonce="${nonce}">
body { font-family: system-ui, sans-serif; margin: 0; background: #f3f3f3; color: #121212; }
.top { background: #13365C; color: #fff; padding: 10px 16px; display: flex; align-items: center; gap: 12px; }
.top .brand { font-weight: 600; letter-spacing: 0.3px; }
.top .model { margin-left: auto; font-family: ui-monospace, monospace; font-size: 12px; opacity: 0.85; }
#chat { padding: 12px 16px; height: calc(100vh - 130px); overflow-y: auto; }
.msg { padding: 8px 12px; margin: 8px 0; border-radius: 6px; max-width: 80%; }
.user { background: #F2B500; color: #121212; margin-left: auto; }
.assistant { background: #fff; color: #121212; border: 1px solid #e5e7eb; }
.error { background: #fee2e2; color: #991b1b; }
.meta { font-size: 11px; opacity: 0.7; margin-top: 4px; }
.input { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 16px; background: #fff; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
.input textarea { flex: 1; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-family: system-ui; resize: none; min-height: 40px; }
.input button { padding: 8px 20px; background: #13365C; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-weight: 500; }
.input button:disabled { opacity: 0.5; }
</style></head><body>
<div class="top"><div class="brand">Kritical SCXCode</div><div class="model" id="model">MiniMax-M2.7</div></div>
<div id="chat"></div>
<div class="input"><textarea id="in" placeholder="Ask anything…"></textarea><button id="send">Send</button></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const chat = document.getElementById('chat');
const input = document.getElementById('in');
const send = document.getElementById('send');
const model = document.getElementById('model');
const history = [];
function add(role, text, meta) {
  const div = document.createElement('div'); div.className = 'msg ' + role; div.textContent = text;
  if (meta) { const m = document.createElement('div'); m.className = 'meta'; m.textContent = meta; div.appendChild(m); }
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
}
send.onclick = () => {
  const text = input.value.trim(); if (!text) return;
  add('user', text); history.push({ role: 'user', content: text }); input.value = ''; send.disabled = true;
  vscode.postMessage({ type: 'chat', history });
};
input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } };
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'reply') { add('assistant', m.text, m.model + ' · ' + m.tokensIn + ' in / ' + m.tokensOut + ' out'); history.push({ role: 'assistant', content: m.text }); model.textContent = m.model; send.disabled = false; }
  else if (m.type === 'error') { add('error', m.error); send.disabled = false; }
  else if (m.type === 'ready') { vscode.postMessage({ type: 'config' }); }
  else if (m.type === 'config') { model.textContent = m.config.defaultModel; }
});
</script></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// activation
// ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const cmds: Array<[string, (...args: any[]) => any]> = [
    ['kritical.scxcode.openChat', () => cmdOpenChat(context)],
    ['kritical.scxcode.pickModel', cmdPickModel],
    ['kritical.scxcode.testConnection', cmdTestConnection],
    ['kritical.scxcode.showStatus', cmdShowStatus],
    ['kritical.scxcode.explainSelection', cmdExplainSelection],
    ['kritical.scxcode.refactorSelection', cmdRefactorSelection],
    ['kritical.scxcode.auditDiff', cmdAuditDiff],
  ];
  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }
  // Status bar
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sb.text = '$(comment-discussion) Kritical SCXCode';
  sb.tooltip = 'Click to open Kritical SCXCode chat';
  sb.command = 'kritical.scxcode.openChat';
  sb.show();
  context.subscriptions.push(sb);
  const out = vscode.window.createOutputChannel('Kritical SCXCode');
  out.appendLine('Kritical SCXCode activated · ' + new Date().toISOString());
  out.appendLine('Run "Kritical: Test SCX Connection" from the command palette to verify auth.');
}

export function deactivate() { /* nothing to clean */ }
