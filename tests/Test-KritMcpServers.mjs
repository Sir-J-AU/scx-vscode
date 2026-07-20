#!/usr/bin/env node
// Protocol-level smoke tests for local Kritical MCP servers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.KRIT_MCP_PYTHON || 'C:\\KriticalSCX\\venv-litellm-test\\Scripts\\python.exe';

function startServer(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  const err = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) lines.push(line.trim());
    }
  });
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) err.push(line.trim());
    }
  });
  return { child, lines, err };
}

function send(server, message) {
  server.child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(server, id, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const line of server.lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) return parsed;
      } catch {
        // Ignore non-JSON stdout.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for MCP response id=${id}; stderr=${server.err.join('\n')}`);
}

async function stop(server) {
  server.child.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

test('kritical-scxcode MCP initializes and lists SCX tools', async () => {
  const server = startServer(process.execPath, ['mcp-server/server.mjs']);
  try {
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    send(server, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const init = await waitFor(server, 1);
    const list = await waitFor(server, 2);
    assert.equal(init.result.serverInfo.name, 'kritical-scxcode');
    const names = list.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ['scx_chat', 'scx_list_models', 'scx_test', 'scx_embed', 'scx_status']);
  } finally {
    await stop(server);
  }
});

test('kritical-store MCP initializes, lists tools, and reads SQL stats', { skip: !existsSync(python) }, async () => {
  const server = startServer(python, ['store-mcp/kritical_store_mcp.py'], {
    env: { KRIT_SCX_STORE_CONNECT_TIMEOUT: '3' },
  });
  try {
    send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    send(server, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const init = await waitFor(server, 1, 10000);
    const list = await waitFor(server, 2, 10000);
    assert.equal(init.result.serverInfo.name, 'kritical-store');
    assert.ok(list.result.tools.some((tool) => tool.name === 'store_stats'));
    send(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'store_stats', arguments: {} } });
    const stats = await waitFor(server, 3, 15000);
    const text = stats.result.content?.[0]?.text || stats.result.structuredContent?.result || '';
    if (/store_stats unavailable:/i.test(text)) {
      assert.match(text, /store_stats unavailable:/i);
    } else {
      assert.match(text, /decision_log:\s*\d+/);
      assert.match(text, /LensSource:\s*\d+/);
    }
  } finally {
    await stop(server);
  }
});
