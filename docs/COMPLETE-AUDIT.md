# Kritical.SCXCode Complete Audit

Date: 2026-07-08  
Repo: `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode`  
Scope: LiteLLM routing, SCX shim, mux, stores, VS Code extension, Codex wrapper, free/SCX agent packs, CLI availability, Windows packaging, supervisor, SQL backing, upstream SCX documentation, and proof.

## Executive State

The requested broad plan is partly shipped and now documented. The core local stack exists:

- SCX-native LiteLLM routing on `4180`.
- Free-first LiteLLM routing on `4182`.
- Codex Responses shim on `4199`.
- VS Code extension under `src/`, currently packaged through VSIX `0.1.27`.
- SCX mux matrix and mixed free-router/SCX supervisor under `mux/`.
- SQLite and MSSQL schema backing under `sql/` and `install/`.
- Store MCP components under `store-mcp/`.
- Free-router and SCX-native agent packs under `free-router/agent-packs/`.
- Secrets-to-env loader with HKCU persistence support.
- E2E proof harness under `tests/Invoke-KritScxE2EProof.ps1`.
- Native coding-tool runtime registry and queue runner gate support.
- OpenRouter free-model batch offload receipts for parallel review/planning lanes.

The remaining gaps are mostly external tooling and productization:

- Kimi, DeepCode, Aider, Cline, Continue, LiteLLM, WiX, and NSIS were not on PATH during audit.
- `kritical.loadout` was not found in this repo as local extension source.
- Windows MSI/NSIS packaging is not proven because the installer toolchain is absent.
- Time-division inter-agent traffic is designed/prototyped through mux/supervisor docs and scripts, but not a full native scheduler.
- The SCX candidate OpenAPI file is mined/generated from docs, not confirmed as an official upstream OpenAPI artifact.

## Audit Matrix

