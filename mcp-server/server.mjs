#!/usr/bin/env node
// Kritical SCXCode MCP server — exposes SCX chat + models + embeddings as MCP
// tools so any MCP-capable agent (Claude Desktop / Cline / Continue / custom)
// can drive SCX via a uniform interface.
//
// Apache 2.0 (c) Kritical Pty Ltd 2026.
//
// Wiring: this is a stdio MCP server. Register in claude_desktop_config.json
// or the equivalent per-client config as:
//
//   "kritical-scxcode": {
//     "command": "node",
//     "args": ["c:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/scx-vscode/mcp-server/server.mjs"],
//     "env": { "SCX_API_KEY": "${SCX_API_KEY}" }
//   }
//
// Tools exposed:
//   scx_chat           — one-shot chat (auto-failover across models)
//   scx_list_models    — return the SCX /v1/models catalog
//   scx_test           — connection + latency probe
//   scx_embed          — generate embeddings via E5-Mistral-7B-Instruct
//   scx_status         — full status (config + probe verdict)

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import https from 'node:https';

const SCX_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.scx.ai';
const SCX_KEY = process.env.SCX_API_KEY;
const DEFAULT_MODEL = process.env.KRIT_SCX_MODEL_DEFAULT || 'MiniMax-M2.7';
const FALLBACK_CHAIN = (process.env.KRIT_SCX_FALLBACK_CHAIN || 'MiniMax-M2.7,MAGPiE,gpt-oss-120b').split(',').map(s => s.trim());

function log(msg) { process.stderr.write(`[scxcode-mcp] ${msg}\n`); }

// ────────────────────────────────────────────────────────────────
// SCX HTTP
// ────────────────────────────────────────────────────────────────

