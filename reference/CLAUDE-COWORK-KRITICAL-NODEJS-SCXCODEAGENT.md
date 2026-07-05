# Cowork brief — build Kritical.NodeJS.SCXCodeAgent MVP

> **Fresh Claude Code session should be able to execute this doc without any prior context.**
> Everything you need is here or explicitly referenced by path.
> Author of this brief: prior session (wave `.5183` -> `.5184`, 2026-07-04).
> Operator: Joshua Finley · Kritical Pty Ltd · [sales@kritical.net](mailto:sales@kritical.net) · ph. 1300 274 655.

---

## What you're building

`Kritical.NodeJS.SCXCodeAgent` — a **Node.js daemon** that mounts a LiteLLM proxy as a subprocess, adds multi-turn auto-continuation, wires web tools (web_search / web_fetch / deep_research), writes-through to the HR27 decision store, and exposes ONE localhost endpoint at `http://127.0.0.1:4180` that any coding agent points at. See [../docs/ARCHITECTURE-SCX-BRIDGE-5182.md](../docs/ARCHITECTURE-SCX-BRIDGE-5182.md) for the load-bearing architecture.

## Non-negotiable HARD RULES that constrain this build

Read [../CLAUDE.md](../CLAUDE.md) first. The specific rules that shape this daemon:

- **HR27** — every prompt + response written through to `documentation/{human,ai}/` (SHA + SimHash deduped). Reuse existing PS module or port to JS.
- **HR28** — no metaphor-named identifiers. `Ferrari` / `Mega` / `Rocket` in code = HR28 breach. Use mechanism names.
- **HR29** — additive, never disruptive. Stopping the daemon must return every downstream agent to direct-API baseline. Print the kill switch on every `-Mode Status` output.
- **HR16** — 4-mode idempotent install/heal script: `Install` / `Remove` / `Heal` / `Status`.
- **HR17** — never claim started without probing `/health`.
- **HR21** — every code file has a paired test.
- **HR14** — npm/pnpm installs route via `%TEMP%` or `D:\` — NEVER `node_modules` inside OneDrive-synced repo path.
- **HR23** — rotate-not-delete for state files.
- **HR26** — every wave emits a linter/receipt report to `receipts/`.

## What already exists (reuse — do not rewrite)

| Artefact | Path | Reuse for |
|---|---|---|
| SCX PS client | [../ps-module/Kritical.PS.SCXCode.psm1](../ps-module/Kritical.PS.SCXCode.psm1) | reference impl for single-turn call + key rotation + fallback chain |
| Auto-continuation PS impl | [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1) | port `Invoke-KritScxAutoContinue` logic (natural terminator regex + SimHash dedup + write-through) to Node. Names must NOT be metaphor-derived (HR28). Use `autoContinue` / `naturalTerminator` / `dedupParagraphs`. |
| Decision logger (HR27) | [../ps-module/KriticalDecisionLogger.psm1](../ps-module/KriticalDecisionLogger.psm1) | reference impl for JSONL write + SHA + SimHash + rotate-not-delete. Either shell out to PS OR port to JS (SHA is trivial in Node crypto; SimHash requires porting). Reuse the SAME `documentation/{human,ai}/` folder tree — HR27's canonical store. |
| MCP server (existing) | [../mcp-server/server.mjs](../mcp-server/server.mjs) | reference impl for stdio JSON-RPC 2.0 dialect (Path E) |
| LiteLLM config (multi-provider) | [../litellm/kritical-scx.config.yaml](../litellm/kritical-scx.config.yaml) | this daemon spawns litellm CLI with this config. Do NOT rewrite the config in JS — spawn subprocess. |
| LiteLLM installer | [../litellm/Install-KritScxLiteLLM.ps1](../litellm/Install-KritScxLiteLLM.ps1) | model for the daemon's own install script |
| SCX marketing crawl | [../sources/www.scx.ai/](../sources/www.scx.ai/) | reference for daemon README + docs — SCX = Southern Cross AI Pty Ltd, Australian sovereign |
| SCX API truth | [../sources/api.scx.ai/v1/README.md](../sources/api.scx.ai/v1/README.md) | 12 authoritative models (not paginated). Do NOT hardcode; fetch dynamically. |
| SCX brand + operator conventions | Brand spec: primary `#13365C`, secondary `#15AFD1`, Roboto 42pt / Assistant Medium 21pt. Contact: `sales@kritical.net` / ph. `1300 274 655`. |

