# OSS universe catalog — what scx-vscode reuses / glues / embeds

> **Operator .5165 mandate**: "find the whole universe of oss/community packages
> that make up the plugin and suck them all in and rapidly glue together with
> any and all required testing."
>
> **Per-package verdict**: EMBED-NOW (bundled in scx-vscode) / EMBED-LATER
> (queued) / KEEP-EYES-ON (evaluated, not yet needed) / REUSE-AS-DEP (declared
> as npm/PSGallery dep, not vendored) / IRRELEVANT (evaluated, rejected).
>
> All prices in AUD unless noted. All licences MIT/Apache 2.0 unless noted.

---

## §A — Chat / inline-complete VS Code extensions (Path A/B/C base layers)

| Package | GitHub | Verdict | Why |
|---|---|---|---|
| **Continue** | `continuedev/continue` | REUSE-AS-DEP (Path A) | Apache 2.0, 100k+ VSIX installs, mature chat + inline complete + model picker + custom slash commands. Anthropic-compatible provider ready. **Path A config template ships in `config-templates/continue-config.json`**. |
| **Cline** (fka Claude Dev) | `cline/cline` | REUSE-AS-DEP (Path B) | Apache 2.0, VS Code side-panel chat + tool use + terminal. OpenAI-compatible provider mode fits SCX shape. |
| **Roo Code** | `RooCodeInc/Roo-Code` | REUSE-AS-DEP (Path B) | Apache 2.0 fork of Cline with more provider settings + better SCX fit. |
| **Aider** (VS Code integration) | `paul-gauthier/aider` | KEEP-EYES-ON | Apache 2.0 CLI-first with VS Code companion. Best-in-class for repo-wide edits. Consider embedding for `krit-refactor` slash. |
| **CodeCompanion** | `olimorris/codecompanion.nvim` | IRRELEVANT | Neovim only. |
| **CodeGPT** | `carlrobertoh/codegpt` | KEEP-EYES-ON | MIT, JetBrains-first. |
| **GitHub Copilot** | (closed source) | IRRELEVANT | Proprietary Microsoft product; not reusable. |
| **Cody by Sourcegraph** | `sourcegraph/cody` | KEEP-EYES-ON | Apache 2.0; strong at codebase-wide semantic. Consider for embeddings-driven `@codebase` mentions. |

## §B — Provider SDKs (used inside Path C standalone extension src/extension.ts)

| Package | Verdict | Purpose |
|---|---|---|
| **`@anthropic-ai/sdk`** (npm) | REUSE-AS-DEP | Anthropic-shape TypeScript client. SCX endpoint accepts it verbatim with `baseURL: 'https://api.scx.ai'`. |
| **`openai`** (npm) | REUSE-AS-DEP | OpenAI-shape client. SCX exposes `/v1/chat/completions` for OpenAI-shape clients. Used for embeddings via E5-Mistral. |
| **`@openrouter/sdk`** | EMBED-LATER | 400+ model router. Kritical Path C uses it as one link in the failover chain (after SCX). WAVE-5162c queued. |
| **`litellm`** (Python) | KEEP-EYES-ON | 100+ provider gateway. Useful if we go Python-side agentic tooling. Not needed for VS Code / PS side. |
| **`langchain`** (npm) | KEEP-EYES-ON | Prompt/chain orchestration. Overkill for now. Consider for `krit-refactor` multi-step flow. |
| **`vercel-ai-sdk`** (`ai` npm) | KEEP-EYES-ON | React streaming UI helpers. Not needed until Path C chat webview grows past current vanilla JS. |
| **`@microsoft/genaiscript`** | KEEP-EYES-ON | Prompt-as-script framework. Interesting for reusable slash commands. |

## §C — MCP (Model Context Protocol) ecosystem — agentic control

