# Kritical.SCXCodex Pack Handoff

Date: 2026-07-06 Australia/Sydney  
UTC build stamp: 20260705T144442Z  
Repository: `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode`

## Outcome

The Codex pack now recompiles OpenAI Codex into a real branded executable instead of installing `.cmd` launcher shims.

Canonical artifact:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
```

Verified branding visible from CLI help:

```text
Kritical.SCXCodex
OpenAI Codex customised for Southern Cross AI - https://scx.ai

Usage: Kritical.SCXCodex [OPTIONS] [PROMPT]
       Kritical.SCXCodex [OPTIONS] <COMMAND> [ARGS]
```

## Hard Safety Boundary

The SCXCodex pack must not read, print, modify, delete, migrate, validate, or otherwise touch native Anthropic/OpenAI/Claude/ChatGPT/Codex provider keys or auth settings.

Recorded build receipt field:

```json
"nativeProviderSecrets": "unread-unchanged"
```

The SCX path uses `SCX_API_KEY` / SCX-specific config only. Native provider settings are outside scope.

## Current Compiled Package Layout

Package root:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex
```

Files present after build:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json
C:\KriticalSCX\dist\Kritical.SCXCodex\codex-package.json
C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
C:\KriticalSCX\dist\Kritical.SCXCodex\codex-path\rg.exe
C:\KriticalSCX\dist\Kritical.SCXCodex\codex-resources\codex-command-runner.exe
C:\KriticalSCX\dist\Kritical.SCXCodex\codex-resources\codex-windows-sandbox-setup.exe
```

Build receipt:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json
```

Recorded receipt values:

```json
{
  "product": "Kritical.SCXCodex",
  "description": "OpenAI Codex customised for Southern Cross AI - https://scx.ai",
  "utc": "20260705T144442Z",
  "upstreamCommit": "98d28aab54ed86714901b6619400598598876dd0",
  "target": "x86_64-pc-windows-msvc",
  "cargoProfile": "dev-small",
  "packageDir": "C:\\KriticalSCX\\dist\\Kritical.SCXCodex",
  "entrypoint": "C:\\KriticalSCX\\dist\\Kritical.SCXCodex\\bin\\Kritical.SCXCodex.exe",
  "sha256": "06EAF88E3D42A404CD450276DBBD79FAAA780A9C272A578F44977B6F4F70F7EC",
  "nativeProviderSecrets": "unread-unchanged"
}
```

## Source And Build Inputs

Upstream Codex clone:

```text
C:\KriticalSCX\codex-upstream
```

Upstream commit used:

```text
98d28aab54ed86714901b6619400598598876dd0
```

Disposable build worktree:

```text
C:\KriticalSCX\build\scxcodex\source
```

Cargo target cache:

```text
C:\KriticalSCX\build\scxcodex\target
```

Prebuilt branded entrypoint before package staging:

```text
C:\KriticalSCX\build\scxcodex\Kritical.SCXCodex.exe
```

## Pack Scripts

Primary compiler:

```text
codex-wrapper\pack\Build-KriticalSCXCodex.ps1
```

Responsibilities:

- Resolves the upstream Codex clone.
- Creates a disposable git worktree from the upstream commit.
- Applies the Kritical.SCXCodex branding overlay inside the disposable worktree only.
- Installs or activates required Rust/MSVC build tooling when missing.
- Compiles Codex with Cargo.
- Uses upstream `scripts\build_codex_package.py` to stage the Codex package layout.
- Renames/stages the package entrypoint as `bin\Kritical.SCXCodex.exe`.
- Rewrites `codex-package.json` entrypoint to `bin/Kritical.SCXCodex.exe`.
- Verifies the compiled executable contains required branding strings.
- Writes `.kritical-scxcodex-build.receipt.json`.

Pack controller:

```text
codex-wrapper\pack\Apply-KriticalCodexPack.ps1
```

Responsibilities:

