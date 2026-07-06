# Kritical SCXCode / SCXCodex Full Architecture Handover

Date: 2026-07-06 Australia/Sydney
Repo: `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode`
Branch: `fix/bughunt-5231`
Installed VS Code Insiders extension: `kritical.scxcode@0.1.27`
Compiled Codex artifact: `C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe`

## Hard Safety Rules

- Use SCX credentials only: `SCX_API_KEY` and optional `SCX_API_KEY_2` through `SCX_API_KEY_9`.
- Do not read, print, edit, migrate, remove, validate, or “helpfully repair” native OpenAI, ChatGPT, Codex, Anthropic, or Claude keys/settings.
- Do not touch `.claude/settings.local.json` unless a future task explicitly scopes that file.
- Stock `codex` remains untouched. Kritical routing is done by wrappers, per-invocation config overrides, and compiled SCXCodex artifacts.

## Bird's-Eye System

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Kritical SCXCode Stack                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  VS Code Insiders                                                            │
│  ┌──────────────────────────────┐                                            │
│  │ kritical.scxcode@0.1.27      │                                            │
│  │ src/out/extension.js         │                                            │
│  └───────┬────────────┬─────────┘                                            │
│          │            │                                                      │
│          │            │ ✦ SCX Codex button / command                         │
│          │            v                                                      │
│          │   ┌──────────────────────────────┐                                │
│          │   │ codex-wrapper/kritical-       │                                │
│          │   │ codex.ps1                     │                                │
│          │   └──────────────┬───────────────┘                                │
│          │                  │ prefers compiled branded exe                   │
│          │                  v                                                │
│          │   ┌──────────────────────────────┐                                │
│          │   │ C:\KriticalSCX\dist\...      │                                │
│          │   │ Kritical.SCXCodex.exe        │                                │
│          │   └──────────────┬───────────────┘                                │
│          │                  │ per-run -c model_provider=scx overrides         │
│          │                  v                                                │
│          │   ┌──────────────────────────────┐                                │
│          │   │ scx-agentic-shim.mjs         │                                │
│          │   │ http://127.0.0.1:4199/v1     │                                │
│          │   └──────────────┬───────────────┘                                │
│          │                  │ SCX_API_KEY only                               │
│          │                  v                                                │
│          │            https://api.scx.ai/v1/responses                         │
│          │                                                                 │
│          │ Chat / Looking Glass / setup GUI                                  │
│          v                                                                 │
│  ┌──────────────────────────────┐       ┌─────────────────────────────────┐  │
│  │ ~/.kritical-scx              │       │ KriticalSCXCodeStore            │  │
│  │ models-cache.json            │       │ .\SQLEXPRESS                    │  │
│  │ current-model.json           │       │ dbo.LensSource / LensSymbol     │  │
│  │ scxcode-store.db             │       │ dbo.LensCorpusFile              │  │
│  └──────────────────────────────┘       └─────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Component Map

```text
Kritical.SCXCode repo
├─ src/
│  ├─ extension.ts
│  │  ├─ SCX chat webview
│  │  ├─ live SCX model catalog fetch/cache
│  │  ├─ model picker + current-model.json publisher
│  │  ├─ Setup GUI: Codex, MCP, SCXCode, storage backend
│  │  ├─ Looking Glass: SQLite/MSSQL store reader
│  │  └─ SCX Codex launcher command
│  ├─ package.json
│  │  ├─ contributes commands/views/config
│  │  └─ SCXCode config schema
│  └─ SCXCode-0.1.27.vsix
│
├─ codex-wrapper/
│  ├─ kritical-codex.ps1
│  │  ├─ reads SCX_API_KEY only
│  │  ├─ follows ~/.kritical-scx/current-model.json when agentic-capable
│  │  ├─ defaults fallback to MiniMax-M2.7
│  │  ├─ starts scx-agentic-shim.mjs on :4199
│  │  ├─ prefers compiled Kritical.SCXCodex.exe
│  │  └─ passes per-invocation Codex -c overrides
│  ├─ kritical-codex.mjs
│  ├─ scx-agentic-shim.mjs
│  ├─ scx-corpus-augment.mjs
│  └─ pack/
│     ├─ Build-KriticalSCXCodex.ps1
│     ├─ Apply-KriticalCodexPack.ps1
│     ├─ Update-Codex.ps1
│     └─ pack-manifest.json
│
├─ install/
│  ├─ Install-KriticalSCX.ps1
│  ├─ Install-KriticalSCXCodex.ps1
│  ├─ Install-KriticalSCXStore.ps1
│  └─ Invoke-KritScxEndToEndBugHunt.ps1
│
├─ lens/
│  ├─ Invoke-KritScxSourceIngest.py
│  └─ Invoke-KritScxCorpusMine.py
│
├─ store-mcp/
│  └─ kritical-local-store.mjs
│
└─ tests/
   ├─ Test-KritScxCodeSetupStorage.js
   ├─ Test-KritScxCodeUI.js
   ├─ Test-KritScxCodeSetupConfig.js
   ├─ Invoke-KritScxSelfTest.ps1
   └─ Test-KritScxVsixPackage.ps1
```