| Area | Status | Evidence | Notes |
|---|---:|---|---|
| LiteLLM SCX routing on `4180` | Shipped | `litellm/kritical-scx.config.yaml`, `litellm/kritical-scx-openrouter.config.yaml` | SCX-native and hybrid configs exist. Start/probe remains via router scripts or direct LiteLLM. |
| Free-router on `4182` | Shipped | `free-router/scripts/Start-KritFreeRouter.ps1`, `litellm/kritical-scx-free.config.yaml` | Localhost-only, free-first fallback chain. |
| Mistral free tier correction | Shipped | `free-router/config/free-providers-registry.json` | Corrected to 2B input and 2B output tokens/day, source marked `operator_verified`. |
| Secrets loader | Shipped | `free-router/scripts/Import-KritSecretsToEnv.ps1` | Loads process env and optional HKCU env from outside-repo key files. |
| DeepCode pack integration | Shipped as additive pack | `free-router/agents/deepcode.config.json`, `free-router/agent-packs/*.json` | DeepCode CLI was not installed on PATH, so native CLI invocation was not proven. |
| Kritical free-router agent pack | Shipped | `free-router/agent-packs/kritical-free-router.agent-pack.json` | Claude, Codex, Continue, Aider, Cline, DeepCode overlay manifest. |
| SCX-native agent pack | Shipped | `free-router/agent-packs/scx-native.agent-pack.json` | Claude, Codex, Continue, Aider, Cline, DeepCode overlay manifest with SCX defaults. |
| Mega agentic pipeline pack | Shipped | `free-router/agent-packs/kritical-agentic-mega-pipeline.agent-pack.json` | Adds Kilo, OpenClaw/KiloClaw, Hermes, Cline/Roo, Continue, Codex, Claude Code, OpenCode, Aider, DeepCode, and account-managed comparators. |
| MCP tool bundle | Shipped | `free-router/agent-packs/kritical-mcp-tools.bundle.json` | SCX MCP, SQL/store MCP, local store, chunk store, and supervisor command bundle. |
| Free agentic model catalog | Shipped | `free-router/config/free-agentic-model-catalog.json` | Local, OpenRouter/free, Hermes/Qwen/Nemotron-style, Mistral 2B/day, Gemini, Groq, Together, SCX, and Claude Max lanes. |
| Target repo bootstrap | Shipped | `install/Add-KritAgenticRepo.ps1` | Adds `.kritical/` pack, MCP bundle, supervisor wrapper, and detailed repo instructions. |
| CodingSystem readiness check | Shipped | `install/Test-KritCodingSystem.ps1` | Checks CLIs, VS Code extensions, env vars, endpoints, manifests, and sister supervisors without printing secrets. |
| 24/7 queue runner | Shipped with gate semantics | `install/Start-KritCodingQueueRunner.ps1`, `install/Invoke-KritCodingGate.ps1` | Drains queued tasks through the mixed supervisor, probes/invokes native tools when requested, and only marks `validated_good` after configured tests pass. |
| Coding tool runtime registry | Shipped | `free-router/config/coding-tool-runtime-registry.json`, `install/Invoke-KritCodingTool.ps1` | Detects Codex, Claude Code, OpenCode, Kilo, Aider, and Hermes; execute mode is opt-in per tool. |
| OpenRouter batch offload | Shipped | `free-router/scripts/Invoke-KritOpenRouterBatch.ps1` | Parallel free-model fanout for review/planning with dry-run and receipt logging. |
| Python environment audit | Shipped | `install/Test-KritPythonEnvironment.ps1` | Fast inventory mode records Python baseline without hanging on deep package execution. |
| Mixed free-router + SCX supervisor | Shipped | `mux/Invoke-KritAgentSupervisor.py` | Dry-run persists lanes to SQLite. Live depends on provider keys and router availability. |
| SCX mux matrix | Shipped | `mux/Invoke-KritScxMuxMatrix.py`, `mux/Invoke-KritScxMuxMatrix.test.py` | SCX-only matrix supports SQLite/MSSQL/directory corpus. |
| SQL backing | Shipped | `sql/scxcode-supervisor-schema.sql`, `sql/scxcode-supervisor-schema.mssql.sql`, `install/Initialize-KritScxBackingStore.ps1` | Supervisor schema exists for SQLite and MSSQL. |
| Store MCP | Shipped | `store-mcp/` | Node local store, chunk store/server, Python FastMCP SQL store. |
| Codex wrapper pack | Shipped | `codex-wrapper/` | Shim, corpus augment, pack build/update scripts, branded wrapper. |
| Auto-context flushing controls | Shipped/proven by tests | `src/extension.ts`, `codex-wrapper/scx-agentic-shim.mjs`, related tests | Existing fixes are covered by E2E and extension build, but long-run 8M token prevention remains an operational monitor item. |
| VS Code `kritical.scxcode` | Shipped | `src/package.json`, `src/extension.ts`, `src/SCXCode-0.1.27.vsix` | Prior architecture doc was stale; corrected now. |
| VS Code `kritical.loadout` | Not found | repo search | No local source found to audit in this checkout. |
| Upstream SCX docs mining | Shipped | `UpstreamDocumentation/` | HTML/text snapshots, live model JSON, candidate spec, validation and smoke reports. |
| Build pipeline docs | Shipped in this pass | `docs/BUILD-PIPELINE.md` | Documents repeatable update and proof sequence. |
| Windows MSI/NSIS packaging | Gap | CLI audit | `wix`, `heat`, `candle`, `makensis` not on PATH. |
| Multi-agent MCP chaining | Partial | MCP server, store MCP, pack docs | Components exist; one-click cross-agent chain orchestration is not complete. |
| Time-division mux strategy | Partial | `docs/AGENTMUX.md`, `docs/AGENTMUX-RUST-DESIGN.md`, `mux/` | Strategy and scripts exist; native scheduler is not complete. |

## CLI And Tooling Availability

Observed on PATH:

| Tool | State |
|---|---|
| `codex` | Found, `codex-cli 0.142.5` |
| `claude` | Found, `2.1.199` |
| `opencode` | Found, `1.17.7` |
| `kilo` | Found, `7.4.1` |
| `node` | Found |
| `npm` | Found |
| `python` | Found |
| `pwsh` | Found |
| `cargo` / `rustup` | Found |
| `aider` | Found via `uvx --python 3.12 --from aider-chat aider` |

Not found on PATH during audit:

| Tool | Impact |
|---|---|
| `kimi` | Kimi native CLI proof not possible locally |
| `deepcode` | DeepCode native CLI proof not possible locally |
| `hermes` | Hermes Agent proof not possible locally until installed and native provider config confirmed |
| `cline` | Cline native CLI proof not applicable/proven locally |
| `continue` | Continue CLI proof not possible locally |
| `litellm` | Router script can install on start, but direct preinstalled proof absent |
| `wix`, `heat`, `candle` | WiX packaging not proven |
| `makensis` | NSIS packaging not proven |

## Secrets Audit

`free-router/scripts/Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly` found and loaded process-only values for:

- `OPENROUTER_API_KEY`
- `SCX_API_KEY`

No matching external key files were found for:

- `MISTRAL_API_KEY`
- `GROQ_API_KEY`
- `TOGETHER_API_KEY`
- `FIREWORKS_API_KEY`
- `GOOGLE_API_KEY`
- `DEEPSEEK_API_KEY`
- `COHERE_API_KEY`

The loader reports only length and SHA256 prefix. It does not print key material.

## LiteLLM Proxy Audit

The repo carries three primary config families:

