# Agentic Codex on Southern Cross AI — Definitive Guide

> **Author:** Joshua Finley — Kritical Pty Ltd — (c) 2026
> **Contact:** sales@kritical.net · 1300 274 655
> **Ground truth:** `codex-wrapper/scx-agentic-shim.mjs` + `codex-wrapper/kritical-codex.ps1` + `docs/SCX-AGENTIC-BRIDGE-SPEC.md`

---

## 1. The Problem

OpenAI Codex serialises its agentic tools (shell execution, apply_patch, and others) as types that Southern Cross AI's `/v1/responses` endpoint rejects.

| Codex tool type | SCX result |
|---|---|
| `namespace` (codex default `shell_command`) | HTTP 400 — "Unknown server tool type" |
| `local_shell` (codex `shell_type="local"`) | HTTP 400 — "Unknown server tool type" |
| `custom` (codex apply_patch) | HTTP 400 — "Unknown server tool type" |
| `freeform` (codex apply_patch variant) | HTTP 400 — "Unknown server tool type" |
| `mcp` (remote MCP tools) | HTTP 400 — "Unknown server tool type" |
| `function` | HTTP 200 — accepted |

SCX accepts only `function` tools and emits `output[{type:"function_call"}]`. Codex's native serialisation is incompatible by default.

The **flatten-shim** bridges this gap. It is a local HTTP proxy that rewrites Codex's outbound tool types to `function`, forwards to SCX, and streams the response back. It also implements a plan-gate retry that drops server-side tools when the model's plan cannot run them.

---

## 2. The Shim — `scx-agentic-shim.mjs`

### 2.1 What it is

A Node.js (>= 20, no dependencies) HTTP proxy running on `127.0.0.1:4199`. It receives Codex's outbound `/v1/responses` requests, rewrites the `tools` array, forwards to SCX, and streams the SSE response back.

### 2.2 Endpoint and binding

```
http://127.0.0.1:4199/v1/responses
```

- Binds **localhost only** (`127.0.0.1`). Never `0.0.0.0`.
- Upstream: `https://api.scx.ai/v1` (configurable via `KRIT_SHIM_UPSTREAM`).
- Auth: `SCX_API_KEY` Bearer token forwarded to upstream. Never reads `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

### 2.3 Core transforms

#### `flattenTool(t, dropServer)`

Rewrites one Codex tool into one or more SCX-compatible `function` tools.

| Input `type` | Behaviour | `dropServer=true` |
|---|---|---|
| `function` | Pass through unchanged | Pass through unchanged |
| `namespace` | Spread inner tools; each becomes `{type:"function", …}` | Drop all inner tools |
| `local_shell` | Rewrite to `{type:"function", name:"shell", …}` | Drop |
| `custom` | Rewrite to `{type:"function", name:<original name>, …}` | Drop |
| `freeform` | Rewrite to `{type:"function", name:<original name>, …}` | Drop |
| Any other unknown type | Rewrite to `{type:"function", name:<original name or type>, …}` | Drop |
| Server tool type (see §2.4) | Pass through unchanged | **Drop entirely** |

#### `transformRequestBody(body, dropServer = false)`

Applies `flattenTool` to every entry in `body.tools`. Returns a new body object with the rewritten tools array.

#### `isPlanGateError(status, text)`

Returns `true` when:
- HTTP status is `400`, **AND**
- Response text matches `/current plan|model_not_in_plan|not available on your/i`

Used to detect plan-gated server tools.

### 2.4 The `SERVER_TOOLS` set

These are SCX's server-side tool types. They are accepted by SCX but require a plan upgrade to execute. When a plan-gate 400 is detected, the shim drops all tools whose type is in this set and retries.

```
web_search, code_interpreter, file_retrieval, academic_search, youtube_search,
reddit_search, x_search, mcp_search, trove_search, retrieve, movie_tv_search,
trending_movies, trending_tv, mermaid_diagram, coin_data, coin_data_by_contract,
coin_ohlc, currency_converter, stock_chart, stock_price, find_place_on_map,
nearby_places_search, weather, travel_advisor, flight_tracker, flight_live_tracker,
datetime, greeting, text_translate, memory_manager
```

### 2.5 Plan-gate retry flow

```
1. Codex sends request with all tools (including server tools)
   ↓
2. Shim forwards to SCX
   ↓
3. SCX returns HTTP 400 with plan-gate message
   ↓
4. Shim detects plan-gate via isPlanGateError
   ↓
5. Shim rebuilds request with all SERVER_TOOLS dropped (dropServer=true)
   ↓
6. Shim retries the rebuilt request
   ↓
7. If retry succeeds → stream response to Codex
   If retry fails (>=400) → return error cleanly with logging + telemetry
