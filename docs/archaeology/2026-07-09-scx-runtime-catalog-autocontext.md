# 2026-07-09 SCX Runtime Catalog, Autocontext, Storage, And Mux Archaeology

This note captures the current state of the SCX-facing runtime lane after the model-catalog and VS Code setup pass.

## Control Plane Reality

- This editing session is controlled by OpenAI Codex/ChatGPT infrastructure.
- The local SCX lane under test routes Kritical SCX Codex through:
  - direct SCX API: `https://api.scx.ai/v1`
  - local SCX Responses shim: `http://127.0.0.1:4199/v1`
  - optional LiteLLM/proxy liveliness check: `http://127.0.0.1:4180/health/liveliness`
- The SCX banner only proves the local wrapper/runtime is branded and configured for SCX. It does not prove this host control conversation is itself served by SCX.

## Model Catalog Ground Truth

Canonical install-wide catalog:

```text
C:\KriticalSCX\config\models\scx-model-catalog.json
```

Compatibility mirror:

```text
%USERPROFILE%\.kritical-scx\models-catalog.full.json
```

Previous-copy history:

```text
C:\KriticalSCX\config\models\history
```

The exporter and shim now both write the same full-fidelity JSON shape:

- `captured_utc`
- `provider`
- `server`
- `source`
- `status` when applicable
- `count`
- `chat_count`
- `canonical_path`
- `mirror_path`
- `backup_history_dir`
- `models`

Current live SCX export result:

- source: `Get-KritScxModels:live:scx`
- total models: `12`
- chat-capable models after local filtering: `9`
- non-chat rows currently filtered from chat/model picker: embeddings, Whisper/audio, moderation/rerank/guard-like rows.

## Consumers Now Aligned

`models/Get-KritScxModels.ps1`

- Queries local proxy first when healthy, then direct SCX.
- Writes reduced cache to `C:\KriticalSCX\cache\scx-models.json`.
- Writes full canonical catalog plus user mirror.
- Creates `.bak` and timestamped previous JSON copies before overwrites.

`codex-wrapper/scx-agentic-shim.mjs`

- Writes `/models` responses to the canonical catalog and mirror.
- Preserves the raw upstream SCX rows in the saved catalog for archaeology, VS Code, and future provider tuning.
- Returns a Codex-safe `ModelInfo` projection to Codex itself:
  - only chat-capable rows are returned
  - non-chat/audio rows remain in the saved catalog but are excluded from Codex's runtime model list
  - `input_modalities` is limited to Codex-supported `text` and `image`
  - required Codex fields such as `slug`, `display_name`, `supported_reasoning_levels`, `shell_type`, `visibility`, and truncation metadata are filled
- Keeps telemetry and request normalization separate from the catalog writer.
- Still flattens Codex tool shapes to SCX-compatible function tools.

`codex-wrapper/kritical-codex.ps1`

- Reads the canonical catalog and mirror.
- Normalizes selected model spelling/case from live catalog data before applying the agentic allow-list.
- Still uses per-invocation Codex provider overrides and does not write vanilla `~/.codex` provider settings.

`src/extension.ts`

- Reads full catalog candidates before falling back to the reduced picker cache.
- Uses the full catalog for model context length metadata.
- Model picker is live-catalog driven rather than hardcoded-only.
- Setup GUI now exposes model catalog path, autocontext mode, autocontext max chars, mux streams, max output tokens, and backing store settings.

## Temperature And Sampling Findings

The SCX `/v1/models` response currently advertises supported sampling parameter names, not per-parameter min/max values.

Observed SCX model rows include:

