// Daemon health + graceful kill via fastify inject (no real port). (HR21 paired test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KRITICAL_LOGGER_TARGET = 'none';

const { buildServer, detectProviderSlots } = await import('../src/server.mjs');

test('GET /health/liveliness returns ok + provider slots + HR29 kill switch', async () => {
  const app = buildServer();
  const res = await app.inject({ method: 'GET', url: '/health/liveliness' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'kritical-scxcode-agent');
  assert.ok(body.providers.scx && 'keyPresent' in body.providers.scx);
  assert.ok(body.hr29_kill_switch.stop_daemon.includes('/admin/kill'));
  await app.close();
});

test('POST /admin/kill acknowledges and invokes the kill callback (HR29)', async () => {
  let killedReason = null;
  const app = buildServer({ onKill: (r) => { killedReason = r; } });
  const res = await app.inject({ method: 'POST', url: '/admin/kill' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().shutting_down, true);
  await new Promise((r) => setTimeout(r, 80)); // kill fires on a short timer
  assert.equal(killedReason, 'POST /admin/kill');
  await app.close();
});

test('detectProviderSlots reports a slot per provider with keyEnv', () => {
  const slots = detectProviderSlots();
  for (const name of ['scx', 'anthropic', 'openai', 'generic']) {
    assert.ok(slots[name], `slot ${name} present`);
    assert.ok('keyPresent' in slots[name] && 'keyEnv' in slots[name]);
  }
});

test('/v1/auto-continue returns an Anthropic-shape envelope (mock upstream)', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    async json() { return { content: [{ type: 'text', text: 'merged answer.' }], stop_reason: 'end_turn' }; },
    async text() { return ''; },
  });
  const app = buildServer({ fetchImpl });
  const res = await app.inject({ method: 'POST', url: '/v1/auto-continue', payload: { prompt: 'hello', model: 'minimax-m2.7' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.type, 'message');
  assert.equal(body.content[0].text, 'merged answer.');
  assert.ok(body.kritical_auto_continue.turn_count >= 1);
  await app.close();
});
