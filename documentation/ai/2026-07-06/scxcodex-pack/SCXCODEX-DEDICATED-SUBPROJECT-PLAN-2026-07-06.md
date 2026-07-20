# Kritical.SCXCodex Dedicated Subproject Plan

Date: 2026-07-06 Australia/Sydney

## Recommendation

Prepare the SCXCodex pack as its own dedicated subfolder first, then split to a standalone repo when the interface is stable.

Recommended intermediate folder:

```text
packs\Kritical.SCXCodex
```

Recommended future repo/package name:

```text
Kritical.SCXCode.SCXCodex
```

Shorter acceptable future repo/package name:

```text
Kritical.SCXCodex
```

## Why This Boundary

SCXCodex has a different lifecycle from the rest of `Kritical.SCXCode`:

- It tracks upstream OpenAI Codex source.
- It owns a Rust/MSVC build pipeline.
- It produces a large binary package under `C:\KriticalSCX\dist`.
- It needs branded binary verification.
- It must stay merge-clean against upstream.
- It should not be coupled to VSIX, LiteLLM, Lens, or mux internals except through explicit integration tests.

## Proposed Subfolder Layout

```text
packs\Kritical.SCXCodex\
  README.md
  pack-manifest.json
  scripts\
    Build-KriticalSCXCodex.ps1
    Apply-KriticalCodexPack.ps1
    Update-Codex.ps1
  tests\
    Test-KriticalSCXCodexPackage.ps1
    Test-KriticalSCXCodexBranding.ps1
    Test-KriticalSCXCodexProviderIsolation.ps1
  docs\
    SCXCODEX-PACK-HANDOFF-2026-07-06.md
    SCXCODEX-DEDICATED-SUBPROJECT-PLAN-2026-07-06.md
  receipts-schema\
    kritical-scxcodex-build.receipt.schema.json
```

## Files To Move First

From:

```text
codex-wrapper\pack\Build-KriticalSCXCodex.ps1
codex-wrapper\pack\Apply-KriticalCodexPack.ps1
codex-wrapper\pack\Update-Codex.ps1
codex-wrapper\pack\pack-manifest.json
codex-wrapper\README.md
```

To:

```text
packs\Kritical.SCXCodex\scripts\Build-KriticalSCXCodex.ps1
packs\Kritical.SCXCodex\scripts\Apply-KriticalCodexPack.ps1
packs\Kritical.SCXCodex\scripts\Update-Codex.ps1
packs\Kritical.SCXCodex\pack-manifest.json
packs\Kritical.SCXCodex\README.md
```

Installer compatibility wrappers can remain at the old paths temporarily:

```text
codex-wrapper\pack\Build-KriticalSCXCodex.ps1
codex-wrapper\pack\Apply-KriticalCodexPack.ps1
codex-wrapper\pack\Update-Codex.ps1
```

Those wrappers should only delegate to `packs\Kritical.SCXCodex\scripts\...` and should not duplicate build logic.

## Required Interfaces

The dedicated pack should expose these stable commands:

```powershell
pwsh .\packs\Kritical.SCXCodex\scripts\Build-KriticalSCXCodex.ps1 -Mode Build
pwsh .\packs\Kritical.SCXCodex\scripts\Build-KriticalSCXCodex.ps1 -Mode Verify
pwsh .\packs\Kritical.SCXCodex\scripts\Apply-KriticalCodexPack.ps1 -Mode Status
pwsh .\packs\Kritical.SCXCodex\scripts\Apply-KriticalCodexPack.ps1 -Mode Install
pwsh .\packs\Kritical.SCXCodex\scripts\Apply-KriticalCodexPack.ps1 -Mode Heal
pwsh .\packs\Kritical.SCXCodex\scripts\Apply-KriticalCodexPack.ps1 -Mode Remove
pwsh .\packs\Kritical.SCXCodex\scripts\Update-Codex.ps1
```

The existing top-level installer should continue to work:

```powershell
pwsh .\install\Install-KriticalSCXCodex.ps1 -Mode Install -Apply
```

## Non-Negotiable Tests

Provider isolation:

- Must statically reject writes/removals/reads of native `ANTHROPIC_*` and `OPENAI_*` settings.
- Must not inspect the operator’s current native provider env values.
- Must not read native Codex auth files.

Branding:

- `Kritical.SCXCodex.exe --help` must print `Kritical.SCXCodex`.
- `Kritical.SCXCodex.exe --help` must print `OpenAI Codex customised for Southern Cross AI - https://scx.ai`.
- Compiled binary must contain `Kritical.SCXCodex`.
- Compiled binary must contain `OpenAI Codex customised for Southern Cross AI`.
- Compiled binary must contain `https://scx.ai`.

Package shape:

- `codex-package.json` must exist.
- `codex-package.json` must point to `bin/Kritical.SCXCodex.exe`.
- `codex-path\rg.exe` must exist.
- `codex-resources\codex-command-runner.exe` must exist on Windows.
- `codex-resources\codex-windows-sandbox-setup.exe` must exist on Windows.

Upstream merge-clean behavior:

- Upstream source clone must not be permanently patched.
- Branding overlay must be applied to a disposable worktree only.
- `git pull --ff-only` must be the upstream update path.

## Future Standalone Repo Checklist

Before splitting to `Kritical.SCXCode.SCXCodex`:

- Replace hard-coded repo-relative paths with manifest-relative paths.
- Add a `README.md` at the subproject root.
- Add a receipt JSON schema.
- Add a smoke test that can run without the rest of `Kritical.SCXCode`.
- Keep integration tests in the parent repo for VSIX/LiteLLM/mux/Lens interaction.
- Create a versioned release artifact directory.
- Add CI for PowerShell parse, provider isolation, package-shape verification, and branding verification.
- Decide whether CI builds the full binary or validates against a cached/released binary.

## Packaging Outputs

Current output root:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex
```

Future versioned output root:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\<version>\<target>
```

Suggested release archive:

```text
Kritical.SCXCodex-<version>-x86_64-pc-windows-msvc.zip
```

## Integration Points Back To Kritical.SCXCode

`Kritical.SCXCode` should consume the dedicated pack through:

```text
install\Install-KriticalSCXCodex.ps1
install\Install-KriticalSCX.ps1
install\Invoke-KritScxEndToEndBugHunt.ps1
tests\Invoke-KritScxSelfTest.ps1
tests\Test-KritScxProviderEnvIsolation.ps1
```

Those parent integrations should verify presence and behavior only. They should not duplicate build internals.

## Immediate Next Patch

The next safe patch is a move-only refactor:

1. Create `packs\Kritical.SCXCodex`.
2. Move pack scripts and manifest into it.
3. Leave compatibility wrappers in `codex-wrapper\pack`.
4. Update `install\Install-KriticalSCXCodex.ps1` to call the new location.
5. Update e2e tests to accept only the new compiled package.
6. Run `Invoke-KritScxEndToEndBugHunt.ps1 -Mode Smoke -SkipLive`.
