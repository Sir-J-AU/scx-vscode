# Kritical.NodeJS.SCXCodeAgent

> Node.js bridge daemon — multi-provider (SCX + Anthropic + OpenAI + generic) with auto-continuation, web tools, and HR27 write-through. **Additive layer** — turn it off and every downstream agent (Claude Code / Codex / SCX PS module) reverts to talking to real provider APIs directly.
>
> Status: **MVP complete** (`.5184`). Built against [../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md](../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md) — 21/21 unit tests green + verified live end-to-end against SCX (`/v1/auto-continue` round-trip through the LiteLLM proxy).
>
> Author: **Joshua Finley** — Kritical Pty Ltd — [sales@kritical.net](mailto:sales@kritical.net) — ph. **1300 274 655**

## What this becomes

A localhost daemon at `127.0.0.1:4180` that:

1. Spawns a LiteLLM subprocess (multi-provider translator) internally at `:4182`.
2. Presents Anthropic-shape at `:4180` and OpenAI-shape at `:4181`.
3. Adds auto-continuation on `POST /v1/auto-continue` — port of `Invoke-KritScxAutoContinue`.
4. Adds web tools on `POST /v1/tools/web_{search,fetch}` — Playwright + Brave/Tavily.
5. Writes-through every prompt + response to HR27 store.
6. HR29 kill switch — stopping the daemon returns every downstream agent to direct-API mode.

## Component status

- ✅ `package.json` — Fastify runtime dep (core logic is dependency-free; Node ≥ 20 global `fetch`)
- ✅ `src/server.mjs` — Fastify daemon: passthrough `/v1/messages`, `/v1/chat/completions`, `/v1/models`; `/v1/auto-continue`; `/v1/tools/{web_search,web_fetch,deep_research}`; `/v1/ingest/code` hook; `/admin/kill`; HR27 write-through + `tool-calls.jsonl` ingest events
- ✅ `src/cli.mjs` — install/remove/heal/status delegated to PS installer, start/stop functional
- ✅ `install/Install-KritScxCodeAgent.ps1` — HR16 Install/Remove/Heal/Status, HR14 runtime mirror off OneDrive, HR17 health-probe, HR26 wave receipt, HR29 kill-switch line
- ✅ `src/auto-continue.mjs` — port of `Invoke-KritScxAutoContinue` (natural-terminator + SimHash adjacent-paragraph dedup)
- ✅ `src/hr27.mjs` — JS port of the HR27 logger (SHA256 + 64-bit SimHash + JSONL append, exact-dupe skip, `KRITICAL_LOGGER_TARGET` honoured)
- ✅ `src/tools/web-search.mjs` + `web-fetch.mjs` + `deep-research.mjs` — Brave/Tavily/DuckDuckGo, static fetch + optional Playwright, search→fetch→dedup→summarise
- ✅ `test/*.test.mjs` — 4 files, **21/21 green** via `node --test` (auto-continue, hr27, health, hr29 regression lock)

## Build + run (HR14-safe)

```powershell
# The daemon's node_modules must NOT live in this OneDrive repo (HR14).
# The installer builds a runtime mirror under %LOCALAPPDATA% and installs there:
pwsh ./install/Install-KritScxCodeAgent.ps1 -Mode Install -Apply
pwsh ./install/Install-KritScxCodeAgent.ps1 -Mode Status

curl http://127.0.0.1:4180/health/liveliness
curl -X POST http://127.0.0.1:4180/v1/auto-continue -H "content-type: application/json" `
  -d '{"prompt":"hi","model":"minimax-m2.7","max_continues":2}'
```

To run the tests, mirror `src/` + `test/` + `package.json` to a `%TEMP%` folder, `npm install fastify` there, and `node --test` (keeps `node_modules` off OneDrive per HR14).

Expected liveliness response: JSON with the provider slot table and HR29 kill-switch block.

## HR29 kill switch

**Stop the daemon** and every downstream agent (Claude Code / Codex / SCX PS module) automatically falls back to direct-API. Nothing breaks.

```bash
# Graceful:
curl -X POST http://127.0.0.1:4180/admin/kill

# Or via CLI:
node src/cli.mjs stop
```

The daemon exists to make provider-swap trivial, not to gate anything.

## HARD RULES this daemon must respect

- **HR14** — `node_modules/` NEVER inside OneDrive-synced repo. Route pnpm/npm installs via `%TEMP%` or `D:\`.
- **HR16** — install script has Install / Remove / Heal / Status modes.
- **HR17** — never claim started without probing `/health`.
- **HR21** — every code file has a paired test.
- **HR23** — rotate-not-delete for state files.
- **HR27** — every prompt + response written through to `documentation/{human,ai}/`.
- **HR28** — descriptive names only. No `Ferrari` / `Mega` / `Rocket` — those are HR28 breaches.
- **HR29** — additive layer. Kill switch always visible in `-Mode Status`.

## Cross-links

- Build spec: [../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md](../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md)
- Architecture: [../docs/ARCHITECTURE-SCX-BRIDGE-5182.md](../docs/ARCHITECTURE-SCX-BRIDGE-5182.md)
- Rulebook: [../CLAUDE.md](../CLAUDE.md)
- LiteLLM proxy (subprocess this daemon spawns): [../litellm/](../litellm/)
- Auto-continuation PS impl (port to JS): [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1)
- Decision logger (HR27): [../ps-module/KriticalDecisionLogger.psm1](../ps-module/KriticalDecisionLogger.psm1)
