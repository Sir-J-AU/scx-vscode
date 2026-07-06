# Kritical.SCXCodex

Compiled SCX-branded OpenAI Codex for Southern Cross AI.

`Kritical.SCXCodex.exe` is built from the upstream OpenAI Codex source clone using a disposable worktree. The pack applies the Kritical/SCX overlay during build, compiles Codex, packages the result, and verifies that the compiled binary contains the required branding strings:

- `Kritical.SCXCodex`
- `OpenAI Codex customised for Southern Cross AI`
- `https://scx.ai`

## Hard Boundary

This pack is SCX-only. It does not read, print, modify, remove, migrate, or validate native Anthropic/OpenAI/Claude/ChatGPT/Codex provider keys or auth settings.

Use `SCX_API_KEY` for SCX-backed routing. Native provider settings are left alone.

## Build

```powershell
pwsh ./codex-wrapper/pack/Apply-KriticalCodexPack.ps1 -Mode Install
```

Output:

```text
C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe
```

## Update From Upstream

```powershell
pwsh ./codex-wrapper/pack/Update-Codex.ps1
```

That command pulls the upstream source clone, reapplies the branding overlay in a disposable worktree, recompiles, packages, and verifies the branded binary. It does not install or mutate stock `codex`.

## AgentMUX Rust Plan

`docs/AGENTMUX-RUST-DESIGN.md` defines the next overlay step: keep upstream Codex intact where possible, add Kritical Rust modules for SQL-backed memory, empirical model routing, prompt manifests, context paging, SCX-only transport, audit events, worktree scheduling, and JSON output contracts, then patch only stable upstream seams.

## Verify

```powershell
pwsh ./codex-wrapper/pack/Build-KriticalSCXCodex.ps1 -Mode Verify
```

Verification fails if the package metadata does not point to `bin/Kritical.SCXCodex.exe` or if the compiled executable is missing any required Kritical/SCX branding string.

## Legacy Wrapper

`kritical-codex.ps1` and `kritical-codex.mjs` remain in the repo for compatibility and development diagnostics, but the pack installer no longer creates `.cmd` shims. The canonical pack artifact is the compiled executable.
