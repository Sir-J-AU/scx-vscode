# SCX End-to-End Todo Status - 2026-07-07

Snapshot time: `2026-07-07T19:29:00+10:00`

Purpose: one living checklist against the SCX platform screenshot, API/docs crawl, shim, VS Code extension, Kritical.SCXCodex, MCP servers, mux, storage, logging, and proof gates.

Status meanings:

- `Complete`: implemented and verified locally.
- `In progress`: partially implemented or wired, but not fully live-proven end to end.
- `Blocked`: implementation exists or is ready to test, but external state prevents proof.
- `Not started`: not yet implemented beyond notes/docs.

## Executive State

| Area | Status | In progress since | Elapsed | Evidence |
|---|---|---:|---:|---|
| API reference crawl and generated OpenAPI | Complete | - | - | `UpstreamDocumentation/`, `scx-openapi.candidate.json`, 22 paths, 28 operations, 23 schemas |
| Docs/manual summary | Complete | - | - | `docs/SCX-MINED-INSTRUCTION-MANUAL-SUMMARY-2026-07-07.md` |
| SQL/Lens ingestion of docs/spec/smoke artifacts | Complete | - | - | Wave `.scx-docs-20260707b`, 97/97 byte-identical reassembly |
| Store fidelity | Complete | - | - | `install/store_verify.py`: 590/590 lossless |
| Kritical.SCXCodex branding/version | Complete | - | - | `Kritical.SCXCodex 0.3.0 (SCX Custom)` |
| Shim basic agentic compatibility | Complete | - | - | tool flattening, retries, `/models` remap, param normalization, telemetry tests |
| MCP config and local Kritical MCP servers | In progress | 2026-07-07 18:29 | ~18 min | config repaired; `kritical-scxcode` and `kritical-store` protocol-smoked; external MCPs still need per-server runtime proof |
| SCX generation/embedding live proof | Blocked | 2026-07-07 18:15 | ~74 min | After key rotation, `/models`, `/batches`, and `/vector-stores` authenticate; `/chat/completions`, `/responses`, `/embeddings` still return `429 Daily token limit exceeded` |
| Full portal/admin API mining for Guardrails/Storage/Usage/Logs/API Keys | In progress | 2026-07-07 18:16 | ~31 min | visible in browser screenshot; no documented API routes found yet |
| Full mux output proof using SCX calls | Blocked | 2026-07-07 18:33 | ~14 min | mux unit tests pass; live calls blocked by SCX daily token quota |
| SCX key rotation | Complete | - | - | `SCX_API_KEY` rotated to Joshua Finley / Kritical 2026-07-07 key; stale `SCX_API_KEY_2` cleared; see `docs/SCX-KEY-ROTATION-2026-07-07.md` |

## Screenshot-Derived Platform Checklist

| SCX surface in screenshot | Desired Kritical support | Status | Notes / next proof |
|---|---|---|---|
| Platform navigation | Inventory all visible platform surfaces | Complete | Screenshot surfaces captured in this ledger |
| Docs | Crawl and preserve text/html | Complete | 44 docs/API text pages plus HTML captured |
| API Reference | Crawl all subpages in detail | Complete | API reference index plus 28 endpoint operations captured |
| Playground - Chat bot | Map prompt/system/tools/variables/messages to API shapes | In progress | Spec covers chat/responses/tools; UI-specific saved draft/project payload not mined yet |
| Playground - Voice agent | Map realtime/audio/speech/transcription prompt | In progress | API reference includes `/realtime`, `/audio/speech`, transcriptions/translations; portal voice-agent config shape not mined |
| Model dropdown | Populate from live `/models` metadata | Complete | 12-model full cache with rich metadata |
| Model badges: ctx/out/reasoning/tools | Carry metadata into UI and docs | In progress | Context/output/features captured; VS Code UI still needs full badge parity pass |
| Tools add button | Support SCX server tools and function tools | In progress | Shim supports server tool enum and local function flattening; portal tool UI shape not mined |
| Variables add button | Capture variable/template pattern | Not started | Visible in portal, not documented in API crawl |
| Top-right playground actions | Capture Compare / Optimize / Evaluate payloads | Not started | Visible in portal action menu; needs authenticated browser/API mining |
| Model settings dialog | Match temperature, top_p, top_k, max tokens, frequency penalty, presence penalty, seed | In progress | Shim clamps temperature and strips unsupported OpenAI params; portal shows fields that may be partially ignored by SCX OpenAI-compatible backend |
| System message | Map to `instructions`/system/developer messages | Complete | Covered in OpenAPI candidate and shim request flow |
| Transcription prompt | Map to audio transcription prompt | Complete | `/audio/transcriptions` schema includes `prompt` |
| Prompt messages / skeleton | Map multi-message prompt templates | In progress | Chat/messages supported; saved template UI storage is not mined |
| Auto-clear | Decide whether local UI mirrors portal behaviour | Not started | UI behaviour visible only, not API-level yet |
| Save draft icon / draft state | Determine whether portal exposes saved playground projects | Not started | Needs authenticated browser/API discovery |
| API Keys | Use `SCX_API_KEY`, `SCX_API_KEY_2..9`; never embed secrets | Complete | wrapper/launcher use HKCU/process env; TOML is secretless |
| API key create settings | Capture name, request logging, allowed regions, hard/soft budget, reset period | In progress | Screenshot shows request logging, Australia/United States regions, AUD hard/soft budget, lifetime reset; admin API not mined yet |
| Guardrails | Discover public/admin API if any | Not started | Visible in platform nav, not in current API reference index |
| Storage | Discover upload/list/delete API if any | In progress | Vector-store file upload is documented; general portal Storage API is not |
| Vector Stores | OpenAPI + live list | Complete | `/vector-stores` and file/search subroutes captured; live list returns 200 |
| Batches | OpenAPI + live list | Complete | `/batches` routes captured; live list returns 200 |
| Usage | Discover API/log export shape | Not started | Visible in platform nav, not in current API reference index |
| Logs | Discover API/log export shape | Not started | Visible in platform nav, not in current API reference index |

