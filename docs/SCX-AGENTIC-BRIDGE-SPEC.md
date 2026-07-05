# SCX Agentic Bridge — Findings, Architecture, Specs (`.5231`)

> Canonical reference for wiring **SCX Codex (scxcodex)** and the **kritical.SCXCode** VS Code
> extension **directly to Southern Cross AI**, agentically, with **`SCX_API_KEY` only** and **no router**.
> Every capability below was **probed live** against `https://api.scx.ai/v1` on 2026-07-05 (ben key).
> Author: Joshua Finley — Kritical Pty Ltd — sales@kritical.net — 1300 274 655.

---

## 0. Executive summary / decisions

1. **SCX speaks three wire shapes directly** — OpenAI `chat/completions`, OpenAI `responses`, and
   Anthropic `messages`. All return HTTP 200 with a valid `SCX_API_KEY` Bearer.
2. **The LiteLLM router is NOT required for this project.** It is a **supervisor** concern. The
   extension talks Anthropic-shape direct; codex talks Responses-shape direct. (Corrects an earlier
   wrong assumption that codex needed the router to translate shapes.)
3. **Codex ↔ SCX agentic — BUILT & PROVEN.** Codex emits most tools as `function` already, plus a
   `namespace` grouping and a plan-gated `web_search` server tool. The **flatten-shim**
   ([../codex-wrapper/scx-agentic-shim.mjs](../codex-wrapper/scx-agentic-shim.mjs)) flattens `namespace`
   → `function` and retries without server tools on a plan-gate 400. **Verified end-to-end 2026-07-05**:
   `codex exec` ran real `pwsh` commands (`Get-ChildItem`, `Get-Content a.txt` → `alpha`) against SCX
   through the shim — `SCX_API_KEY` only, no router, no `OPENAI_*`, Windows-native PowerShell. Paired
   test green (6/6).
4. **HR1/HR29 invariant:** every path uses `SCX_API_KEY` and SCX-specific config only. `OPENAI_*` /
   `ANTHROPIC_*` env vars are NEVER read or written. Codex uses a custom `[model_providers.scx]` with
   `env_key = "SCX_API_KEY"`.

---

## 1. SCX API capability matrix (probed live)

### 1a. `/v1/responses` (OpenAI Responses API) — what codex uses

| Capability | Result | Notes |
|---|---|---|
| `tools: [{type:"function"}]` | ✅ 200 | **The tool type to use.** |
| `tools: [{type:"custom"}]` | ❌ 400 | "Unknown server tool type: 'custom'" |
| `tools: [{type:"local_shell"}]` | ❌ 400 | codex's `shell_type="local"` emits this |
| `tools: [{type:"freeform"}]` | ❌ 400 | codex apply_patch freeform |
| `tools: [{type:"namespace"}]` | ❌ 400 | codex `shell_type="shell_command"` (the default) emits this |
| `tools: [{type:"mcp"}]` | ❌ 400 | remote MCP tool type not accepted |
| `tool_choice: required / auto / {type:function,name}` | ✅ 200 | all three work |
| **emits `output:[{type:"function_call"}]`** | ✅ **YES** | **agentic loop works** — verified on gpt-oss-120b, MiniMax-M2.7, coder (parallel `[function_call,function_call]`) |
| `reasoning: {effort}` / `{effort, summary}` | ✅ 200 | |
| `text: {format: {type:"json_schema", …}}` | ✅ 200 | structured output works **here** (not on chat/completions) |
| `max_output_tokens` | ✅ 200 | |
| `parallel_tool_calls` | ✅ 200 | |
| `store: true` | ✅ 200 | **stateful** — `previous_response_id` chaining is available |
| `stream: true` | ✅ 200 | SSE |
| `instructions` (system) | ✅ 200 | |
| `temperature` 0–2 | ✅ 200 | **2.5 → 400 "greater than the maximum of 2"** |
| `top_p` | ✅ 200 | |

**SCX server-side tool allowlist** (accepted `type` values, plan-gated by model):
`web_search, code_interpreter, file_retrieval, academic_search, youtube_search, reddit_search, x_search,
mcp_search, trove_search, retrieve, movie_tv_search, trending_movies, trending_tv, mermaid_diagram,
coin_data, coin_data_by_contract, coin_ohlc, currency_converter, stock_chart, stock_price,
find_place_on_map, nearby_places_search, weather, travel_advisor, flight_tracker, flight_live_tracker,
datetime, greeting, text_translate, memory_manager`.
(`web_search`/`code_interpreter` returned "model not on your plan" for gpt-oss-120b — the **type** is
recognised; availability is plan/model-gated.)

### 1b. `/v1/chat/completions` (OpenAI Chat Completions)

| Param | Result |
|---|---|
| `temperature` 0–2, `top_p`, `top_k`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `logprobs`+`top_logprobs`, `n`, `reasoning_effort`, `stream` | ✅ all 200 |
| `tools: [{type:function}]` | ⚠️ 502 "Upstream provider returned an error" for gpt-oss-120b — **use `/v1/responses` for tools** |
| `response_format: json_object` / `json_schema` | ❌ 400 "Invalid structured output" — **use `/v1/responses` `text.format` for structured output** |

