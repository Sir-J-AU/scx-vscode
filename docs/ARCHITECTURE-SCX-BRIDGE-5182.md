# Kritical LiteLLM Bridge — Architecture (`.5182` → `.5184`)

> Load-bearing architecture doc for the 3-layer Kritical AI stack anchored on Southern Cross AI (SCX) — with **Anthropic + OpenAI + generic** provider slots in the same proxy per HR29 (.5184).
> Supersedes ad-hoc router work. Owned by `Kritical.SCXCode`. Referenced by `Kritical.AISupervisor.*` and `Kritical.NodeJS.SCXCodeAgent`.

## Load-bearing posture (`.5184` update)

Per HR29 (.5184) — every Kritical layer is **additive**:

- **Primary path**: operator's **existing Codex CLI + Claude Code CLI + our VS Code extension**, all pointing at LiteLLM. Provider swap is one env var.
- **Nice-to-have**: `krit-scx.exe` Codex CLI fork, `Kritical.NodeJS.SCXCodeAgent` bridge daemon, auto-continuation shims. These are polish. Skipping them costs nothing — the primary path works standalone.
- **Never break existing tools**. If LiteLLM stops, Claude Code / Codex / SCX PS module all fall back to talking directly to their real provider APIs. If the Node bridge daemon dies, the VS Code extension falls back to `directBaseUrl`. Every layer prints its kill switch in `-Mode Status`.
- **Multi-provider by default**. Same LiteLLM config carries SCX + Anthropic + OpenAI + generic OpenAI-compatible slots. Whichever provider's key is present in HKCU, that slot is live. Absent keys → that slot returns 404 for its models → downstream client picks another.

## The three layers (from the outside in)

```
                       Operator prompt (VS Code / CLI / MCP / PS)
                                        │
                                        ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  Layer 1 — KRITICAL SUPERVISOR                                 │
   │  (Kritical.AISupervisor.NodeJS + Kritical.AISupervisor.PS)     │
   │                                                                │
   │  Job: queue + wave lifecycle + STOP.flag + kill-log +          │
   │       parallel worker coordination + budget guardrails         │
   │  Owns: scripts/state/supervisor-queue.json + HR27 store       │
   │  Talks to: Layer 2 for every inference call                    │
   └────────────────────────────────────────────────────────────────┘
                                        │  {task, model_hint,
                                        │   preferred_provider,
                                        │   max_cost_usd,
                                        │   session_id}
                                        ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  Layer 2 — KRITICAL AIROUTER                                   │
   │  (Kritical.AISupervisor.PS.AIRouter.psm1 + Pax8LlmRouter.psm1) │
   │                                                                │
   │  Job: pick the RIGHT SCX model for THIS task; enforce          │
   │       Kritical policy (HR1 no API keys, HR12 no profanity      │
   │       in public artifacts, HR27 log every call);               │
   │       decide when to invoke Mega-Response continuation.        │
   │                                                                │
   │  Model routing matrix (default):                               │
   │    code / refactor       → coder OR MiniMax-M2.7               │
   │    reasoning / architect → gpt-oss-120b OR DeepSeek-V3.1       │
   │    australian-context    → MAGPiE                              │
   │    embeddings            → E5-Mistral-7B-Instruct              │
   │    transcription         → Whisper-Large-v3                    │
   │    moderation            → opir-large                          │
   │    multimodal / vision   → Llama-4-Maverick                    │
   │    quick / cheap         → Meta-Llama-3.3-70B-Instruct         │
   │                                                                │
   │  Talks to: Layer 3 (localhost bridge) — never SCX directly.    │
   └────────────────────────────────────────────────────────────────┘
                                        │  OpenAI-shape OR
                                        │  Anthropic-shape
                                        ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  Layer 3 — KRITICAL.SCX.LiteLLM BRIDGE                         │
   │  (this repo — Kritical.SCXCode/litellm/ + node.js/scxagent)    │
   │                                                                │
   │  Job: single localhost endpoint that presents BOTH             │
   │       OpenAI + Anthropic shapes; translates to SCX;            │
   │       handles auth + key rotation + fallback chain +           │
   │       multi-turn auto-continuation + web tools +               │
   │       HR27 write-through.                                      │
   │                                                                │
   │  Bind: 127.0.0.1:4180 (Anthropic shape at /v1/messages)        │
   │        127.0.0.1:4181 (OpenAI shape at /v1/chat/completions)   │
   │                                                                │
   │  Adopts LiteLLM as the provider translation engine:            │
   │    - LiteLLM handles OpenAI ↔ Anthropic ↔ any provider         │
   │    - Kritical wraps it with SCX auth + auto-continue +         │
   │      HR27 logging + Kritical brand emit                        │
   │                                                                │
   │  Talks to: api.scx.ai/v1                                       │
   └────────────────────────────────────────────────────────────────┘
                                        │  Bearer $SCX_API_KEY
                                        │  (HKCU rotation pool)
                                        ▼
                             https://api.scx.ai/v1
                             (Southern Cross AI Pty Ltd —
                              Australian sovereign infra)
```

