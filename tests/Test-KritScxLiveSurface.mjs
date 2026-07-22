#!/usr/bin/env node
// Validates the mined SCX OpenAPI candidate and, when requested, performs bounded live probes.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const includeAudio = args.has('--include-audio');
const includeTools = args.has('--include-tools');
const outPath = valueAfter('--out') || join(repoRoot, 'UpstreamDocumentation', live ? 'scx-live-smoke.latest.json' : 'scx-spec-validate.latest.json');
const specPath = valueAfter('--spec') || join(repoRoot, 'UpstreamDocumentation', 'scx-openapi.candidate.json');
const baseUrl = process.env.SCX_BASE_URL || 'https://api.scx.ai/v1';
const apiKey = process.env.SCX_API_KEY;
const model = process.env.SCX_SMOKE_MODEL || 'Meta-Llama-3.3-70B-Instruct';
const responsesModel = process.env.SCX_SMOKE_RESPONSES_MODEL || 'gpt-oss-120b';
const embeddingModel = process.env.SCX_SMOKE_EMBEDDING_MODEL || 'E5-Mistral-7B-Instruct';

function valueAfter(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function validateSpec(spec) {
  const checks = [];
  const requiredPaths = [
    '/models',
    '/chat/completions',
    '/responses',
    '/embeddings',
    '/audio/speech',
    '/audio/transcriptions',
    '/audio/translations',
    '/batches',
    '/vector-stores',
    '/vector-stores/{store_id}/files',
    '/vector-stores/{store_id}/search',
  ];
  for (const path of requiredPaths) {
    assert(spec.paths[path], `OpenAPI candidate missing path ${path}`);
    checks.push({ name: `spec:path:${path}`, status: 'pass' });
  }
  assert(spec.openapi === '3.1.1', `Expected OpenAPI 3.1.1, got ${spec.openapi}`);
  checks.push({ name: 'spec:openapi-3.1.1', status: 'pass' });

  const chat = spec.components.schemas.ChatCompletionRequest;
  assert(chat.properties.temperature.maximum === 1, 'Chat temperature maximum must reflect SCX OpenAI-compatible 0..1 range');
  assert(chat.properties.top_k, 'Chat schema missing SCX top_k');
  assert(chat.properties.logprobs.deprecated === true, 'Chat schema should flag unsupported logprobs as deprecated/ignored');
  checks.push({ name: 'spec:openai-compat-params', status: 'pass' });

  const speech = spec.components.schemas.SpeechRequest;
  assert(speech.properties.model.enum.includes('scx-tts'), 'Speech schema missing scx-tts');
  assert(speech.properties.input.maxLength === 5000, 'Speech input maxLength must be 5000');
  assert(speech.properties.response_format.default === 'wav', 'Speech default response_format must be wav');
  assert(speech.properties.max_new_tokens.maximum === 4096, 'Speech max_new_tokens upper bound must be 4096');
  checks.push({ name: 'spec:speech-current-surface', status: 'pass' });

  const tools = chat.properties.tools.items.properties.type.enum;
  for (const toolName of ['web_search', 'youtube_search', 'mcp_search', 'file_retrieval', 'code_interpreter']) {
    assert(tools.includes(toolName), `Tool enum missing ${toolName}`);
  }
  checks.push({ name: 'spec:server-tools', status: 'pass' });
  return checks;
}

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let json = null;
  if (contentType.includes('json') && text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: response.status, ok: response.ok, contentType, text, json };
}

function redactResult(result) {
  const preview = result.text ? result.text.slice(0, 500) : '';
  return {
    status: result.status,
    ok: result.ok,
    contentType: result.contentType,
    preview,
  };
}

async function liveChecks() {
  if (!apiKey) throw new Error('SCX_API_KEY is required for --live');
  const checks = [];

  const models = await api('/models');
  assert(models.ok, `GET /models failed: ${models.status} ${models.text.slice(0, 200)}`);
  const modelRows = Array.isArray(models.json?.data) ? models.json.data : [];
  assert(modelRows.length > 0, 'GET /models returned no model rows');
  checks.push({ name: 'live:models', status: 'pass', count: modelRows.length });

  const chat = await api('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: scx-smoke-ok' }],
      temperature: 0,
      max_tokens: 16,
      top_k: 1,
    }),
  });
  checks.push({ name: 'live:chat-completions', status: chat.ok ? 'pass' : 'warn', result: redactResult(chat) });

  const responses = await api('/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: responsesModel,
      input: 'Reply with exactly: scx-response-ok',
      temperature: 0,
      max_output_tokens: 16,
      store: false,
    }),
  });
  checks.push({ name: 'live:responses', status: responses.ok ? 'pass' : 'warn', result: redactResult(responses) });

  const embeddings = await api('/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      model: embeddingModel,
      input: 'SCX smoke embedding',
    }),
  });
  checks.push({ name: 'live:embeddings', status: embeddings.ok ? 'pass' : 'warn', result: redactResult(embeddings) });

  const batches = await api('/batches');
  checks.push({ name: 'live:batches-list', status: batches.ok ? 'pass' : 'warn', result: redactResult(batches) });

  const vectorStores = await api('/vector-stores');
  checks.push({ name: 'live:vector-stores-list', status: vectorStores.ok ? 'pass' : 'warn', result: redactResult(vectorStores) });

  if (includeTools) {
    const tools = await api('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Use the supplied function to return weather for Sydney.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Return weather for a city.',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        }],
        tool_choice: 'required',
        temperature: 0,
        max_tokens: 64,
      }),
    });
    checks.push({ name: 'live:function-tool-required', status: tools.ok ? 'pass' : 'warn', result: redactResult(tools) });
  }

  if (includeAudio) {
    const audio = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'scx-tts',
        input: 'SCX smoke test.',
        response_format: 'wav',
      }),
    });
    const chunk = new Uint8Array(await audio.arrayBuffer());
    checks.push({
      name: 'live:audio-speech',
      status: audio.ok && chunk.length > 44 ? 'pass' : 'warn',
      result: { status: audio.status, ok: audio.ok, contentType: audio.headers.get('content-type') || '', bytes: chunk.length },
    });
  }

  return checks;
}

async function main() {
  const spec = await readJson(specPath);
  const checks = validateSpec(spec);
  if (live) checks.push(...await liveChecks());
  const failed = checks.filter((c) => c.status === 'fail');
  const report = {
    captured_utc: new Date().toISOString(),
    mode: live ? 'live' : 'offline',
    base_url: baseUrl,
    spec_path: specPath,
    live_models: live ? { chat: model, responses: responsesModel, embeddings: embeddingModel } : null,
    checks,
    failed: failed.length,
  };
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