### 1c. `/v1/messages` (Anthropic) — what the extension uses

Works direct (`x-api-key` + `anthropic-version`). The extension chat panel uses this shape. Model ids are
**mixed-case direct** (`MAGPiE`, `MiniMax-M2.7`) — the local LiteLLM proxy uses **lowercase aliases**
(`magpie`). The extension normalises model id to the endpoint (see `normalizeModelId`).

### 1d. Models + sampling (from `GET /v1/models`, authoritative)

12 models. Each advertises `context_length`, `max_output_length`, `supported_sampling_parameters`
(`temperature, top_p, top_k, max_tokens, stop, frequency_penalty, presence_penalty, seed`) and
`supported_features` (`tools, reasoning, json_mode`). Chat-capable: MiniMax-M2.7, gpt-oss-120b,
DeepSeek-V3.1, Meta-Llama-3.3-70B-Instruct, gemma-4-31B-it, Qwen3-32B, Llama-4-Maverick-…, MAGPiE, coder.
Non-chat (must NOT appear in chat/codex model pickers): E5-Mistral-7B-Instruct (embeddings),
Whisper-Large-v3 (speech), opir-large (moderation).

**UI rule:** temperature slider range **0–2** (hard SCX max). Default per model = its advertised value
(`tempSrc`: `rec` published / `def` neutral 0.7 / `api` live / `you` override). Only surface sampling
params the model's `supported_sampling_parameters` lists.

### 1e. Anthropic tool-use, embeddings, moderation, stateful (probe #2)

| Capability | Result | Notes |
|---|---|---|
| `/v1/messages` + `tools` (Anthropic-shape) | ✅ 200 `stop_reason=tool_use` | **SCX does agentic tool use in Anthropic shape** — the extension (and any Claude-shape agent) can be agentic direct, no shim |
| `/v1/messages` + `tool_choice:{type:tool,name}` | ✅ 200 emits `tool_use` | |
| `/v1/embeddings` model `E5-Mistral-7B-Instruct` | ✅ 200 `embedding` | use SCX id, not `text-embedding-3-*` (400 unsupported) |
| `/v1/moderations` model `opir-large` | ✅ 200 | |
| `/v1/responses` `store:true` + `previous_response_id` | ✅ 200 both | **stateful chaining works** — server-side conversation memory |
| `/v1/responses` `stream:true` **with tools** | ⚠️ 502 on some shapes | streaming works in practice (codex streamed fine through the shim) but tool+stream is not 100% on every request shape — treat as best-effort + retry |

### 1f. Which models are AGENTIC-capable (emit `function_call` on `/v1/responses`)

Probed with `tool_choice:required`:

| Model | function_call? |
|---|---|
| gpt-oss-120b | ✅ |
| MiniMax-M2.7 | ✅ |
| coder | ✅ (parallel calls too) |
| gemma-4-31B-it | ✅ |
| Meta-Llama-3.3-70B-Instruct | ✅ |
| Llama-4-Maverick-17B-128E-Instruct | ✅ |
| Qwen3-32B | ❌ 400 "Invalid function calling output" |
| MAGPiE | ❌ 502 "Upstream provider returned an error" |
| DeepSeek-V3.1 | ⏳ strict RPM (429 during probe) — retry-gated, not tool-broken |

**UI rule:** the SCX Codex / agentic model picker should default to and prefer the ✅ set
(MiniMax-M2.7 or coder for coding). Flag Qwen3-32B / MAGPiE as "chat-only, not agentic" so codex isn't
pointed at a model that can't tool-call.

---

## 2. Direct-SCX wiring (HR1/HR29-correct, no router)

`~/.codex/config.toml` — additive, never hijacks plain codex (use a **profile**):

```toml
[model_providers.scx]
name     = "Southern Cross AI"
base_url = "https://api.scx.ai/v1"   # (or the shim: http://127.0.0.1:4199/v1)
env_key  = "SCX_API_KEY"             # SCX-specific var ONLY — Bearer auth, never OPENAI_API_KEY
wire_api = "responses"               # codex 0.142.5 dropped "chat"; SCX supports "responses" ✓

[profiles.scx]
model_provider = "scx"
model = "gpt-oss-120b"               # or MiniMax-M2.7 / coder — from the shared model list
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

Launch: `codex --profile scx`. The wrapper (`codex-wrapper/kritical-codex.ps1`) sets nothing in the
environment except reading `SCX_API_KEY`; it must **stop** setting `OPENAI_BASE_URL`/`OPENAI_API_KEY`
(the old proxy approach) and instead rely on this profile.

---

## 3. The flatten-shim — spec

**Why:** codex serialises its shell / apply_patch tools as `namespace` (default) / `custom` / `local_shell`
— all rejected by SCX. SCX accepts `function` tools and emits `function_call`. The shim translates.

**Shape:** a localhost Responses proxy on `127.0.0.1:4199` (SCX_API_KEY only, HR1/HR29; bind localhost
only). Codex `base_url = http://127.0.0.1:4199/v1`, everything else identical to §2.