## Screenshot-Derived Playground Controls Added 2026-07-07 19:29

The latest screenshot batch added these portal details to the implementation backlog:

- API key creation supports key name, request logging policy, allowed serving regions, max budget, soft budget, and reset period.
- Chat playground exposes a top-right action menu with `Compare`, `Optimize`, and `Evaluate`.
- Chat tools menu exposes `Web Search`, `Code Interpreter`, `Academic Search`, `MCP Search`, and `YouTube Search`.
- Variables UI adds named template variables such as `city`.
- Chat model settings expose `Temperature`, `Top P`, `Top K`, `Max Tokens`, `Freq. Penalty`, `Pres. Penalty`, and `Seed`.
- Voice agent mode exposes conversation model, system prompt, transcription language/model/prompt hint, text-to-speech model/output format, browser AEC/noise suppression, turn-detection threshold, silence duration, prefix pad, and diagnostics.

Implementation implication: some portal settings map cleanly to public API fields, some are unsupported OpenAI-compatible fields that the shim now strips and warns about, and some appear to be portal/private admin state that still needs authenticated browser or HAR mining.

## API Reference Coverage

Complete locally:

- `POST /responses`
- `GET /responses/{response_id}`
- `DELETE /responses/{response_id}`
- `POST /chat/completions`
- `POST /completions`
- `POST /embeddings`
- `POST /moderations`
- `POST /audio/transcriptions`
- `POST /audio/translations`
- `WS /realtime`
- `POST /audio/speech`
- `POST /audio/voices`
- `GET /audio/voices`
- `DELETE /audio/voices/{voice_id}`
- `GET /models`
- `POST /batches`
- `GET /batches`
- `GET /batches/{batch_id}`
- `POST /batches/{batch_id}/cancel`
- `POST /messages`
- `POST /vector-stores`
- `GET /vector-stores`
- `GET /vector-stores/{store_id}`
- `DELETE /vector-stores/{store_id}`
- `POST /vector-stores/{store_id}/files`
- `GET /vector-stores/{store_id}/files`
- `DELETE /vector-stores/{store_id}/files/{file_id}`
- `POST /vector-stores/{store_id}/search`

Open gap: platform admin pages from the sidebar (`API Keys`, `Guardrails`, `Storage`, `Usage`, `Logs`) may use private/internal endpoints not present in the public API reference. They need authenticated browser/devtools or HAR mining before claiming API support.

## Shim / Proxy Checklist

| Requirement | Status | Evidence |
|---|---|---|
| Localhost-only additive proxy | Complete | `127.0.0.1:4199`; kill switch is stopping process |
| `SCX_API_KEY` only | Complete | no OpenAI/Anthropic key path in shim |
| Codex tool flattening | Complete | namespace/local_shell/custom/freeform to function tests |
| SCX server tool enum | Complete | 30 tools captured and tested |
| Plan-gated tool retry | Complete | drops server tools on plan-gate retry |
| Transient retry/backoff | Complete | 429/529/5xx helper tests |
| Context limit detection | Complete | telemetry flag tests |
| `/models` remap + full cache | Complete | `{data}` to `{models}` and cache write |
| Unsupported OpenAI param cleanup | Complete | strips known unsupported params and warns |
| Temperature clamp | Complete | `0..1` clamp and warnings |
| Chat/Responses token field drift | Complete | maps `max_tokens` / `max_output_tokens` by endpoint |
| Loud accounting/reporting | In progress | JSONL telemetry and warning headers exist; aggregate dashboard/report not built |

## MCP / Connector Checklist

Configured in `~/.codex/config.toml`:

- `bc_al`
- `falcon-mcp`
- `kritical-scxcode`
- `kritical-store`
- `node_repl`
- `pax8`
- `shopify-dev-mcp`

