#!/usr/bin/env node
// Kritical SCX — platform docs/API-reference miner.
//
// Fetches platform.scx.ai docs/reference pages, records the raw HTML, extracts route inventory, and
// emits a conservative OpenAPI candidate when no upstream spec is found. No credentials required.

import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SEEDS = [
  'https://platform.scx.ai/docs',
  'https://platform.scx.ai/api-reference',
];

const SPEC_CANDIDATES = [
  'https://platform.scx.ai/openapi.json',
  'https://platform.scx.ai/api-reference/openapi.json',
  'https://api.scx.ai/openapi.json',
  'https://api.scx.ai/v1/openapi.json',
];

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|WS)\s+([^/\n]*?)\s+(\/[a-zA-Z0-9._~:/{}-]+)\b/g;
const LINK_RE = /href=["']([^"'#]+)(?:#[^"']*)?["']/g;
const SCX_SERVER_TOOLS = [
  'web_search', 'code_interpreter', 'file_retrieval', 'academic_search', 'youtube_search', 'reddit_search',
  'x_search', 'mcp_search', 'trove_search', 'retrieve', 'movie_tv_search', 'trending_movies', 'trending_tv',
  'mermaid_diagram', 'coin_data', 'coin_data_by_contract', 'coin_ohlc', 'currency_converter', 'stock_chart',
  'stock_price', 'find_place_on_map', 'nearby_places_search', 'weather', 'travel_advisor', 'flight_tracker',
  'flight_live_tracker', 'datetime', 'greeting', 'text_translate', 'memory_manager',
];

const OPENAI_COMPAT_UNSUPPORTED_PARAMS = [
  'logprobs',
  'top_logprobs',
  'n',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'seed',
];

const SPEECH_VOICE_REF_FORMATS = ['mp3', 'wav', 'pcm'];
const SPEECH_RESPONSE_FORMATS = ['mp3', 'wav', 'pcm'];
const AUDIO_RESPONSE_FORMATS = ['json', 'text', 'srt', 'verbose_json', 'vtt'];

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractLinks(html, baseUrl) {
  const out = new Set();
  for (const m of String(html).matchAll(LINK_RE)) {
    try {
      const url = new URL(m[1], baseUrl);
      if (url.protocol === 'https:' && url.hostname === 'platform.scx.ai') out.add(url.href.replace(/\/$/, ''));
    } catch {
      // Ignore malformed links from rendered docs.
    }
  }
  return [...out].sort();
}

export function extractEndpoints(text) {
  const endpoints = new Map();
  for (const m of String(text).matchAll(METHOD_RE)) {
    const method = m[1].toUpperCase();
    const summary = m[2].trim().replace(/\s+/g, ' ');
    const path = normalizePath(m[3].trim());
    const key = `${method} ${path}`;
    endpoints.set(key, { method, path, summary });
  }
  return [...endpoints.values()].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

function normalizePath(path) {
  let out = path;
  const opens = (out.match(/{/g) || []).length;
  const closes = (out.match(/}/g) || []).length;
  if (opens > closes) out += '}'.repeat(opens - closes);
  return out;
}

export function buildOpenApiCandidate(endpoints) {
  const paths = {};
  for (const ep of endpoints) {
    const method = ep.method === 'WS' ? 'get' : ep.method.toLowerCase();
    paths[ep.path] ??= {};
    paths[ep.path][method] = {
      summary: ep.summary || `${ep.method} ${ep.path}`,
      'x-scx-mined': true,
      responses: {
        200: {
          description: 'Successful response.',
          content: { 'application/json': { schema: responseSchemaRef(ep) } },
        },
      },
      ...operationShape(ep),
    };
  }
  return {
    openapi: '3.1.1',
    info: {
      title: 'SCX.ai API - mined candidate',
      version: new Date().toISOString().slice(0, 10),
      description: 'Generated from https://platform.scx.ai/api-reference when no official OpenAPI document was discoverable.',
    },
    servers: [{ url: 'https://api.scx.ai/v1' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: commonSchemas(),
    },
    security: [{ bearerAuth: [] }],
    'x-scx-doc-notes': {
      openai_compatibility: {
        base_url: 'https://api.scx.ai/v1',
        unsupported_openai_parameters_ignored: OPENAI_COMPAT_UNSUPPORTED_PARAMS,
        scx_only_parameters: ['top_k'],
        temperature_range: '0..1 in the OpenAI compatibility guide; some API reference pages still describe 0..2. Treat 0..1 as the compatibility-safe client range.',
      },
      speech: {
        current_public_model: 'scx-tts',
        default_response_format: 'wav',
        stored_voice_ids: 'Enroll with POST /v1/audio/voices and pass returned voice_... ID as voice.',
        inline_voice_cloning: ['voice_ref_wav_b64', 'voice_ref_wav_format', 'ref_text', 'x_vector_only_mode'],
      },
    },
  };
}

function jsonContent(schema) {
  return { content: { 'application/json': { schema } } };
}

function multipartContent(schema) {
  return { content: { 'multipart/form-data': { schema } } };
}

function jsonAndMultipartContent(schema) {
  return {
    content: {
      'application/json': { schema },
      'multipart/form-data': { schema },
    },
  };
}

function binaryContent(schema) {
  return {
    content: {
      'audio/wav': { schema },
      'audio/mpeg': { schema },
      'audio/pcm': { schema },
      'application/octet-stream': { schema },
    },
  };
}

function pathParameters(path) {
  return [...path.matchAll(/{([^}]+)}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function operationShape(ep) {
  const parameters = pathParameters(ep.path);
  const shape = { parameters };
  if (ep.method === 'GET' || ep.method === 'DELETE' || ep.method === 'WS') return shape;
  const p = ep.path;
  if (p === '/responses') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/ResponseCreateRequest' }) };
  if (p === '/chat/completions') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/ChatCompletionRequest' }) };
  if (p === '/completions') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/CompletionRequest' }) };
  if (p === '/messages') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/AnthropicMessageRequest' }) };
  if (p === '/embeddings') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/EmbeddingRequest' }) };
  if (p === '/moderations') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/ModerationRequest' }) };
  if (p === '/audio/transcriptions' || p === '/audio/translations') return { ...shape, requestBody: multipartContent({ $ref: '#/components/schemas/AudioTranscriptionRequest' }) };
  if (p === '/audio/speech') return {
    ...shape,
    requestBody: jsonAndMultipartContent({ $ref: '#/components/schemas/SpeechRequest' }),
    responses: {
      200: {
        description: 'Streamed binary audio in the requested format.',
        ...binaryContent({ type: 'string', format: 'binary' }),
      },
    },
  };
  if (p === '/audio/voices') return { ...shape, requestBody: multipartContent({ $ref: '#/components/schemas/VoiceCreateRequest' }) };
  if (p === '/batches') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/BatchCreateRequest' }) };
  if (p === '/vector-stores') return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/VectorStoreCreateRequest' }) };
  if (p.endsWith('/files')) return { ...shape, requestBody: multipartContent({ $ref: '#/components/schemas/VectorStoreFileUploadRequest' }) };
  if (p.endsWith('/search')) return { ...shape, requestBody: jsonContent({ $ref: '#/components/schemas/VectorStoreSearchRequest' }) };
  return shape;
}

function responseSchemaRef(ep) {
  if (ep.path === '/models') return { $ref: '#/components/schemas/ModelListResponse' };
  if (ep.path === '/chat/completions') return { $ref: '#/components/schemas/ChatCompletionResponse' };
  if (ep.path === '/messages') return { $ref: '#/components/schemas/AnthropicMessageResponse' };
  if (ep.path === '/responses') return { $ref: '#/components/schemas/ResponseObject' };
  if (ep.path === '/embeddings') return { $ref: '#/components/schemas/EmbeddingResponse' };
  if (ep.path === '/audio/speech') return { type: 'string', format: 'binary' };
  if (ep.path === '/audio/transcriptions' || ep.path === '/audio/translations') return { $ref: '#/components/schemas/AudioTextResponse' };
  if (ep.path === '/batches' && ep.method === 'GET') return { $ref: '#/components/schemas/BatchListResponse' };
  if (ep.path.startsWith('/vector-stores')) return { $ref: '#/components/schemas/ObjectResponse' };
  return { $ref: '#/components/schemas/ObjectResponse' };
}

function commonSchemas() {
  const sampling = {
    temperature: { type: 'number', minimum: 0, maximum: 1, description: 'SCX OpenAI-compatibility safe range is 0..1.' },
    top_p: { type: 'number', minimum: 0, maximum: 1 },
    top_k: { type: 'integer', minimum: 0 },
    max_tokens: { type: 'integer', minimum: 1 },
    stop: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    frequency_penalty: { type: 'number', deprecated: true, description: 'OpenAI compatibility guide says this parameter is currently unsupported and ignored.' },
    presence_penalty: { type: 'number', deprecated: true, description: 'OpenAI compatibility guide says this parameter is currently unsupported and ignored.' },
    seed: { type: 'integer', deprecated: true, description: 'OpenAI compatibility guide says this parameter is currently unsupported and ignored.' },
  };
  const tool = {
    type: 'object',
    additionalProperties: true,
    properties: {
      type: { type: 'string', description: 'SCX accepts OpenAI function tools and SCX server tools.', enum: ['function', ...SCX_SERVER_TOOLS] },
      function: { type: 'object', additionalProperties: true },
    },
  };
  return {
    ObjectResponse: { type: 'object', additionalProperties: true },
    ModelListResponse: {
      type: 'object',
      additionalProperties: true,
      properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ModelObject' } } },
    },
    ModelObject: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        context_length: { type: 'integer' },
        max_output_length: { type: 'integer' },
        pricing: { type: 'object', additionalProperties: true },
        supported_sampling_parameters: { type: 'array', items: { type: 'string' } },
        supported_features: { type: 'array', items: { type: 'string' } },
        datacenters: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
    ChatMessage: { type: 'object', additionalProperties: true, properties: { role: { type: 'string' }, content: {} } },
    ChatCompletionRequest: {
      type: 'object', required: ['model', 'messages'], additionalProperties: true,
      properties: {
        model: { type: 'string' },
        messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
        tools: { type: 'array', items: tool },
        tool_choice: {
          oneOf: [
            { type: 'string', enum: ['auto', 'required', 'none'] },
            { type: 'object', additionalProperties: true },
          ],
        },
        response_format: {},
        reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Function-calling guide recommends high for gpt-oss-120b tool-calling quality.' },
        stream: { type: 'boolean' },
        logprobs: { type: 'boolean', deprecated: true, description: 'Currently unsupported by SCX OpenAI compatibility and ignored.' },
        top_logprobs: { type: 'integer', deprecated: true, description: 'Currently unsupported by SCX OpenAI compatibility and ignored.' },
        n: { type: 'integer', deprecated: true, description: 'Currently unsupported by SCX OpenAI compatibility and ignored.' },
        logit_bias: { type: 'object', additionalProperties: true, deprecated: true, description: 'Currently unsupported by SCX OpenAI compatibility and ignored.' },
        ...sampling,
      },
    },
    ResponseCreateRequest: {
      type: 'object', required: ['model', 'input'], additionalProperties: true,
      properties: {
        model: { type: 'string' },
        input: {},
        instructions: { type: 'string' },
        tools: { type: 'array', items: tool },
        tool_choice: {},
        stream: { type: 'boolean' },
        previous_response_id: { type: 'string', description: 'Continue from a stored previous response.' },
        max_output_tokens: { type: 'integer', minimum: 1 },
        metadata: { type: 'object', additionalProperties: true },
        store: { type: 'boolean', default: true },
        response_format: {},
        text: { type: 'object', additionalProperties: true, description: 'Text output configuration, including plain text, JSON, or JSON Schema structured output.' },
        reasoning: { type: 'object', additionalProperties: true },
        ...sampling,
      },
    },
    AnthropicMessageRequest: {
      type: 'object', required: ['model', 'messages'], additionalProperties: true,
      properties: { model: { type: 'string' }, messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } }, system: {}, tools: { type: 'array', items: tool }, tool_choice: {}, ...sampling },
    },
    CompletionRequest: { type: 'object', required: ['model', 'prompt'], additionalProperties: true, properties: { model: { type: 'string' }, prompt: {}, ...sampling } },
    EmbeddingRequest: { type: 'object', required: ['model', 'input'], additionalProperties: true, properties: { model: { type: 'string' }, input: {}, dimensions: { type: 'integer' }, encoding_format: { type: 'string' } } },
    ModerationRequest: { type: 'object', required: ['model', 'input'], additionalProperties: true, properties: { model: { type: 'string' }, input: {} } },
    AudioTranscriptionRequest: {
      type: 'object',
      required: ['file', 'model'],
      additionalProperties: true,
      properties: {
        file: { type: 'string', format: 'binary', description: 'Audio file. Documented limit: 25 MB for translation/transcription endpoints.' },
        model: { type: 'string', examples: ['Whisper-Large-v3'] },
        language: { type: 'string' },
        prompt: { type: 'string' },
        response_format: { type: 'string', enum: AUDIO_RESPONSE_FORMATS, default: 'json', description: 'When stream=true, SCX documents json as the only supported format.' },
        temperature: { type: 'number', minimum: 0, maximum: 1 },
        stream: { type: 'boolean', default: false, description: 'SCX extension: streams transcript.text.delta and transcript.text.done SSE events.' },
      },
    },
    AudioTextResponse: {
      type: 'object',
      additionalProperties: true,
      properties: { text: { type: 'string' } },
    },
    SpeechRequest: {
      type: 'object',
      required: ['model', 'input'],
      additionalProperties: true,
      properties: {
        model: { type: 'string', enum: ['scx-tts'], description: 'Current public SCX speech model.' },
        input: { type: 'string', maxLength: 5000, description: 'Text to synthesise. Server auto-splits long inputs at sentence boundaries under this cap.' },
        voice: { type: 'string', description: 'Optional stored Wordcab voice ID such as voice_...; omit for gateway default voice.' },
        response_format: { type: 'string', enum: SPEECH_RESPONSE_FORMATS, default: 'wav' },
        speed: { type: 'number', minimum: 0.25, maximum: 4.0, default: 1, description: 'Model hint, not a precise linear duration multiplier.' },
        voice_ref_wav_b64: { type: 'string', contentEncoding: 'base64', description: 'scx-tts inline voice-cloning reference audio, recommended 5-10 seconds.' },
        voice_ref_wav_format: { type: 'string', enum: SPEECH_VOICE_REF_FORMATS, default: 'wav' },
        ref_text: { type: 'string', description: 'Exact transcript of voice_ref_wav_b64 for full prosodic cloning; omit for embedding-only mode.' },
        x_vector_only_mode: { type: 'boolean', description: 'When true, use only speaker embedding and skip prosodic conditioning.' },
        max_new_tokens: { type: 'integer', minimum: 30, maximum: 4096, default: 512, description: 'Audio-token cap; 512 is documented as roughly 39 seconds.' },
      },
    },
    VoiceCreateRequest: {
      type: 'object',
      required: ['file'],
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        file: { type: 'string', format: 'binary', description: 'Reference audio used to enroll a stored voice_... ID.' },
        ref_text: { type: 'string' },
      },
    },
    BatchCreateRequest: { type: 'object', required: ['input_file_id', 'endpoint', 'completion_window'], additionalProperties: true, properties: { input_file_id: { type: 'string' }, endpoint: { type: 'string' }, completion_window: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } } },
    VectorStoreCreateRequest: { type: 'object', additionalProperties: true, properties: { name: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } } },
    VectorStoreFileUploadRequest: { type: 'object', required: ['file'], additionalProperties: true, properties: { file: { type: 'string', format: 'binary' }, metadata: { type: 'object', additionalProperties: true } } },
    VectorStoreSearchRequest: { type: 'object', required: ['query'], additionalProperties: true, properties: { query: {}, max_num_results: { type: 'integer' }, filters: {} } },
    ChatCompletionResponse: { type: 'object', additionalProperties: true },
    AnthropicMessageResponse: { type: 'object', additionalProperties: true },
    ResponseObject: { type: 'object', additionalProperties: true },
    EmbeddingResponse: { type: 'object', additionalProperties: true },
    BatchListResponse: { type: 'object', additionalProperties: true },
  };
}

