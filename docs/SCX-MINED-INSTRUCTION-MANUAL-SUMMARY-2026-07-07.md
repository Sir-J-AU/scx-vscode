# SCX Mined Instruction Manual Summary - 2026-07-07

This is the operator-facing summary of the local SCX platform crawl, OpenAPI candidate, shim behaviour, and validation gaps.

## API Reference Coverage

The local crawl captured the API reference index plus every endpoint page linked from it, and additional Speech voice pages reached from the endpoint pages.

Captured API-reference text pages:

- `api-reference.txt`
- `api-reference__responses.txt`
- `api-reference__responses-retrieve.txt`
- `api-reference__responses-delete.txt`
- `api-reference__chat-completions.txt`
- `api-reference__completions.txt`
- `api-reference__embeddings.txt`
- `api-reference__moderations.txt`
- `api-reference__audio-transcriptions.txt`
- `api-reference__audio-translations.txt`
- `api-reference__realtime.txt`
- `api-reference__speech.txt`
- `api-reference__audio-voices-create.txt`
- `api-reference__audio-voices-list.txt`
- `api-reference__audio-voices-delete.txt`
- `api-reference__models.txt`
- `api-reference__batches-create.txt`
- `api-reference__batches-list.txt`
- `api-reference__batches-retrieve.txt`
- `api-reference__batches-cancel.txt`
- `api-reference__messages.txt`
- `api-reference__vector-stores.txt`
- `api-reference__vector-stores-list.txt`
- `api-reference__vector-stores-retrieve.txt`
- `api-reference__vector-stores-delete.txt`
- `api-reference__vector-stores-files-upload.txt`
- `api-reference__vector-stores-files-list.txt`
- `api-reference__vector-stores-files-delete.txt`
- `api-reference__vector-stores-search.txt`

Current live index check on 2026-07-07 showed the public index links Responses, Chat Completions, Completions, Embeddings, Audio Transcriptions, Audio Translations, Realtime, Speech, Models, Batches, Anthropic Messages, and Vector Stores. The local crawl additionally captured the voice enrollment/list/delete subpages exposed through the Speech/Audio area.

## Generated OpenAPI Candidate

- File: `UpstreamDocumentation/scx-openapi.candidate.json`
- Version: OpenAPI `3.1.1`
- Paths: 22
- Operations mined: 28
- Schemas: 23
- Server: `https://api.scx.ai/v1`
- Security: bearer auth

Important documented compatibility rules in the spec:

- Use `SCX_API_KEY` with OpenAI-compatible clients.
- Base URL is `https://api.scx.ai/v1`.
- Temperature safe range for OpenAI-compatible clients is `0..1`.
- `top_k` is SCX-specific and supported.
- Unsupported OpenAI params are flagged as deprecated/ignored: `logprobs`, `top_logprobs`, `n`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `seed`.

## Model Metadata Cache

- Full model cache: `%USERPROFILE%\.kritical-scx\models-catalog.full.json`
- Current direct SCX catalog: 12 models with rich metadata.
- The shim also writes the full `/models` body through to this cache on successful proxy model-list calls.

## Shim Behaviour

File: `codex-wrapper/scx-agentic-shim.mjs`

The shim is localhost-only on `127.0.0.1:4199` by default and is additive. Stopping it returns the tools to direct SCX/native Codex paths.

What it currently does:

- Uses only `SCX_API_KEY`.
- Never reads or writes `OPENAI_*` or `ANTHROPIC_*`.
- Rewrites Codex unsupported tool shapes into SCX-compatible function tools.
- Keeps documented SCX server tools when allowed.
- Retries plan-gated server-tool failures by dropping SCX server tools and preserving local function tools.
- Retries transient upstream pressure: `429`, `529`, `500`, `502`, `503`, `504`.
- Remaps `/models` `{ data: [...] }` into Codex-compatible `{ data: [...], models: [...] }`.
- Records structured JSONL telemetry to `%TEMP%\scx-shim-telemetry.jsonl` unless overridden.
- Writes human-readable debug logs to `%TEMP%\krit-shim.log` unless overridden.
- Detects context-limit errors and records `context_limit: true` in telemetry.
- Normalizes common wasteful request drift:
  - strips unsupported OpenAI params listed above;
  - clamps temperature to `0..1`;
  - maps `max_tokens` to `max_output_tokens` for `/responses`;
  - maps `max_output_tokens` to `max_tokens` for `/chat/completions`.
- Adds `x-kritical-scx-warnings` response headers when it corrected a request, and records the same warnings in telemetry.

What it intentionally does not do:

- It does not hard-fail unknown request fields because SCX docs use `additionalProperties`-style extension behaviour and HR29 requires passthrough by default.
- It does not invent unsupported APIs that are only visible in the platform UI, such as Logs/Usage/Guardrails admin pages, unless SCX documents or exposes those API routes.

## VS Code And Codex Pack

- VS Code chat uses `SCX_API_KEY` through extension config/env resolution.
- `Kritical.SCXCodex.exe` now reports `Kritical.SCXCodex 0.3.0 (SCX Custom)`.
- `kritical-codex.ps1` passes Codex per-invocation provider overrides:
  - provider name: `Southern Cross AI`
  - base URL: local shim or direct SCX
  - env key: `SCX_API_KEY`
  - wire API: `responses`
- Native `~/.codex` plugins, connectors, MCP servers, and config are reused but not mutated by the wrapper.

## MCP Setup

The VS Code setup GUI reads and writes `~/.codex/config.toml`:

- Parses TOML before writing.
- Preserves existing non-MCP config.
- Writes atomically through a temp file.
- Creates a timestamped backup before replacing config.
- Lets the operator add/edit `[mcp_servers.<name>]` cards with command, args, and env JSON.

Status: config path is wired and additive; actual end-to-end MCP server launch/tool-list validation still needs a UI or Codex MCP runtime smoke pass. Do not claim MCP runtime execution is proven until that pass is run.

## Live Validation State

Receipt: `UpstreamDocumentation/scx-live-smoke.latest.json`

Passed live with the current key:

- `GET /models`: 12 models
- `GET /batches`: 200, empty list
- `GET /vector-stores`: 200, empty list

Reachable but quota-blocked:

- `POST /chat/completions`: `429 Daily token limit exceeded`
- `POST /responses`: `429 Daily token limit exceeded`
- `POST /embeddings`: `429 Daily token limit exceeded`

Run after quota reset or with a fresh key:

```powershell
$env:SCX_API_KEY = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
node tests\Test-KritScxLiveSurface.mjs --live --include-tools --include-audio
```

## SQL/Lens Backing Store

Latest ingest wave:

- Wave: `.scx-docs-20260707b`
- Corpus: `UpstreamDocumentation`
- Files: 97
- Bytes: 5,700,673
- SQL reassembly: 97/97 byte-identical

Store verification:

- `decision_log`: 459/459
- `lens_artifact`: 128/128
- `context_shard`: 3/3
- Total: 590/590 lossless

