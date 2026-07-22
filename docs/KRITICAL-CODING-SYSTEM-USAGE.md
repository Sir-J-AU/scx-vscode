# Kritical CodingSystem Usage

This is the operator guide for using Kritical.SCXCode plus the sister supervisors as an all-day coding system.

## What It Does

Kritical CodingSystem gives you one local control surface for:

- Free-first model discovery through OpenRouter.
- SCX-native synthesis and validation.
- Claude Code/Codex/Kilo/OpenCode/Aider style coding tools where installed.
- MCP tools for SCX, store, chunk store, SQL, and supervisor reports.
- Target repo bootstrap through `.kritical/`.
- Queue-driven work through a local queue runner and the Node supervisor API.
- Validation gates that only mark work `validated_good` after configured tests pass.

It is additive. If the Kritical layer is stopped, your native tools still work.

## First-Time Setup

From `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode`:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -PersistUser
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode DiscoverFreeModels
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode Status
```

Install useful CLIs:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode InstallTools -Tools kilo,codex,claude,opencode,aider
```

Current proven local executable status:

| Tool | Status | Notes |
|---|---|---|
| Codex | Present | `codex-cli 0.142.5` |
| Claude Code | Present | `2.1.199` |
| OpenCode | Present | `1.17.7`, help confirms `opencode run [message..]` |
| Kilo CLI | Present | `7.4.1` |
| Aider | Present via `uvx` | Uses `uvx --python 3.12 --from aider-chat aider`, because Python 3.14 pip install fails build isolation |
| Hermes | Not present | Detect-only until installed |

Kilo and other CLIs may still require native sign-in or settings after install.

Probe local executables:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode ProbeTools
```

## Best Free Model Failover Order

The live OpenRouter discovery currently found 27 free models. For coding work, use this order:

1. `qwen/qwen3-coder:free` — strongest free coding/tool-use lane found.
2. `poolside/laguna-m.1:free` — agentic software engineering lane.
3. `poolside/laguna-xs-2.1:free` / `poolside/laguna-xs.2:free` — additional coding-agent lanes.
4. `nvidia/nemotron-3-ultra-550b-a55b:free` — long-context planning/orchestration.
5. `nvidia/nemotron-3-super-120b-a12b:free` — structured/tool-capable reasoning.
6. `openai/gpt-oss-120b:free` — general reasoning/tool-use fallback.
7. `cohere/north-mini-code:free` — fast code auxiliary lane.
8. `nousresearch/hermes-3-llama-3.1-405b:free` — persistent-agent/Hermes compatibility lane.
9. `google/gemma-4-31b-it:free` — multimodal/docs/screenshots auxiliary lane.
10. `openrouter/free` — last-resort free router for low-stakes tasks because it can choose different models per call.

Then escalate to:

11. Mistral free tier when `MISTRAL_API_KEY` exists: `codestral-latest`, `devstral-latest`.
12. SCX included allocation: `coder`, `MiniMax-M2.7`, `MAGPiE`, `gpt-oss-120b`, `DeepSeek-V3.1`.
13. Claude Max/native plan for hard execution when you intentionally want that path.

Refresh the live list any time:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode DiscoverFreeModels
```

Output:

```text
out/openrouter-free-model-candidates.json
```

Export the parameter/capability matrix:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Export-KritModelParameterMatrix.ps1
```

Outputs:

```text
out/model-parameter-matrix.json
docs/MODEL-PARAMETER-MATRIX.md
```

## Add A Repo

This creates `.kritical/` in the target repo:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode AddRepo -RepoPath 'C:\Path\To\Repo'
```

The repo gets:

- `.kritical/AGENT-INSTRUCTIONS.md`
- `.kritical/agents/agent-pack.json`
- `.kritical/mcp/mcp-tools.bundle.json`
- `.kritical/supervisor/run-supervisor.ps1`

Give `.kritical/AGENT-INSTRUCTIONS.md` to Kilo, Cline, Codex, Claude Code, OpenCode, Hermes, or OpenClaw so it knows the Kritical rules, endpoints, and proof expectations.