- `-Mode Install`: removes legacy `.cmd` shims and runs the compiler.
- `-Mode Heal`: removes legacy `.cmd` shims, verifies package, rebuilds if missing.
- `-Mode Status`: reports package/build status without touching native provider auth.
- `-Mode Remove`: removes only the SCX compiled package/build cache and legacy `.cmd` shims.

Upstream update helper:

```text
codex-wrapper\pack\Update-Codex.ps1
```

Responsibilities:

- Pulls the upstream source clone with `git pull --ff-only`.
- Rebuilds `Kritical.SCXCodex.exe`.
- Verifies compiled branding.
- Does not install, update, or mutate stock `codex`.

Top-level Codex installer facade:

```text
install\Install-KriticalSCXCodex.ps1
```

Responsibilities:

- `-Mode Install -Apply`: delegates to compiled pack install.
- `-Mode Heal -Apply`: delegates to compiled pack heal.
- `-Mode Status`: delegates to pack status.
- `-Mode Remove -Apply`: delegates to pack remove.
- Dry-run by default without `-Apply`.

Whole-stack e2e loop:

```text
install\Invoke-KritScxEndToEndBugHunt.ps1
```

Responsibilities:

- Runs status checks.
- Runs PowerShell and JavaScript parse gates.
- Runs provider-env isolation test.
- Runs VSIX package integrity test.
- Runs regression self-test.
- In live/full mode can run proxy, mux, and Lens paths.

## Commands

Build/rebuild the compiled package:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Build
```

Verify the compiled package:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Verify
```

Pack status:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Apply-KriticalCodexPack.ps1 -Mode Status
```

Install/heal via pack:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Apply-KriticalCodexPack.ps1 -Mode Install
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Apply-KriticalCodexPack.ps1 -Mode Heal
```

Update from upstream and rebuild:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Update-Codex.ps1
```

Dry-run top-level Codex install:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install\Install-KriticalSCXCodex.ps1 -Mode Install
```

Apply top-level Codex install:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install\Install-KriticalSCXCodex.ps1 -Mode Install -Apply
```

Smoke e2e:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install\Invoke-KritScxEndToEndBugHunt.ps1 -Mode Smoke -SkipLive
```

## Validation Results

Compiled package verify:

```text
Verified compiled Kritical.SCXCodex package.
```

Pack status result:

```text
pack version   : 0.3.0
source clone   : present C:\KriticalSCX\codex-upstream
package dir    : present C:\KriticalSCX\dist\Kritical.SCXCodex
entrypoint     : present C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
receipt        : present C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json
stock codex    : untouched
provider auth  : native OpenAI/Anthropic/Codex settings unread + unchanged
```

Smoke e2e result:

```text
9 passed, 0 warnings, 0 failed
```

Primary smoke receipt:

```text
receipts\end-to-end-bughunt-20260705T144559Z.json
```

Later available smoke receipt observed during inventory:

```text
receipts\end-to-end-bughunt-20260705T153709Z.json
```

## Logs And Receipts Of Interest

Recent e2e receipts:

```text
receipts\end-to-end-bughunt-20260705T153709Z.json
receipts\end-to-end-bughunt-20260705T144559Z.json
receipts\end-to-end-bughunt-20260705T142551Z.json
```

Recent bughunt logs:

```text
receipts\bughunt\20260705T153709Z-whole-stack_installer_status.log
receipts\bughunt\20260705T153709Z-SCX_Codex_installer_status.log
receipts\bughunt\20260705T153709Z-Codex_pack_status.log
receipts\bughunt\20260705T153709Z-LiteLLM_proxy_status.log
receipts\bughunt\20260705T153709Z-provider_env_isolation.log
receipts\bughunt\20260705T153709Z-VSIX_package_integrity.log
receipts\bughunt\20260705T153709Z-regression_self-test.log
receipts\bughunt\20260705T144559Z-whole-stack_installer_status.log
receipts\bughunt\20260705T144559Z-SCX_Codex_installer_status.log
receipts\bughunt\20260705T144559Z-Codex_pack_status.log
receipts\bughunt\20260705T144559Z-LiteLLM_proxy_status.log
receipts\bughunt\20260705T144559Z-provider_env_isolation.log
receipts\bughunt\20260705T144559Z-VSIX_package_integrity.log
receipts\bughunt\20260705T144559Z-regression_self-test.log
```

