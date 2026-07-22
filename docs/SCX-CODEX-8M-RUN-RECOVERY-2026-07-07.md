# SCX Codex 8M-Token Run Recovery - 2026-07-07

## What the other agent was doing

Source: pasted terminal transcripts from the SCX-backed `kritical-codex.ps1` run.

- Launched Kritical SCX Codex from `KRTPax8ToShopifyConnector\KriticalPax8ToShopify`.
- Routed Codex through `http://127.0.0.1:4199/v1` to SCX `MiniMax-M2.7`.
- Tried to reconstruct prior context around SQL-backed storage, synthetic mux, auto-context flushing, and Kritical.SCXCode packaging.
- Audited scattered local assets: `mux/`, `store-mcp/`, `sql/`, `codex-wrapper/`, `C:\KriticalSCX`, VS Code extension files, Codex config, and local `.kritical-scx` stores.
- Tried standard OpenAPI guesses; `https://api.scx.ai/openapi.json` returned 404 in that run.
- Identified that SCX public docs list Responses, Chat/Completions, Embeddings, Moderations, Audio, Realtime, Models, Batches, Anthropic Messages, and Vector Stores.
- Hit `context_length_exceeded` around 199k request tokens against a 196608-token model limit.
- Then hit `429 Too Many Requests`.
- Final reported token usage: `8,678,442 total`, `8,652,069 input`, `26,373 output`.

## What it actually saved locally

- HR27 action log entries only captured wrapper invocations, not the actual full conversation.
- `documentation/ai/2026-07-07/action.jsonl` had two `kritical-codex invocation` rows before this recovery pass.
- `codex-wrapper/_scx-task.txt` recorded a narrow `/models` shim task.
- The worktree contained new or modified audit docs and generated artifacts, but no durable complete handover of the long run's reasoning.
- Existing local stores found:
  - `%USERPROFILE%\.kritical-scx\scxcode-store.db`
  - `%USERPROFILE%\.kritical-scx\models-cache.json`
  - `%USERPROFILE%\.codex\sqlite\*.sqlite`

## Failure diagnosis

- The shim treated transient pressure (`429`, `529`, selected 5xx) like ordinary failures. There was no bounded backoff.
- The shim did not classify context-limit failures separately, so over-budget prompts were not made obvious in telemetry.
- `/models` through the shim needed SCX `{data:[...]}` remapped to Codex `{models:[...]}`.
- The VS Code extension exposed an `autocompact` setting, but the chat histories were still resent in full.
- Existing model caches were lossy picker caches and discarded the full `/models` metadata that contains context length, max output, pricing, supported params, features, and datacenters.
- Platform docs had no obvious official OpenAPI document at common locations, so a repeatable miner/synthesizer is required.

## Recovery changes landed in this pass

- `codex-wrapper/scx-agentic-shim.mjs`
  - Bounded backoff for `429`, `529`, `500`, `502`, `503`, `504`.
  - Context-limit telemetry flag for `context_length_exceeded` / max context failures.
  - Body-safe `/models` remap.
  - Full-fidelity model catalog cache on successful `/models` proxy calls.

- `src/extension.ts`
  - Full-fidelity model catalog cache at `%USERPROFILE%\.kritical-scx\models-catalog.full.json`.
  - Deterministic local auto-context flush for panel and sidebar chat histories.
  - UI reply metadata now shows `flushed N old turns` when compaction happened.

- `models/Get-KritScxModels.ps1`
  - `-Refresh` now writes the full SCX model catalog, not only IDs.
  - `-IncludeMetadata` can return the saved full model rows.

- `install/Invoke-KritScxApiReferenceMine.mjs`
  - Crawls `platform.scx.ai/docs` and `platform.scx.ai/api-reference`.
  - Probes common official OpenAPI locations.
  - Synthesizes `UpstreamDocumentation/scx-openapi.candidate.json`.
  - Captures direct SCX `/v1/models` metadata into `UpstreamDocumentation/scx-models.live.json` when `SCX_API_KEY` is available.

## Current proof

- `node --test tests\Test-KritScxApiReferenceMine.mjs codex-wrapper\scx-agentic-shim.test.mjs codex-wrapper\scx-agentic-shim.edge.test.mjs`
  - 17 tests passed.
- `npm run build` in `src/`
  - `out\extension.js` built successfully.
- Direct SCX model refresh:
  - `full_catalog_count=12`
  - `source=Get-KritScxModels:live:scx`
  - Saved to `%USERPROFILE%\.kritical-scx\models-catalog.full.json`
- Platform miner:
  - `official_openapi_found=false`
  - `model_catalog_count=12`
  - `endpoint_count=28`
  - `page_count=44`

## Still not done

- Codex CLI itself may still resend large internal conversation state through the `:4199` shim. The VS Code extension auto-flush is fixed; Codex-wrapper conversation compaction needs a separate request-shaping layer if Codex does not expose native compaction hooks.
- The generated OpenAPI candidate has endpoint shells only. Request/response schemas need a second pass from detailed API-reference pages plus live dry-run probes where safe.
- The `:4180` LiteLLM proxy model list is alias-normalized and less rich than direct SCX `/v1/models`; direct SCX is the canonical full metadata source.
- Batch/supervisor orchestration still needs a strict contract: return code + tests + dry-run proof + run proof before a task is considered complete.