**Request path (codex → shim → SCX):**
1. Parse the Responses request body.
2. For each entry in `tools`: if `type ∈ {namespace, custom, local_shell, freeform}`, rewrite to
   `{type:"function", name:<original tool name>, description, parameters:<json schema>}`. Keep a
   `Map<name → originalType>` for the response path. Pass real server tools (`web_search`, …) and
   existing `function` tools through unchanged.
3. Forward to `https://api.scx.ai/v1/responses` with the Bearer `SCX_API_KEY`.

**Response path (SCX → shim → codex):**
4. For each `output` item of `type:"function_call"` whose `name` maps back to a codex-native type,
   rewrite the item `type` to what codex expects for that tool (`local_shell_call` / `custom_tool_call`
   / the namespaced call), preserving `call_id`, `name`, `arguments`.
5. Handle **streaming**: translate the same fields inside SSE `response.output_item.*` /
   `response.function_call_arguments.*` events.

**Follow-up path (codex tool result → shim → SCX):**
6. Codex sends the tool result as `function_call_output` (or its native `*_call_output`). Normalise to
   `function_call_output` with the matching `call_id` before forwarding.

**Invariants:** pass-through by default; never touch non-tool fields; never read `OPENAI_*`; localhost
bind; print the HR29 kill line on status. ~80–120 lines of Node (global `fetch`, no deps). Paired test
(HR21): a mock that asserts namespace/custom/local_shell → function on the way out and function_call →
native on the way back.

**Deletion criterion:** the shim is removed the day SCX accepts codex's native tool types (see §4).

---

## 4. What to request from SCX (the ask-spec)

To make agentic codex work against SCX with **zero shim**, request ONE of:

1. **Accept codex's Responses tool types** on `/v1/responses`: `local_shell`, `custom` (freeform), and
   the `namespace` grouping (codex's default `shell_command`). Treat them as opaque client-side
   function tools — emit `function_call` (or the matching `*_call`) as today. *(Preferred — smallest ask.)*
2. **Graceful unknown-tool handling:** instead of `400 "Unknown server tool type"`, ignore unrecognised
   *client* tool types (any not in the server allowlist) and treat them as function tools. This future-proofs
   every agent, not just codex.
3. **Document the supported set** explicitly in SCX API docs: which `tools[].type` values are accepted on
   `/v1/responses`, that `function` + `function_call` round-trips work, that `store`/`previous_response_id`
   are supported, and the plan-gating for server tools.

Also confirm for the record: `tool_choice` variants (verified working), `parallel_tool_calls` (working),
`text.format` json_schema on Responses (working), temperature hard-max 2, and that
`/v1/chat/completions` `response_format` structured output + function tools are **not** currently reliable
(so agents should prefer `/v1/responses`).

---

## 5. Known issues / outstanding

- **Agentic codex: RESOLVED** via the shim (§3), proven end-to-end. SCX-side tool-type support (§4)
  would let the shim be deleted; until then the shim is the supported agentic path.
- **chat/completions**: function tools 502 on gpt-oss; structured output 400. Route tools + structured
  output via `/v1/responses`.
- **DeepSeek-V3.1** hit a `429` (RPM) during probing — transient, has strict per-minute limits.
- **web_search / code_interpreter** server tools are plan/model-gated ("not on your plan" for gpt-oss).
- **Windows paths**: all file paths written to config/state must be Windows-native (`C:\…` or TOML-safe
  forward slashes) unless a command is explicitly bash. Validate on every write.
- **node-agent repo** not yet created on GitHub (`Sir-J-AU/Kritical.NodeJS.SCXCodeAgent`) — split staged.

---

## 6. Codex config surface (for the parity GUI)

From codex `ModelProviderInfo` + `ConfigProfile` (Rust source, v0.142.5): `model`, `model_provider`,
`service_tier`, `approval_policy` (untrusted/on-failure/on-request/never), `sandbox_mode`
(read-only/workspace-write/danger-full-access), `model_reasoning_effort`, `plan_mode_reasoning_effort`,
`model_reasoning_summary`, `model_verbosity`, `personality`, `web_search`, `tools`, `features`, `windows`,
`mcp_servers`, `model_catalog_json`, `include_*_instructions`, `experimental_use_unified_exec_tool`, plus
provider fields `base_url`, `env_key`, `wire_api`, `query_params`, `http_headers`, `request_max_retries`,
`stream_max_retries`, `stream_idle_timeout_ms`. The parity GUI renders these; all persist to the shared
`config.toml`, so setting a value in the GUI or in the codex CLI syncs automatically.

---

## 7. Provenance

All §1 rows are live-probe results (`api.scx.ai/v1`, ben key, 2026-07-05). §6 is read from the codex
upstream clone (`C:\KriticalSCX\codex-upstream\codex-rs`). Re-run the probe:
`node <scratchpad>/scx-probe.mjs`. This document is the source of truth; marketing copy loses to it.
