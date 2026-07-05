# Kritical.NodeJS.SCXCodeAgent

> Node.js bridge daemon — multi-provider (SCX + Anthropic + OpenAI + generic) with auto-continuation, web tools, and HR27 write-through. **Additive layer** — turn it off and every downstream agent (Claude Code / Codex / SCX PS module) reverts to talking to real provider APIs directly.
>
> Status: **scaffold** (`.5184`). Fresh session builds against [../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md](../reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md).
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

## Current scaffold status

- ✅ `package.json` — Fastify + Undici deps declared
- ✅ `src/server.mjs` — health endpoints functional, all business endpoints return 501 with pointer to the cowork brief
- ✅ `src/cli.mjs` — install/remove/heal/status delegated to PS installer, start/stop functional
- ⏳ `install/Install-KritScxCodeAgent.ps1` — TODO (fresh session; model on [../litellm/Install-KritScxLiteLLM.ps1](../litellm/Install-KritScxLiteLLM.ps1))
- ⏳ `src/auto-continue.mjs` — TODO (port from [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1))
- ⏳ `src/hr27.mjs` — TODO (shell out to PS logger OR port SimHash)
- ⏳ `src/tools/web-search.mjs` + `web-fetch.mjs` + `deep-research.mjs` — TODO
- ⏳ `test/*.test.mjs` — TODO (4 test files per cowork brief)

## Quick smoke test (scaffold-only)

```bash
cd node-agent
# HR14 — install to %TEMP% not this folder's node_modules/:
$env:npm_config_prefix = "$env:TEMP/kritical-scxcode-agent"
npm install fastify undici
node src/server.mjs
# in another terminal:
curl http://127.0.0.1:4180/health/liveliness
```

Expected: JSON response with the provider slot table and HR29 kill-switch block.

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
