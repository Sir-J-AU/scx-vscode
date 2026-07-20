# Kritical.SCXCode

**Sovereign Southern Cross AI inside VS Code — agentic Codex-on-SCX via the flatten-shim, PowerShell client, MCP server, Node bulk-writer, multi-model mux, and the Lens Looking Glass.**

> *"The IT and IT Security Experts — if it's too hard for everyone else, just give us a call."*
> Kritical Pty Ltd · sales@kritical.net · 1300 274 655

---

## What it is

Kritical.SCXCode is a monorepo that puts **Southern Cross AI (SCX)** at the centre of the developer workstation. It is not a fork of any upstream tool — every layer is additive and can be switched off independently (HR29). The operator's existing Codex CLI, Claude Code CLI, and VS Code editor remain fully functional whether Kritical's layer is running, degraded, or absent.

### Surfaces

| Surface | Location | What it does |
|---|---|---|
| **VS Code extension** (`kritical.SCXCode`) | `src/` | Chat panel, inline autocomplete, model picker, auto-failover chain, auto-context, telemetry. Ships as a VSIX. |
| **PowerShell module** (`Kritical.PS.SCXCode`) | `ps-module/` | 11 exported functions for SCX chat, auto-continue, decision logging, corpus mining, and install/heal/status idempotent scripts. |
| **MCP server** (`kritical-scxcode`) | `mcp-server/server.mjs` | stdio JSON-RPC 2.0 server — exposes SCX chat, corpus search, and symbol lookup as MCP tools for any MCP-compatible client. |
| **Agentic Codex shim** (`scx-agentic-shim.mjs`) | `codex-wrapper/` | Local flatten-proxy on `127.0.0.1:4199` that rewrites Codex's native tool serialisation into what SCX accepts, then retries plan-gated requests with server tools dropped. |
| **PowerShell Codex wrapper** (`kritical-codex.ps1`) | `codex-wrapper/` | Launches the real Codex CLI routed through the shim, re-using the operator's real `~/.codex` home (MCP servers, plugins) without touching it on disk. |
| **Node bulk-writer / local store** (`kritical-local-store.mjs`) | `store-mcp/` | `node:sqlite` corpus store — mines a repo, indexes files and symbols, and serves keyword search. Ships inside the VS Code extension host with zero native dependencies. |
| **Multi-model mux** (`Invoke-KritScxMuxMatrix.py`) | `mux/` | Fans one task across DeepSeek-V3.1, MiniMax-M2.7, and gpt-oss-120b in parallel, each sized to its **proven real usable ceiling**, then synthesises one grounded cross-model answer. |
| **Lens Looking Glass** | `lens/` | SCX-powered workspace introspection — source ingest (SQL Server byte-exact), corpus mining (Node SQLite), and cross-model synthesis. |

### Models

| Model | Architecture | Context (advertised) | Real usable ceiling | Best for |
|---|---|---|---|---|
| **MiniMax-M2.7** | 230B sparse MoE (10B active) | 192,000 | **195,676** tokens | Default agentic pick — exceeds its advertised ceiling |
| **DeepSeek-V3.1** | 671B MoE (37B active) | 131,072 | **129,300** tokens | Hardest problems; synthesis anchor |
| **gpt-oss-120b** | 117B MoE | 131,072 | **107,842** tokens | Cheapest reasoner; deployment caps input below advertised |
| **MAGPiE** | 117B MoE | 131,072 | ~131K | Near o4-mini reasoning; chat-only |
| **coder** | SCX-optimised | 196,000 | ~196K | Inline autocomplete; algorithms; debugging |
| **gemma-4-31B-it** | Google Gemma 4 31B | 131,072 | ~131K | Multimodal + thinking-mode toggle |
| **Qwen3-32B** | Qwen3 32B dense | 32,000 | ~32K | 119 languages |
| **Llama-4-Maverick-17B-128E-Instruct** | Llama 4 Maverick 400B MoE | 131,072 | ~131K | Multimodal text+image |
| **Meta-Llama-3.3-70B-Instruct** | 70B dense | 131,072 | ~131K | 405B-class dense performance |

> **The advertised numbers lie both ways.** MiniMax exceeds 192K (real ceiling ~196,608). gpt-oss-120b is capped below its 131K ad (real ceiling ~108K). DeepSeek-V3.1 honours the full 131K. The mux sizes each model's injected context to its **proven real usable ceiling** — never the advertised number.

---

## Directory map

