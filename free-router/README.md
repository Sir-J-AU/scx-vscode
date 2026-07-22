# Kritical Free Router — OpenRouter + Free AI Provider Integration

> **The simplest way to get free inference.** OpenRouter's `/free` endpoint selects free models at random, smartly filtering for features your request needs (vision, tools, JSON, reasoning). Combined with Groq, Together AI, Google AI Studio, DeepSeek, and more — all routed through a single local LiteLLM proxy.

**Author:** Joshua Finley — Kritical Pty Ltd — sales@kritical.net — ph. 1300 274 655

---

## Quick Start

### 1. Register your OpenRouter key (and any other free provider keys)

```powershell
# OpenRouter is the crown jewel — unlimited free frontier models
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider openrouter -Key "sk-or-v1-..."

# Add more free providers for redundancy and speed
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider google -Key "AIzaSy..."
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider groq -Key "gsk_..."
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider together -Key "..."
```

### 2. Start the Free Router

```powershell
# Free-first config (port 4182)
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Start -Config free

# Or the hybrid SCX+OpenRouter config (port 4180)
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Start -Config openrouter
```

### 3. Point your coding agent at the router

| Tool | Command / Config |
|------|-----------------|
| **Claude Code** | `claude config set apiUrl http://127.0.0.1:4182` |
| **Codex CLI** | `pwsh ./scripts/kritical-openrouter.ps1` |
| **Continue.dev** | Set `apiBase` to `http://127.0.0.1:4182` |
| **Kimi Code** | Uses Continue.dev config — same endpoint |
| **DeepCode** | `deepcode --api-base http://127.0.0.1:4182` |
| **Aider** | `aider --model openrouter/free --api-base http://127.0.0.1:4182` |
| **Cline** | Set OpenAI-compatible base URL to `http://127.0.0.1:4182` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CODING AGENTS                               │
│  Claude Code  Codex CLI  Continue.dev  Kimi  DeepCode  Aider   │
└─────────────────┬───────────────────────────────────────────────┘
                  │  All speak OpenAI-compatible API
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              Kritical LiteLLM Proxy (localhost)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Port 4180   │  │ Port 4181   │  │ Port 4182   │             │
│  │ SCX+OR hybrid│  │ Anthropic   │  │ FREE-FIRST  │             │
│  │ (default)   │  │ shape       │  │ (this dir)  │             │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘             │
└─────────┬──────────────────────────────────┬────────────────────┘
          │                                  │
    ┌─────┴──────┐                    ┌──────┴──────┐
    │  SCX Paid  │                    │ Free Tier   │
    │  api.scx.ai│                    │ Providers   │
    └────────────┘                    ├─────────────┤
                                      │ OpenRouter  │ ← unlimited /free
│ Mistral     │ ← 2B tokens/day
│ Google AI   │ ← 15 RPM, 1M TPM
│ Groq        │ ← 1K tok/sec
                                      │ Together AI │ ← 1M tokens/day
                                      │ DeepSeek    │ ← reasoning specialist
                                      │ Fireworks   │ ← 400+ models
                                      │ Cohere      │ ← Command R
│ Mistral     │ ← Codestral, Devstral
                                      │ Ollama      │ ← local, truly free
                                      └─────────────┘
```

---

## Free Provider Registry

Sorted by generosity (daily free tokens). Full details in `config/free-providers-registry.json`.

| Rank | Provider | Free Tier | RPM | Best For |
|------|----------|-----------|-----|----------|
| 1 | **OpenRouter /free** | Unlimited (rate-limited) | 20 | General purpose, rotating frontier models |
| 2 | **Mistral** | 2B tokens/day | Rate-limited | Codestral, Devstral, high-volume free code work |
| 3 | **Google AI Studio** | 15 RPM, 1M TPM | 15 | Vision, grounding, long context |
| 4 | **Together AI** | ~1M tokens/day | 60 | Research models, serverless |
| 5 | **Groq** | ~500K tokens/day | 30 | **Speed** — 1,000+ tokens/sec |
| 6 | **DeepSeek** | ~500K tokens/day | — | Reasoning, code generation |
| 7 | **Fireworks AI** | ~500K tokens/day | 60 | 400+ models, sub-2s latency |
| 8 | **Cohere** | ~1M tokens/month | 100 | RAG, Command R series |
| 9 | **Ollama** | Truly unlimited | — | Local privacy, offline |
| 10 | **LM Studio** | Truly unlimited | — | Local GUI inference |

---

## Top Free Models Available via OpenRouter

These models rotate through the `/free` endpoint based on availability:

| Model | Provider | Parameters | Context | Features |
|-------|----------|-----------|---------|----------|
| **gpt-oss-120b** | OpenAI | 120B | 131K | Reasoning, near-o4-mini |
| **Nemotron 3 Super** | NVIDIA | — | 128K | Coding, agents |
| **Llama 3.3 70B** | Meta | 70B | 128K | General purpose |
| **Qwen3 Coder 480B** | Alibaba | 480B MoE | 128K | Code specialist |
| **Gemma 4 31B** | Google | 31B | 128K | Multimodal |
| **DeepSeek-V3.1** | DeepSeek | 671B MoE | 128K | Hard problems |
| **MAGPiE** | SCX | 117B MoE | 131K | Australian context |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `litellm/kritical-scx-openrouter.config.yaml` | SCX + OpenRouter hybrid (port 4180) |
| `litellm/kritical-scx-free.config.yaml` | Free-first routing (port 4182) |
| `config/free-providers-registry.json` | Central registry of all free providers |
| `scripts/Register-KritFreeApiKey.ps1` | Key management (register, validate, rotate) |
| `scripts/Start-KritFreeRouter.ps1` | Router launcher (Start/Stop/Heal/Status) |
| `scripts/kritical-openrouter.ps1` | Codex CLI wrapper for OpenRouter |
| `agents/claude-code.config.json` | Claude Code config |
| `agents/kimi-code.config.json` | Continue.dev / Kimi Code config |
| `agents/deepcode.config.json` | DeepCode (DeepSeek-focused) config |

---

## PowerShell Commands

### Key Management

```powershell
# Show all key statuses
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Status