## Build Environment Notes

Observed host:

- Windows ARM64 host.
- x64 package target selected: `x86_64-pc-windows-msvc`.
- Rustup was installed by the pack because Cargo was initially missing.
- Visual Studio Build Tools were installed/activated by the pack because MSVC `link.exe` was initially missing and Git’s `link.exe` was shadowing it.
- The final successful compile used `stable-x86_64-pc-windows-msvc`.

Important failure modes fixed during the session:

- PowerShell inline `if` inside function-call arguments caused `The term 'if' is not recognized`.
- `Invoke-Logged` originally failed to enter `-WorkingDirectory`, causing Cargo to search for `Cargo.toml` from the repo root.
- Rustup stdout was accidentally returned from `Ensure-RustToolchain`, corrupting the `$cargo` path.
- Git’s Unix `link.exe` shadowed MSVC `link.exe`.
- ARM64 host toolchain combined with x64 libraries caused linker machine-type conflicts.
- Binary branding verify was changed from slow byte-by-byte scan to fast UTF-8 string scan.

## Legacy Shim Removal

The pack no longer installs `.cmd` shims.

Removed paths:

```text
C:\KriticalSCX\bin\scxcodex.cmd
C:\KriticalSCX\bin\kcodex.cmd
C:\Users\joshl\AppData\Local\Kritical\bin\scxcodex.cmd
C:\Users\joshl\AppData\Local\Kritical\bin\kcodex.cmd
```

Current checks confirm all four paths are absent.

The only remaining `.cmd` references in the pack are intentional cleanup references in:

```text
codex-wrapper\pack\Apply-KriticalCodexPack.ps1
```

## Files Changed For SCXCodex Pack

Primary pack files:

```text
codex-wrapper\pack\Build-KriticalSCXCodex.ps1
codex-wrapper\pack\Apply-KriticalCodexPack.ps1
codex-wrapper\pack\Update-Codex.ps1
codex-wrapper\pack\pack-manifest.json
```

Installer/status/test/documentation files previously adjusted for the compiled-pack model:

```text
install\Install-KriticalSCXCodex.ps1
install\Install-KriticalSCX.ps1
tests\Invoke-KritScxSelfTest.ps1
tests\Test-KritSupervisorRouting.ps1
codex-wrapper\README.md
```

Related earlier SCX-only key/isolation files from this session:

```text
ps-module\Kritical.PS.SCXCode.psm1
install\Install-KritScxVsCode.ps1
litellm\Install-KritScxLiteLLM.ps1
litellm\Test-KritScxRouting.ps1
mcp-server\server.mjs
safety\Restore-WorkingClaude.ps1
tests\Test-KritScxProviderEnvIsolation.ps1
tests\Test-KritScxVsixPackage.ps1
install\Invoke-KritScxEndToEndBugHunt.ps1
```

## Current Git Notes

Observed modified/untracked files include items outside this SCXCodex pack task, including `.claude\settings.local.json`, `documentation\ai\2026-07-05\`, `documentation\ai\2026-07-06\`, `lens\__pycache__\`, `mux\__pycache__\Invoke-KritScxMuxMatrix.cpython-314.pyc`, and `out\`.

Do not assume those unrelated files were created by the SCXCodex compiler work without inspecting their provenance.

## Immediate Usage

Run branded help:

```powershell
& 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe' --help
```

Run non-interactive branded Codex:

```powershell
& 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe' exec "review this repository"
```

Run package verification:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Verify
```

## Next Extraction Decision

The current implementation lives under:

```text
codex-wrapper\pack
```

That is workable inside `Kritical.SCXCode`, but the cleaner packaging boundary is a dedicated subproject/repo such as:

```text
Kritical.SCXCode.SCXCodex
```

or:

```text
Kritical.SCXCodex
```

The extraction should move the pack scripts, manifest, docs, build receipts schema, and e2e pack tests into a dedicated subtree first, then optionally split that subtree to its own repo.