## Launch Flows

### VS Code SCXCode Chat

```text
VS Code Insiders
  │
  ├─ Activity bar / Kritical SCXCode Chat
  │    ├─ model dropdown populated from:
  │    │    1. preseeded in-code SCX catalog
  │    │    2. ~/.kritical-scx/models-cache.json
  │    │    3. live GET https://api.scx.ai/v1/models
  │    ├─ selected model saved to VS Code config: kritical.scxcode.defaultModel
  │    └─ selected model published to ~/.kritical-scx/current-model.json
  │
  └─ SCX API calls use:
       baseUrl = kritical.scxcode.baseUrl
       apiKey  = kritical.scxcode.apiKey or SCX_API_KEY
```

### VS Code `✦ SCX Codex`

```text
SCX Codex button / command
  │
  v
resolveCodexWrapper()
  │
  ├─ configured kritical.scxcode.codexWrapperPath
  ├─ workspace codex-wrapper/kritical-codex.ps1
  ├─ extension codex-wrapper/kritical-codex.ps1
  └─ known repo fallback
  │
  v
pwsh -NoExit -File codex-wrapper/kritical-codex.ps1
  │
  ├─ SCX_API_KEY only
  ├─ read ~/.kritical-scx/current-model.json
  ├─ if model cannot drive agentic Codex, fallback MiniMax-M2.7
  ├─ start scx-agentic-shim.mjs on 127.0.0.1:4199 if needed
  ├─ prefer C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
  └─ pass -c overrides:
       model_provider=scx
       model_providers.scx.name="Southern Cross AI"
       model_providers.scx.base_url="http://127.0.0.1:4199/v1"
       model_providers.scx.env_key="SCX_API_KEY"
       model_providers.scx.wire_api="responses"
       model="<resolved SCX model>"
```

### Direct CLI Launch

```powershell
cd "C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode"
pwsh -File ".\codex-wrapper\kritical-codex.ps1"
pwsh -File ".\codex-wrapper\kritical-codex.ps1" -Model MiniMax-M2.7
& "C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe" --help
```

## Storage Architecture

```text
                 Looking Glass storage dropdown
                              │
              ┌───────────────┼────────────────┐
              │               │                │
              v               v                v
          auto mode        sqlite mode       mssql mode
              │               │                │
              │               │                ├─ .\SQLEXPRESS
              │               │                ├─ DB KriticalSCXCodeStore
              │               │                ├─ dbo.LensSource
              │               │                │    └─ DECOMPRESS(content_gz)
              │               │                │       -> hex -> UTF-8 preview
              │               │                ├─ dbo.LensSymbol
              │               │                └─ dbo.LensCorpusFile fallback
              │               │
              │               └─ ~/.kritical-scx/scxcode-store.db
              │                    ├─ files(path, lang, loc, fn_count, content)
              │                    └─ symbols(path, name, kind, line)
              │
              └─ prefer populated SQLite, else populated MSSQL, else empty state
```

Relevant VS Code settings:

```json
{
  "kritical.scxcode.storageBackend": "auto",
  "kritical.scxcode.sqliteStorePath": "",
  "kritical.scxcode.mssqlServer": ".\\SQLEXPRESS",
  "kritical.scxcode.mssqlDatabase": "KriticalSCXCodeStore"
}
```

## Model Architecture

```text
SCX model sources
├─ VS Code model dropdown
│  ├─ hardcoded safe preseed list in src/extension.ts
│  ├─ ~/.kritical-scx/models-cache.json
│  └─ live GET /v1/models from kritical.scxcode.baseUrl
│
├─ SCX Codex wrapper
│  ├─ explicit -Model wins
│  ├─ else ~/.kritical-scx/current-model.json
│  ├─ only accepts agentic-capable SCX models for Codex tool flow
│  └─ fallback: MiniMax-M2.7
│
└─ Compiled Kritical.SCXCodex.exe
   ├─ currently branded upstream Codex binary
   ├─ receives SCX model/provider/base_url via -c overrides
   └─ internal /model UI may still show upstream Codex model lists
```

Important distinction:

- VS Code dropdown is SCX-native and live/cache driven.
- Codex TUI `/model` is still upstream Codex UI unless/until the Rust overlay owns the model picker.
- The wrapper forces the effective provider/model using `-c` overrides even if the TUI model picker still displays upstream options.

## Installed State