```
Kritical.SCXCode/
├── src/                          # VS Code extension (TypeScript, VSIX 0.1.27)
│   ├── extension.ts              # Entry point, commands, webview, SCX transport
│   └── out/                      # Compiled JS (esbuild)
├── ps-module/
│   ├── Kritical.PS.SCXCode.psm1  # 11 exported functions + 4 aliases
│   ├── KriticalDecisionLogger.psm1  # HR27: JSONL append-only, SHA+SimHash dedup
│   └── Kritical.PS.SCXCode.psd1
├── mcp-server/
│   └── server.mjs                # stdio JSON-RPC 2.0 MCP server
├── codex-wrapper/
│   ├── scx-agentic-shim.mjs      # Flatten-proxy: rewrites Codex tools → SCX function
│   ├── kritical-codex.ps1        # PowerShell wrapper: launches codex via shim
│   └── assets/                   # Brand spec, logo
├── store-mcp/
│   └── kritical-local-store.mjs  # node:sqlite corpus store + miner
├── mux/
│   └── Invoke-KritScxMuxMatrix.py  # Multi-model parallel mux + synthesis
├── lens/
│   ├── Invoke-KritScxSourceIngest.py   # SQL Server byte-exact ingest (separate pipeline)
│   └── Invoke-KritScxCorpusMine.py     # Corpus mining (separate from local-store.mjs)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SCX-AGENTIC-BRIDGE-SPEC.md
│   ├── SCX-MUX-STORAGE-CONTEXT-PROOF.md  # Proven ceilings, store comparison, mux proof
│   └── SCX-BUGHUNT-FIXES-5231.md
├── src-db/
│   └── decision_log_schema.sql   # KriticalBrain.dbo.decision_log SQL schema
├── install/
│   ├── Install-KriticalSCX.ps1   # Idempotent: Install / Remove / Heal / Status
│   └── Install-KritScxVsCode.ps1
├── litellm/
│   └── Install-KritScxLiteLLM.ps1
├── safety/
│   └── Restore-WorkingClaude.ps1
├── config-templates/
│   └── continue-config.json      # Continue.dev config drop-in
├── tests/
│   └── Test-KriticalDecisionLogger.ps1
├── documentation/
│   ├── human/   # HR27: every operator prompt (append-only JSONL)
│   └── ai/      # HR27: every AI response (append-only JSONL)
├── CLAUDE.md    # Project rulebook — HARD RULES, HR1–HR29
└── README.md    # This file
```

---

## Quick-start per surface

### VS Code extension

```powershell
# Install the VSIX (sideload)
code --install-extension ./src/kritical.scxcode-0.1.27.vsix

# Or from a share link (HR15)
# New-KritOneDriveShareLink ./src/kritical.scxcode-0.1.27.vsix

# Set your SCX key once (HKCU — survives restarts)
[Environment]::SetEnvironmentVariable('SCX_API_KEY', 'your-key-here', 'User')

# Open VS Code. The Kritical SCXCode panel appears in the Activity Bar.
# Use the model picker or /model to switch. The fallback chain is:
# MiniMax-M2.7 → MAGPiE → gpt-oss-120b
```

Settings (all in VS Code Preferences → Extensions → Kritical SCXCode):

| Setting | Default | Notes |
|---|---|---|
| `kritical.scxcode.apiKey` | `${env:SCX_API_KEY}` | HKCU env fallback |
| `kritical.scxcode.defaultModel` | `MiniMax-M2.7` | |
| `kritical.scxcode.autocompleteModel` | `coder` | 196K context fits large files |
| `kritical.scxcode.fallbackChain` | `[MiniMax-M2.7, MAGPiE, gpt-oss-120b]` | Set `[]` to disable |
| `kritical.scxcode.autocompact` | `auto` | Summarise at 75% context |
| `kritical.scxcode.autoContext` | `file+selection` | Injects editor state per turn |
| `kritical.scxcode.provider` | `auto` | SCX first; falls through to local Claude Code CLI on all-key 429 |

### PowerShell module

