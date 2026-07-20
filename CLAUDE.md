# Kritical.SCXCode — Project Rulebook

> Repo-scoped rulebook for `Kritical.SCXCode` (SCX-in-VS-Code + PowerShell client + MCP server + Node.js agent). Auto-loaded by Claude Code / Codex / any agent that opens this folder. Treat as load-bearing project context.
>
> **Companion sister rulebook**: `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\KRTPax8ToShopifyConnector\CLAUDE.md` (the Pax8↔BC↔Shopify connector — much larger, upstream HARD RULE conventions we inherit).

---

## 🚨🚨🚨🚨 HARD RULE 29 (.5184) — KRITICAL LAYERS ARE ADDITIVE, NEVER DISRUPTIVE. UNDERLYING TOOLS MUST WORK WITH OUR LAYER OFF OR AT ANY LAYER FAILING. 🚨🚨🚨🚨

> Operator (.5184 paraphrased per HR12): the operator's underlying agents
> (Claude Code / Codex / raw SCX / raw ChatGPT / etc) must **always** work
> whether Kritical's layer is running, degraded, or absent. Being unable
> to run claude / codex / any operator-facing agent because of a Kritical
> layer is a HARD failure.
>
> **CONTRACT**:
>
> 1. **Additive by default.** Every Kritical layer (LiteLLM proxy,
>    AIRouter, SCXCodeAgent bridge, VS Code extension, PS module) is an
>    ADD-ON. Removing it returns the operator to a working baseline —
>    direct agent-to-API.
> 2. **Zero-config disable.** Every layer honours a single "off" switch:
>    - LiteLLM proxy: `-Mode Remove` OR not started
>    - AutoContinue module: not imported
>    - Node bridge daemon: `-Mode Remove` OR port unbind
>    - VS Code extension: uninstall the VSIX
> 3. **Zero surprise breakage.** No Kritical layer intercepts, rewrites,
>    or drops requests it does not fully understand. Passthrough default;
>    augmentation is opt-in per-endpoint.
> 4. **Provider-agnostic proxy.** LiteLLM accepts SCX + Anthropic +
>    OpenAI + generic OpenAI-compatible slots in the same config. One
>    env var flip to swap providers. Zero rewrite.
> 5. **Codex + our VS Code plugin is the primary path.** Forks
>    (`krit-scx.exe`, custom binaries) are nice-to-have. Load-bearing
>    surface = operator's existing Codex CLI + Claude Code CLI + our VS
>    Code extension — all pointing at LiteLLM which routes to whichever
>    provider is configured.
> 6. **Kill switch always visible.** Every install / heal / status script
>    prints the "how to fully disable this layer" line at end of
>    `-Mode Status` output.
> 7. **Applies to BOTH rulebooks + every sister repo.**
>
> **REFUSAL CONDITIONS**:
>
> - Do NOT ship a Kritical layer that mandates itself for the underlying
>   tool to work.
> - Do NOT wrap an existing tool in a way that hides its native config
>   surface.
> - Do NOT bind proxies to `0.0.0.0` — localhost only.
> - Do NOT overwrite operator env vars (`ANTHROPIC_BASE_URL` /
>   `OPENAI_BASE_URL`) — add new vars alongside.
>
> **VERIFIED "OFF" BEHAVIOUR**:
>
> | Kritical layer | "OFF" means | Underlying agent still works? |
> |---|---|---|
> | LiteLLM proxy | stopped / removed / port unbound | Claude Code, Codex, SCX PS module -> direct API ✓ |
> | AutoContinue module | not imported | Base `Invoke-KritScxChat` single-turn ✓ |
> | Decision logger (HR27) | `$env:KRITICAL_LOGGER_TARGET=none` | Every AI call still succeeds ✓ |
> | Node bridge daemon | port unbind / stopped | VS Code ext falls back to `directBaseUrl` ✓ |
> | VS Code extension | uninstalled | Claude Code + Codex + terminal unchanged ✓ |

---

