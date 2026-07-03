# scx-vscode — architecture

## The three paths, side by side

```
┌───────────────────────────────────────────────────────────────────────┐
│                          VS Code                                       │
│                                                                       │
│  ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────┐   │
│  │  Path A           │  │  Path B           │  │  Path C          │   │
│  │  Continue.dev     │  │  Cline / RooCode  │  │  Kritical SCX    │   │
│  │  (works TODAY)    │  │  (works TODAY)    │  │  (scaffold only) │   │
│  └────────┬──────────┘  └────────┬──────────┘  └────────┬─────────┘   │
│           │                       │                       │            │
│           └───────────────┬───────┴───────────────┬──────┘            │
│                           │                       │                    │
│                           ▼                       ▼                    │
│                   config.json          Extension settings              │
│                     with SCX apiBase   with anthropic-compat provider  │
│                     and env-substituted apiKey                         │
└───────────────────────────┬───────────────────────┬───────────────────┘
                            │                       │
                            └────────┬──────────────┘
                                     │  ANTHROPIC-SHAPE POST
                                     │  x-api-key: {{env.SCX_API_KEY}}
                                     │  anthropic-version: 2023-06-01
                                     │
                                     ▼
                        ┌──────────────────────────┐
                        │  https://api.scx.ai      │
                        │  /v1/messages            │
                        │  /v1/chat/completions    │
                        │  /v1/embeddings          │
                        │  /v1/models              │
                        └──────────────────────────┘

     Key source (Kritical env-var convention, never in git):

     C:\Users\joshl\OneDrive - Kritical Pty Ltd\
       Github-SecretsOutsideOfGitRepos\
         scx-benApiKey-MMDDYYYY-vNNN.txt      <-- MMDDYYYY sorted DESC picks newest
                          │
                          ▼
        Install-KritScxVsCode.ps1 -Mode Install
                          │
                          ▼
    HKCU env vars (persist across sessions, per-user, no admin needed):
      SCX_API_KEY               = <39 char sk-scx-...>
      ANTHROPIC_BASE_URL        = https://api.scx.ai
      KRIT_SCX_MODEL_DEFAULT    = MiniMax-M2.7
      KRIT_SCX_FALLBACK_CHAIN   = MiniMax-M2.7,MAGPiE,gpt-oss-120b (Path C only)
```

## Path A (Continue.dev) — deep-dive

**Why chosen as default**: Continue is Apache 2.0, has 100k+ VSIX installs,
supports Anthropic-compatible endpoints via `provider: anthropic` +
`apiBase: https://api.scx.ai`, has the mature chat panel + inline complete +
model picker Kritical wants without new engineering.

**How env-var substitution works**: Continue's config parser interprets
`{{env.SCX_API_KEY}}` in `apiKey` fields and resolves at request time from
the HKCU env of the VS Code process. So Continue reads the key EVERY
request — key rotation is instant (no VS Code restart) as long as the new
value is in HKCU.

**Autocompact**: Continue calls this "compaction". Default ON. When the
conversation nears model context length, Continue summarizes older turns and
replaces them with the summary. Per-conversation override via `/compact off`
or `/compact aggressive` in chat.

**Fallback**: Continue does NOT ship auto-failover across models. Behavior on
SCX 429: request fails, chat panel shows error. Workaround: click a different
model in the picker (bottom of chat panel). Path C is where auto-failover lives.

**Chat window features Continue provides for free**:
- Multi-turn history w/ compaction
- Model picker (bottom bar dropdown)
- File `@`-references for context
- Inline complete (Cmd/Ctrl+I) using `tabAutocompleteModel`
- Custom slash commands (Kritical config seeds `/explain`, `/krit-refactor`,
  `/audit-my-change`)
- Codebase indexing via embeddings model
- Terminal / diff review integrations

## Path B (Cline / Roo Code) — deep-dive

**Why offered**: Cline exposes chat as a first-class VS Code side panel with
file editing, tool use, and terminal execution — closer to the Claude Code
experience than Continue's chat panel. Roo Code is a fork with more provider
settings + better SCX fit.

