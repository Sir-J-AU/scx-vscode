# Kritical.SCXCode Architecture

Kritical.SCXCode is the additive SCX-in-coding-agents stack for Kritical Lens. Every layer is optional: if a router, shim, store, MCP server, VS Code extension, or supervisor is stopped, the underlying agent must still be able to run through its native path.

## Runtime Map

```text
Operator tools
  Claude Code | Codex CLI | Continue | Aider | Cline | DeepCode | VS Code
      |
      | OpenAI-compatible / Anthropic-compatible HTTP
      v
Local additive routing
  127.0.0.1:4180  LiteLLM SCX-native / hybrid router
  127.0.0.1:4182  LiteLLM free-first router
  127.0.0.1:4199  SCX Codex Responses shim
  127.0.0.1:4270  Chunk-store HTTP server
      |
      v
Provider and store backends
  SCX API | OpenRouter/free | Mistral | Google | Groq | Together | DeepSeek | Fireworks | Cohere
  SQLite | SQL Express / MSSQL | append-only JSONL decision logs
```

## Deployment Paths

| Path | Surface | Location | Current state |
|---|---|---|---|
| A | Continue.dev drop-in | `config-templates/`, `free-router/agents/`, agent packs | Shipped config templates and pack manifests |
| B | OpenAI-compatible agent pack overlays | `free-router/agent-packs/`, `free-router/scripts/Install-KritAgentPack.ps1` | Shipped additive free-router and SCX-native packs |
| C | `kritical.scxcode` VS Code extension | `src/` | Built and packaged through VSIX v0.1.27 |
| D | `Kritical.PS.SCXCode` PowerShell module and scripts | `ps-module/`, `install/`, `free-router/scripts/` | Shipped management, setup, key, store, and proof scripts |
| E | `kritical-scxcode` MCP server | `mcp-server/server.mjs` | Shipped stdio JSON-RPC MCP server |
| F | Codex Responses shim and branded Codex wrapper | `codex-wrapper/` | Shipped localhost shim, corpus augment, and pack build scripts |
| G | Supervisor and mux lanes | `mux/` | Shipped SCX mux matrix plus mixed free-router/SCX supervisor |
| H | Local stores | `store-mcp/`, `sql/` | Shipped SQLite, chunk store, Python MSSQL MCP, and schema initializers |

## Routers

`litellm/kritical-scx.config.yaml` is the SCX-native config for port `4180`. It uses `SCX_API_KEY` and does not overwrite operator `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL`.

`litellm/kritical-scx-openrouter.config.yaml` is the hybrid SCX plus OpenRouter/free provider config for port `4180`.

`litellm/kritical-scx-free.config.yaml` and `free-router/litellm/kritical-scx-free.config.yaml` are the free-first configs for port `4182`. The corrected provider order is OpenRouter/free, Mistral, Google/Gemini, Together, Groq, DeepSeek, Fireworks, Cohere, then optional SCX fallback.

All local listeners are localhost-only by design.

## Agent Packs

The free-router pack is `free-router/agent-packs/kritical-free-router.agent-pack.json`. It targets `http://127.0.0.1:4182/v1` and exposes free logical models such as `free-default`, `free-coding`, and `free-reasoning`.

The SCX-native pack is `free-router/agent-packs/scx-native.agent-pack.json`. It targets `https://api.scx.ai/v1` for native OpenAI-compatible clients and `http://127.0.0.1:4199/v1` where the Codex Responses shim is required.

`free-router/scripts/Install-KritAgentPack.ps1` installs these manifests into `%LOCALAPPDATA%\Kritical\SCXCode\agent-packs` and can persist HKCU env vars without modifying upstream agent installs.

## Codex Shim

`codex-wrapper/scx-agentic-shim.mjs` bridges Codex-style Responses calls to SCX. It strips unsupported OpenAI parameters, maps tokens and model names, retries transient SCX errors, emits telemetry, and can augment context from the corpus store. It binds to `127.0.0.1:4199` and uses `SCX_API_KEY`.

`codex-wrapper/kritical-codex.ps1` prefers a compiled branded Codex binary when available, then falls back to the operator's normal `codex` executable.

## VS Code Extension

`src/package.json` and `src/extension.ts` implement the `kritical.scxcode` extension. The extension provides SCX chat, model cache, setup GUI, MCP summaries, Looking Glass store views, auto-context controls, and SCX Codex terminal launch.

Build command:

```powershell
npm --prefix .\src run build
```

Package artifacts currently exist through `src/SCXCode-0.1.27.vsix`.

## Stores

`store-mcp/kritical-local-store.mjs` provides a zero-native-dependency SQLite local file and symbol index using Node's `node:sqlite`.

`store-mcp/kritical-chunk-store.mjs` and `store-mcp/kritical-chunk-server.mjs` provide content-addressed chunk storage, reassembly, and an HTTP API on `127.0.0.1:4270`.

`store-mcp/kritical_store_mcp.py` exposes read-only SQL Server store tools through FastMCP against SQL Express or MSSQL.

`install/Initialize-KritScxBackingStore.ps1` initializes the supervisor SQLite database and can apply the MSSQL schema in `sql/scxcode-supervisor-schema.mssql.sql`.

## Mux And Supervisor

`mux/Invoke-KritScxMuxMatrix.py` is the SCX-native mux matrix. It supports corpus loading from SQLite, MSSQL, and directories, model scoring, and synthesis.

`mux/Invoke-KritAgentSupervisor.py` is the mixed supervisor. It can run free-router lanes and SCX-native lanes together, persist lane results to SQLite, and write a Markdown report.

`mux/Invoke-KritScxMux.ps1` is the older shard mux path through LiteLLM on `4180` with optional SQL shard ingest.

## Secrets

Secrets stay outside repos. `free-router/scripts/Import-KritSecretsToEnv.ps1` reads external key files from `Github-SecretsOutsideOfGitRepos-JoshONLY`, loads process env vars, and can persist HKCU env vars. It prints only names, lengths, and hash prefixes.

Primary vars:

```text
SCX_API_KEY
OPENROUTER_API_KEY
MISTRAL_API_KEY
GROQ_API_KEY
TOGETHER_API_KEY
GOOGLE_API_KEY
DEEPSEEK_API_KEY
FIREWORKS_API_KEY
COHERE_API_KEY
```

## Proof

The end-to-end proof entrypoint is:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

It validates the Mistral registry correction, PowerShell parse, JSON manifests, Python compile, SQLite schema, supervisor dry-run, agent pack install, VS Code build, and optional live SCX surface probe.

## Kill Switches

| Layer | Disable path |
|---|---|
| LiteLLM free router | `pwsh .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Stop` |
| SCX Codex shim | stop the `127.0.0.1:4199` process |
| Chunk server | stop the `127.0.0.1:4270` process |
| Agent packs | `pwsh .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Remove -Pack free` |
| VS Code extension | uninstall the VSIX |
| Decision logger DB ingest | `$env:KRITICAL_LOGGER_TARGET='none'` |

(c) 2026 Kritical Pty Ltd. All rights reserved.
