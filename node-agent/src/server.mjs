// Kritical.NodeJS.SCXCodeAgent — bridge daemon scaffold
//
// This is a stub. See ../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md
// for the full MVP build spec. A fresh Claude session picks up from here.
//
// Per HR29 (.5184): additive layer. If this crashes, downstream agents must
// still work by talking to their real provider APIs directly.
// Per HR27 (.5182): every request/response written to documentation/{human,ai}/.
// Per HR28 (.5183): mechanism-named identifiers only. No metaphors.
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
// Contact: sales@kritical.net — ph. 1300 274 655

import Fastify from 'fastify';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');

const HOST = process.env.KRITICAL_AGENT_HOST || '127.0.0.1';
const PORT_ANTHROPIC = parseInt(process.env.KRITICAL_AGENT_PORT_ANTHROPIC || '4180', 10);
const PORT_OPENAI = parseInt(process.env.KRITICAL_AGENT_PORT_OPENAI || '4181', 10);
const LITELLM_PORT = parseInt(process.env.KRITICAL_LITELLM_PORT || '4182', 10);

// -----------------------------------------------------------------------------
// Kritical brand banner (once per process)
// -----------------------------------------------------------------------------

let bannerEmitted = false;
function showKriticalSCXCodeAgentBanner() {
  if (bannerEmitted) return;
  bannerEmitted = true;
  console.log('');
  console.log('  Kritical.NodeJS.SCXCodeAgent — multi-provider bridge (HR29 additive)');
  console.log('  Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655');
  console.log('  https://kritical.net');
  console.log('');
}

// -----------------------------------------------------------------------------
// Provider slot detection (HR29 — key present -> slot live; absent -> dormant)
// -----------------------------------------------------------------------------

function detectProviderSlots() {
  return {
    scx: {
      keyPresent: !!process.env.SCX_API_KEY,
      apiBase: 'https://api.scx.ai/v1',
      keyEnv: 'SCX_API_KEY',
    },
    anthropic: {
      keyPresent: !!process.env.ANTHROPIC_API_KEY,
      apiBase: 'https://api.anthropic.com',
      keyEnv: 'ANTHROPIC_API_KEY',
    },
    openai: {
      keyPresent: !!process.env.OPENAI_API_KEY,
      apiBase: 'https://api.openai.com/v1',
      keyEnv: 'OPENAI_API_KEY',
    },
    generic: {
      keyPresent: !!process.env.GENERIC_API_KEY,
      apiBase: process.env.GENERIC_API_BASE || null,
      keyEnv: 'GENERIC_API_KEY',
    },
  };
}

// -----------------------------------------------------------------------------
// LiteLLM subprocess management (spawned on demand; optional)
// -----------------------------------------------------------------------------

let liteLLMProcess = null;

function startLiteLLMSubprocess() {
  // See ../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md for the
  // full lifecycle. Stub: log and no-op. The fresh session's job to flesh
  // out with actual spawn(), health probe, and restart-on-crash.
  console.log(`[scaffold] LiteLLM subprocess would spawn on port ${LITELLM_PORT}`);
  console.log('[scaffold] Fresh session: implement child_process.spawn + health probe here.');
  return null;
}

// -----------------------------------------------------------------------------
// HR29 kill switch — graceful shutdown
// -----------------------------------------------------------------------------

async function killAllAndExit(reason = 'operator-initiated') {
  console.log(`\n[HR29 kill switch] Shutting down (${reason})...`);
  if (liteLLMProcess) {
    try {
      liteLLMProcess.kill('SIGTERM');
      console.log('[HR29 kill switch] LiteLLM subprocess signalled SIGTERM.');
    } catch (e) {
      console.warn('[HR29 kill switch] LiteLLM subprocess kill failed:', e.message);
    }
  }
  console.log('[HR29 kill switch] Downstream agents (Claude Code / Codex / SCX PS module) will now');
  console.log('[HR29 kill switch] talk to their real provider APIs directly. This is by design.');
  process.exit(0);
}

process.on('SIGTERM', () => killAllAndExit('SIGTERM'));
process.on('SIGINT', () => killAllAndExit('SIGINT'));

// -----------------------------------------------------------------------------
// Fastify server
// -----------------------------------------------------------------------------

async function start() {
  showKriticalSCXCodeAgentBanner();

  const slots = detectProviderSlots();
  console.log('[startup] Provider slots:');
  for (const [name, s] of Object.entries(slots)) {
    console.log(`  ${name.padEnd(10)} ${s.keyPresent ? 'LIVE' : 'dormant'}  (${s.keyEnv} ${s.keyPresent ? 'present' : 'absent'})`);
  }

  const app = Fastify({ logger: false });

  app.get('/health/liveliness', async (req, reply) => {
    return {
      ok: true,
      service: 'kritical-scxcode-agent',
      version: '0.1.0',
      providers: slots,
      litellm_subprocess: liteLLMProcess ? 'running' : 'not spawned (scaffold)',
      hr29_kill_switch: {
        stop_daemon: 'POST /admin/kill',
        fully_disable: 'pwsh ./install/Install-KritScxCodeAgent.ps1 -Mode Remove -IUnderstand',
        with_daemon_off: 'downstream agents talk to real provider APIs directly — unaffected',
      },
    };
  });

  app.get('/health/readiness', async () => ({
    ready: true,
    scaffold: true,
    fresh_session_todo: 'wire LiteLLM subprocess health probe here',
  }));

  app.get('/v1/models', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: proxy this to LiteLLM at http://127.0.0.1:' + LITELLM_PORT + '/v1/models',
      brief: '../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md',
    };
  });

  app.post('/v1/messages', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: implement Anthropic-shape passthrough to LiteLLM subprocess.',
    };
  });

  app.post('/v1/chat/completions', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: implement OpenAI-shape passthrough to LiteLLM subprocess.',
    };
  });

  app.post('/v1/auto-continue', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: port ps-module/Kritical.PS.SCXCode.AutoContinue.psm1 to auto-continue.mjs.',
    };
  });

  app.post('/v1/tools/web_search', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: wire Brave / Tavily / DuckDuckGo. See tools/web-search.mjs stub.',
    };
  });

  app.post('/v1/tools/web_fetch', async (req, reply) => {
    reply.code(501);
    return {
      error: 'scaffold',
      message: 'Fresh session: spawn Playwright headless chromium here. See tools/web-fetch.mjs stub.',
    };
  });

  app.post('/admin/kill', async () => {
    setTimeout(() => killAllAndExit('POST /admin/kill'), 100);
    return { shutting_down: true, hr29: true };
  });

  await app.listen({ host: HOST, port: PORT_ANTHROPIC });
  console.log(`[startup] Kritical.NodeJS.SCXCodeAgent listening at http://${HOST}:${PORT_ANTHROPIC}`);
  console.log(`[startup] (Anthropic-shape endpoint. OpenAI-shape planned on :${PORT_OPENAI}.)`);
  console.log('[startup] Repo root:', repoRoot);
  console.log('[startup] Scaffold ready. Fresh session: build out per');
  console.log('[startup]   ../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md');

  // Optionally start LiteLLM subprocess (currently stub)
  if (process.env.KRITICAL_AGENT_SPAWN_LITELLM === '1') {
    liteLLMProcess = startLiteLLMSubprocess();
  } else {
    console.log('[startup] LiteLLM subprocess NOT auto-started. Set KRITICAL_AGENT_SPAWN_LITELLM=1 to enable.');
  }
}

start().catch((err) => {
  console.error('[fatal] Failed to start:', err);
  process.exit(1);
});
