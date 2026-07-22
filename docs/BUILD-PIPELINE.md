# Kritical.SCXCode Build Pipeline

This pipeline keeps SCXCode additive. It updates Kritical overlays, proves them locally, and leaves upstream tools untouched.

## Principles

- Do not modify upstream agent installs in place.
- Put Kritical overlays under `%LOCALAPPDATA%\Kritical\SCXCode` or this repo.
- Keep secrets outside repos and load them through env vars.
- Bind local services to `127.0.0.1`.
- Treat generated/mined upstream docs as evidence snapshots, not immutable truth.
- Every shipped change must have a proof command.

## Standard Update Flow

1. Load secrets process-only.

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly
```

2. Validate free provider registry.

```powershell
pwsh -NoProfile -File .\tests\Test-KritFreeRouterRegistry.ps1
```

3. Build VS Code extension.

```powershell
npm --prefix .\src run build
```

4. Compile Python orchestration scripts.

```powershell
python -B -m py_compile .\mux\Invoke-KritAgentSupervisor.py .\mux\Invoke-KritScxMuxMatrix.py
```

5. Initialize local SQLite proof store.

```powershell
pwsh -NoProfile -File .\install\Initialize-KritScxBackingStore.ps1 -Mode Install
```

6. Run mixed supervisor dry-run.

```powershell
python .\mux\Invoke-KritAgentSupervisor.py --mode dry-run --prompt "pipeline proof" --sqlite .\out\pipeline-supervisor.sqlite --report .\out\pipeline-supervisor.md
```

7. Run E2E proof.

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

8. Check the broader Kritical CodingSystem readiness surface.

```powershell
pwsh -NoProfile -File .\install\Test-KritCodingSystem.ps1
```

## Agent Pack Update Flow

1. Update source manifests:

```text
free-router/agent-packs/kritical-free-router.agent-pack.json
free-router/agent-packs/scx-native.agent-pack.json
free-router/agent-packs/kritical-agentic-mega-pipeline.agent-pack.json
free-router/agent-packs/kritical-mcp-tools.bundle.json
free-router/config/free-agentic-model-catalog.json
```

2. Keep router configs aligned:

```text
litellm/kritical-scx-free.config.yaml
free-router/litellm/kritical-scx-free.config.yaml
```

3. Install pack overlays into local app data:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack free -PersistHKCU
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack scx -PersistHKCU
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack kritical-agentic-mega-pipeline -PersistHKCU
```

4. Run E2E proof and inspect `out/e2e-proof.md`.

## Free Provider Registry Update Flow

1. Update `free-router/config/free-providers-registry.json`.
2. Update both free LiteLLM configs when provider ranking changes.
3. Update `free-router/README.md` provider table.
4. Run:

```powershell
pwsh -NoProfile -File .\tests\Test-KritFreeRouterRegistry.ps1
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild
```

Mistral is currently recorded as operator-verified at 2B input tokens/day and 2B output tokens/day.

## SCX Upstream Documentation Update Flow

1. Mine SCX docs:

```powershell
node .\install\Invoke-KritScxApiReferenceMine.mjs
```

2. Validate generated artifacts:

```powershell
node .\tests\Test-KritScxApiReferenceMine.mjs
```

3. Refresh docs that summarize the mined data:

```text
docs/SCX-API-SURFACE-MATRIX-2026-07-07.md
docs/SCX-MINED-INSTRUCTION-MANUAL-SUMMARY-2026-07-07.md
docs/PROVIDERS.md
```

4. Keep the boundary explicit: candidate specs remain candidate until official upstream confirmation exists.

## VS Code Extension Build Flow

1. Edit `src/extension.ts` or `src/package.json`.
2. Build:

```powershell
npm --prefix .\src run build
```

3. Run focused extension tests:

```powershell
node .\tests\Test-KritScxCodeAttach.js
node .\tests\Test-KritScxCodeDropdownNeverBlank.js
node .\tests\Test-KritScxCodeModelTemp.js
node .\tests\Test-KritScxCodeMux.js
node .\tests\Test-KritScxCodeSetupConfig.js
node .\tests\Test-KritScxCodeSetupStorage.js
node .\tests\Test-KritScxCodeUI.js
```

4. Package and validate VSIX when package contents change:

```powershell
pwsh -NoProfile -File .\tests\Test-KritScxVsixPackage.ps1
```

## Codex Pack Build Flow

1. Update wrapper or pack files under `codex-wrapper/`.
2. Run shim tests:

```powershell
node .\codex-wrapper\scx-agentic-shim.test.mjs
node .\codex-wrapper\scx-agentic-shim.edge.test.mjs
node .\codex-wrapper\scx-corpus-augment.test.mjs
```

3. Build branded pack:

```powershell
pwsh -NoProfile -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1
```

4. Verify normal `codex` still works when the Kritical shim is off.

## Store And SQL Build Flow

1. Apply SQLite schema:

```powershell
pwsh -NoProfile -File .\install\Initialize-KritScxBackingStore.ps1 -Mode Install
```

2. Apply MSSQL schema when SQL Express is present:

```powershell
pwsh -NoProfile -File .\install\Initialize-KritScxBackingStore.ps1 -Mode Install -Mssql -ConnectionString 'Server=.\SQLEXPRESS;Database=KriticalSCXCode;Trusted_Connection=True;TrustServerCertificate=True'
```

3. Run store tests:

```powershell
node .\store-mcp\kritical-local-store.test.mjs
node .\store-mcp\kritical-chunk-store.test.mjs
node .\store-mcp\kritical-chunk-server.test.mjs
```

## Windows Installer Path

Current state: not proven locally. The audit did not find WiX or NSIS tools on PATH.

Once a toolchain is installed, add one of:

- WiX pipeline using `wix`, `heat`, and `candle`.
- NSIS pipeline using `makensis`.

The installer must install only additive Kritical layers and must print kill-switch instructions at the end of status/heal/install output.

## 24/7 Queue Runner Gate

The queue runner is report-first. It may run continuously, but it should not silently mutate repos without a downstream agent/tool explicitly doing the edit under its own safety model.

Proof:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild
```

Manual loop smoke:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Status
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode RunOnce
```

## Release Gate

Before calling a build finalized:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
git status --short
```

Do not declare native CLI coverage for tools that are not installed and probed on the machine.

(c) 2026 Kritical Pty Ltd. All rights reserved.