## Deliverables (MVP scope)

Ship these under `Kritical.SCXCode/node-agent/` (new subfolder in this repo — do NOT create a new sister repo yet).

### 1. Package skeleton — `node-agent/package.json`

```json
{
  "name": "@kritical/scxcode-agent",
  "version": "0.1.0",
  "description": "Kritical Node.js SCXCode Agent — multi-provider bridge + auto-continuation + web tools + HR27 write-through",
  "type": "module",
  "author": "Joshua Finley <sales@kritical.net> (Kritical Pty Ltd)",
  "license": "Apache-2.0",
  "engines": { "node": ">=20.0.0" },
  "main": "src/server.mjs",
  "bin": { "kritical-scxcode-agent": "src/cli.mjs" },
  "scripts": {
    "start": "node src/server.mjs",
    "test": "node --test test/",
    "lint": "eslint src/"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/http-proxy": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "undici": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "@playwright/test": "^1.48.0"
  }
}
```

Notes:
- Per HR14 the daemon's own `node_modules/` MUST NOT live inside the OneDrive-synced repo. `.gitignore` `node_modules/`. The installer script must invoke `pnpm --store-dir=$env:TEMP/kritical-scxcode-agent-pnpm-store install --prefix .` OR route via `D:\pnpm-store` per HR14.
- `better-sqlite3` is for querying `KriticalBrain` SQL Express IF operator opts in via `KRITICAL_BRAIN_ENABLED=1`. Default off — JSONL under `documentation/` is the canonical store.

### 2. Server — `node-agent/src/server.mjs`

Fastify HTTP server binding `127.0.0.1:4180` (Anthropic-shape) + `127.0.0.1:4181` (OpenAI-shape). Both endpoints ultimately talk to the same LiteLLM subprocess (child_process.spawn) which is the multi-provider translator.

Endpoints:

```
POST /v1/messages           Anthropic-shape — proxies to LiteLLM :4182
POST /v1/chat/completions   OpenAI-shape — proxies to LiteLLM :4182
GET  /v1/models             passthrough to LiteLLM
POST /v1/auto-continue      NEW — multi-turn auto-continuation wrapper
                            (see AutoContinue module logic to port)
GET  /health/liveliness     returns { ok: true, ...providers }
GET  /health/readiness      probes LiteLLM subprocess health
POST /v1/tools/web_search   Brave/Tavily/DuckDuckGo (env-configured)
POST /v1/tools/web_fetch    Playwright headless (localhost only)
POST /v1/tools/deep_research web_search + web_fetch loop, dedup, summarise via SCX
POST /admin/kill            HR29 graceful shutdown — subprocess.kill + exit(0)
```

The daemon spawns litellm as a subprocess on port 4182 (internal). Its own :4180/:4181 endpoints are thin wrappers that either passthrough OR augment (auto-continue / tool injection). Every augmented call still returns a valid Anthropic/OpenAI envelope so the caller does not know it went through anything.

### 3. CLI — `node-agent/src/cli.mjs`

Thin wrapper for `kritical-scxcode-agent {install|remove|heal|status|start|stop}`. Delegates to the PS installer at `install/Install-KritScxCodeAgent.ps1` (below) for the HR16 4-mode operations. `start` runs the Fastify server in the foreground; the PS installer's `Install` mode does `Start-Process` in background + PID file.

### 4. Installer — `node-agent/install/Install-KritScxCodeAgent.ps1`

Model this on [../litellm/Install-KritScxLiteLLM.ps1](../litellm/Install-KritScxLiteLLM.ps1). Same 4 modes. Same HR29 kill-switch verbiage in `-Mode Status`. Same PID + log file locations under `%LOCALAPPDATA%\Kritical\SCXCode\node-agent.pid`.

Additional requirements:
- Prints the multi-provider slot status (from HKCU) — reuse the block already in `Install-KritScxLiteLLM.ps1`.
- Cascade install: Install mode installs the LiteLLM subprocess first (calls `Install-KritScxLiteLLM.ps1 -Mode Install`) then starts the Node daemon on top.
- Remove mode stops the Node daemon but LEAVES the LiteLLM proxy running by default (operator explicitly `-CascadeRemove` to take both down). Rationale: HR29 additive layers — removing the outer layer should not remove the inner one.

