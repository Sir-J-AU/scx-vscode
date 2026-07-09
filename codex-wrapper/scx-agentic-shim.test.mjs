// HR21 paired test for the SCX agentic flatten-shim (transform logic only — no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenTool,
  transformRequestBody,
  isPlanGateError,
  isContextLimitError,
  isRetryableUpstreamStatus,
  parseRetryAfterMs,
  normalizeScxRequestBody,
  remapModelsResponse,
} from './scx-agentic-shim.mjs';

test('function tools pass through unchanged', () => {
  const t = { type: 'function', name: 'shell_command', parameters: { type: 'object', properties: {} } };
  assert.deepEqual(flattenTool(t, false), [t]);
});

test('local_shell / custom / freeform become function tools with the name preserved', () => {
  for (const type of ['local_shell', 'custom', 'freeform']) {
    const out = flattenTool({ type, name: 'shell' }, false);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'function');
    assert.equal(out[0].name, 'shell');
    assert.ok(out[0].parameters);
  }
});

test('namespace tool flattens to its inner function tools', () => {
  const ns = { type: 'namespace', namespace: 'apps', tools: [
    { type: 'function', name: 'a', parameters: { type: 'object', properties: {} } },
    { type: 'function', name: 'b', parameters: { type: 'object', properties: {} } },
  ] };
  const out = flattenTool(ns, false);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.type), ['function', 'function']);
  assert.deepEqual(out.map((t) => t.name), ['a', 'b']);
});

test('server tools kept normally, dropped on retry', () => {
  const ws = { type: 'web_search' };
  assert.deepEqual(flattenTool(ws, false), [ws]);      // normal request keeps it
  assert.deepEqual(flattenTool(ws, true), []);         // plan-gate retry drops it
});

test('transformRequestBody rewrites a realistic codex tool array', () => {
  const body = { model: 'gpt-oss-120b', tools: [
    { type: 'function', name: 'shell_command', parameters: { type: 'object', properties: {} } },
    { type: 'namespace', tools: [{ type: 'function', name: 'x', parameters: { type: 'object', properties: {} } }] },
    { type: 'web_search' },
  ] };
  const normal = transformRequestBody(body, false);
  assert.deepEqual(normal.tools.map((t) => t.type), ['function', 'function', 'web_search']);
  const retry = transformRequestBody(body, true);
  assert.deepEqual(retry.tools.map((t) => t.type), ['function', 'function']); // web_search dropped
  assert.ok(retry.tools.every((t) => t.type === 'function'));
});

test('isPlanGateError detects SCX plan-gate 400s only', () => {
  assert.equal(isPlanGateError(400, 'The model `gpt-oss-120b` is not available on your current plan.'), true);
  assert.equal(isPlanGateError(400, '{"code":"model_not_in_plan"}'), true);
  assert.equal(isPlanGateError(400, 'some other bad request'), false);
  assert.equal(isPlanGateError(200, 'current plan'), false);
});

test('retry helpers classify SCX transient pressure without retrying context-limit errors', () => {
  assert.equal(isRetryableUpstreamStatus(429), true);
  assert.equal(isRetryableUpstreamStatus(529), true);
  assert.equal(isRetryableUpstreamStatus(503), true);
  assert.equal(isRetryableUpstreamStatus(400), false);
  assert.equal(isContextLimitError(400, '{"code":"context_length_exceeded","message":"Please reduce the length of the messages"}'), true);
  assert.equal(parseRetryAfterMs('2'), 2000);
});

test('remapModelsResponse returns Codex-safe ModelInfo rows and rebuilds consumed non-json bodies', async () => {
  const remapped = await remapModelsResponse(new Response(JSON.stringify({ data: [
    { id: 'MiniMax-M2.7', context_length: 192000, supported_features: ['tools', 'reasoning'], input_modalities: ['text', 'image'] },
    { id: 'Whisper-Large-v3', input_modalities: ['audio'] },
  ] }), { status: 200 }));
  const json = await remapped.json();
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].slug, 'MiniMax-M2.7');
  assert.equal(json.data[0].display_name, 'MiniMax-M2.7');
  assert.equal(json.data[0].shell_type, 'shell_command');
  assert.equal(json.data[0].visibility, 'list');
  assert.equal(json.data[0].context_window, 192000);
  assert.equal(json.data[0].supports_parallel_tool_calls, true);
  assert.deepEqual(json.data[0].input_modalities, ['text', 'image']);
  assert.deepEqual(json.data[0].supported_reasoning_levels.map((x) => x.effort), ['low', 'medium', 'high']);
  assert.deepEqual(json.models, json.data);

  const passthrough = await remapModelsResponse(new Response('not-json', { status: 502 }));
  assert.equal(await passthrough.text(), 'not-json');
});

test('normalizeScxRequestBody strips unsupported OpenAI params and clamps SCX temperature', () => {
  const { body, warnings } = normalizeScxRequestBody({
    model: 'MiniMax-M2.7',
    temperature: 1.7,
    logprobs: true,
    top_logprobs: 2,
    seed: 123,
  }, '/v1/chat/completions');
  assert.equal(body.temperature, 1);
  assert.equal(body.logprobs, undefined);
  assert.equal(body.top_logprobs, undefined);
  assert.equal(body.seed, undefined);
  assert.ok(warnings.some((w) => w.includes('clamped temperature')));
  assert.ok(warnings.some((w) => w.includes('logprobs')));
});

test('normalizeScxRequestBody maps common max-token field drift by endpoint', () => {
  const responses = normalizeScxRequestBody({ max_tokens: 44 }, '/v1/responses').body;
  assert.equal(responses.max_output_tokens, 44);
  assert.equal(responses.max_tokens, undefined);

  const chat = normalizeScxRequestBody({ max_output_tokens: 55 }, '/v1/chat/completions').body;
  assert.equal(chat.max_tokens, 55);
  assert.equal(chat.max_output_tokens, undefined);
});