## 🚨🚨🚨🚨 HARD RULE 28 (.5183) — OPERATOR METAPHORS ARE VISUAL, NOT NAMING. RENAME EVERY IDENTIFIER TO WHAT IT DOES. 🚨🚨🚨🚨

> Operator (.5183 paraphrased per HR12): the operator communicates visually.
> "Like a Ferrari" is not a naming instruction; it conveys **feel** (fast,
> effortless, refined). "smashIt" is not an identifier; it's a **verb** for
> concurrency. "Commodore 64" is not a class name; it's a **critique**. When
> visual metaphors get turned into function / module / parameter names the
> resulting code reads like inside baseball and future-me can't grep for it.
> Read metaphors for **behavioural intent**, then name the code for the
> **mechanism**.
>
> **CONTRACT**:
>
> 1. **No metaphor-derived identifiers.** No `-SmashIt` param. No
>    `Ferrari.psm1` file. No `Invoke-*Mega*` / `Invoke-*Rocket*` /
>    `Invoke-*Ninja*` functions. Every identifier answers "what does this
>    DO", not "how did the operator describe it".
> 2. **Descriptive naming rubric**:
>    - Functions: `Verb-Noun` — approved PowerShell verb + noun that
>      names the OUTPUT or TARGET
>    - Modules: `Kritical.$Product.$Concern.psm1` — Concern names the
>      responsibility (`AutoContinue`, `Router`, `Logger`, `Cache`)
>    - Parameters: describe the value's role (`-Parallel`,
>      `-MaxConcurrency`, `-TimeoutSec`) — never the operator's emotion
>      about wanting them fast/big/hard
> 3. **Metaphor rot**: existing artefacts named after operator metaphors
>    are renamed **on-sight** in the SAME commit as the discovery — files,
>    docs, cross-references, tests, CLAUDE.md, memory files. No
>    "grandfather in" the old names.
> 4. **What operator metaphors ARE for**: they encode intent + feel +
>    urgency + comparison to a mental model. Read them for the
>    behavioural requirement, then name the code for the mechanism.
>    - *"Like a Ferrari"* → make it feel effortless + fast + refined →
>      mechanism: auto-continuation with dedup + natural-terminator
>      heuristic → `Invoke-KritScxAutoContinue`
>    - *"SmashIt"* → high concurrency → `-Parallel` or `-MaxConcurrency`
>    - *"Commodore 64"* → primitive/underpowered feel → augment mechanism
>      with orchestration + tools + memory
>    - *"Kill the queue"* → drain to zero → `Clear-KritQueue` /
>      `Invoke-KritQueueDrain`
>    - *"Throw it at the wall"* → parallel scattergun test → `Test-*` with
>      `-Parallel` + `-FailFast:$false`
> 5. **Applies to BOTH rulebooks**: this rule lives verbatim in
>    [../KRTPax8ToShopifyConnector/CLAUDE.md](../KRTPax8ToShopifyConnector/CLAUDE.md)
>    AND this file. Every new sister repo seeded from Kritical MUST carry
>    HR28 verbatim.
>
> **REFUSAL CONDITIONS**:
>
> - Do NOT ship an identifier that quotes an operator metaphor verbatim.
> - Do NOT preserve historical metaphor-named artefacts once identified —
>   rename in the SAME commit.
> - Do NOT interpret every colourful word as a naming instruction; read
>   the mechanical requirement first, name the code for that.
>
> **KNOWN HISTORICAL BREACHES + FIXES** (canonical register — extend on any new discovery):
>
> | Historical name | Renamed to | Why the old name broke HR28 |
> |---|---|---|
> | `-SmashIt` supervisor parameter | `-Parallel` / `-MaxConcurrency` | "smash it" was a concurrency verb from the operator, not an identifier |
> | `Kritical.PS.SCXCode.Ferrari.psm1` (.5182) | `Kritical.PS.SCXCode.AutoContinue.psm1` (.5183) | "Ferrari" was a feel metaphor for fast/effortless; mechanism is auto-continuation across turns |
> | `Invoke-KritScxMegaResponse` (.5182) | `Invoke-KritScxAutoContinue` (.5183) | "Mega" was a size vibe; mechanism is looped multi-turn continuation with dedup |
> | `Show-KriticalFerrariBanner` (.5182) | `Show-KriticalSCXCodeBanner` (.5183) | Banner isn't Ferrari-specific — it's the SCXCode module banner |
> | `$script:FerrariTerminatorRegex` (.5182) | `$script:SCXNaturalTerminatorRegex` (.5183) | Terminator regex is not Ferrari-specific |

