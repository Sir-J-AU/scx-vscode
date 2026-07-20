# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — .5231

### Fixed

- **extension.ts**: `switchKey` panel handler was missing — the 429 "Switch SCX key" button was dead in the chat panel
- **extension.ts**: `switchKey` mutated `process.env.SCX_API_KEY` directly, causing `getConfig()` to re-derive a shrinking key set and lose keys on rotation; now uses a stable rotation index without mutating env
- **extension.ts**: Failed sends left an orphaned user turn in history, causing next send to 400 with "roles must alternate"; trailing user turn is now popped on error in both panel and sidebar catch blocks
- **extension.ts**: `temperature` was sent verbatim; out-of-range values caused a hard 400; now clamped to SCX's proven `[0, 2]` range in `scxPost`
- **scx-agentic-shim.mjs**: A failed plan-gate retry streamed an opaque error via the byte reader; retry failures now return cleanly with logging and telemetry
- **scx-agentic-shim.mjs**: Telemetry `tools_out` and `flattened` reflected the first attempt payload, not the retried (server-tools-dropped) payload; both are now recomputed from the retry body
- **kritical-codex.ps1**: Kill-switch force-killed whatever owned :4199 at teardown, potentially terminating an innocent process; now tracks the exact launched node PID and identity-checks before `Stop-Process`
- **kritical-codex.ps1**: Shim launched without `KRIT_SHIM_PORT`, `KRIT_SHIM_UPSTREAM`, or `SCX_API_KEY` in the child environment, causing silent mismatches on non-default ports; all three vars are now exported before `Start-Process`
- **Install-KritScxLiteLLM.ps1**: Assigned to the read-only automatic `$pid` variable, throwing and breaking `Get-KritLiteLLMPid`; renamed to `$procId`
- **Install-KritScxLiteLLM.ps1**: Same `$pid` write in `-Mode Status`; renamed to `$litellmPid`
- **Kritical.PS.SCXCode.psm1**: `$currentKey.Substring(0, 8)` threw when the key was null or too short; added null and length guards
- **Restore-WorkingClaude.ps1**: Rescue script force-killed the :4180 owner with no identity check; now only kills a `python` or `litellm` owner, otherwise leaves it
- **Install-KriticalSCX.ps1**: "litellm installed" status reused the venv-exists predicate, reporting green even when litellm was absent; now driven off an actual `import litellm` check
- **Install-KritScxLiteLLM.ps1**: `"…".PadRight(60) + '║'` bound `+ '║'` as extra `Write-Host` args, mangling the banner; expression parenthesised
- **Invoke-KritScxSyntheticContext.py**: No per-stream error isolation — one stream's `HTTPError` re-raised through `ex.map`, discarding all successful streams; now uses try/except per stream, synthesises from survivors, and guards all-failed and baseline cases
- **Invoke-KritScxSourceIngest.py**: "byte-exact" storage decoded UTF-8/replace into NVARCHAR, mangling non-UTF-8 bytes; the reassembly proof compared lossy-text vs lossy-text (same U+FFFD both sides) so it always passed and `stored_sha` was never checked; now stores raw bytes via `COMPRESS(<varbinary>)` and proves at byte level (`DECOMPRESS` bytes == original bytes **and** re-hash == stored sha256)
- **kritical-local-store.mjs**: `search('')` built an invalid `WHERE` clause, throwing SQL; empty terms now return cleanly
- **Invoke-KritScxSyntheticContext.py**: Context cap was 11,000 chars (~2.7k tokens), far under the real gpt-oss-120b ~108k ceiling; raised default to 90,000

### Added