| MCP / connector | Status | Proof | Remaining |
|---|---|---|---|
| `kritical-scxcode` | Complete for protocol/listing; Blocked for generation | launcher initializes and lists 5 tools; model list works | generation tools blocked by SCX 429 quota |
| `kritical-store` | Complete | initializes, lists tools, `store_stats` returns SQL counts | add more semantic query smoke checks |
| `bc_al` | In progress | config args repaired; executable exists | need protocol launch/list smoke |
| `shopify-dev-mcp` | In progress | command exists and enabled | needs launch/list smoke; may require network/npm cache |
| `falcon-mcp` | In progress | `uvx` exists, env file exists, enabled | needs launch/list smoke; security/API auth may gate |
| `pax8` remote MCP | In progress | URL configured | needs remote handshake proof |
| `node_repl` | In progress | configured by Codex runtime | already available as tool in this session, but config-level smoke still useful |
| OpenAI-curated connectors/plugins | In progress | enabled in Codex config | need per-plugin availability/readiness matrix |

## Mux / Storage / Summarisation Checklist

| Requirement | Status | Evidence |
|---|---|---|
| SQLite local store tests | Complete | `kritical-local-store.test.mjs` pass |
| Chunk store and synthetic edit context | Complete | chunk-store/server tests pass |
| SQL Server Kritical store | Complete | `kritical-store` MCP `store_stats`, LensSource rows present |
| Multi-model mux matrix offline logic | Complete | 13/13 unittest pass |
| Single-model mux lens bug fixed | Complete | `scx(args.model, messages...)` repaired |
| Live mux generation | Blocked | SCX token quota exhausted |
| Inter-agent/subprompt summarisation prompt library | In progress | docs/design exist; needs executable prompt-pack wiring |
| Write-back of mux shard summaries to DB | In progress | `mux_shards_ingest.py` exists and prior `context_shard` rows present; needs fresh live run after quota |
| Accounting per stream/model/cost | In progress | mux reports tokens/latency; needs persistent aggregate report |

## Verification Commands

Last proof run:

```powershell
node --test tests\Test-KritMcpServers.mjs tests\Test-KritScxApiReferenceMine.mjs tests\Test-KritScxLiveSurface.mjs codex-wrapper\scx-agentic-shim.test.mjs codex-wrapper\scx-agentic-shim.edge.test.mjs store-mcp\kritical-local-store.test.mjs store-mcp\kritical-chunk-store.test.mjs store-mcp\kritical-chunk-server.test.mjs codex-wrapper\scx-corpus-augment.test.mjs
```

Result: `48/48` pass.

```powershell
& 'C:\KriticalSCX\venv-litellm-test\Scripts\python.exe' mux\Invoke-KritScxMuxMatrix.test.py
```

Result: `13/13` pass.

```powershell
& 'C:\KriticalSCX\venv-litellm-test\Scripts\python.exe' .\install\store_verify.py
```

Result: `590/590` lossless.

## Next Work Queue

1. Authenticated portal/API mining for sidebar admin pages: API Keys, Guardrails, Storage, Usage, Logs.
2. Runtime smoke for external MCP servers: `bc_al`, `shopify-dev-mcp`, `falcon-mcp`, `pax8`.
3. After SCX quota reset/budget lift: rerun `tests\Test-KritScxLiveSurface.mjs --live --include-tools --include-audio`.
4. After quota reset/budget lift: run live single-model mux and multi-model mux, then ingest fresh shard summaries.
5. Build an aggregate accounting/report command over shim telemetry, live smoke receipts, mux reports, and SQL store rows.
6. Bring VS Code UI parity closer to SCX Playground: model badges, tool picker, variables/templates, voice-agent controls, storage/vector-store attach.

## Verification Update - 2026-07-07 19:29

Post-rotation live read proof:

```powershell
$env:SCX_API_KEY=[Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
pwsh -NoProfile -ExecutionPolicy Bypass -File .\models\Get-KritScxModels.ps1 -Refresh -ProxyPort 9
node tests\Test-KritScxLiveSurface.mjs --live
```

Result:

- `/models`: 12 live models.
- `/batches`: 200, empty list.
- `/vector-stores`: 200, empty list.
- `/chat/completions`, `/responses`, `/embeddings`: `429 Daily token limit exceeded`.

Local regression proof:

```powershell
node --test tests\Test-KritScxLiveSurface.mjs tests\Test-KritScxApiReferenceMine.mjs codex-wrapper\scx-agentic-shim.test.mjs codex-wrapper\scx-agentic-shim.edge.test.mjs tests\Test-KritMcpServers.mjs
```

Result: `23/23` pass.

```powershell
& 'C:\KriticalSCX\venv-litellm-test\Scripts\python.exe' mux\Invoke-KritScxMuxMatrix.test.py
```

Result: `13/13` pass.

```powershell
& 'C:\KriticalSCX\venv-litellm-test\Scripts\python.exe' .\install\store_verify.py
```

Result: `590/590` lossless.