# Register a key (secure prompt if -Key omitted)
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider openrouter -Key "sk-or-v1-..."

# Validate a key works
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider openrouter -Validate

# Validate ALL registered keys
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider all -Validate

# Remove a key
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider groq -Remove

# Rotate (archive old, prompt for new)
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider openrouter -Rotate
```

### Router Management

```powershell
# Start free-first router
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Start -Config free

# Start hybrid router
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Start -Config openrouter

# Check status
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Status

# Restart if unhealthy
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Heal

# Stop
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Stop
```

---

## Agentic Coding Tools Showcase

### Claude Code + OpenRouter

```bash
# Configure once
claude config set apiUrl http://127.0.0.1:4182
claude config set apiKey sk-kritical-free-local
claude config set model openrouter/free

# Use forever
claude
> review this PR
> refactor src/utils to use async/await
> write tests for the auth middleware
```

### Codex CLI + OpenRouter

```powershell
# Via Kritical wrapper (recommended)
pwsh ./scripts/kritical-openrouter.ps1 -- exec "implement a Red-Black tree in Python"

# Direct
claude config set apiUrl http://127.0.0.1:4182
codex -c model=openrouter/free -c api_key=sk-kritical-free-local
```

### Continue.dev / Kimi Code

Copy `agents/kimi-code.config.json` to `%USERPROFILE%\.continue\config.json`:

```powershell
$src = 'agents\kimi-code.config.json'
$dst = "$env:USERPROFILE\.continue\config.json"
Copy-Item $src $dst -Force
```

Then restart VS Code. The Continue panel now shows:
- **OpenRouter /free** — unlimited rotating frontier models
- **Gemini 2.5 Flash** — Google's generous free tier
- **Groq Llama 3.3** — 1,000 tokens/sec
- **DeepSeek Chat** — reasoning specialist

### DeepCode (DeepSeek-focused)

```powershell
# DeepCode uses DeepSeek's reasoning capabilities
$env:DEEPCODE_API_BASE = 'http://127.0.0.1:4182'
$env:DEEPCODE_MODEL = 'deepseek/deepseek-chat'

deepcode review src/
deepcode explain complex_function.py
deepcode test --generate-missing
```

### Aider + OpenRouter

```bash
# Free coding pair programmer
aider --model openrouter/free --api-base http://127.0.0.1:4182

# With specific model
aider --model openrouter/qwen/qwen3-coder-480b-a35b --api-base http://127.0.0.1:4182
```

### Cline (VS Code extension)

In Cline settings:
- **API Provider**: OpenAI Compatible
- **Base URL**: `http://127.0.0.1:4182`
- **API Key**: `sk-kritical-free-local`
- **Model**: `openrouter/free`

---

## Fallback Chain

When a provider hits its limit or goes down, the router automatically falls back:

```
openrouter/free  →  mistral/codestral-latest  →  openrouter/gpt-oss-120b
     ↓                    ↓                          ↓
gemini/gemini-2.5-flash → groq/llama-3.3 → together/llama-3.3
     ↓                    ↓                          ↓
SCX paid tier    →  (never fails — unlimited)
```

---

## Hard Rules (inherited from Kritical.SCXCode)

- **HR29 (Additive)**: This layer is additive. Stop the router → agents fall back to direct API. Zero rewrite.
- **HR1 (Key Safety)**: Keys live in HKCU environment variables only. Never committed. Never logged.
- **HR16 (Idempotent)**: All scripts support Install/Start/Stop/Heal/Status modes.
- **HR17 (Probe First)**: Router never claims "started" without a successful health check.
- **HR27 (Logged)**: All prompts and responses captured to `documentation/human/` + `documentation/ai/`.

---

## Getting API Keys

| Provider | Signup URL |
|----------|-----------|
| OpenRouter | https://openrouter.ai/settings/keys |
| Google AI Studio | https://aistudio.google.com/app/apikey |
| Groq | https://console.groq.com/keys |
| Together AI | https://api.together.xyz/settings/api-keys |
| DeepSeek | https://platform.deepseek.com/api_keys |
| Fireworks AI | https://fireworks.ai/account/api-keys |
| Cohere | https://dashboard.cohere.com/api-keys |
| Mistral AI | https://console.mistral.ai/api-keys/ |

---

## Troubleshooting

### "No endpoint available"
```powershell
# Register at least one key
pwsh ./scripts/Register-KritFreeApiKey.ps1 -Provider openrouter -Key <key>
```

### "429 Rate Limited"
The router automatically falls back to the next provider. If all free tiers exhaust, it falls back to SCX paid (if configured).

### "Model not found"
OpenRouter's `/free` endpoint dynamically selects models. For deterministic routing, use a specific model slug like `openrouter/nvidia/nemotron-3-super`.

### Local router won't start
```powershell
# Check what's using port 4182
Get-NetTCPConnection -LocalPort 4182

# Heal (stop + restart)
pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Heal
```

---

*(c) 2026 Kritical Pty Ltd. All rights reserved. sales@kritical.net · ph. 1300 274 655*
