# Free and SCX Agent Packs

This repo now carries two secretless coding-agent packs:

| Pack | Default route | Use when |
|---|---|---|
| `kritical-free-router` | `http://127.0.0.1:4182/v1` | Maximise free coding/agentic tokens across OpenRouter/free, Mistral, Gemini, Together, Groq, DeepSeek, Fireworks, Cohere, and local providers. |
| `scx-native` | `https://api.scx.ai/v1` plus shim `http://127.0.0.1:4199/v1` | Use SCX.ai models directly with `SCX_API_KEY`, especially `coder`, `MiniMax-M2.7`, `MAGPiE`, and `DeepSeek-V3.1`. |

## Free-Provider Order

Current free-router priority:

1. OpenRouter `/free` router.
2. Mistral AI free tier, corrected to operator-verified `2,000,000,000` tokens/day.
3. Google AI Studio / Gemini.
4. Together AI.
5. Groq.
6. DeepSeek.
7. Fireworks.
8. Cohere.
9. Ollama / LM Studio local.

The bad `500K/day` Mistral placeholder is gone from the registry and the LiteLLM fallback chain.

## Secrets

External source folder:

```powershell
C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY
```

Load keys into the current process and HKCU:

```powershell
pwsh .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -PersistUser
```

Status without showing values:

```powershell
pwsh .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Status
```

The existing external `Load-KriticalSecrets.ps1` handles SCX and other Kritical secrets. The repo loader adds free-provider mappings such as `OPENROUTER_API_KEY` and `MISTRAL_API_KEY`.

## Install Packs

Generate user-local config snippets:

```powershell
pwsh .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack kritical-free-router -PersistHKCU
pwsh .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack scx-native
```

Generated snippets land under:

```powershell
$env:LOCALAPPDATA\Kritical\SCXCode\agent-packs\
```

Use `-WriteNative` only when you want the installer to write known native config locations, currently DeepCode VS Code settings. It backs up first.

## Start Routers

Free-first LiteLLM:

```powershell
pwsh .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config free
```

SCX/OpenRouter hybrid LiteLLM:

```powershell
pwsh .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config openrouter
```

SCX Codex agentic shim:

```powershell
node .\codex-wrapper\scx-agentic-shim.mjs
```

## Mixed Supervisor

Dry-run, no token spend:

```powershell
python .\mux\Invoke-KritAgentSupervisor.py --mode dry-run -q "Validate free-router plus SCX lanes."
```

Live:

```powershell
python .\mux\Invoke-KritAgentSupervisor.py --mode live -q "Run a coding review across free-router and SCX lanes."
```

The supervisor persists lane results to SQLite by default:

```powershell
~\.kritical-scx\scxcode-supervisor.db
```

Initialize backing storage explicitly:

```powershell
pwsh .\install\Initialize-KritScxBackingStore.ps1 -Mode Install
```

Add SQL Server tables too:

```powershell
pwsh .\install\Initialize-KritScxBackingStore.ps1 -Mode Install -Mssql
```

## Proof

Offline proof:

```powershell
pwsh .\tests\Invoke-KritScxE2EProof.ps1
```

Live proof:

```powershell
pwsh .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

The proof validates registry correction, PowerShell parsing, JSON manifests, Python compile, SQLite backing store, mixed supervisor dry-run, pack install, VS Code build, and optional live SCX surface.

## Sister App Alignment

These sister repos carry lightweight alignment docs that point back here as the source of truth:

```text
C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.NodeJS\docs\SCXCODE-AGENT-PACK-ALIGNMENT.md
C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.PS\docs\SCXCODE-AGENT-PACK-ALIGNMENT.md
```

Different defaults stay different:

- SCXCode owns the actual packs, shims, MUX matrix, and proof harness.
- NodeJS supervisor owns queued autonomous work orchestration.
- PS supervisor owns Windows keep-alive/task-loop orchestration.