## Where each existing artefact lives

| Concern | Layer | Existing artefact | Status |
|---|---|---|---|
| Wave queue + STOP.flag | 1 | `KRTPax8ToShopifyConnector/scripts/state/supervisor-queue.json` + `Run-PaxOvernightLoop.ps1` | live |
| PS AI router | 2 | `scripts/lib/Kritical.AISupervisor.PS.AIRouter.psm1` + `scripts/lib/Pax8LlmRouter.psm1` | live (predates the bridge) |
| Node.js supervisor | 1+2 | `Kritical.AISupervisor.NodeJS/` (sister repo) | live |
| SCX PS client | 3 | `Kritical.SCXCode/ps-module/Kritical.PS.SCXCode.psm1` | live (`.5165`) |
| SCX MCP server | 3 | `Kritical.SCXCode/mcp-server/server.mjs` | live (`.5165`) |
| SCX VS Code extension | 3 (via bridge) | `Kritical.SCXCode/src/` (SCXCode-0.1.2.vsix) | live (`.5165`) |
| LiteLLM install artefacts | 3 | `Kritical.SCXCode/litellm/` | **NEW — this wave** |
| Bridge Node.js daemon | 3 | `Kritical.SCXCode/node-bridge/` or `Kritical.NodeJS.SCXCodeAgent/` (new sister) | **NEW — next wave** |
| Decision log (HR27) | shared | `Kritical.SCXCode/documentation/{human,ai}/` + `KriticalBrain.dbo.decision_log` | live (`.5182`) |
| Model catalogue | 3 | `Get-KritScxModels` (dynamic — no hardcoding) | live |

## Why LiteLLM at Layer 3 (definitive answer to "does anything already do this")

Grepped the whole Kritical.* + KRTPax8ToShopifyConnector tree at `.5182`. **LiteLLM is NOT wired anywhere**. It appears in `Kritical.SCXCode/docs/OSS-UNIVERSE-CATALOG.md` classified as `KEEP-EYES-ON` with the note *"Useful if we go Python-side agentic tooling. Not needed for VS Code / PS side."*

That reasoning was correct at the time — when the fleet was purely PS + VS Code, LiteLLM was overkill. It stops being overkill the moment we want to:

1. Fork Codex CLI (Rust, expects OpenAI-shape) and point at SCX.
2. Wire Aider (Python, expects OpenAI-shape) at SCX.
3. Point Cline / Continue / OpenCode / goose at SCX with a single-line config change.
4. Give any 3rd-party agent SCX access without teaching it SCX's specific dialect.

The bridge turns Kritical.SCX.LiteLLM into the **universal front door** for the entire OSS coding-agent ecosystem talking to SCX under the hood.

## Multi-turn auto-continuation — "N turns merged into one response"

SCX per-turn `max_tokens` is bounded (typically 4-8K). Operator wants Claude Code-tier long-form responses. Solution: bridge-side loop.

```
Function Invoke-KritScxAutoContinue(prompt, model, max_continues=10):
    conversation = [ {role:user, content:prompt} ]
    accumulated  = ""
    for turn in 1..max_continues:
        r = SCX.messages.create(
            model=model,
            messages=conversation,
            max_tokens=SCX_PER_TURN_CEILING
        )
        chunk = r.content
        accumulated += chunk

        # heuristic completion:
        #   1. last chars are a natural terminator
        #   2. AND chunk length < 80% of ceiling (i.e. model didn't stop from limit)
        if ends_with_natural_terminator(chunk) and length(chunk) < 0.8 * SCX_PER_TURN_CEILING:
            break

        conversation.push( {role:assistant, content:chunk} )
        conversation.push( {role:user, content:"continue from exactly where you left off. no preamble, no meta."} )

    # dedup consecutive-repeated paragraphs (SimHash Hamming ≤ 3 on rolling window)
    accumulated = dedup_consecutive_paragraphs(accumulated)

    # HR27 write-through — as one merged response, not 10 fragments
    Add-KriticalAIResponse -Content accumulated -Model model -Provider scx -Source scx-mega -Category response

    return accumulated
```

Where the natural terminator is:

```regex
(?<=\S)(?:\.\s*$|\?\s*$|!\s*$|```\s*$|---\s*$)
```

Combined with HR27's prior-conversation replay-on-boot, effective context:

```
effective_tokens = SCX_per_turn_max × max_continues + HR27.replay_depth
                 ≈ 4096 × 10 + 20 × 4096
                 ≈ 122,880 tokens per operator turn — from a "commodore 64" API