```powershell
# Install
git clone https://github.com/Sir-J-AU/Kritical.SCXCode.git $env:TEMP\Kritical.SCXCode
Import-Module $env:TEMP\Kritical.SCXCode\ps-module\Kritical.PS.SCXCode.psd1

# Quick chat
Invoke-KritScxChat "Explain this function" -Model MiniMax-M2.7

# Auto-continue across turns (multi-shot, deduped)
Invoke-KritScxAutoContinue "Build me a REST client" -MaxTurns 5

# Mine the local corpus (node:sqlite — NOT the SQL Server pipeline)
node $env:TEMP\Kritical.SCXCode\store-mcp\kritical-local-store.mjs mine C:\path\to\repo

# Search the corpus
node $env:TEMP\Kritical.SCXCode\store-mcp\kritical-local-store.mjs search "scx-agentic-shim flattenTool"

# Install / Heal / Status (idempotent)
& "$env:TEMP\Kritical.SCXCode\install\Install-KriticalSCX.ps1" -Mode Status
```

### MCP server

```bash
# Start the MCP server (stdio JSON-RPC 2.0)
node mcp-server/server.mjs

# Or via npx (if published)
npx kritical-scxcode

# The server exposes tools: scx_chat, scx_search_corpus, scx_symbols, scx_stats
# Compatible with any MCP client (Continue.dev, Cursor, etc.)
```

### Agentic Codex

```powershell
# Prerequisites: npm install -g @openai/codex
# SCX_API_KEY must be set in HKCU

# Launch Codex routed through the SCX agentic shim
pwsh ./codex-wrapper/kritical-codex.ps1

# Force a specific agentic-capable model
pwsh ./codex-wrapper/kritical-codex.ps1 -Model MiniMax-M2.7

# Non-agentic (chat only, direct to api.scx.ai)
pwsh ./codex-wrapper/kritical-codex.ps1 -NoShim

# Your real ~/.codex (MCP servers, plugins) is reused but NEVER modified.
# HR29: vanilla codex (run without this wrapper) is 100% untouched.
```

### Multi-model mux

```bash
# Fan one question across all three models in parallel, each sized to its real ceiling
python mux/Invoke-KritScxMuxMatrix.py `
  -q "How does the SCX agentic shim handle plan-gated server tools?" `
  -k scx-agentic-shim SCX-AGENTIC-BRIDGE `
  --report out/matrix.md

# Subset of models
python mux/Invoke-KritScxMuxMatrix.py -q "..." --models DeepSeek-V3.1 MiniMax-M2.7

# Override corpus source (directory scan instead of SQLite store)
python mux/Invoke-KritScxMuxMatrix.py -q "..." --corpus C:\path\to\repo
```

---

## The agentic-codex flow

This is the most complex surface. Here is exactly what happens, step by step.

### What the shim is

The OpenAI Codex CLI serialises its agentic tools (shell execution, apply_patch, and others) as SCX rejects them — namespace groupings, `local_shell`, `custom`, and `freeform` types that have no equivalent in SCX's tool schema. SCX accepts `function` tools and emits `function_call`.

The **flatten-shim** (`scx-agentic-shim.mjs`) is a local HTTP proxy on `127.0.0.1:4199` that:

1. Receives Codex's outbound request.
2. Rewrites every tool into a `function` tool — namespace groups are spread into their constituent functions, `local_shell`/`custom`/`freeform` become plain named functions.
3. Forwards the rewritten request to `https://api.scx.ai/v1/responses`.
4. Streams the SSE response back to Codex unchanged.

### Plan-gate retry (the critical behaviour)

SCX has server-side tools (`web_search`, `code_interpreter`, `file_retrieval`, etc.) that require a plan upgrade to use. When Codex's request includes a server tool the model's current plan cannot run, SCX returns **HTTP 400** with a message matching `current plan|model_not_in_plan|not available on your`.

**The shim does NOT return a plan for human approval. It does NOT ask the operator to upgrade. It retries the request with server tools dropped from the payload.**

Specifically:

1. First request sent with all tools (including server tools) → SCX returns plan-gate 400.
2. Shim detects the 400 pattern (`isPlanGateError`).
3. Shim rebuilds the request, removing every tool whose type is in the `SERVER_TOOLS` set (`web_search`, `code_interpreter`, `file_retrieval`, `academic_search`, `youtube_search`, `reddit_search`, `x_search`, `mcp_search`, `trove_search`, `retrieve`, `movie_tv_search`, `trending_movies`, `trending_tv`, `mermaid_diagram`, `coin_data`, `coin_data_by_contract`, `coin_ohlc`, `currency_converter`, `stock_chart`, `stock_price`, `find_place_on_map`, `nearby_places_search`, `weather`, `travel_advisor`, `flight_tracker`, `flight_live_tracker`, `datetime`, `greeting`, `text_translate`, `memory_manager`).
4. Shim retries the request with the remaining client-side tools only.
5. If the retry itself fails (≥400), the error is returned cleanly with logging and telemetry — it is not opaquely streamed as a byte error.