```

The retry failure path returns a proper HTTP error response with `Content-Type: application/json`. It does **not** opaquely stream a byte error.

### 2.6 Telemetry

Every served request appends one JSON line to `KRIT_SHIM_TELEMETRY` (default: `<tmpdir>/scx-shim-telemetry.jsonl`).

Fields per event:

| Field | Description |
|---|---|
| `ts` | ISO 8601 timestamp |
| `seq` | Monotonic sequence number |
| `method` | HTTP method |
| `endpoint` | Request path |
| `model` | Model from request body |
| `stream` | Boolean |
| `retried` | Boolean — was this a plan-gate retry? |
| `flattened` | Boolean — did tool types change? |
| `plan_gate` | Boolean — plan-gate was hit |
| `tools_in` | Array of input tool types |
| `tools_out` | Array of output tool types |
| `status` | Upstream HTTP status |
| `latency_ms` | Wall-clock ms |
| `bytes` | Bytes proxied |
| `error` | Error text (truncated 200 chars), if any |

### 2.7 Health endpoint

```
GET http://127.0.0.1:4199/health
```

Returns:
```json
{ "ok": true, "service": "scx-agentic-shim", "upstream": "https://api.scx.ai/v1" }
```

Used by the wrapper to confirm the shim is up without a SCX round-trip.

---

## 3. The Wrapper — `kritical-codex.ps1`

### 3.1 What it is

A PowerShell 7+ wrapper that launches the real Codex CLI routed through the shim. It auto-starts the shim if not running, resolves an agentic-capable model, and passes all SCX routing as per-invocation `-c` overrides that never touch `~/.codex` on disk.

### 3.2 Model resolution

The wrapper resolves the model in this order:

1. Explicit `-Model` parameter (operator-specified)
2. Shared VS Code model selection file: `$env:USERPROFILE\.kritical-scx\current-model.json`
3. Default: `gpt-oss-120b`

**Agentic-capable models** (emit `function_call` on `/v1/responses`):

```
gpt-oss-120b, MiniMax-M2.7, gemma-4-31B-it,
Meta-Llama-3.3-70B-Instruct, Llama-4-Maverick-17B-128E-Instruct
```

**`coder` is excluded.** It emits `function_call` fine on the raw SCX API but Codex rejects it with `model_not_found` — a reserved-name clash. Use `coder` in the chat panel instead.

If the resolved model is not in the agentic list, the wrapper:
- Warns the operator (with source-appropriate guidance: "from VS Code model selection" vs "Override with -Model")
- Substitutes `gpt-oss-120b` for the session

### 3.3 Per-invocation `-c` overrides

All SCX routing is passed as `-c` flags. These are **per-invocation** — they do not persist to `~/.codex/config.toml`. Vanilla `codex` run without the wrapper is 100% untouched.

```powershell
-c model_provider=scx
-c model_providers.scx.name="Southern Cross AI"
-c model_providers.scx.base_url="http://127.0.0.1:4199/v1"   # the shim (or $scxDirect with -NoShim)
-c model_providers.scx.env_key="SCX_API_KEY"
-c model_providers.scx.wire_api="responses"
-c model="<resolved agentic model>"
```

The wrapper also exports `SCX_API_KEY`, `KRIT_SHIM_PORT`, and `KRIT_SHIM_UPSTREAM` into the child environment before starting the shim, so a non-default port and the HKCU-resolved key always reach it.

---

## 4. Request flow (end to end)

```
operator types in codex CLI
  → kritical-codex.ps1  (SCX_API_KEY from HKCU; resolve agentic model; auto-start shim on :4199)
  → codex, launched with the -c overrides above
  → scx-agentic-shim.mjs  (flatten tools → function; plan-gate retry drops server tools)
  → https://api.scx.ai/v1/responses  (SCX_API_KEY Bearer; never OPENAI_*/ANTHROPIC_*)
```

On exit the wrapper tears down only the exact `node` PID it launched (identity-checked), never an unrelated process that grabbed the port.

## 5. HR1 / HR29 guarantees

- **HR1** — `SCX_API_KEY` only. Neither the shim nor the wrapper reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or any other provider key.
- **HR29** — additive. The wrapper writes nothing to `~/.codex` on disk; all SCX routing is per-invocation `-c`. Vanilla `codex` (run without the wrapper) is 100% untouched. Stop the shim and codex routes directly to `api.scx.ai`.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `shim did not become healthy — falling back to direct` | Node missing, or port 4199 busy | Install Node ≥ 20; free the port; re-run |
| `model_not_found` on `coder` | codex reserved-name clash | Use an agentic model (default `gpt-oss-120b`); use `coder` in the chat panel |
| Repeated plan-gate 400s | model's plan can't run a server tool (e.g. `web_search`) | Automatic — the shim retries with server tools dropped |
| `'<model>' can't drive agentic codex on SCX` | non-agentic model selected | Pick one of the 5 agentic models, or pass `-Model` |

## 7. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `SCX_API_KEY` | (HKCU) | SCX Bearer token — the only inference credential |
| `KRIT_SHIM_PORT` | `4199` | Shim listen port |
| `KRIT_SHIM_UPSTREAM` | `https://api.scx.ai/v1` | SCX upstream base |
| `KRIT_SHIM_TELEMETRY` | `<tmpdir>/scx-shim-telemetry.jsonl` | Per-request telemetry JSONL |
| `KRIT_SHIM_LOG` | `<tmpdir>/krit-shim.log` | Debug log path |
| `KRIT_SHIM_DEBUG` | `0` | `1` logs raw request tools |

---

> **Kritical Pty Ltd** — (c) 2026. Agentic Codex, sovereign on Southern Cross AI. HR1/HR29 by construction.