- **extension.ts**: Lens Looking Glass webview command (`kritical.scxcode.lookingGlass`) — SCX-powered workspace introspection surface
- **mux/**: Multi-model mux-matrix (`Invoke-KritScxMuxMatrix.py`) — fans one task across DeepSeek-V3.1, MiniMax-M2.7, and gpt-oss-120b in parallel, each sized to its proven real usable ceiling, then synthesises one grounded cross-model answer
- **extension.ts**: Router on/off toggle — allows the operator to enable or disable SCX routing without uninstalling the extension
- **mux/**: SCX bulk-write driver (`Invoke-KritScxBulkWrite.mjs`) — grounds file-generation tasks on real source, fans them across SCX models sized per job, and stages drafts for operator review (the sovereign-SCX "SCX writes, operator lenses" loop)
- **tests**: SCX-authored, operator-lensed offline test suites for the local store and the mux-matrix

### Changed

- **scx-agentic-shim.mjs**: Retry telemetry now reflects the retried payload rather than the original attempt
- **Invoke-KritScxSyntheticContext.py**: Default context cap raised from ~11k to 90,000 chars to utilise gpt-oss-120b's real ~108k token ceiling
- **Invoke-KritScxSourceIngest.py**: Storage backend switched from UTF-8 lossy NVARCHAR to raw-byte VARBINARY via `COMPRESS`; integrity proof now byte-exact

---

## [0.1.27] — 2026-01-27

### Added

- VS Code extension (`kritical.SCXCode`) — chat panel, inline autocomplete, model picker, auto-failover chain, auto-context, and telemetry shipped as VSIX
- Model support: MiniMax-M2.7, MAGPiE, gpt-oss-120b, DeepSeek-V3.1, Meta-Llama-3.3-70B-Instruct, gemma-4-31B-it, Qwen3-32B, Llama-4-Maverick-17B-128E-Instruct, and coder
- PowerShell module (`Kritical.PS.SCXCode`) with 11 exported functions for SCX chat, auto-continue, decision logging, corpus mining, and idempotent install/heal/status
- MCP server (`kritical-scxcode`) — stdio JSON-RPC 2.0 exposing SCX chat, corpus search, and symbol lookup as MCP tools
- Agentic Codex shim (`scx-agentic-shim.mjs`) — localhost flatten-proxy on :4199 that rewrites Codex tool serialisation into SCX-compatible `function` tools and handles plan-gate retries with server tools dropped
- PowerShell Codex wrapper (`kritical-codex.ps1`) — launches the real Codex CLI routed through the shim, reusing the operator's `~/.codex` without modifying it on disk
- Node bulk-writer / local store (`kritical-local-store.mjs`) — `node:sqlite` corpus store with zero native dependencies, ships inside the VS Code extension host
- Lens Looking Glass — SCX-powered workspace introspection with SQL Server byte-exact ingest and corpus mining pipelines
- `kritical.scxcode.muxQuery` command — synthetic-context query that fans out N concurrent SCX streams via the mux
- `kritical.scxcode.lookingGlass` command — opens the Lens Looking Glass webview
- `kritical.scxcode.scxCodex` command — opens SCX Codex terminal session (SCX-branded, never touches real codex)
- `kritical.scxcode.setupGui` command — SCX setup UI for Codex options, MCP servers, and SCXCode shared config
- `kritical.scxcode.checkUpdate` command — checks for sideloaded VSIX updates
- `kritical.scxcode.manageMcp` command — manage MCP servers and tools
- `kritical.scxcode.auditDiff` command — audit current diff against CLAUDE.md HARD RULES
- `kritical.scxcode.generateTests` command — generate tests for the active file
- `kritical.scxcode.explainFile` command — explain the active file
- `kritical.scxcode.refactorSelection` command — refactor selected code in Kritical style
- `kritical.scxcode.explainSelection` command — explain selected code
- `kritical.scxcode.testConnection` command — test SCX connection via `/v1/messages` ping
- `kritical.scxcode.showStatus` command — show SCX status including models, quota, and fallback chain
- `kritical.scxcode.newChat` command — start a new chat session
- `kritical.scxcode.openSettings` command — open SCXCode settings
- `kritical.scxcode.pickModel` command — open the model picker
- `kritical.scxcode.openChat` command — open the SCX chat panel
- Decision logger (`KriticalDecisionLogger.psm1`) — append-only JSONL with SHA + SimHash deduplication (HR27)
- `continue-config.json` — Continue.dev config drop-in for SCX integration
- Idempotent install/heal/status scripts: `Install-KriticalSCX.ps1`, `Install-KritScxVsCode.ps1`, `Install-KritScxLiteLLM.ps1`, `Restore-WorkingClaude.ps1`
- Safety scripts: `Restore-WorkingClaude.ps1` for recovering from broken Claude sessions
- `kritical.scxcode.concurrency` setting — synthetic-context concurrent mux streams (default 1)
- `kritical.scxcode.temperature`, `maxTokens`, `autoContext`, and `provider` settings

---

_This changelog is maintained under the .5231 sovereign-SCX bulk-write loop: entries are SCX-drafted and operator-lensed against the source before landing._
