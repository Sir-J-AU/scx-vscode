# Kritical.SCXCode &nbsp;·&nbsp; SCX inside VS Code

> **The Kritical VS Code extension for [SCX](https://api.scx.ai)** — twelve open-source
> LLMs (MiniMax-M2.7 · MAGPiE · gpt-oss-120b · DeepSeek-V3.1 · coder · gemma-4 ·
> Qwen3 · Llama-4-Maverick · Meta-Llama-3.3-70B) plus embeddings (E5-Mistral),
> speech (Whisper), and moderation (opir) — all through one Anthropic-shape
> gateway priced in AUD.

Made in Australia by **[Kritical Pty Ltd](https://kritical.net)** — a
Seriously Kritical&trade; Production.

<div align="center">

[![Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-13365C)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-stable%20%2B%20insiders-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![SCX](https://img.shields.io/badge/SCX-api.scx.ai-15AFD1)](https://api.scx.ai)
[![PowerShell 7](https://img.shields.io/badge/PowerShell-7%2B-5391FE?logo=powershell&logoColor=white)](https://learn.microsoft.com/powershell/)

</div>

---

## One-line install

```powershell
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Install
```

The installer reads your SCX key from the Kritical secrets folder,
persists it to `HKCU`, installs the extension into VS Code (**stable**
and **Insiders**), drops the default configuration, and verifies auth.
Idempotent — runs cleanly again and again. Supports
`-Mode Install | Remove | Heal | Status`.

---

## What you get

- **Kritical-branded sidebar** — dedicated activity-bar view with the
  SCXCode icon on the left rail. Dark-navy `#13365C` header with cyan
  `#15AFD1` accents. Model picker and status-bar item.
- **Markdown-rendered responses** — headings, lists, fenced code with
  language tags. Every message header carries a **copy button** — one
  click puts either the assistant response or the full turn onto the
  clipboard.
- **Automatic context** — every chat and slash-command auto-prepends the
  active editor's file path, language, current selection, and a
  &plusmn;30-line cursor window so the model always knows what you're
  looking at. Configurable
  (`kritical.scxcode.autoContext = off | file | file+selection | workspace-tree`).
- **Automatic failover and key rotation** — on SCX `429` or `5xx`, the
  extension walks a fallback chain of models (defaults
  `MiniMax-M2.7 → MAGPiE → gpt-oss-120b`). On persistent `429`,
  `Switch-KritScxKey` swaps to the next `HKCU`-registered backup key
  (`SCX_API_KEY_2..9`) automatically — no reload required.
- **Seven Command-Palette commands** (`Kritical:` prefix):

  | Command | What it does |
  |---|---|
  | `Kritical: Open SCX Chat` | Dedicated webview chat |
  | `Kritical: Pick SCX Model` | Quick-pick from the nine chat models with AUD/1M pricing shown inline |
  | `Kritical: Test SCX Connection` | 20-token round-trip probe with latency |
  | `Kritical: Show SCX Status` | Config + endpoint + fallback chain summary |
  | `Kritical: Explain Selected Code` | Right-click any selection |
  | `Kritical: Refactor Selection` | Right-click, applies the Kritical style guide |
  | `Kritical: Audit Current Diff` | Pre-commit safety pass |

- **Eight typed configuration properties** with enum-driven quick pickers
  for model, autocomplete model, autocompact behaviour, telemetry level,
  auto-context scope, and the fallback chain.
- **No API key ever ends up in source.** The extension reads `SCX_API_KEY`
  from `HKCU` at request time so key rotation is instant — no reload —
  and the auto-key-switch on `429` makes rotation happen without you
  noticing.

---

## Install options

### 1 &nbsp;·&nbsp; One-line installer (recommended)

```powershell
pwsh ./install/Install-KritScxVsCode.ps1 -Mode Install
```

Detects VS Code stable or Insiders, installs the latest built VSIX
(`src/SCXCode-0.1.2.vsix`), seeds the `HKCU` environment variables from
the Kritical secrets folder, and verifies auth. Idempotent — supports
`-Mode Install | Remove | Heal | Status`.

### 2 &nbsp;·&nbsp; Build and install from source

```powershell
git clone https://github.com/Sir-J-AU/Kritical.SCXCode.git
cd Kritical.SCXCode/src
npm install
npm run build
npx --yes @vscode/vsce package --allow-missing-repository
code-insiders --install-extension SCXCode-0.1.2.vsix    # or 'code' for stable
```

Then seed the `HKCU` environment variables from the Kritical secrets
folder:

```powershell
pwsh ../install/Install-KritScxVsCode.ps1 -Mode Install
```

### 3 &nbsp;·&nbsp; Visual Studio Marketplace / OpenVSX

Marketplace listing planned. See [`CHANGELOG.md`](CHANGELOG.md) for progress.

---

## Companion pieces (same repo, same environment)

The extension is the main event. These optional friends share the
`SCX_API_KEY` environment variable — whichever surface you prefer, it
just works.

| Component | Path | For when you want |
|---|---|---|
| Continue.dev config template | [`config-templates/continue-config.json`](config-templates/continue-config.json) | Continue.dev chat and inline-complete pointing at SCX |
| `Kritical.PS.SCXCode` PowerShell 7 module | [`ps-module/`](ps-module/) | Terminal-first: `scx 'what is 47 * 3?'` from any pwsh session |
| `kritical-scxcode` MCP server | [`mcp-server/`](mcp-server/) | Register in Claude Desktop, Cline, or any MCP-capable agent for agentic SCX access |

Each carries its own README explaining what it is and how to use it.

---

## Environment convention

Everything reads from `HKCU`. Secret files never live in git. The
canonical filename pattern is `scx-<purpose>-MMDDYYYY-vNNN.txt` under
`Github-SecretsOutsideOfGitRepos/` (outside every git repo). Sort
descending — newest wins.

| HKCU variable | Purpose |
|---|---|
| `SCX_API_KEY` | Active SCX API key (`sk-scx-...`) |
| `SCX_API_KEY_2..9` | Backup keys for `Switch-KritScxKey` rotation |
| `ANTHROPIC_BASE_URL` | `https://api.scx.ai` |
| `KRIT_SCX_MODEL_DEFAULT` | e.g. `MiniMax-M2.7` |
| `KRIT_SCX_FALLBACK_CHAIN` | `MiniMax-M2.7,MAGPiE,gpt-oss-120b` |

---

## Documentation

- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — full twelve-model SCX catalogue
  with AUD pricing, context length, features (verified live via
  `GET /v1/models`).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the Kritical environment
  flow and test recipes.
- [`docs/OSS-UNIVERSE-CATALOG.md`](docs/OSS-UNIVERSE-CATALOG.md) — every
  open-source package evaluated, reused, or passed on, and why.
- [`CHANGELOG.md`](CHANGELOG.md) — Keep-a-Changelog / SemVer.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute.

---

## Design at a glance

The `#13365C` navy + `#15AFD1` cyan chat panel sits next to any Claude,
Copilot, or Continue button in your activity bar. Every message header
reads `Kritical.SCXCode · MiniMax-M2.7`. Every developer session
quietly tells anyone glancing over your shoulder that Kritical and SCX
did the work.

---

## License and credits

Apache 2.0. Copyright &copy; 2026 **Kritical Pty Ltd**. Author:
**Joshua Finley**.

Built on top of the Anthropic SDK's message envelope and the
Continue.dev configuration schema — thank you to both projects.

---

<div align="center">

<sub>Kritical Pty Ltd &nbsp;·&nbsp; ABN 39 687 048 086 &nbsp;·&nbsp; Geelong VIC, Australia
<br/>+61 1300 274 655 &nbsp;·&nbsp; [sales@kritical.net](mailto:sales@kritical.net) &nbsp;·&nbsp; [kritical.net](https://kritical.net)</sub>

</div>