function safePageName(url) {
  const u = new URL(url);
  const name = (u.hostname + u.pathname).replace(/^platform\.scx\.ai\/?/, '').replace(/^\/+/, '').replace(/\/+/g, '__') || 'index';
  return name.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
  const text = await response.text();
  return { url, status: response.status, contentType: response.headers.get('content-type') || '', text };
}

async function tryFetchOfficialSpec() {
  for (const url of SPEC_CANDIDATES) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json,*/*;q=0.8' } });
      const text = await response.text();
      if (!response.ok) continue;
      const parsed = JSON.parse(text);
      if (parsed.openapi || parsed.swagger) return { url, text, parsed };
    } catch {
      // Keep probing candidates.
    }
  }
  return null;
}

async function tryFetchModelCatalog() {
  const key = process.env.SCX_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch('https://api.scx.ai/v1/models', {
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    if (!response.ok) return null;
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.models) ? parsed.models : []);
    if (!rows.length) return null;
    return {
      captured_utc: new Date().toISOString(),
      source: 'https://api.scx.ai/v1/models',
      status: response.status,
      count: rows.length,
      models: rows,
    };
  } catch {
    return null;
  }
}

async function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = new Map(process.argv.slice(2).map((arg, i, arr) => [arg, arr[i + 1]]));
  const outDir = args.get('--out') || join(repoRoot, 'UpstreamDocumentation');
  const maxPages = Number(args.get('--max-pages') || 80);
  await mkdir(outDir, { recursive: true });
  const pagesDir = join(outDir, 'pages');
  await mkdir(pagesDir, { recursive: true });

  const officialSpec = await tryFetchOfficialSpec();
  if (officialSpec) {
    await writeFile(join(outDir, 'scx-openapi.official.json'), JSON.stringify(officialSpec.parsed, null, 2));
  }
  const modelCatalog = await tryFetchModelCatalog();
  if (modelCatalog) {
    await writeFile(join(outDir, 'scx-models.live.json'), JSON.stringify(modelCatalog, null, 2));
  }

  const seen = new Set();
  const queue = [...DEFAULT_SEEDS];
  const pages = [];
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const page = await fetchText(url);
    const text = htmlToText(page.text);
    const pageName = safePageName(url);
    await writeFile(join(pagesDir, `${pageName}.html`), page.text);
    await writeFile(join(pagesDir, `${pageName}.txt`), text + '\n');
    pages.push({ url, status: page.status, contentType: page.contentType, sha256: sha256(page.text), text, text_file: `pages/${pageName}.txt`, html_file: `pages/${pageName}.html` });
    for (const link of extractLinks(page.text, url)) {
      if (!seen.has(link) && /\/(docs|api-reference)(\/|$)/.test(new URL(link).pathname)) queue.push(link);
    }
  }

  const endpoints = extractEndpoints(pages.map((p) => p.text).join('\n'));
  const candidate = buildOpenApiCandidate(endpoints);
  const snapshot = {
    captured_utc: new Date().toISOString(),
    seeds: DEFAULT_SEEDS,
    official_openapi_found: Boolean(officialSpec),
    official_openapi_url: officialSpec?.url || null,
    model_catalog_count: modelCatalog?.count || 0,
    page_count: pages.length,
    endpoint_count: endpoints.length,
    endpoints,
    pages: pages.map(({ text, ...p }) => ({ ...p, preview_240: text.slice(0, 240) })),
  };

  await writeFile(join(outDir, 'scx-api-reference.snapshot.json'), JSON.stringify(snapshot, null, 2));
  await writeFile(join(outDir, 'scx-openapi.candidate.json'), JSON.stringify(candidate, null, 2));
  await writeFile(join(outDir, 'scx-server-tools.json'), JSON.stringify({ captured_utc: snapshot.captured_utc, tools: SCX_SERVER_TOOLS }, null, 2));
  await writeFile(join(outDir, 'README.md'), [
    '# SCX Platform Documentation Snapshot',
    '',
    `Captured UTC: ${snapshot.captured_utc}`,
    `Official OpenAPI found: ${snapshot.official_openapi_found ? snapshot.official_openapi_url : 'no'}`,
    `Live model catalog captured: ${snapshot.model_catalog_count}`,
    `Pages fetched: ${snapshot.page_count}`,
    `Endpoints mined: ${snapshot.endpoint_count}`,
    '',
    'Regenerate:',
    '',
    '```powershell',
    'node install/Invoke-KritScxApiReferenceMine.mjs --out UpstreamDocumentation',
    '```',
    '',
  ].join('\n'));

  console.log(JSON.stringify({ outDir, official_openapi_found: snapshot.official_openapi_found, model_catalog_count: snapshot.model_catalog_count, endpoint_count: endpoints.length, page_count: pages.length }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
