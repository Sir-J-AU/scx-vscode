# Kritical.SCXCode Runbook

Use these commands from:

```powershell
Set-Location 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode'
```

## 1. Load Secrets

Process-only load, safe for proof runs:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly
```

Persist to HKCU for operator tools:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -PersistUser
```

Status without printing secrets:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Status
```

## 2. Start Or Stop Routers

Free-first router on `127.0.0.1:4182`:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config free
```

Hybrid SCX plus OpenRouter router on `127.0.0.1:4180`:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config openrouter
```

Status and heal:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Status
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Heal -Config free
```

Kill switch:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Stop
```

## 3. Install Agent Packs

Install free-router pack:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack free -PersistHKCU
```

Install SCX-native pack:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack scx -PersistHKCU
```

Write native tool snippets where supported:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack free -PersistHKCU -WriteNative
```

Remove installed pack overlays:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Remove -Pack free
```

## 4. Initialize Backing Stores

SQLite supervisor store:

```powershell
pwsh -NoProfile -File .\install\Initialize-KritScxBackingStore.ps1 -Mode Install
```

MSSQL or SQL Express supervisor schema:

```powershell
pwsh -NoProfile -File .\install\Initialize-KritScxBackingStore.ps1 -Mode Install -Mssql -ConnectionString 'Server=.\SQLEXPRESS;Database=KriticalSCXCode;Trusted_Connection=True;TrustServerCertificate=True'
```

## 5. Run Supervisor

Dry-run proof without spending tokens:

```powershell
python .\mux\Invoke-KritAgentSupervisor.py --mode dry-run --prompt "Summarize current repo proof state" --sqlite .\out\supervisor.sqlite --report .\out\supervisor-proof.md
```

Live mixed run after secrets and routers are available:

```powershell
python .\mux\Invoke-KritAgentSupervisor.py --mode live --prompt "Review the current staged SCXCode changes" --sqlite .\out\supervisor.sqlite --report .\out\supervisor-live.md
```

## 6. Run SCX Mux Matrix

Dry task file example:

```powershell
python .\mux\Invoke-KritScxMuxMatrix.py --help
```

Use this path when the job should stay SCX-native and use corpus-backed model scoring.

## 7. Build VS Code Extension

```powershell
npm --prefix .\src run build
```

Package proof remains covered by:

```powershell
pwsh -NoProfile -File .\tests\Test-KritScxVsixPackage.ps1
```

## 8. Build Codex Pack

Status and build are handled under `codex-wrapper/pack/`:

```powershell
pwsh -NoProfile -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1
```

The wrapper kill switch is simple: stop the shim on `127.0.0.1:4199` and call normal `codex`.

Known-working installed runtime restore point:

```text
docs\restore-points\2026-07-09-scxcodex-working\RESTORE-POINT.md
```

The executable backup is intentionally outside normal Git history:

```text
C:\KriticalSCX\restore-points\2026-07-09-scxcodex-working\Kritical.SCXCodex.exe
```

Before restoring, verify the documented SHA256. Do not overwrite a live good process unless the operator explicitly asks for rollback.

## 9. Mine SCX Upstream Docs

```powershell
node .\install\Invoke-KritScxApiReferenceMine.mjs
```

Outputs land in `UpstreamDocumentation/`. Treat `scx-openapi.candidate.json` as candidate/mined until an official upstream OpenAPI source is confirmed.

## 10. Run Full E2E Proof

With live SCX probe:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

Without build or live provider checks:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild
```

Latest report:

```powershell
Get-Content .\out\e2e-proof.md
```

## 11. Known Local Gaps

Native CLI proof needs the tools installed on PATH:

```text
kimi, deepcode, cline, continue, litellm, hermes
```

Windows installer proof needs one packaging toolchain installed:

```text
WiX: wix, heat, candle
NSIS: makensis
```

## 12. Kritical CodingSystem Mega Pipeline

Check local readiness without printing secrets:

```powershell
pwsh -NoProfile -File .\install\Test-KritCodingSystem.ps1
```

Probe real local coding executables:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode ProbeTools
```

Install known CLI tools where package managers support them:

```powershell
pwsh -NoProfile -File .\install\Install-KritAiCLIs.ps1 -Mode Status
pwsh -NoProfile -File .\install\Install-KritAiCLIs.ps1 -Mode Install -Only kilo,codex,claude,opencode,aider
```

Add `.kritical/` instructions and MCP bundle to a target repo:

```powershell
pwsh -NoProfile -File .\install\Add-KritAgenticRepo.ps1 -RepoPath 'C:\Path\To\Repo' -Pack mega
```

Create a queue file:

```powershell
@{
  queue = @(
    @{
      id = 'TASK-001'
      status = 'queued'
      repo = 'C:\Path\To\Repo'
      prompt = 'Implement the detailed design, using free lanes first and SCX for synthesis.'
      mode = 'dry-run'
    }
  )
} | ConvertTo-Json -Depth 10 | Set-Content .\out\coding-queue.json -Encoding UTF8
```

Run one item:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode RunOnce -QueuePath .\out\coding-queue.json
```

Run one item and prove coding-tool executable access:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode RunOnce -QueuePath .\out\coding-queue.json -InvokeTool -Tool auto
```

Run one item and only mark it good after tests pass:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 `
  -Mode RunOnce `
  -QueuePath .\out\coding-queue.json `
  -InvokeTool `
  -Tool auto `
  -TestCommand 'pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild'
```

Run continuously in report mode:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Loop -QueuePath .\out\coding-queue.json -StartRouters -SleepSeconds 60
```

Run continuously with executable probes after each supervisor report:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Loop -QueuePath .\out\coding-queue.json -StartRouters -InvokeTool -Tool auto -SleepSeconds 60
```

Run the one-command wrapper continuously. This was the command that previously failed when no `-TestCommand` value was provided; the wrapper now only forwards `-TestCommand` when one or more values exist.

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode Loop -StartRouters -InvokeTool -Tool auto
```

Parallel free-model review/offload through OpenRouter:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Invoke-KritOpenRouterBatch.ps1 `
  -Prompt 'Review the current queue item and produce testable implementation advice.' `
  -MaxConcurrency 3
```

Stop the runner:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Stop
```

Use [KILO-AND-MEGA-AGENTIC-PIPELINE-2026-07-08.md](KILO-AND-MEGA-AGENTIC-PIPELINE-2026-07-08.md) for the Kilo/OpenClaw/KiloClaw/Hermes/comparator design.
Use [KRITICAL-CODING-SYSTEM-USAGE.md](KRITICAL-CODING-SYSTEM-USAGE.md) for the plain-English operator workflow and Node supervisor API examples.

(c) 2026 Kritical Pty Ltd. All rights reserved.