| Package | Verdict | Purpose |
|---|---|---|
| **`@modelcontextprotocol/sdk`** (npm) | REUSE-AS-DEP | JSON-RPC over stdio primitives. `mcp-server/server.mjs` currently hand-rolls the protocol — swap to SDK when it's easier than maintaining our own. |
| **`@modelcontextprotocol/server-filesystem`** | EMBED-LATER | Reference FS server. Wire alongside `kritical-scxcode` MCP server so agents get both. |
| **`@modelcontextprotocol/server-github`** | EMBED-LATER | GH ops via MCP. Useful for `scx_chat` → "audit last PR". |
| **`@modelcontextprotocol/server-postgres`** | EMBED-LATER | KriticalBrain SQL access via MCP. Wire per `KRTPax8ToShopifyConnector` DB tier 2. |
| **`Krit.Pax8Mcp`** (PSGallery) | REUSE-AS-DEP | Kritical-authored PSGallery module. Pattern reference for our own MCP wiring. |
| **`falcon-mcp`** | KEEP-EYES-ON | CrowdStrike Falcon MCP tools (in this session's context). Cross-referenced. |

### C.1 — Kritical.SCXCode MCP server (this repo)

Located at `mcp-server/server.mjs`. Exposes 5 tools:

| Tool | Purpose |
|---|---|
| `scx_chat` | One-shot chat with auto-failover across FALLBACK_CHAIN on 429/5xx. |
| `scx_list_models` | GET `/v1/models` — full SCX catalog + AUD pricing. |
| `scx_test` | 20-token round-trip probe with latency. |
| `scx_embed` | E5-Mistral-7B-Instruct embeddings via `/v1/embeddings`. |
| `scx_status` | Config + probe verdict + model count. |

**Registration in Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kritical-scxcode": {
      "command": "node",
      "args": ["c:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/scx-vscode/mcp-server/server.mjs"],
      "env": { "SCX_API_KEY": "${SCX_API_KEY}" }
    }
  }
}
```

**Registration in Cline** (settings → MCP servers): same JSON shape.

## §D — Kritical PowerShell already-published ecosystem (from CLAUDE.md §PUBLISHED PACKAGE INDEX)

| Package | Version | PSGallery | Purpose | Fits scx-vscode? |
|---|---|:---:|---|---|
| **Krit.OmniFramework** | 1.1.14 | ✅ | Kritical PowerShell foundation (auto-loads PSFramework + PSSharedGoods + PSWriteHTML + ImportExcel). | Path C `Kritical.PS.SCXCode` declares `ExternalModuleDependencies = @('Krit.OmniFramework')` per the resilience pattern (memory pin per `KRTPax8ToShopifyConnector` CLAUDE.md). |
| **Krit.Pax8Mcp** | 1.0.0 | ✅ | Multi-agent Pax8 MCP wiring pattern. | **Reference pattern for our own MCP wiring**. |
| **Krit.Hardening** | 1.0.1 | ✅ | Windows hardening audit (HotCakeX + HardeningKitty + DSC). | KEEP-EYES-ON for the `audit-my-change` slash command. |
| **Krit.OpenApi** | 0.1.0 (local) | ⌛ | OpenAPI 3.x → PS module generator. | **Generate `Kritical.PS.SCXCode` directly from SCX's OpenAPI spec once SCX publishes one**. Currently our psm1 is hand-written. |

## §E — Testing / linting glue

| Package | Verdict | Purpose |
|---|---|---|
| **Vitest** (npm) | EMBED-NOW | Unit tests for `extension.ts` and `mcp-server/server.mjs`. |
| **`@vscode/test-electron`** (npm) | EMBED-LATER | End-to-end VS Code extension host tests. |
| **Pester 5.x** (PSGallery) | EMBED-NOW | Tests for `Kritical.PS.SCXCode.psm1`. |
| **ESLint** + `@typescript-eslint/*` | EMBED-NOW | Lint TS/JS. |
| **PSScriptAnalyzer** (PSGallery) | EMBED-NOW | Lint PS. |
| **prettier** | EMBED-NOW | Format TS/JSON. |
| **esbuild** | EMBED-NOW | Bundle Path C extension. |
| **vsce** (`@vscode/vsce`) | EMBED-LATER | Package + publish VSIX to OpenVSX / Microsoft marketplace. |

## §F — Data-plane / knowledge / RAG (evaluated for `@codebase` mentions)

| Package | Verdict | Purpose |
|---|---|---|
| **LlamaIndex** (npm `llamaindex`) | KEEP-EYES-ON | RAG toolkit. Useful when `@codebase` mentions land in Path C chat. |
| **ChromaDB** (`chromadb-client`) | KEEP-EYES-ON | Local vector DB. Alternative to E5-Mistral only-in-memory. |
| **LanceDB** | KEEP-EYES-ON | Serverless vector DB via Arrow. Considered for embeddings persistence. |

## §G — Community VS Code extensions that model our UX

| Extension | Copy-worthy pattern |
|---|---|
| **Continue** | Bottom-bar model picker; `@`-mentions; custom slash commands as JSON. |
| **Cline** | Approvals-first tool use; git-diff review before apply. |
| **Cursor** (fork of VS Code) | Whole-app AI integration (out of scope). |
| **Windsurf** (fka Codeium) | Cascade agent panel — inspiration for Path C future work. |

## §H — What we're deliberately NOT embedding

- **Anthropic API key path** — deliberately not embedded. Claude access is exclusively via the native Claude Max plan (through the `claude.exe` CLI). SCX is separately embedded because SCX billing is native to the operator's SCX plan.
- **OpenAI API key path** — same posture. OpenAI access is exclusively via the native Codex CLI on a ChatGPT Plus / Pro plan. No API keys.
- **Cursor / Windsurf** — closed forks of VS Code. Uses their own IDE, not ours.
- **Copilot** — proprietary Microsoft, not reusable.

## §I — Glue matrix — how the pieces call each other

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Kritical.SCXCode ecosystem                     │
│                                                                     │
│  ┌────────────────┐    ┌────────────────┐    ┌──────────────────┐   │
│  │ VS Code Path A │    │ VS Code Path C │    │ PowerShell       │   │
│  │ Continue+.json │    │ src/extension  │    │ Kritical.PS      │   │
│  │ config template│    │ .ts (this repo)│    │ .SCXCode         │   │
│  └───────┬────────┘    └────────┬───────┘    └────────┬─────────┘   │
│          │                       │                       │           │
│          └───────────────┬───────┼───────────────┬──────┘           │
│                          │       │               │                    │
│                          ▼       ▼               ▼                    │
│                    ┌─────────────────────────────────┐                │
│                    │  HKCU env (single source):      │                │
│                    │  SCX_API_KEY / BASE_URL /       │                │
│                    │  DEFAULT_MODEL / FALLBACK_CHAIN │                │
│                    └────────────────┬────────────────┘                │
│                                     │                                 │
│                                     ▼                                 │
│                    ┌─────────────────────────────────┐                │
│                    │  SCX HTTPS                       │                │
│                    │  /v1/messages  (anthropic-shape) │                │
│                    │  /v1/chat/completions (OpenAI)   │                │
│                    │  /v1/embeddings                  │                │
│                    │  /v1/models                      │                │
│                    └─────────────────────────────────┘                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ MCP server (mcp-server/server.mjs) — stdio JSON-RPC 2.0       │   │
│  │ Exposes: scx_chat / scx_list_models / scx_test / scx_embed /  │   │
│  │          scx_status                                            │   │
│  │ Consumed by: Claude Desktop / Cline / Continue / custom       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## §J — Install matrix (one command each)

| Surface | Install command |
|---|---|
| Path A (Continue) | `pwsh Install-KritScxVsCode.ps1 -Mode Install -Path Continue` |
| Path C (Kritical extension) | `code --install-extension kritical.SCXCode` (once published) OR local build: `cd src && npm i && npm run build && code --install-extension .` |
| PowerShell | `Install-Module Kritical.PS.SCXCode` (once published) OR local: `Import-Module ./ps-module/Kritical.PS.SCXCode.psd1` |
| MCP server | Register `mcp-server/server.mjs` in your MCP client (see §C.1) |

## §K — Testing plan

1. `pwsh -c "Import-Module ./ps-module/Kritical.PS.SCXCode.psd1; Test-KritScxConnection"` — probe live SCX
2. `pwsh -c "Import-Module ./ps-module/Kritical.PS.SCXCode.psd1; Get-KritScxModels | Format-Table"` — list catalog
3. `node mcp-server/server.mjs` (stdio) + JSON-RPC init handshake + `tools/call scx_test` — MCP protocol test
4. `cd src && npm test` — vitest for extension.ts (once tests added)
5. `Invoke-Pester ./ps-module/tests` — PS unit tests (once tests added)