- `supported_sampling_parameters`: `temperature`, `top_p`, `top_k`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`
- `supported_features`: commonly `tools`, `reasoning`, `json_mode` on chat-capable models
- `context_length`
- `max_output_length`
- `pricing`
- `currency`
- modality fields

There is historical repo disagreement:

- Older bridge notes recorded SCX accepting temperature up to `2`.
- The generated API surface/miner and current shim tests use `0..1` as the OpenAI-compatible safe range.

Current implemented rule:

- VS Code UI uses `0..1`.
- `src/extension.ts` clamps outbound chat temperature to `0..1`.
- `codex-wrapper/scx-agentic-shim.mjs` clamps Responses/chat temperature to `0..1`.
- `install/Invoke-KritScxApiReferenceMine.mjs` generates temperature schema as `minimum: 0`, `maximum: 1`.

Open item:

- A live route-specific probe can re-check whether current SCX accepts `temperature: 2` on the exact OpenAI-compatible route. Until then, `0..1` remains the conservative no-error default.

## Autocontext, Storage, And Mux State

Autocontext flush:

- `src/extension.ts` compacts old panel/sidebar history locally before sending when context budget is exceeded.
- UI reply metadata shows flushed turn count.
- The setup GUI exposes `autoContext`, `autoContextMaxChars`, `maxTokens`, and `concurrency`.

Backing storage:

- SQLite Lens store path resolves from VS Code setting, `KRIT_LOCAL_STORE`, then `%USERPROFILE%\.kritical-scx\scxcode-store.db`.
- MSSQL Lens store uses configured server/database.
- Looking Glass reads SQLite first in `auto`, then MSSQL if available.
- E2E proof initializes SQLite backing store successfully.

Mux:

- VS Code chat path calls `scxMux()`.
- `concurrency=1` stays single-stream.
- `concurrency>1` fans out to SCX lenses and synthesizes one answer.
- E2E proof validates supervisor/matrix compile and mixed supervisor dry-run.

## Dirty Worktree Inventory

Files intentionally touched in this pass:

- `models/Get-KritScxModels.ps1`
- `codex-wrapper/scx-agentic-shim.mjs`
- `codex-wrapper/scx-agentic-shim.test.mjs`
- `codex-wrapper/kritical-codex.ps1`
- `src/extension.ts`
- `src/package.json`
- `docs/archaeology/2026-07-09-scx-runtime-catalog-autocontext.md`

Pre-existing dirty or untracked areas still require separate review before cleanup/staging:

- `.claude/settings.local.json`
- `.gitignore`
- `codex-wrapper/pack/Build-KriticalSCXCodex.ps1`
- `docs/ARCHITECTURE.md`
- `install/Install-KritAiCLIs.ps1`
- `lens/`
- `mcp-server/server.mjs`
- `mux/Invoke-KritScxSyntheticContext.py`
- untracked docs, free-router, install scripts, SQL schemas, tests, and generated `out/`

Do not bulk-remove or stage those without a dedicated audit because several are known useful work from earlier waves.

## Proofs Run

```text
PowerShell parse:
  models\Get-KritScxModels.ps1
  codex-wrapper\kritical-codex.ps1
  mux\Invoke-KritScxAutoCompact.ps1

Node syntax:
  codex-wrapper\scx-agentic-shim.mjs
  codex-wrapper\scx-agentic-shim.test.mjs

Shim regression:
  node --test codex-wrapper\scx-agentic-shim.test.mjs
  10 passed, 0 failed

VS Code extension:
  npm run build

Live SCX catalog export:
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\models\Get-KritScxModels.ps1 -Refresh -ServerId scx -CatalogPath C:\KriticalSCX\config\models\scx-model-catalog.json

SCXCode E2E:
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild

Isolated SCX Codex:
  pwsh -NoProfile -ExecutionPolicy Bypass -Command "& '.\codex-wrapper\kritical-codex.ps1' -NoBanner -NoLog -Model 'MiniMax-M2.7' -CodexArgs @('exec','--skip-git-repo-check','Reply exactly: KRITICAL_SCX_CODEX_NO_MODEL_ERRORS_OK')"
  returned KRITICAL_SCX_CODEX_NO_MODEL_ERRORS_OK through provider: scx
```

Latest E2E result:

```text
42 passed, 0 failed, 3 skipped
```

Skipped lanes:

- optional direct OpenRouter free path because `OPENROUTER_API_KEY` was not loaded in that process
- VS Code extension build inside E2E because `-SkipBuild` was supplied; a separate `npm run build` passed
- live SCX surface probe because E2E was not run with `-Live`

Latest SCX Codex runtime note:

- The earlier Codex model-manager decode failures were caused by returning raw SCX provider rows directly to Codex.
- The final isolated proof returned cleanly after the shim filtered non-chat rows and sanitized modalities.
- The proof still reported high token use because Codex loaded a large skill/context surface. That is a separate compression/autocontext optimization lane, not a SCX `/models` decode failure.