## Add Work To The Queue

Local queue only:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 `
  -Mode Enqueue `
  -QueueTarget local `
  -RepoPath 'C:\Path\To\Repo' `
  -Prompt 'Implement the design, run tests, fix failures, and return proof.'
```

Node supervisor API only:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 `
  -Mode Enqueue `
  -QueueTarget node-api `
  -RepoPath 'C:\Path\To\Repo' `
  -Prompt 'Short task under 500 chars for Node supervisor queue.'
```

Both:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 `
  -Mode Enqueue `
  -QueueTarget both `
  -RepoPath 'C:\Path\To\Repo' `
  -Prompt 'Detailed work item. Local queue keeps full prompt; Node API gets a short pointer if needed.'
```

## Run Work

Run one local queue item:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode RunOnce
```

Run one item and prove local coding executables are callable after the supervisor report:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode RunOnce -InvokeTool -Tool auto
```

Run one item with an explicit validation command:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 `
  -Mode RunOnce `
  -InvokeTool `
  -Tool auto `
  -TestCommand 'pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -SkipBuild'
```

Run continuously:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode Loop -StartRouters -InvokeTool -Tool auto
```

Stop:

```powershell
pwsh -NoProfile -File .\install\Invoke-KritCodingSystem.ps1 -Mode Stop
```

## Use The Node Supervisor API Directly

Import the client:

```powershell
Import-Module .\ps-module\Kritical.PS.NodeClientAPI.psm1 -Force
```

Check status:

```powershell
Get-KritNodeSupervisorStatus
Get-KritNodeSupervisorQueue
```

Add a short queue item:

```powershell
Add-KritNodeSupervisorQueueItem `
  -Id 'KCS-001' `
  -Prompt 'Run Kritical CodingSystem report for repo X and produce proof.' `
  -MaxConcurrency 1
```

Set failover order:

```powershell
Set-KritNodeSupervisorProviderOrder -FailoverOrder @(
  'openrouter-free',
  'scx-native',
  'codex',
  'claude-code',
  'hermes-api',
  'openclaw-api'
)
```

## Gate Semantics

The local queue runner is allowed to report, probe tools, and run configured validation commands. It only marks an item `validated_good` when the gate script exits successfully.

Queue status meanings:

- `supervisor_reported`: supervisor produced a report, but no tool/test gate was requested.
- `tool_probe_complete`: native coding executable was callable, but no test gate was requested.
- `validated_good`: tool phase and configured tests passed.
- `tool_probe_failed`: no suitable local tool could be probed or invoked.
- `failed_gate`: one or more configured validation commands failed.

This is the current safety boundary: free lanes can explore and draft; SCX can synthesize; native coding tools can be attached explicitly; completion still requires tests or E2E proof.

## Offload Free-Model Review Work

Use OpenRouter free models for parallel review, planning, and implementation critique without mutating the repo:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Invoke-KritOpenRouterBatch.ps1 `
  -Prompt 'Review this repo plan and list concrete implementation risks.' `
  -MaxConcurrency 3
```

Dry-run mode proves fanout/receipts without spending tokens:

```powershell
pwsh -NoProfile -File .\free-router\scripts\Invoke-KritOpenRouterBatch.ps1 `
  -Prompt 'dry-run proof' `
  -Models 'qwen/qwen3-coder:free' `
  -DryRun
```

## Proof

Run the full proof:

```powershell
pwsh -NoProfile -Command ". .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly | Out-Host; pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live"
```

Expected latest state:

```text
41 passed, 0 failed, 2 skipped
```

## Current Boundaries

- OpenRouter free models can throttle or require privacy settings.
- Free model provider privacy terms vary; do not send secrets or customer data to free lanes.
- Kilo/Hermes/OpenClaw native execution still requires those tools to be installed and configured locally, and direct execute mode is only enabled after each tool's non-interactive contract is proven.
- KiloClaw is hosted/account-managed, not free local compute.
- The local queue runner is gate-first for completion; direct unattended mutation remains opt-in per tool registry entry.

(c) 2026 Kritical Pty Ltd. All rights reserved.
