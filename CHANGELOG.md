# Changelog

All notable changes documented per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Semantic versioning per [semver.org](https://semver.org/).

## [Unreleased]

### Added
- Path C standalone extension icon (planned)
- Publish `Kritical.PS.SCXCode` to PSGallery (planned)
- Publish `kritical.SCXCode` VS Code extension to OpenVSX + Microsoft Marketplace (planned)
- OpenRouter provider integration (planned; queued as WAVE-5162c in Kritical supervisor)

## [0.1.0] — 2026-07-03 (.5165)

### Added

- Repo scaffold under Kritical Pty Ltd, Sir-J-AU / scx-vscode public GitHub repo.
- **Path A — Continue.dev config template** (`config-templates/continue-config.json`)
  with 8 SCX chat models seeded (MiniMax-M2.7 default, MAGPiE, gpt-oss-120b, DeepSeek-V3.1,
  coder, gemma-4-31B-it, Qwen3-32B, Llama-4-Maverick, Meta-Llama-3.3-70B),
  autocomplete via `coder`, embeddings via `E5-Mistral-7B-Instruct`, custom slash
  commands (`/explain`, `/krit-refactor`, `/audit-my-change`), env-var
  substitution `{{env.SCX_API_KEY}}`.
- **Path C — `kritical.SCXCode` VS Code extension** (`src/`) with
  `package.json` manifest (7 commands, webview chat view, activity-bar container,
  8 typed config properties with enum descriptions) and `extension.ts` with
  SCX HTTPS client, auto-failover across `fallbackChain` on 429/5xx, webview chat
  UI (Kritical brand `#13365C` + `#F2B500`), status bar, output channel, and the
  7 slash commands: openChat, pickModel, testConnection, showStatus,
  explainSelection, refactorSelection, auditDiff.
- **Path D — `Kritical.PS.SCXCode` PowerShell 7 module** (`ps-module/`) with
  10 exported functions (Invoke-KritScx, Invoke-KritScxChat, Get-KritScxModels,
  Get-KritScxConfig, Set-KritScxConfig, Test-KritScxConnection,
  New-KritScxEmbedding, Get-KritScxStatus, Install-KritScxKey, Uninstall-KritScxKey)
  + 4 aliases (`scx`, `scx-chat`, `scx-models`, `scx-test`). Test-ModuleManifest
  passes. Test-KritScxConnection live-verified against `api.scx.ai/v1/messages`.
- **Path E — `kritical-scxcode` MCP server** (`mcp-server/server.mjs`) — stdio
  JSON-RPC 2.0 server exposing 5 tools: `scx_chat` (with failover),
  `scx_list_models`, `scx_test`, `scx_embed`, `scx_status`. Registered in Claude
  Desktop `claude_desktop_config.json` with env-var substitution. initialize +
  tools/list handshake live-verified.
- **`install/Install-KritScxVsCode.ps1`** — HR16 idempotent installer for Path A
  (Install / Remove / Heal / Status modes; HKCU env-var management; Continue
  extension install via `code --install-extension continue.continue`; config
  template drop with backup of any prior config).
- **`install/Install-KritAiCLIs.ps1`** — HR16 idempotent multi-CLI installer for
  claude / codex / opencode / openai / aider / gemini via winget / npm / choco /
  pip. Live-verified on this box: codex v0.140.0 PRESENT, opencode v1.17.7
  PRESENT, PATH heal added `AppData\Roaming\npm` to HKCU.
- **`docs/PROVIDERS.md`** — full 12-model SCX catalog with AUD pricing verified
  live via `GET /v1/models`.
- **`docs/ARCHITECTURE.md`** — 5-path deployment matrix (A/B/C/D/E) + Kritical
  env-var flow + install matrix + test recipes.
- **`docs/OSS-UNIVERSE-CATALOG.md`** — every OSS package in the AI-in-VS-Code
  universe classified EMBED-NOW / REUSE-AS-DEP / EMBED-LATER / KEEP-EYES-ON /
  IRRELEVANT. Covers Continue / Cline / Roo Code / Aider / Cody / SDK layer
  (@anthropic-ai/sdk / openai / @openrouter / litellm / langchain / vercel-ai-sdk /
  genaiscript) / MCP ecosystem / Kritical PSGallery published packages / testing
  glue / RAG evaluation + a glue matrix.

### Kritical env-var convention

All 5 paths read from the same HKCU registry keys:

- `SCX_API_KEY` — sourced from `Github-SecretsOutsideOfGitRepos/scx-benApiKey-MMDDYYYY-vNNN.txt`
- `ANTHROPIC_BASE_URL` = `https://api.scx.ai`
- `KRIT_SCX_MODEL_DEFAULT` = `MiniMax-M2.7`
- `KRIT_SCX_FALLBACK_CHAIN` = `MiniMax-M2.7,MAGPiE,gpt-oss-120b`

### Attribution

- **Continue** — https://github.com/continuedev/continue (Apache 2.0)
- **Cline** — https://github.com/cline/cline (Apache 2.0)
- **Roo Code** — https://github.com/RooCodeInc/Roo-Code (Apache 2.0)
- **SCX** — https://api.scx.ai (Anthropic-shape gateway, AUD pricing)
- **Anthropic Claude Code CLI** — https://claude.com/claude-code (native Max-plan path)
- **OpenAI Codex CLI** — https://github.com/openai/codex (native ChatGPT Plus/Pro)
- **OpenCode AI** — https://opencode.ai (npm `opencode-ai`)

### License

Apache 2.0 — matches all upstream reused projects.
