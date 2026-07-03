# scx-vscode — SCX in VS Code the Kritical way

Kritical-branded VS Code integration for [SCX](https://api.scx.ai) — 12+ open-source
models (MiniMax-M2.7 / MAGPiE / gpt-oss-120b / DeepSeek-V3.1 / Llama-3.3 / Llama-4-Maverick /
Qwen3 / gemma-4 / coder / plus embeddings + Whisper + moderation) through one
Anthropic-shape gateway priced in AUD.

**Philosophy** (per operator .5165): **reuse the OSS universe, don't reinvent**.
Anthropic Claude Code + Continue + Cline + Roo Code + Aider + LiteLLM already
solved 95% of what a VS Code AI extension needs. This repo does the last 5%:
Kritical env-var convention, SCX endpoint wiring, fallback chain to native
plans, install/uninstall scripts, docs.

## Three ways to use SCX in VS Code (pick the one that fits)

### Path A — Continue.dev config (fastest — works TODAY, ~2 minutes)

Continue is Apache-2.0, mature (100k+ VSIX installs), supports custom
OpenAI-compatible AND Anthropic-compatible providers. SCX passes as
Anthropic-shape. Drop-in config:

```powershell
# 1. Install Continue extension in VS Code
code --install-extension continue.continue

# 2. Run the Kritical installer (sets HKCU SCX_API_KEY + drops Continue config)
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Install -Path Continue
```

Result: Continue's chat + inline complete + model picker all work against SCX.
Model list surfaces MiniMax-M2.7 / MAGPiE / gpt-oss-120b / DeepSeek-V3.1 /
coder / embeddings. Model selector lives in Continue's bottom bar.

### Path B — Cline / Roo Code (VS Code-native chat panel)

Cline (Apache 2.0) and its more-configurable fork Roo Code both expose the
chat as a first-class VS Code side panel with tool use, file editing, and
terminal. Both support "OpenAI Compatible" providers.

```powershell
code --install-extension saoudrizwan.claude-dev            # Cline
# or
code --install-extension RooVeterinaryInc.roo-cline        # Roo Code

pwsh ./install/Install-KritScxVsCode.ps1 -Mode Install -Path Cline
```

### Path C — Standalone Kritical extension `kritical.vscode.SCXCode`

Real VS Code extension in `src/`:

- **`src/package.json`** — full extension manifest (`kritical.SCXCode`),
  7 commands, webview chat, activity-bar view container, 8 config properties
  with enum descriptions
- **`src/extension.ts`** — SCX HTTPS client with auto-failover across
  `fallbackChain` on 429/5xx, webview chat UI (Kritical branding
  `#13365C` + `#F2B500`), status bar, output channel, model picker
- Build: `cd src && npm i && npm run build`
- Install locally: `code --install-extension .` from `src/out/`
- Publishing to OpenVSX + Microsoft marketplace: deferred until initial
  operator smoke.

### Path D — PowerShell module `Kritical.PS.SCXCode`

Real PowerShell 7 module in `ps-module/`:

- **`ps-module/Kritical.PS.SCXCode.psd1`** — module manifest v0.1.0,
  Apache 2.0, tags for PSGallery
- **`ps-module/Kritical.PS.SCXCode.psm1`** — 10 functions +
  4 aliases (`scx`, `scx-chat`, `scx-models`, `scx-test`)
- Live-verified: `Get-KritScxConfig` returns HKCU state; `Test-KritScxConnection`
  probes `/v1/messages` in ~640ms

```powershell
# Local
Import-Module ./ps-module/Kritical.PS.SCXCode.psd1
Get-KritScxConfig
Test-KritScxConnection
Get-KritScxModels
scx 'what is 47*3?'
```

### Path E — MCP server `kritical-scxcode`

`mcp-server/server.mjs` — JSON-RPC 2.0 over stdio. 5 tools:
`scx_chat` / `scx_list_models` / `scx_test` / `scx_embed` / `scx_status`.

Register in Claude Desktop / Cline / Continue / any MCP-capable agent:

```json
{
  "mcpServers": {
    "kritical-scxcode": {
      "command": "node",
      "args": ["<path>/scx-vscode/mcp-server/server.mjs"],
      "env": { "SCX_API_KEY": "${SCX_API_KEY}" }
    }
  }
}
```

Live-verified: initialize + tools/list handshake return correct JSON-RPC responses.

### Path C roadmap (still-to-build)

- Kritical branding (logo, colours `#13365C` primary + `#F2B500` accent — already wired in webview)
- Autocompact toggle env-parity with the wave supervisor (`SKIP_RADAR` / `SKIP_TOOLKIT_PREAMBLE`)
- Hide models SCX doesn't accept (tier-based filter driven by `/v1/models`)
- Extend fallback chain: SCX → Claude Code (native Max plan) → Codex → OpenRouter
- Load-balancing across multiple SCX keys (ben-key + huzaifa-key)

## Kritical env-var convention (single source of truth)

Per `KRTPax8ToShopifyConnector` §SECRETS DIRECTORY. All paths above read
from HKCU (never from a file committed to git):

| HKCU env var | Sourced from | Used by |
|---|---|---|
| `SCX_API_KEY` | `Github-SecretsOutsideOfGitRepos/scx-benApiKey-MMDDYYYY-vNNN.txt` | Continue / Cline / Roo Code / Path C |
| `ANTHROPIC_BASE_URL` | Literal `https://api.scx.ai` | Optional — for Anthropic-shape mode |
| `KRIT_SCX_MODEL_DEFAULT` | Operator preference (e.g. `MiniMax-M2.7`) | Path C model picker default |
| `KRIT_SCX_FALLBACK_CHAIN` | Comma list (e.g. `MiniMax-M2.7,MAGPiE,gpt-oss-120b`) | Path C failover |

The installer script sets all four idempotently. Uninstaller removes only what
it added (never removes keys authored by the operator directly).

## Docs

| File | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How Path A/B/C wire together + Kritical env-var flow |
| [`docs/PROVIDERS.md`](docs/PROVIDERS.md) | 12 SCX models with pricing (AUD) + supported features + context length |
| [`docs/FALLBACKS.md`](docs/FALLBACKS.md) | SCX → Claude Code → Codex → OpenRouter chain design |

## Install scripts (HR16-compliant: Install / Remove / Heal / Status)

```powershell
# Install (idempotent — skips already-set env, updates config if changed)
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Install -Path Continue

# Status (read-only inventory: env set? config file present? Continue installed?)
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Status

# Heal (re-run whatever's missing / broken)
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Heal

# Remove (undo everything Install added; never touches operator-authored config)
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Remove
```

## Attribution

- **Continue** — https://github.com/continuedev/continue (Apache 2.0)
- **Cline** — https://github.com/cline/cline (Apache 2.0)
- **Roo Code** — https://github.com/RooCodeInc/Roo-Code (Apache 2.0)
- **SCX** — https://api.scx.ai (Anthropic-shape gateway, AUD pricing, 12+ models)
- **Anthropic Claude Code CLI** — https://claude.com/claude-code (proprietary, native Max-plan path)

Per Kritical HARD RULE 20 — no LLM inference via API key from this codebase.
SCX is EXPLICITLY exempt: SCX billing IS native to the operator's SCX plan (per
[[scx-ben-key-preferred]] memory pin). No Anthropic API key. No OpenAI API key.
Only SCX key HKCU + native Claude Code / Codex CLI plans.

## License

Apache 2.0 — matches all upstream reused projects.

Kritical branding + Kritical env-var convention + Kritical install scripts:
© Kritical Pty Ltd 2026, Apache 2.0.