### 5. Auto-continuation port — `node-agent/src/auto-continue.mjs`

Port the logic from [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1):

- `naturalTerminatorRegex` = `/(?<=\S)(?:\.\s*$|\?\s*$|!\s*$|```\s*$|---\s*$|\}\s*$|>\s*$)/`
- `testNaturalTerminator(chunk, perTurnCeiling)` — returns true when chunk ends naturally AND length < 80% of ceiling.
- `simHash64(text)` — port from `Get-KriticalContentSimHash` — MD5 per token, aggregate bit-vector, threshold at 0.
- `hammingDistance(a, b)` — Hamming distance on the 64-bit binary strings.
- `dedupAdjacentParagraphs(text)` — split on blank lines, drop paragraphs whose SimHash Hamming ≤ 3 from previous.
- `autoContinue({ prompt, model, maxContinues=10, perTurnCeiling=8192, systemPrompt, sessionId, wave, apiBase, apiKey })` — the main loop. Same logic as `Invoke-KritScxAutoContinue`. Returns `{ mergedResponse, turnCount, stopReason, durationSec, ... }`.

### 6. HR27 write-through — `node-agent/src/hr27.mjs`

Two options — pick ONE and document:

**Option A (recommended)** — shell out to PS. Every write appends via:

```js
import { execFile } from 'node:child_process';
execFile('pwsh', [
  '-NoProfile', '-Command',
  `Import-Module '${loggerPath}' -Force; Add-KriticalHumanPrompt -Content '${escapedContent}' -Category '${category}' -Wave '${wave}' -SessionId '${sessionId}' | Out-Null`
]);
```

Slower per-write but keeps HR27's SimHash + rotate-not-delete + SQL sync semantics guaranteed identical to PS.

**Option B** — port to JS. Faster per-write but you own SimHash correctness. Reuse the exact JSONL row schema documented in [../documentation/human/README.md](../documentation/human/README.md).

Whichever you pick, honour `$env:KRITICAL_LOGGER_TARGET` (`file` / `db` / `both` / `none`) per HR27.

### 7. Web tools — `node-agent/src/tools/`

- `web-search.mjs` — reads `BRAVE_API_KEY` OR `TAVILY_API_KEY` OR `DUCKDUCKGO_API_KEY` from HKCU. If none present, returns 501 with a clear "operator: set $env:BRAVE_API_KEY per..." message. Do NOT silently fail.
- `web-fetch.mjs` — spawns Playwright headless chromium (bundled via `@playwright/test`). Fetches URL, extracts text via readability heuristic, returns clean markdown.
- `deep-research.mjs` — orchestrates web_search → top 5 results → web_fetch each → SimHash-dedup → summarise via `autoContinue` on SCX MiniMax-M2.7.

### 8. Paired tests — `node-agent/test/`

Per HR21. Use Node's built-in `node --test` runner:

- `test/auto-continue.test.mjs` — mirrors `Test-KritScxAutoContinue.ps1` gate for gate. Same 10 gates. Use a mock single-turn function (no live SCX call needed).
- `test/hr27.test.mjs` — round-trip write-then-read against a `$env:KRITICAL_DECISION_LOG_ROOT` sandbox path.
- `test/health.test.mjs` — daemon starts, responds to `/health/liveliness`, gracefully shuts down on `POST /admin/kill`.
- `test/hr29.test.mjs` — the "off" invariant. Assert that direct calls to `api.scx.ai` / `api.anthropic.com` / `api.openai.com` still work with the daemon stopped. This is the load-bearing HR29 regression lock.

### 9. README — `node-agent/README.md`

Same shape as [../litellm/README.md](../litellm/README.md). Multi-provider slot table. Kritical + SCX sales plug at the top. HR29 kill switch verbiage. Kritical contact footer.

### 10. Wave receipt

On successful `-Mode Install -Apply`, write `receipts/wave-<utc>-node-agent-install.json` with the observed state (PIDs, ports bound, LiteLLM subprocess status, HR27 sample write). Per HR26.

## Ingest layer (`.5187` — deferred but note the scope)

Operator direction (.5184): "to the database, all code, all semantic and raw parsing, detailed outputs comparisons and all other details from same, any and all metadata previously identified etc".

This is deferred to `.5187` but the daemon MUST leave hooks so the ingest layer plugs in cleanly:

- Every `/v1/messages` and `/v1/chat/completions` call emits a structured event to `documentation/ai/<date>/tool-calls.jsonl` with prompt shape, model, provider, token counts, latency, and the raw response envelope hash.
- The `deep-research` tool emits per-URL captures to `documentation/ai/<date>/web-captures.jsonl`.
- If `KRITICAL_BRAIN_ENABLED=1` env is set, the daemon also inserts rows into `KriticalBrain.dbo.decision_log` (schema at [../src-db/decision_log_schema.sql](../src-db/decision_log_schema.sql)) — this is the SQL sink the ingest layer will later consume.
- Add a `POST /v1/ingest/code` endpoint stub that accepts `{ path, language, content }`, parses via `tree-sitter` (any language SCX has a tokenizer for), and appends `{ file, ast_hash, symbol_count, imports, exports }` to `documentation/ai/<date>/ast-parses.jsonl`. Wave `.5187` will run this in bulk across the whole tree.

Do NOT build the full ingest orchestrator in this wave. Just leave the hooks.

## Success criteria

Fresh session's wave ships when:

1. `pwsh ./node-agent/install/Install-KritScxCodeAgent.ps1 -Mode Install` completes cleanly.
2. `pwsh ./node-agent/install/Install-KritScxCodeAgent.ps1 -Mode Status` prints:
   - Multi-provider slot table (SCX / Anthropic / OpenAI / Generic each with key-present/absent).
   - LiteLLM subprocess PID + health.
   - Node daemon PID + health.
   - **HR29 kill-switch line** at the bottom.
3. `curl http://127.0.0.1:4180/health/liveliness` returns 200 with a valid JSON envelope.
4. `curl -X POST http://127.0.0.1:4180/v1/auto-continue -d '{"prompt":"hi","model":"minimax-m2.7","max_continues":2}'` returns a merged response.
5. `node --test test/` returns 4/4 test files green.
6. Stopping the daemon (`-Mode Remove`) + then a direct `curl -H "x-api-key: $SCX_API_KEY" https://api.scx.ai/v1/models` still works (HR29 regression lock).
7. HR27 store shows fresh rows for every daemon-served call.
8. Kritical brand banner emits once per daemon session.

