// Kritical SCX — CROSS-AGENT CHUNK SERVER. A localhost-only, token-secured, per-agent-namespaced HTTP
// endpoint over the chunk-store, so ANY coding agent (scxcodex now; codex / Claude Code / etc later) can
// use the synthetic-context editing loop: chunk a massive file, pull a budget-fit synthetic window, edit
// a focus chunk, reassemble. This is "any agent can use our storage".
//
// Security (HR29): binds 127.0.0.1 ONLY (never 0.0.0.0). Bearer token required (KRIT_CHUNK_TOKEN or a
// persisted generated one). Per-agent namespace isolates each agent's chunk DB. Optional KRIT_CHUNK_ROOT
// confines file paths under a root. HR1: this server serves TEXT only — it never reads SCX_API_KEY
// (summarization is a separate SCX-holding process).
//
//   node store-mcp/kritical-chunk-server.mjs            # start on 127.0.0.1:4270
//   POST /v1/context  { ns, file, focus, budget }  -> synthetic edit window (focus full + map)
//   POST /v1/chunk|map|apply|reassemble            (see routes below)   Authorization: Bearer <token>
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOST = '127.0.0.1';                                     // HR29: localhost only, never 0.0.0.0
const PORT = parseInt(process.env.KRIT_CHUNK_PORT || '4270', 10);
const STORE_CLI = join(dirname(fileURLToPath(import.meta.url)), 'kritical-chunk-store.mjs');
const NS_BASE = join(homedir(), '.kritical-scx', 'chunk-ns');
const ROOT = process.env.KRIT_CHUNK_ROOT ? resolve(process.env.KRIT_CHUNK_ROOT) : null; // optional path jail
mkdirSync(NS_BASE, { recursive: true });

function resolveToken() {
  if (process.env.KRIT_CHUNK_TOKEN) return process.env.KRIT_CHUNK_TOKEN;
  const f = join(homedir(), '.kritical-scx', 'chunk-token.txt');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const t = randomBytes(24).toString('hex'); writeFileSync(f, t, { mode: 0o600 }); return t;
}
const nsDb = (ns) => join(NS_BASE, `chunk-${String(ns || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}.db`);
const pathAllowed = (p) => !ROOT || resolve(p).startsWith(ROOT);

function runStore(dbPath, args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [STORE_CLI, ...args], { env: { ...process.env, KRIT_CHUNK_STORE: dbPath }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; let done = false;
    const fin = (code) => { if (!done) { done = true; res({ code, out, err }); } };
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => fin(code));
    child.on('error', (e) => { err += String(e); fin(1); });
    setTimeout(() => { try { child.kill(); } catch { /* noop */ } err += ' [timeout]'; fin(124); }, 20_000);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function createChunkServer({ token = resolveToken() } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'kritical-chunk-server', root: ROOT || '(unrestricted)' });
    // Bearer auth on everything else.
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth || auth !== token) return json(res, 401, { ok: false, error: 'unauthorized (Authorization: Bearer <token>)' });
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });

    const chunks = [];
    req.on('data', (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 8_000_000) req.destroy(); });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad JSON' }); }
      const verb = url.pathname.replace(/^\/v1\//, '');
      const db = nsDb(body.ns);
      const file = body.file;
      if (['chunk', 'map', 'context', 'apply', 'reassemble'].includes(verb) && !file) return json(res, 400, { ok: false, error: 'file required' });
      if (file && !pathAllowed(file)) return json(res, 403, { ok: false, error: 'path outside KRIT_CHUNK_ROOT' });
      try {
        if (verb === 'chunk') { const r = await runStore(db, ['chunk', file]); return json(res, r.code ? 500 : 200, { ok: !r.code, output: r.out.trim(), error: r.err.trim() || undefined }); }
        if (verb === 'map') { const r = await runStore(db, ['map', file]); return json(res, 200, { ok: true, map: r.out }); }
        if (verb === 'context') { const r = await runStore(db, ['context', file, String(body.focus ?? '1'), String(body.budget ?? 12000)]); return json(res, 200, { ok: true, context: r.out, meta: r.err.trim() }); }
        if (verb === 'apply') {
          if (typeof body.content !== 'string') return json(res, 400, { ok: false, error: 'content required' });
          const tmp = join(tmpdir(), `krit-apply-${randomBytes(6).toString('hex')}.txt`);
          writeFileSync(tmp, body.content, 'utf8');
          const r = await runStore(db, ['apply', file, String(body.idx), tmp]);
          return json(res, r.code ? 500 : 200, { ok: !r.code, output: r.out.trim(), error: r.err.trim() || undefined });
        }
        if (verb === 'reassemble') { const r = await runStore(db, ['reassemble', file]); return json(res, 200, { ok: true, content: r.out }); }
        return json(res, 404, { ok: false, error: `unknown verb '${verb}'` });
      } catch (e) { return json(res, 500, { ok: false, error: String(e && e.message || e) }); }
    });
  });
}

// Run directly = start the server. Importing (for tests) does NOT auto-listen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = resolveToken();
  createChunkServer({ token }).listen(PORT, HOST, () => {
    console.log(`Kritical chunk server -> http://${HOST}:${PORT}  (per-agent namespaced; token in ~/.kritical-scx/chunk-token.txt)`);
    console.log(`Any agent: POST /v1/context {ns,file,focus,budget} with 'Authorization: Bearer <token>'. Path jail: ${ROOT || '(set KRIT_CHUNK_ROOT to confine)'}`);
  });
}