```

That's ≈ Claude Code territory — reconstructed programmatically without any single SCX turn ever exceeding its ceiling.

## Web-augmentation (MCP tools registered on the bridge)

The bridge exposes three tools to every attached agent:

| Tool | Backend | Notes |
|---|---|---|
| `web_search` | Brave Search API OR Tavily OR DuckDuckGo MCP | Free-tier friendly. Config-selected. |
| `web_fetch` | Playwright headless chromium (local) | Free. Uses the `.claude/settings.local.json` allow-listed browser session. |
| `deep_research` | wraps `web_search` + `web_fetch` in a loop, dedups via SimHash, summarises via SCX MiniMax-M2.7 | The ChatGPT-web-style "deep research" equivalent. |

Every tool result is added back into the conversation as an `tool_result` message. Every result is also written to HR27's `documentation/ai/` store category=`action` for later replay.

## Kritical branding invariant (HR9b + HR13 + brand spec)

The bridge, the daemon, the LiteLLM proxy, and every artefact emitted MUST carry Kritical brand at startup + at run:

- Banner: `KriticalLogo.txt` from `OneDrive\Kritical-Branding\public\` OR bundled `Assets/kritical-logo.txt`
- Author metadata: `Joshua Finley`, `Kritical Pty Ltd`, `(c) 2026 Kritical Pty Ltd`
- Contact footer (non-intrusive, once per session at startup): `Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655`
- Colours in any UI: primary `#13365C`, secondary `#15AFD1`
- Zero API-provider or agent-provider (Claude / Codex / MiniMax / etc.) attribution in customer-facing artefacts.

## Deliverables per wave (roadmap)

| Wave | Deliverable | State |
|---|---|---|
| `.5165` | Path A/C/D/E shipped (Continue config, VS Code ext, PS module, MCP server) | done |
| `.5182` | HR27 decision store + logger + SQL schema + paired test + this arch doc + SCX crawl seed + crawler script | **in-flight this session** |
| `.5182` | Multi-turn auto-continuation (`Invoke-KritScxAutoContinue`) — was named `Invoke-KritScxMegaResponse` at ship then renamed per HR28 (.5183) | in-flight this session |
| `.5182` | Kritical.SCX.LiteLLM install artefacts (config template + install script) | in-flight this session |
| `.5183` | Node.js bridge daemon MVP (`Kritical.NodeJS.SCXCodeAgent`) — LiteLLM + auto-cont + web tools + HR27 | queued |
| `.5184` | Codex CLI fork → `krit-scx.exe` cross-platform binaries | queued |
| `.5185` | VS Code extension talks to bridge (not SCX directly) — inherits web + multi-provider + LSP context | queued |
| `.5186` | AIRouter (Layer 2) routes via bridge instead of raw SCX; consolidates PS + Node routers | queued |
| `.5187` | Full ingest layer — semantic + raw AST parsing of all code + comparisons + all previously-identified metadata written to `KriticalBrain` from the bridge daemon | queued (operator .5184 direction) |

## Non-goals (explicit)

- Not a new inference engine. Not a new provider. SCX stays SCX.
- Not a Postgres / DuckDB deployment. Per §0a-1 canonical: SQL Express `KriticalBrain` only.
- Not a competing VS Code extension family. `kritical.SCXCode` (Path C) IS the Kritical VS Code extension.
- Not another agent framework (LangChain / smolagents / CrewAI). Bridge is provider-shaping only; agent logic lives in the operator's chosen agent (Codex fork / Cline / OpenCode / etc.) or in Kritical.AISupervisor.

## Cross-refs

- Repo-scoped rulebook: [../CLAUDE.md](../CLAUDE.md) (HR27 = why this store exists at all)
- Upstream connector rulebook: `KRTPax8ToShopifyConnector/CLAUDE.md` (HR1/12/13/23/26 we inherit)
- OSS universe scan: [OSS-UNIVERSE-CATALOG.md](OSS-UNIVERSE-CATALOG.md) (updated `.5182` — see LiteLLM row)
- Existing paths: [ARCHITECTURE.md](ARCHITECTURE.md) (Paths A/B/C/D/E — this doc adds Path F Bridge)
- Provider catalog: [PROVIDERS.md](PROVIDERS.md) (12 SCX models — dynamic list, see `sources/api.scx.ai/v1/README.md`)
- HR27 store: [../documentation/human/README.md](../documentation/human/README.md) + [../documentation/ai/README.md](../documentation/ai/README.md)
- Logger module: [../ps-module/KriticalDecisionLogger.psm1](../ps-module/KriticalDecisionLogger.psm1)
- Auto-continue implementation: [../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1](../ps-module/Kritical.PS.SCXCode.AutoContinue.psm1) `Invoke-KritScxAutoContinue` (this wave)

---

*This document is the load-bearing architecture reference for Kritical.SCX.LiteLLM. When the design drifts, THIS is the file that gets updated first — then every other artefact in the same commit per HR21 discipline.*
