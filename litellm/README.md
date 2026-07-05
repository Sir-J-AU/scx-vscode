# Kritical LiteLLM proxy — multi-provider front

> **Universal front for SCX + Anthropic + OpenAI + any OpenAI-compatible endpoint** — a localhost LiteLLM proxy that lets any coding agent (Codex CLI / Claude Code / Aider / Cline / Continue / OpenCode / goose / our VS Code extension) point at `http://127.0.0.1:4180` and pick whichever provider is currently configured.
>
> **Per HR29 (.5184)** — this proxy is ADDITIVE. Stop it and every agent falls back to talking to the real APIs directly (`api.anthropic.com` / `api.openai.com` / `api.scx.ai`). Zero rewrite. Zero re-install. The proxy exists to make provider-swap trivial, not to gate anything.
>
> Author: **Joshua Finley** — Kritical Pty Ltd — [sales@kritical.net](mailto:sales@kritical.net) — ph. **1300 274 655**

## What this is

- One local proxy → operator picks the provider per call.
- SCX + Anthropic + OpenAI + generic OpenAI-compatible slots side-by-side.
- Every model as a normalised alias (`minimax-m2.7`, `scx-coder`, `anthropic/claude-sonnet-4-6`, `openai/gpt-5-codex`, `generic/default`, …).
- Automatic model-fallback chain on 429/5xx (SCX side).
- No prompt/response body written to disk (SCX zero-retention posture preserved).
- All keys stay in HKCU — never in source, never in the proxy binary.
- **HR29 kill switch**: `pwsh ./Install-KritScxLiteLLM.ps1 -Mode Remove` stops the proxy; every downstream agent reverts to direct-API. Zero surprise breakage.

## Install (one line)

```powershell
pwsh ./litellm/Install-KritScxLiteLLM.ps1 -Mode Install
```

HR16 idempotent. Re-runs are safe. Modes: `Install` / `Remove` / `Heal` / `Status`.

## Confirm it's running

```powershell
pwsh ./litellm/Install-KritScxLiteLLM.ps1 -Mode Status
```

Or curl:

```bash
curl http://127.0.0.1:4180/health/liveliness
curl -H "Authorization: Bearer sk-kritical-scx-local" http://127.0.0.1:4180/v1/models
```

## Point your agent at it

| Agent | Environment |
|---|---|
| **Codex CLI** | `OPENAI_BASE_URL=http://127.0.0.1:4180`, `OPENAI_API_KEY=sk-kritical-scx-local` |
| **Aider** | `aider --openai-api-base http://127.0.0.1:4180 --openai-api-key sk-kritical-scx-local --model minimax-m2.7` |
| **Cline / Roo-Code / Kilo Code** | Provider = OpenAI-compatible, Base URL = `http://127.0.0.1:4180`, key = `sk-kritical-scx-local` |
| **Continue.dev** | Add `openai` provider with `apiBase: http://127.0.0.1:4180` in `~/.continue/config.yaml` |
| **OpenCode** | `--provider openai --api-base http://127.0.0.1:4180` |
| **goose (Block)** | Configure `openai` provider with `host: http://127.0.0.1:4180` |
| **Claude Code (this session)** | `ANTHROPIC_BASE_URL=http://127.0.0.1:4180` — LiteLLM presents Anthropic shape |
| **kritical.SCXCode VS Code ext** | Config `kritical.scxcode.baseUrl = http://127.0.0.1:4180` (queued wire-in) |

## Model aliases exposed

Dynamic — see [kritical-scx.config.yaml](kritical-scx.config.yaml). Canonical set at `.5184`:

**SCX slot** (always active if `SCX_API_KEY` set):

- Coding: `minimax-m2.7`, `scx-coder`, `claude-sonnet-4-6` (SCX-served alias)
- Reasoning: `gpt-oss-120b`, `deepseek-v3.1`
- Australian-context: `magpie`
- Multimodal: `llama-4-maverick`
- Quick/cheap: `llama-3.3-70b`, `qwen3-32b`, `gemma-4`
- Embeddings: `e5-mistral-embeddings`
- Speech: `whisper-large-v3`

**Anthropic slot** (active if `ANTHROPIC_API_KEY` set):

- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-opus-4-7`
- `anthropic/claude-haiku-4-5`

**OpenAI slot** (active if `OPENAI_API_KEY` set):

- `openai/gpt-5`
- `openai/gpt-5-codex`
- `openai/gpt-4o`
- `openai/gpt-4o-mini`

**Generic slot** (active if `GENERIC_API_BASE` + `GENERIC_API_KEY` set):

- `generic/default` — routes to `${GENERIC_API_BASE}/${GENERIC_MODEL_NAME}` with OpenAI shape. Use for Ollama, LM Studio, OpenRouter, Together, Fireworks, Groq, DeepInfra, or any internal endpoint.

## Why LiteLLM and not something else

Grepped the entire Kritical.* tree at `.5182`. **LiteLLM was never wired** — filed as `KEEP-EYES-ON` back when the fleet was purely PowerShell + VS Code (BerriAI/litellm was overkill then). The moment we want to plug Codex CLI (Rust, OpenAI-shape) / Aider (Python, OpenAI-shape) / Cline (TS, OpenAI-shape) into SCX, LiteLLM becomes the cleanest single translation layer. See [../docs/ARCHITECTURE-SCX-BRIDGE-5182.md](../docs/ARCHITECTURE-SCX-BRIDGE-5182.md) for the full architectural argument.

## What this proxy does NOT do (by design)

- **No auto-continuation** — that's `Invoke-KritScxAutoContinue` in [Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1). LiteLLM stays a clean single-turn translator; multi-turn auto-continuation lives one layer up in the Node bridge.
- **No web tools** — those are also bridge-layer (queued `Kritical.NodeJS.SCXCodeAgent`).
- **No HR27 logging** — bridge layer, not proxy layer. This keeps LiteLLM upstream-compatible.
- **No 0.0.0.0 bind** — localhost only. Never internet-exposed. Rotate the master key if you break this rule.

## Cross-refs

- Architecture: [../docs/ARCHITECTURE-SCX-BRIDGE-5182.md](../docs/ARCHITECTURE-SCX-BRIDGE-5182.md)
- Rulebook: [../CLAUDE.md](../CLAUDE.md) (HR27 write-through happens in the bridge layer, not here)
- Model catalogue truth: [../sources/api.scx.ai/v1/README.md](../sources/api.scx.ai/v1/README.md)
- Auto-continuation module (layer above): [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1)
- SCX partner positioning: [../sources/www.scx.ai/partner-program.md](../sources/www.scx.ai/partner-program.md)