```text
VS Code Insiders
├─ kritical.kritical-plugin-control-panel@0.4.0
└─ kritical.scxcode@0.1.27

SCXCode VSIX
└─ src/SCXCode-0.1.27.vsix

Compiled Codex package
├─ C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
├─ C:\KriticalSCX\dist\Kritical.SCXCodex\codex-package.json
└─ C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json
```

## Build / Install / Verify Commands

```powershell
# VS Code extension
npm --prefix src run build
vsce package --out SCXCode-0.1.27.vsix
code-insiders --install-extension .\src\SCXCode-0.1.27.vsix --force
code-insiders --list-extensions --show-versions | Select-String -Pattern 'kritical|scx'

# Focused extension tests
node tests/Test-KritScxCodeSetupConfig.js
node tests/Test-KritScxCodeSetupStorage.js
node tests/Test-KritScxCodeUI.js

# SCXCodex compiled pack
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Verify
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Apply-KriticalCodexPack.ps1 -Mode Status
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Update-Codex.ps1

# Whole-stack smoke
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install\Invoke-KritScxEndToEndBugHunt.ps1 -Mode Smoke -SkipLive
```

## Configuration Concerns

```text
SCX-only credential path
├─ SCX_API_KEY
├─ SCX_API_KEY_2 .. SCX_API_KEY_9
└─ never OPENAI_*, ANTHROPIC_*, Claude, ChatGPT, or native Codex auth

VS Code config
├─ kritical.scxcode.apiKey
├─ kritical.scxcode.baseUrl
├─ kritical.scxcode.defaultModel
├─ kritical.scxcode.fallbackChain
├─ kritical.scxcode.storageBackend
├─ kritical.scxcode.sqliteStorePath
├─ kritical.scxcode.mssqlServer
├─ kritical.scxcode.mssqlDatabase
└─ kritical.scxcode.codexWrapperPath

Local Kritical state
├─ ~/.kritical-scx/models-cache.json
├─ ~/.kritical-scx/current-model.json
├─ ~/.kritical-scx/scxcode-store.db
└─ ~/.kritical-scx/key-rotation.json

Codex native state
└─ ~/.codex is reused by upstream Codex for plugins/MCP, but wrappers should not write it.
```

## Known Issues / Next Work

```text
done now
├─ VS Code Insiders installed on 0.1.27
├─ storage dropdown in Setup GUI
├─ SQLite/MSSQL/auto Looking Glass selection
├─ SQL Server LensSource byte-exact preview decode
├─ wrapper prefers compiled Kritical.SCXCodex.exe
└─ wrapper fallback moved from gpt-oss-120b to MiniMax-M2.7

still to do
├─ move SCX-native model picker into Rust Codex overlay
├─ make compiled Kritical.SCXCodex speak SCX directly without wrapper reliance
├─ move mux/context economy into Rust or a first-class runtime layer
├─ promote SQLite context economy schema beyond current files/symbols store
├─ formalize SQL install migrations as .sql files plus idempotent installer
├─ wire live findings from dbo.v_LensFindings into Looking Glass
├─ make /model show SCX models inside Codex TUI
└─ make full SCX API capabilities first-class while preserving non-SCX provider compatibility
```

## Why There Are Multiple Things Named SCX Codex

```text
Name shown to user                What it actually is
──────────────────────────────────────────────────────────────────────────────
Kritical SCXCode                  VS Code extension
✦ SCX Codex button                VS Code command that launches wrapper
codex-wrapper/kritical-codex.ps1  PowerShell launcher + SCX env/model/shim policy
Kritical.SCXCodex.exe             compiled branded upstream Codex binary
scx-agentic-shim.mjs              OpenAI/Codex-compatible bridge to SCX responses
stock codex                       user's native Codex CLI, left untouched
```

The current practical launch path is:

```text
VS Code button -> kritical-codex.ps1 -> Kritical.SCXCodex.exe -> SCX shim -> SCX API
```

The long-term target is:

```text
VS Code button -> Kritical.SCXCodex.exe -> native SCX provider/runtime -> SCX API
```

## Commit Scope Guidance

Include:

- `codex-wrapper/kritical-codex.ps1`
- `src/extension.ts`
- `src/package.json`
- `src/SCXCode-0.1.27.vsix`
- `tests/Test-KritScxCodeUI.js`
- `tests/Test-KritScxCodeSetupStorage.js`
- `documentation/ai/2026-07-06/scxcodex-pack/SCXCODEX-FULL-ARCHITECTURE-HANDOVER-2026-07-06.md`
- `documentation/ai/2026-07-06/scxcodex-pack/INDEX.md`

Do not include unless explicitly reviewed:

- `.claude/settings.local.json`
- `documentation/ai/2026-07-06/action.jsonl`
- `documentation/ai/2026-07-05/`
- `lens/__pycache__/`
- `mux/__pycache__/`
- `out/`