---

## 🚨🚨🚨🚨 HARD RULE 27 (.5182) — EVERY HUMAN PROMPT + EVERY AI RESPONSE IS AUTO-CAPTURED TO `documentation/human/` + `documentation/ai/` (JSONL APPEND-ONLY, SHA+SIMHASH DEDUPED, INGESTED TO KRITICAL BRAIN) 🚨🚨🚨🚨

> Operator (.5182 paraphrased per HR12): make sure every last detail — human
> prompts, decisions, context, direction — plus every AI response, is captured
> to a canonical dedup'd store. Default JSONL for simplicity; opt-in SQL Express
> ingest to `KriticalBrain.dbo.decision_log`. Simple enough for idiots, powerful
> enough to fold into `Kritical.NodeJS.SCXCodeAgent` as the primary session-memory
> store — enabling the synthetic-mega-context-window that motivated the rule.
>
> **CONTRACT**:
>
> 1. **Canonical folders at repo root**: `documentation/human/<yyyy-mm-dd>/<category>.jsonl` + `documentation/ai/<yyyy-mm-dd>/<category>.jsonl`.
>    Categories:
>    - human: `prompt`, `decision`, `context`, `direction`
>    - ai: `response`, `action`, `commit`
> 2. **JSONL row schema** (full spec at [documentation/human/README.md](documentation/human/README.md) §schema): `{id, ts_utc, side, category, wave, session_id, content_sha256, simhash, content_len, content_preview_120, content, model?, provider?, source}`.
> 3. **Dedup at write time**: SHA256 exact-dupe → skip write (increments occurrence_count in sidecar). SimHash 64-bit near-dupe (Hamming ≤ 3) → append with `dup_of: <id>` link, do NOT collapse.
> 4. **Default emit target = JSONL file** (simplest — idiot-safe). Opt-in SQL Express via `$env:KRITICAL_LOGGER_TARGET = 'db'` or `'both'`, or per-call `-EmitToDb` switch.
> 5. **SQL Express table**: `KriticalBrain.dbo.decision_log` — schema at [src-db/decision_log_schema.sql](src-db/decision_log_schema.sql). Sync on-demand via `Sync-KriticalDecisionLogToKriticalBrain`.
> 6. **HR23 supersedes**: NEVER purge either folder. Rotate rows ≥ 90 days old to `documentation/{human|ai}/_ARCHIVED-<utc>/` sibling.
> 7. **HR12 boundary**: profanity in raw operator prompts stays verbatim in JSONL (internal-only). Scrubbed at public-artifact emission boundary only.
> 8. **HR21 paired-test**: logger has [tests/Test-KriticalDecisionLogger.ps1](tests/Test-KriticalDecisionLogger.ps1).
> 9. **Repo-agnostic anchor**: `Resolve-KriticalLoggerRoot` walks up looking for `.git/` / `package.json` / `CLAUDE.md` / `README.md`. Override via `$env:KRITICAL_DECISION_LOG_ROOT`. Works uniformly from any Kritical.* sister.
>
> **REFUSAL CONDITIONS**:
> - Do NOT design a script that writes decisions/prompts anywhere other than `documentation/{human|ai}/`.
> - Do NOT bypass dedup — every write goes through the module primitives.
> - Do NOT rename the folder names or change the JSONL schema without updating this rule + module + paired test + SQL schema in the SAME commit.
>
> **MODULE**: [ps-module/KriticalDecisionLogger.psm1](ps-module/KriticalDecisionLogger.psm1) — 9 exported primitives: `Add-KriticalHumanPrompt` / `Add-KriticalAIResponse` / `Get-KriticalDecisionLog` / `Find-KriticalDecisionByHash` / `Sync-KriticalDecisionLogToKriticalBrain` / `Import-KriticalConversationBackfill` / `Get-KriticalContentSha256` / `Get-KriticalContentSimHash` / `Get-KriticalSimHashHammingDistance`.
>
> **BACKFILL**: `Import-KriticalConversationBackfill -TranscriptPath <jsonl>` retroactively ingests any prior session. First backfill = wave `.5182` seed of the SCX-coder review + Lens-context-expansion planning session.
>
> **FEEDS SCXCODE MEGA-CONTEXT**: `Kritical.NodeJS.SCXCodeAgent` (queued next-wave sister) reads `documentation/{human|ai}/` at session boot to reconstruct prior conversation context — the primary mechanism for the synthetic mega-context-window that motivated this rule. This is what makes SCXCode's effective context longer than Claude Code's raw window.

