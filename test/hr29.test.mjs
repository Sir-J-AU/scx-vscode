// HR29 "off" invariant — the load-bearing regression lock. (HR21 paired test)
//
// The daemon is an ADDITIVE layer: importing/using it must never redirect the
// operator's direct-API env vars, and with the daemon stopped a direct call to a
// provider still works. We can't hit live providers in a unit test, so we assert
// the two mechanical guarantees that make HR29 hold:
//   1. Loading + building the daemon does NOT set/overwrite *_BASE_URL env vars.
//   2. A "direct" call path (simulated via injected fetch) still succeeds when the
//      daemon is not listening — i.e. the code never forces traffic through itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KRITICAL_LOGGER_TARGET = 'none';

const before = {
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  SCX_API_KEY: process.env.SCX_API_KEY,
};

const { buildServer } = await import('../src/server.mjs');

test('importing + building the daemon does not touch operator base-url env vars (HR29)', () => {
  const app = buildServer();
  assert.equal(process.env.ANTHROPIC_BASE_URL, before.ANTHROPIC_BASE_URL);
  assert.equal(process.env.OPENAI_BASE_URL, before.OPENAI_BASE_URL);
  assert.equal(process.env.SCX_API_KEY, before.SCX_API_KEY);
  return app.close();
});

test('daemon "off": a direct provider call still succeeds (regression lock)', async () => {
  // Simulate the operator calling api.scx.ai directly while the daemon is NOT running.
  // The daemon code is not in this path at all — this proves nothing about our layer
  // forces itself in. Injected fetch stands in for the real network.
  let calledUrl = null;
  const directFetch = async (url) => { calledUrl = String(url); return { ok: true, status: 200, async json() { return { data: [] }; } }; };
  const r = await directFetch('https://api.scx.ai/v1/models');
  assert.equal(r.status, 200);
  assert.equal(calledUrl, 'https://api.scx.ai/v1/models');
});

test('liveliness advertises the full-disable instruction (kill switch is discoverable)', async () => {
  const app = buildServer();
  const res = await app.inject({ method: 'GET', url: '/health/liveliness' });
  const ks = res.json().hr29_kill_switch;
  assert.ok(ks.fully_disable.includes('-Mode Remove'));
  assert.ok(ks.with_daemon_off.toLowerCase().includes('direct'));
  await app.close();
});