**Provider settings**: Both use "OpenAI Compatible" provider mode. Point at
`https://api.scx.ai/v1` + set model name from SCX catalog.

**Autocompact**: Cline has its own context management — "auto-condense" —
similar to Continue's compaction. Toggleable in extension settings.

**Model selection**: Both extensions have a model dropdown in the side panel.
Kritical config seeds the same 8 SCX models.

**Path B installer status** (2026-07-03): docs-only. The Install-KritScxVsCode.ps1
script currently only implements the Continue path fully. Cline + RooCode paths
land in Path C when the settings-file location on Windows is confirmed.

## Path C (Kritical SCX standalone extension) — future scaffold

**Why exists**: Path A/B are 95% of what Kritical wants but don't do:
- Kritical branding (logo #13365C + accent #F2B500)
- Auto-failover chain (SCX → SCX-other-model → Claude Code → Codex → OpenRouter)
- Multiple SCX keys for load-balance (ben + huzaifa)
- Env-controlled autocompact toggles matching wave supervisor
  (`NODE_SUP_SKIP_RADAR` / `NODE_SUP_SKIP_TOOLKIT_PREAMBLE` parity)
- Hide models that don't accept the current key tier
- Local telemetry log for cost-per-day per model per user

**Reuse plan** (per operator .5165: "reuse as much as is out there"):
- Fork Continue's `core/llm/providers` layer (Apache 2.0 — attribution retained)
- Fork Continue's chat panel React tree
- Add Kritical brand wrapper (StatusBarItem, chat panel header logo)
- Add fallback middleware in the provider dispatch
- Package as `kritical.krit-scx-vscode` on OpenVSX (avoids Microsoft marketplace
  attribution paperwork initially)

**Not yet built**. `src/` is empty. Continue-based Path A is the actionable
recommendation until Path C ships.

## Kritical env-var convention (single source of truth)

Per `KRTPax8ToShopifyConnector/CLAUDE.md` §SECRETS DIRECTORY. Rules:

1. **Never commit secrets**. Files live at
   `Github-SecretsOutsideOfGitRepos/` (outside every git repo).
2. **Filename convention** `<service>-<purpose>-MMDDYYYY-vNNN.txt`. Sort descending
   by name → newest wins.
3. **HKCU env** is the runtime source. Files are the reload source (installer copies
   file → HKCU).
4. **HKLM env** is NEVER used. Per-user only.
5. **Rotation**: drop a new `scx-benApiKey-<newdate>-vNNN.txt`, re-run
   `Install-KritScxVsCode.ps1 -Mode Heal`. HKCU picks up the newer file. Path A
   Continue reads HKCU per-request so rotation propagates instantly.

## Test recipes

### Verify SCX key + endpoint alive

```bash
curl -sf https://api.scx.ai/v1/models -H "x-api-key: $SCX_API_KEY" \
  | python -c "import sys,json; print(len(json.load(sys.stdin)['data']),'models')"
# expected: 12 models (or current SCX catalog size)
```

### Verify Continue config picks up HKCU

```bash
# 1. Set env
setx SCX_API_KEY sk-scx-test-value

# 2. Reload VS Code (Ctrl+Shift+P → Developer: Reload Window)
# 3. Open Continue chat → confirm any SCX model auth error message references sk-scx-test-value
```

### Verify audit-my-change custom command

Highlight a code diff in VS Code → Continue chat → `/audit-my-change`. Should
respond with a per-hard-rule OK/REFUSED list from CLAUDE.md.

## Cross-refs

- Kritical `.5162` SCX + failover queue: see wave-block `WAVE-5162a-d` in
  `KRTPax8ToShopifyConnector/scripts/state/supervisor-queue.json`
- Ben SCX key origin: memory pin `scx-ben-key-preferred`
- SCX-vs-Claude Code cost comparison: `KRTPax8ToShopifyConnector/reference/SISTER-APPS-AND-INCIDENTS-DOSSIER-5165.md` §E
