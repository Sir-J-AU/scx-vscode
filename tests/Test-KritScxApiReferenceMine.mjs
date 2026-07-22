import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEndpoints, extractLinks, buildOpenApiCandidate } from '../install/Invoke-KritScxApiReferenceMine.mjs';

test('extractEndpoints mines SCX rendered API reference route rows', () => {
  const text = 'POST Create embeddings /embeddings GET List models /models GET Retrieve batch /batches/{batch_id POST Cancel batch /batches/{batch_id}/cancel WS Realtime audio (WebSocket) /realtime';
  const endpoints = extractEndpoints(text);
  assert.deepEqual(endpoints.map((e) => `${e.method} ${e.path}`), [
    'POST /batches/{batch_id}/cancel',
    'GET /batches/{batch_id}',
    'POST /embeddings',
    'GET /models',
    'WS /realtime',
  ]);
});

test('extractLinks keeps only platform docs/reference links', () => {
  const links = extractLinks('<a href="/docs/models">m</a><a href="https://scx.ai/">x</a><a href="/api-reference#top">api</a>', 'https://platform.scx.ai/docs');
  assert.deepEqual(links, ['https://platform.scx.ai/api-reference', 'https://platform.scx.ai/docs/models']);
});

test('buildOpenApiCandidate emits paths from mined endpoints', () => {
  const spec = buildOpenApiCandidate([{ method: 'POST', path: '/responses', summary: 'Create response' }]);
  assert.equal(spec.openapi, '3.1.1');
  assert.equal(spec.servers[0].url, 'https://api.scx.ai/v1');
  assert.equal(spec.paths['/responses'].post.summary, 'Create response');
  assert.equal(spec.paths['/responses'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/ResponseCreateRequest');
  assert.ok(spec.components.schemas.ResponseCreateRequest.properties.tools.items.properties.type.enum.includes('web_search'));
  assert.equal(spec.components.schemas.ChatCompletionRequest.properties.temperature.maximum, 1);
  assert.ok(spec['x-scx-doc-notes'].openai_compatibility.unsupported_openai_parameters_ignored.includes('logprobs'));
});

test('buildOpenApiCandidate captures current SCX speech surface', () => {
  const spec = buildOpenApiCandidate([{ method: 'POST', path: '/audio/speech', summary: 'Create speech' }]);
  const speech = spec.components.schemas.SpeechRequest;
  assert.deepEqual(speech.properties.model.enum, ['scx-tts']);
  assert.equal(speech.properties.input.maxLength, 5000);
  assert.equal(speech.properties.response_format.default, 'wav');
  assert.equal(speech.properties.speed.minimum, 0.25);
  assert.equal(speech.properties.speed.maximum, 4.0);
  assert.equal(speech.properties.max_new_tokens.maximum, 4096);
  assert.ok(spec.paths['/audio/speech'].post.requestBody.content['multipart/form-data']);
  assert.ok(spec.paths['/audio/speech'].post.responses[200].content['audio/wav']);
});