Telemetry (`KRIT_SHIM_TELEMETRY`) records per request: method, endpoint, model, stream flag, whether it was retried, whether tools were flattened, plan_gate flag, status, latency_ms, bytes proxied, and error text.

### HR1/HR29 compliance

- SCX_API_KEY only. The shim never reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or any other provider key.
- Binds localhost only (`127.0.0.1`). Never `0.0.0.0`.
- Does not modify `~/.codex` on disk. All SCX routing is passed as per-invocation `-c` overrides.
- Kill switch: stopping the shim process returns Codex to direct SCX routing immediately.

---

## HR1 / HR29 safety

### HR1 — SCX key only

No Kritical surface ever uses an API key for AI inference from any provider other than SCX. The native plan client or HKCU-registered SCX key is the only inference credential. This applies to every surface: VS Code extension, PowerShell module, MCP server, shim, and mux.

### HR29 — additive, never disruptive

Every Kritical layer is an add-on. Removing it returns the operator to a working baseline.

| Layer | "OFF" means | Underlying agent still works? |
|---|---|---|
| VS Code extension | uninstall the VSIX | Claude Code + Codex + terminal unchanged |
| PowerShell module | not imported | Base `Invoke-KritScxChat` single-turn still callable |
| MCP server | port unbind / stopped | VS Code ext falls back to direct SCX |
| Agentic shim | stopped | Codex routes directly to `api.scx.ai` |
| LiteLLM proxy | stopped / port unbound | Claude Code, Codex, SCX PS module → direct API |
| Decision logger | `$env:KRITICAL_LOGGER_TARGET=none` | Every AI call still succeeds |

Every install / heal / status script prints the "how to fully disable this layer" line at end of `-Mode Status` output.

---

## Corpus mining — two distinct pipelines

There are **two separate corpus ingestion pipelines**. Do not conflate them.

### Node SQLite store (shippable, inside the extension)

```bash
node store-mcp/kritical-local-store.mjs mine <repoRoot>
node store-mcp/kritical-local-store.mjs search "<keywords>"
node store-mcp/kritical-local-store.mjs symbols <name>
node store-mcp/kritical-local-store.mjs stats
```

- Backend: Node ≥ 22 built-in `DatabaseSync`, single `.db` file under `~/.kritical-scx/`.
- Zero native dependencies. Ships inside the VS Code extension host.
- Schema: `files(path, lang, loc, sha, fn_count, content, mined_utc)` + `symbols(path, name, kind, line)`.
- WAL journal mode. Keyword search via `path LIKE ? OR content LIKE ?`.
- This is what the VS Code extension and the mux read from.

### SQL Server byte-exact ingest (server-side, separate pipeline)

```powershell
python lens/Invoke-KritScxSourceIngest.py --source <repoRoot> --dest <sql-connection-string>
```

- Backend: SQL Server Express via `pyodbc` / ODBC 18.
- Stores **raw bytes** via `COMPRESS(<varbinary>)` — byte-exact, not UTF-8 lossy.
- Proves byte-level integrity: `DECOMPRESS` bytes == original bytes **and** re-hashed SHA256 == stored SHA256.
- This is the **server-side source of truth** for heavy/concurrent SQL workloads. It is NOT shippable in the VS Code extension.

---

## Kritical brand

- **Primary colour:** `#13365C` (Kritical navy)
- **Secondary colour:** `#15AFD1` (Kritical cyan)
- **Author:** Joshua Finley
- **Company:** Kritical Pty Ltd
- **Copyright:** (c) 2026 Kritical Pty Ltd. All rights reserved.
- **Positioning:** *"The IT and IT Security Experts — if it's too hard for everyone else, just give us a call."*
- **Tagline:** *"Your last call. And your first move."*
- **Contact:** sales@kritical.net · 1300 274 655 · Geelong & The Bellarine's IT & Cybersecurity Specialists
- **Web:** https://kritical.net

Every published release note, banner, and public artifact carries the tagline. Customer-facing product name is **Kritical Lens™**; internal module names stay `Kritical.*`.

---

> **Kritical Pty Ltd** — (c) 2026. Sovereign Australian AI — powered by Southern Cross AI (SCX). If it's too hard for everyone else, just give us a call.