- `litellm/kritical-scx.config.yaml`: SCX-native model list for `4180`.
- `litellm/kritical-scx-openrouter.config.yaml`: SCX plus OpenRouter/free provider hybrid.
- `litellm/kritical-scx-free.config.yaml`: free-first config for `4182`.

There is also a mirrored free-router copy:

- `free-router/litellm/kritical-scx-free.config.yaml`

Both free configs were aligned so Mistral is treated as a high-capacity free lane and the free default fallback chain does not silently skip paid SCX fallback.

## Mux And Supervisor Audit

`mux/Invoke-KritScxMuxMatrix.py` is the SCX-native matrix engine. It can load context from SQLite, MSSQL, and directory corpora, score models empirically, and synthesize a response.

`mux/Invoke-KritAgentSupervisor.py` is the mixed free-router plus SCX supervisor. It supports dry-run and live modes, lane selection, SQLite persistence, and Markdown reports. It is the current proof point for "both free router and SCX with supervisor."

`mux/Invoke-KritScxMux.ps1` is the older shard-based mux path. It remains useful for LiteLLM `4180` routing and SQL shard ingest, but the mixed supervisor is the newer cross-provider entrypoint.

## Store And MCP Audit

`store-mcp/kritical-local-store.mjs` provides local SQLite indexing through Node `node:sqlite`.

`store-mcp/kritical-chunk-store.mjs` and `store-mcp/kritical-chunk-server.mjs` provide chunked storage and reassembly. The server binds to localhost and protects writes with a local token file.

`store-mcp/kritical_store_mcp.py` provides FastMCP SQL Server tools and blocks mutating SQL statements through a read-only query guard.

`mcp-server/server.mjs` exposes SCX chat, models, embeddings, and related tools over stdio JSON-RPC 2.0.

## Codex Wrapper Pack Audit

The Codex wrapper remains additive:

- `codex-wrapper/scx-agentic-shim.mjs` bridges Codex Responses traffic to SCX.
- `codex-wrapper/scx-corpus-augment.mjs` adds corpus context when opted in.
- `codex-wrapper/kritical-codex.ps1` falls back to the normal `codex` executable when the branded binary is absent.
- `codex-wrapper/pack/Build-KriticalSCXCodex.ps1` builds the branded pack in a separate/disposable workspace.

This satisfies HR29's core requirement: the operator's native Codex path remains intact if Kritical layers are off.

## VS Code Audit

`src/package.json` is at `0.1.27`, and `src/extension.ts` implements real extension behavior: chat, model cache, setup GUI, MCP summary, Looking Glass store views, SCX Codex launch, and auto-context controls.

The old architecture statement that Path C was "scaffold only" was wrong and has been replaced.

## SCX API And Model Audit

`UpstreamDocumentation/` contains mined SCX documentation, including:

- `scx-models.live.json`
- `scx-api-reference.snapshot.json`
- `scx-openapi.candidate.json`
- `scx-live-smoke.latest.json`
- `scx-spec-validate.latest.json`
- rendered HTML/text pages under `UpstreamDocumentation/pages/`

Boundary: `scx-openapi.candidate.json` is a candidate file derived from docs/mining, not a confirmed official OpenAPI download.

## Sister App Alignment

The SCXCode agent-pack defaults are now mirrored into sister supervisor docs:

- `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.NodeJS\docs\SCXCODE-AGENT-PACK-ALIGNMENT.md`
- `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.PS\docs\SCXCODE-AGENT-PACK-ALIGNMENT.md`

SCXCode remains the source of truth for agent pack manifests. NodeJS and PS supervisors keep different orchestration defaults.

## Proof Command

Primary proof:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

Expected coverage:

- Mistral registry correction.
- PowerShell syntax parse for new scripts.
- JSON manifest parse.
- Python compile for supervisor.
- SQLite schema creation.
- Mixed supervisor dry-run.
- Agent pack install smoke.
- VS Code extension build.
- Optional live SCX surface probe when `SCX_API_KEY` is available.

## Remaining Work

1. Install and validate native Kilo, Hermes, Kimi, DeepCode, Aider, Cline, Continue, OpenCode, and LiteLLM CLIs if those exact native surfaces are required.
2. Install WiX or NSIS and add a real Windows installer proof.
3. Convert the time-division mux strategy from docs/prototype scripts into a persistent scheduler.
4. Add a one-command live free-router proof once the relevant non-OpenRouter provider keys are present.
5. Decide whether `kritical.loadout` is a separate repo, a future extension, or a stale plan item, because no local source was found here.
6. Promote the SCX candidate API spec only after an official source or reproducible extraction contract is confirmed.
7. Keep OpenClaw/KiloClaw in explicit-bounds mode: sandboxed worktrees, least-privilege MCP/tools, and account-managed spend visibility.
