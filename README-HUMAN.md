# [MONOREPO] Kritical.SCXCode — README (human companion)

> **Sovereign Southern Cross AI (SCX) inside VS Code** — the flagship Kritical AI-dev monorepo.
> Puts SCX at the centre of the developer workstation across multiple independently-switchable
> surfaces (HR29: the operator's Codex/Claude/VS Code keep working with Kritical's layer on,
> degraded, or absent). Every layer is additive, never a fork.
>
> *(The repo's own `README.md` is the canonical human intro with a full surfaces table — this
> file is a navigational + machine-oriented companion, additive.)*

| | |
|---|---|
| **Repo** | `Kritical.SCXCode` (monorepo, multi-language) |
| **VS Code ext** | `SCXCode` v0.1.27 (`src/`, ships as VSIX) |
| **PS module** | `Kritical.PS.SCXCode` v0.1.0 (`ps-module/`, 11 fns) |
| **Node agent** | `@kritical/scxcode-agent` v0.1.0 (`node-agent/`) |
| **Models** | 12+ OSS: MiniMax-M2.7 / MAGPiE / gpt-oss-120b / DeepSeek-V3.1 / coder / gemma-4 / Qwen3 / Llama-4-Maverick / E5-Mistral (embeddings) / Whisper / opir |
| **Compliance** | HR29 (additive/switchable), HR27 (write-through) |
| **Author** | Kritical Pty Ltd |

---

## The surfaces (what SCX exposes)

| Surface | Location | What it does |
|---|---|---|
| **VS Code extension** | `src/` | Chat panel, inline autocomplete, model picker, auto-failover chain, auto-context, telemetry (VSIX). |
| **PowerShell module** | `ps-module/` | 11 fns for SCX chat, embeddings, config, key install/switch, status. |
| **MCP server** (`kritical-scxcode`) | `mcp-server/server.mjs` | stdio JSON-RPC 2.0 — SCX chat + corpus search + symbol lookup as MCP tools. |
| **Agentic Codex shim** | `codex-wrapper/scx-agentic-shim.mjs` | Flatten-proxy on `127.0.0.1:4199` — rewrites Codex tool serialisation into what SCX accepts; retries plan-gated requests. |
| **PS Codex wrapper** | `codex-wrapper/kritical-codex.ps1` | Launches real Codex CLI through the shim, reusing the operator's `~/.codex` untouched. |
| **Model mux / free-router / litellm** | `mux/` · `free-router/` · `litellm/` | Multi-model routing + LiteLLM integration. |
| **Lens Looking Glass** | `lens/` | Python git-archaeology + brain bug-hunt + repo-sweep + Netlink parity tools. |

## PowerShell module (`Kritical.PS.SCXCode`) — 11 functions
`Invoke-KritScx` · `Invoke-KritScxChat` · `Get-KritScxModels` · `Get-/Set-KritScxConfig` ·
`Test-KritScxConnection` · `New-KritScxEmbedding` · `Get-KritScxStatus` ·
`Install-/Uninstall-/Switch-KritScxKey` (HKCU-based env-var convention shared with the VS Code ext).

## Notable contents

- **`media/brand-spec.json`** — the **authoritative Kritical brand-spec** (entity legal name,
  **ABN 39 687 048 086**, ACN, registered address, phones, fonts, colours). This is the file the
  L22 storefront work sourced the footer ABN from — the single source of truth for brand identity.
- **`lens/`** — SCX's own Python "Looking Glass": `Invoke-KritLensBrainBugHunt.py`,
  `Invoke-KritLensRepoSweep.py`, `Invoke-KritLensDiff.py`, `Invoke-KritGitBlobArchaeology*.py`,
  Netlink-parity extractors. (Distinct from the PowerShell `Kritical.Lens` fleet — this is the
  SCX-embedded analysis toolset; potentially relevant to L16 estate bug sweep.)
- **`store-mcp/` · `mcp-server/` · `sql/` · `src-db/`** — MCP + data surfaces.
- **`BRANDING-REGISTER.md`, `CLAUDE.md`, `AGENTS.md`** — governance/brand docs.

## Estate role
- The **AI/model backbone** — the SCX offload the LlmOffload (`Kritical.PS.Toolkit/lib`) and the
  Showcase catalog generation ("SCX-generated draft controls") route through.
- **MCP surface** consumable by any MCP client (Claude Code included).
- **Brand source of truth** (`media/brand-spec.json`).

## ⚠️ Notes
- Large multi-language monorepo (VS Code TS + PS module + Node agent + Python lens + LiteLLM);
  no single build — each surface builds independently (HR29).
- Not a fork of Codex/Claude/VS Code — additive shim layer only.

---
*Companion machine doc: `README-AI.md` (`kritical-readme-ai/v1`). Generated from the repo's own
README surfaces table + component enumeration — new files only, does not touch `README.md`.*