---

## Path snapshot (.5165 → .5182)

`Kritical.SCXCode` ships across five deployment paths (per [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

| Path | Surface | Location | Status |
|---|---|---|---|
| **A** | Continue.dev config drop-in | [config-templates/continue-config.json](config-templates/continue-config.json) | shipped `.5165` |
| **B** | (reserved) — direct Anthropic SDK swap | — | planned |
| **C** | `kritical.SCXCode` VS Code extension | [src/](src/) — TypeScript + VSIX 0.1.2 | shipped `.5165` |
| **D** | `Kritical.PS.SCXCode` PowerShell 7 module | [ps-module/](ps-module/) — 11 exported functions + 4 aliases | shipped `.5165` |
| **E** | `kritical-scxcode` MCP server | [mcp-server/server.mjs](mcp-server/server.mjs) — stdio JSON-RPC 2.0 | shipped `.5165` |

12+ SCX models — MiniMax-M2.7 (default) · MAGPiE · gpt-oss-120b · DeepSeek-V3.1 · coder · gemma-4 · Qwen3 · Llama-4-Maverick · Meta-Llama-3.3-70B · E5-Mistral embeddings · Whisper · opir moderation. Fallback chain hard-wired: MiniMax-M2.7 → MAGPiE → gpt-oss-120b. Multi-key rotation via `SCX_API_KEY_2..9` in HKCU.

## Known Working Restore Point - 2026-07-09

`Kritical.SCXCodex.exe` was captured as a known-working installed runtime while PID `8548` was running from:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
```

Restore docs and hash evidence:

```text
docs\restore-points\2026-07-09-scxcodex-working\RESTORE-POINT.md
```

Binary backup is local-only and deliberately not committed to Git:

```text
C:\KriticalSCX\restore-points\2026-07-09-scxcodex-working\Kritical.SCXCodex.exe
```

Any rollback must verify SHA256 first:

```text
C934C0E5E391EC348BC08E75039A3E3303D5605D46C7D51BDF83B88868CB4A1E
```

## Kritical brand invariants (per HR13 + brand spec)

- Primary colour: **`#13365C`** (Kritical navy)
- Secondary colour: **`#15AFD1`** (Kritical cyan) — supersedes any legacy `#F2B500` gold references in code
- Typography: Roboto Regular 42pt headings / Assistant Medium 21pt sub-headings
- Author: `Joshua Finley`
- Company: `Kritical Pty Ltd`
- Copyright stamp: `(c) 2026 Kritical Pty Ltd. All rights reserved.`
- Banner: `KriticalLogo.txt` from `OneDrive\Kritical-Branding\public\` embedded at module load per HR canonical banner rule.

## Sales positioning (operator .5182)

> **"The IT and IT Security Experts — if it's too hard for everyone else, just give us a call."**
>
> Kritical Pty Ltd's niche: the people the AI providers call when the AI providers themselves need something.

This lands on the README as the closing sales blurb. Every published Kritical.SCXCode release note carries the tagline.

## Sister-repo cross-links (Kritical Lens™ umbrella per HR13)

- **`Kritical.PS.OmniFramework`** — foundation loader (`Import-KritFoundation` etc). Depend on ≥ v1.1.14 for OneDrive share-link helpers.
- **`Kritical.PS.Toolkit`** — shared PS utility library + canonical `Krit.Banner.psm1` reader.
- **`Kritical.PS.UTCM`** — Microsoft Graph UTCM REST API client. Sister for M365DSC-adjacent flows.
- **`Kritical.Lens.CodeGraph`** — semantic AL parse cross-check. Regression-lock for AL surfaces.
- **`Kritical.Lens.SqlMiner`** — git corpus miner → SQL warehouse. Bridge for HR27 SQL ingest hook.
- **`Kritical.AISupervisor.NodeJS`** / **`.PS`** — orchestrator lanes (per `[[kritical-aisupervisor-sister-separation]]` HARD RULE).
- **`KRTPax8ToShopifyConnector`** — upstream Pax8↔BC↔Shopify connector; source of HR1–HR26 conventions we inherit here.

## Standing rules inherited from upstream connector rulebook

We inherit these load-bearing rules from `KRTPax8ToShopifyConnector/CLAUDE.md` (do not violate here either):

- **HR1** — NEVER use ANY API key for AI inference; native plan client / HKCU-registered SCX key only.
- **HR9b** — **WE ARE KRITICAL**. Customer/product-facing names are Kritical-*; supplier references (Pax8, Anthropic, OpenAI) stay in source only.
- **HR10** — CODE OVER DOCS. Bulk-programmatic edits first; new reference docs only when the doc IS the deliverable.
- **HR12** — no profanity in public artifacts; internal rulebooks + JSONL logs keep operator verbatim.
- **HR13** — Kritical Lens™ umbrella brand. Customer-facing = "Kritical Lens™"; internal names stay Kritical.*.
- **HR14** — npm/pnpm install MUST route via `%TEMP%` or `D:\`, NEVER OneDrive-synced node_modules.
- **HR15** — OneDrive share-link over 10 MB email attachments for customer deliverables (`New-KritOneDriveShareLink`).
- **HR16** — every install/provision script exposes idempotent `Install` / `Remove` / `Heal` / `Status` modes.
- **HR17** — never declare a service started without active API probe (health-check the endpoint).
- **HR18** — never `Remove-Item -Recurse -Force` on a path without interrogating NTFS reparse points first.
- **HR20** — MCP Learn / Krit.OpenApi / existing scripts consulted BEFORE assuming.
- **HR21** — validate + prove + auto-test every step; no code without matching test.
- **HR22** — OneDrive lock triage → route via `%TEMP%` / `D:\` mirror.
- **HR23** — NEVER purge history (backup tags / stashes / receipts / archaeology stay). Rotate, don't delete.
- **HR26** — linter output is load-bearing evidence; every Lens tool emits a linter report.
- **HR27** — every human prompt + AI response captured to `documentation/human/` + `documentation/ai/` (this file's headline rule).

## Where SCXCode fits in the Lens umbrella

```
Kritical Lens™ (customer-facing umbrella)
├── Kritical.Lens.CodeGraph          # semantic AL cross-check
├── Kritical.Lens.SqlMiner           # git corpus → SQL
├── Kritical.Lens.SchemaCompleteness # mirror-table coverage
├── Kritical.Lens.ALDependencyMatrix # AL dep surface
├── Kritical.Lens.CompareAndBounce   # wave delta
├── Kritical.PS.OmniFramework        # foundation loader
├── Kritical.PS.UTCM                 # M365 Graph client
├── Kritical.PS.SCXCode  ◀────── (Path D — you are here for the PS surface)
├── Kritical.NodeJS.SCXCodeAgent     # queued next — the mega-context orchestrator
└── kritical.SCXCode  ◀────── (Path C — the VS Code extension)
```

SCXCode's job: be the SCX-inside-VS-Code + PowerShell + MCP entry point where operators actually type prompts and read responses. Every prompt and every response funnels through HR27 to the decision store, which the queued `Kritical.NodeJS.SCXCodeAgent` reads to reconstruct arbitrarily-long prior context.
