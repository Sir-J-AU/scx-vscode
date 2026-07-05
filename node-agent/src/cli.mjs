#!/usr/bin/env node
// Kritical.NodeJS.SCXCodeAgent CLI wrapper.
// Delegates to the PS installer at ../install/Install-KritScxCodeAgent.ps1
// for HR16 4-mode ops (Install / Remove / Heal / Status). start/stop run
// the Fastify server in-process.
//
// Per HR29 — this CLI never redirects operator env vars. It never overwrites
// ANTHROPIC_BASE_URL / OPENAI_BASE_URL / etc. Direct-API calls stay direct.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerPath = join(__dirname, '..', 'install', 'Install-KritScxCodeAgent.ps1');

const args = process.argv.slice(2);
const cmd = args[0];

function help() {
  console.log(`
Kritical.NodeJS.SCXCodeAgent — CLI

  kritical-scxcode-agent install       (delegates to PS installer -Mode Install)
  kritical-scxcode-agent remove        (delegates to PS installer -Mode Remove)
  kritical-scxcode-agent heal          (delegates to PS installer -Mode Heal)
  kritical-scxcode-agent status        (delegates to PS installer -Mode Status)
  kritical-scxcode-agent start         (foreground: node src/server.mjs)
  kritical-scxcode-agent stop          (POST /admin/kill to running daemon)

HR29 kill switch — stopping this daemon returns every downstream agent
(Claude Code / Codex / SCX PS module) to talking to their real provider APIs
directly. Nothing breaks.

Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655
`);
}

async function runInstaller(mode) {
  const args = ['-NoProfile', '-File', installerPath, '-Mode', mode];
  return new Promise((resolve, reject) => {
    const p = spawn('pwsh', args, { stdio: 'inherit' });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`pwsh exit ${code}`)));
  });
}

async function stopViaKill() {
  const port = process.env.KRITICAL_AGENT_PORT_ANTHROPIC || '4180';
  const host = process.env.KRITICAL_AGENT_HOST || '127.0.0.1';
  const url = `http://${host}:${port}/admin/kill`;
  try {
    const r = await fetch(url, { method: 'POST' });
    console.log('[stop] POST /admin/kill ->', r.status);
  } catch (e) {
    console.error('[stop] Failed to POST /admin/kill:', e.message);
    console.log('[stop] Daemon may already be down. Verify with:');
    console.log('  kritical-scxcode-agent status');
    process.exit(1);
  }
}

switch (cmd) {
  case 'install':
  case 'remove':
  case 'heal':
  case 'status': {
    const mode = cmd[0].toUpperCase() + cmd.slice(1);
    await runInstaller(mode);
    break;
  }
  case 'start':
    await import('./server.mjs');
    break;
  case 'stop':
    await stopViaKill();
    break;
  case 'help':
  case '-h':
  case '--help':
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    help();
    process.exit(1);
}
