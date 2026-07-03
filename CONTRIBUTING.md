# Contributing to Kritical.SCXCode

Thanks for looking. This repo powers the Kritical SCX ecosystem across
five deployment surfaces — the VS Code extension, a Continue.dev config
template, Cline / Roo docs, a PowerShell 7 module, and an MCP server.
The guidance below keeps the contribution surface tidy.

## Ground rules

1. **Never commit API keys, tokens, or `.env` files.** Secrets live in
   `HKCU` by convention. If you find a real secret in a diff, stop and
   rotate.
2. **Never bulk-restore whole files from git**
   (`git checkout <sha> -- <path>`). Semantic diff peak-vs-HEAD;
   cherry-pick only the piece belonging in the target file.
3. **Idempotent installer contract.** Any script that mutates external
   state (extension install, `HKCU` env, config drop) exposes
   `-Mode Install | Remove | Heal | Status`. Reference:
   `install/Install-KritScxVsCode.ps1`.
4. **Live-verify before shipping.** If you claim it works, include the
   receipt (`receipts/*.json`) or a captured log line as evidence in the
   PR body.

## Local dev

### Path A (Continue config)

```powershell
pwsh install/Install-KritScxVsCode.ps1 -Mode Install
```

### Path C (VS Code extension)

```bash
cd src
npm install
npm run build           # esbuild bundles to out/extension.js
```

Open the folder in VS Code. Press `F5` for the extension host. Command palette
→ "Kritical: Test SCX Connection" to verify auth.

### Path D (PS module)

```powershell
Import-Module ./ps-module/Kritical.PS.SCXCode.psd1 -Force
Test-KritScxConnection
scx 'what is 47*3?'
```

### Path E (MCP server)

```bash
node mcp-server/server.mjs
# stdio JSON-RPC 2.0. Send initialize + tools/list to test.
```

## Adding a new SCX model

1. Verify with `curl -sf https://api.scx.ai/v1/models` that the model is real.
2. Update **`config-templates/continue-config.json`** — new `models[]` entry.
3. Update **`src/package.json`** — `kritical.scxcode.defaultModel.enum` and
   `enumDescriptions` arrays.
4. Update **`src/extension.ts`** — `cmdPickModel` catalog array.
5. Update **`docs/PROVIDERS.md`** — add a row with AUD pricing + context length.
6. Update **`ps-module/Kritical.PS.SCXCode.psm1`** — no code change needed
   (dynamic model list via `Get-KritScxModels`), but consider adding a helper
   alias if the model becomes a preferred default.

## Adding a new CLI to the installer

Drop a row into `$CLI_MAP` inside `install/Install-KritAiCLIs.ps1`. Each row:

```powershell
'my-cli' = @{
    DisplayName = 'Human readable name'
    NpmPackage  = '@vendor/cli-package'      # OR PipPackage 'x' OR WingetId 'Vendor.Product'
    BinName     = 'my-cli.cmd'
    InstallCmd  = { npm install -g @vendor/cli-package --silent 2>&1 | Out-String }
    RemoveCmd   = { npm uninstall -g @vendor/cli-package 2>&1 | Out-String }
    TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
    Homepage    = 'https://vendor.com/cli'
}
```

Then update the `Only` `ValidateSet` list in the `param()` block.

## Testing

Not yet wired. Roadmap:

- **`src/`** — Vitest for unit tests of `scxPost` + `chatWithFailover`;
  `@vscode/test-electron` for extension host integration
- **`ps-module/`** — Pester 5.x tests for each exported function
- **`mcp-server/`** — Vitest for handleTool dispatch

Contributions welcome to seed each of these.

## Commit style

Conventional commits: `<type>: <imperative summary>` where type is one
of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf`.

Examples:

- `feat: add Kritical.SCXCode marketplace listing`
- `fix: load-balance skips penalty-boxed provider on next attempt`
- `docs: correct SCX MiniMax-M2.7 context length in docs/PROVIDERS.md`

Keep commit subjects professional — no profanity, no personal quotes.

## Sign-off

By contributing you agree that your contribution is licensed under Apache 2.0
matching the rest of the repo.