## Non-goals

- No fork of Codex CLI in this wave. That's `.5185+`.
- No Claude Code fork. Ever — HR29 says wrap and augment, never replace.
- No SQL ingest orchestrator. Hooks only.
- No public marketplace listing. Internal MVP first.
- No new VS Code extension binaries. Path C already ships; wire it to the daemon in `.5185`.

## Read for context (in order)

1. This brief.
2. [../CLAUDE.md](../CLAUDE.md) — HR27 + HR28 + HR29 (the three rules that constrain this build).
3. [../docs/ARCHITECTURE-SCX-BRIDGE-5182.md](../docs/ARCHITECTURE-SCX-BRIDGE-5182.md) — three-layer architecture.
4. [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1) — the mechanism to port.
5. [../ps-module/KriticalDecisionLogger.psm1](../ps-module/KriticalDecisionLogger.psm1) — HR27 impl to shell out to (or port).
6. [../litellm/kritical-scx.config.yaml](../litellm/kritical-scx.config.yaml) — the LiteLLM config the daemon spawns.
7. [../litellm/Install-KritScxLiteLLM.ps1](../litellm/Install-KritScxLiteLLM.ps1) — pattern for the daemon's own installer.

## Contact for the fresh session

If anything in this brief is unclear, the operator is: **Joshua Finley** — [sales@kritical.net](mailto:sales@kritical.net) — ph. **1300 274 655**.

The prior session (that wrote this brief) noted: **operator has direct relationship with SCX leadership** (no partner-program formality needed for co-marketing / support). Also: **skip anything that reads like Ferrari / Mega / Rocket** — those are HR28 breaches. Every identifier must describe the mechanism.

Good luck.