function scxPost(path, body) {
  return new Promise((resolve, reject) => {
    if (!SCX_KEY) return reject(new Error('SCX_API_KEY not set (need HKCU env or MCP env)'));
    const url = new URL(path, SCX_BASE);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'x-api-key': SCX_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, body: buf }));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`parse: ${e.message}\n${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function scxGet(path) {
  return new Promise((resolve, reject) => {
    if (!SCX_KEY) return reject(new Error('SCX_API_KEY not set'));
    const url = new URL(path, SCX_BASE);
    https.request({
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname,
      headers: { 'x-api-key': SCX_KEY },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`parse: ${e.message}`)); }
      });
    }).on('error', reject).end();
  });
}

async function chatWithFailover(messages, maxTokens = 1200, preferredModel = null) {
  const chain = [preferredModel || DEFAULT_MODEL, ...FALLBACK_CHAIN.filter(m => m !== (preferredModel || DEFAULT_MODEL))];
  let lastErr;
  const attempts = [];
  for (const m of chain) {
    attempts.push(m);
    try {
      const r = await scxPost('/v1/messages', { model: m, messages, max_tokens: maxTokens });
      return { ...r, _model: m, _attempts: attempts };
    } catch (e) {
      lastErr = e;
      if (e.status === 429 || e.status >= 500) continue;
      throw e;
    }
  }
  throw new Error(`failover exhausted (${attempts.join(' -> ')}): ${lastErr?.body || lastErr?.message}`);
}

// ────────────────────────────────────────────────────────────────
// MCP protocol (JSON-RPC 2.0 over stdio)
// ────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'scx_chat',
    description: 'Chat with SCX (auto-failover across fallback chain on 429/5xx). Returns model actually used + tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'User message.' },
        model: { type: 'string', description: 'Preferred model. Falls back through KRIT_SCX_FALLBACK_CHAIN on 429.' },
        max_tokens: { type: 'number', default: 1200 },
        system: { type: 'string', description: 'Optional system prompt.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'scx_list_models',
    description: 'List every model in the SCX catalog with context length and AUD pricing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scx_test',
    description: 'Ping /v1/messages with a 20-token round-trip. Returns latency + status.',
    inputSchema: { type: 'object', properties: { model: { type: 'string' } } },
  },
  {
    name: 'scx_embed',
    description: 'Generate embeddings via E5-Mistral-7B-Instruct.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'array', items: { type: 'string' }, description: 'One or more strings to embed.' },
      },
      required: ['input'],
    },
  },
  {
    name: 'scx_status',
    description: 'Return config + endpoint alive-status + model catalog count.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'scx_chat': {
      const r = await chatWithFailover(
        [{ role: 'user', content: args.prompt }],
        args.max_tokens ?? 1200,
        args.model || null,
      );
      const text = r.content.map(c => c.text).join('');
      return { content: [{ type: 'text', text }], _meta: { model: r._model, attempts: r._attempts, usage: r.usage } };
    }
    case 'scx_list_models': {
      const r = await scxGet('/v1/models');
      const lines = r.data.map(m => {
        const inCost = (parseFloat(m.pricing.prompt) * 1e6).toFixed(2);
        const outCost = (parseFloat(m.pricing.completion) * 1e6).toFixed(2);
        return `${m.id.padEnd(38)} ctx=${String(m.context_length).padStart(7)} maxOut=${String(m.max_output_length).padStart(7)} in=AUD$${inCost}/M out=AUD$${outCost}/M`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    case 'scx_test': {
      const t0 = Date.now();
      try {
        const r = await scxPost('/v1/messages', {
          model: args.model || DEFAULT_MODEL,
          max_tokens: 20,
          messages: [{ role: 'user', content: 'reply just OK' }],
        });
        return { content: [{ type: 'text', text: `OK · ${args.model || DEFAULT_MODEL} · ${Date.now() - t0}ms · ${r.content[0].text}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `FAIL · ${Date.now() - t0}ms · status=${e.status || '?'} · ${e.body || e.message}` }], isError: true };
      }
    }
    case 'scx_embed': {
      const r = await scxPost('/v1/embeddings', { model: 'E5-Mistral-7B-Instruct', input: args.input });
      return { content: [{ type: 'text', text: JSON.stringify(r.data.map(d => ({ index: d.index, dims: d.embedding.length }))) }] };
    }
    case 'scx_status': {
      const config = { baseUrl: SCX_BASE, hasKey: !!SCX_KEY, keyLen: SCX_KEY?.length || 0, defaultModel: DEFAULT_MODEL, fallbackChain: FALLBACK_CHAIN };
      let probe = { alive: false };
      try {
        const models = await scxGet('/v1/models');
        probe = { alive: true, modelCount: models.data.length };
      } catch (e) { probe = { alive: false, error: e.message }; }
      return { content: [{ type: 'text', text: JSON.stringify({ config, probe }, null, 2) }] };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ────────────────────────────────────────────────────────────────
// stdio JSON-RPC loop
// ────────────────────────────────────────────────────────────────

async function main() {
  log(`kritical-scxcode MCP server starting (SCX_BASE=${SCX_BASE}, HAS_KEY=${!!SCX_KEY})`);
  const rl = createInterface({ input: stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log(`parse error: ${e.message}`); return; }
    const respond = (result) => stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
    const respondErr = (code, message) => stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\n');

    try {
      switch (msg.method) {
        case 'initialize':
          respond({
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'kritical-scxcode', version: '0.1.0' },
          });
          break;
        case 'tools/list':
          respond({ tools: TOOLS });
          break;
        case 'tools/call': {
          const { name, arguments: args } = msg.params;
          const result = await handleTool(name, args || {});
          respond(result);
          break;
        }
        case 'notifications/initialized':
          break;
        default:
          respondErr(-32601, `method not found: ${msg.method}`);
      }
    } catch (e) {
      log(`handler error: ${e.message}`);
      respondErr(-32000, e.message);
    }
  });
  rl.on('close', () => { log('stdin closed, exiting'); process.exit(0); });
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exit(1); });
