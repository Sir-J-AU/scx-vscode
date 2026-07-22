#requires -Version 7.0
<#
.SYNOPSIS
  Add Kritical SCXCode agentic instructions, MCP bundle references, and pack snippets to a target repo.

.DESCRIPTION
  This is an additive repo bootstrapper. It creates a .kritical folder in the
  target repository with instructions, MCP bundle references, supervisor
  defaults, and agent-pack manifests. It does not overwrite native Kilo, Cline,
  Claude Code, Codex, Continue, or VS Code user configuration.

.NOTES
  Author: Joshua Finley — (c) 2026 Kritical Pty Ltd. All rights reserved.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [string] $RepoPath,

  [ValidateSet('free','scx','mega')]
  [string] $Pack = 'mega',

  [string] $DesignPromptPath,

  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$scxRoot = Split-Path -Parent $PSScriptRoot
$target = (Resolve-Path -LiteralPath $RepoPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) {
  throw "Target is not a git repo root or .git is missing: $target"
}

$packMap = @{
  free = 'kritical-free-router'
  scx = 'scx-native'
  mega = 'kritical-agentic-mega-pipeline'
}
$packId = $packMap[$Pack]
$packPath = Join-Path $scxRoot "free-router\agent-packs\$packId.agent-pack.json"
$mcpPath = Join-Path $scxRoot 'free-router\agent-packs\kritical-mcp-tools.bundle.json'
if (-not (Test-Path -LiteralPath $packPath)) { throw "Missing pack: $packPath" }
if (-not (Test-Path -LiteralPath $mcpPath)) { throw "Missing MCP bundle: $mcpPath" }

$out = Join-Path $target '.kritical'
$agentDir = Join-Path $out 'agents'
$mcpDir = Join-Path $out 'mcp'
$supervisorDir = Join-Path $out 'supervisor'
New-Item -ItemType Directory -Path $agentDir,$mcpDir,$supervisorDir -Force | Out-Null

function Copy-Additive {
  param([string] $Source, [string] $Destination)
  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    Write-Host "Exists, keeping: $Destination" -ForegroundColor DarkYellow
    return
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

Copy-Additive -Source $packPath -Destination (Join-Path $agentDir 'agent-pack.json')
Copy-Additive -Source $mcpPath -Destination (Join-Path $mcpDir 'mcp-tools.bundle.json')

$designText = ''
if ($DesignPromptPath) {
  $designResolved = (Resolve-Path -LiteralPath $DesignPromptPath).Path
  $designText = Get-Content -LiteralPath $designResolved -Raw
}

$instructionsPath = Join-Path $out 'AGENT-INSTRUCTIONS.md'
if ((-not (Test-Path -LiteralPath $instructionsPath)) -or $Force) {
  $instructions = @"
# Kritical Agentic Coding Instructions

This repository is wired for Kritical SCXCode additive agent orchestration.

## Operating Contract

- Use native tools first where they already work.
- Use Kritical free-router lanes for cheap exploration, broad search, and draft patches.
- Use SCX-native lanes for synthesis, hard debugging, final review, and response quality.
- Use MCP tools for repo context, SQL/store lookup, chunked context, and SCX model access.
- Never print secrets. Keys come from env vars or HKCU.
- Ask before destructive commands. Prefer patch-sized changes and proof after each change.

## Local Endpoints

- Free router: `http://127.0.0.1:4182/v1`
- SCX native: `https://api.scx.ai/v1`
- Codex SCX shim: `http://127.0.0.1:4199/v1`
- Chunk server: `http://127.0.0.1:4270`

## Default Agent Roles

- Kilo Code: high-autonomy IDE/CLI agent, subagents, model comparison, MCP-aware repo work.
- Codex: terminal/repo execution with SCX Responses shim when available.
- Claude Code: high-quality native reasoning path, untouched by Kritical overlays.
- Cline/Roo Code: MCP-heavy VS Code plan/act workflows.
- Continue: declarative chat, context, and lower-risk assistant use.
- Aider/OpenCode: terminal patch agents when installed.
- DeepCode: focused review/explain/test generation when installed.

## Supervisor Pattern

1. Parse the design prompt and produce a task graph.
2. Run cheap/free lanes first for idea generation and repo reconnaissance.
3. Run SCX lanes for synthesis, conflict resolution, and final answer.
4. Persist lane outputs to SQLite.
5. Return changed files, proof commands, failures, and residual risk.

## Proof

From the SCXCode repo:

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

From this repo, use the generated supervisor command in `.kritical/supervisor/run-supervisor.ps1`.

## Design Prompt

$designText
"@
  Set-Content -LiteralPath $instructionsPath -Value $instructions -Encoding UTF8
}

$runPath = Join-Path $supervisorDir 'run-supervisor.ps1'
if ((-not (Test-Path -LiteralPath $runPath)) -or $Force) {
  $run = @"
#requires -Version 7.0
param(
  [Parameter(Mandatory)]
  [string] `$Prompt,
  [ValidateSet('dry-run','live')]
  [string] `$Mode = 'dry-run'
)

`$scxRoot = '$($scxRoot -replace "'", "''")'
`$repoRoot = '$($target -replace "'", "''")'
`$outDir = Join-Path `$repoRoot '.kritical\out'
New-Item -ItemType Directory -Path `$outDir -Force | Out-Null

python (Join-Path `$scxRoot 'mux\Invoke-KritAgentSupervisor.py') `
  --mode `$Mode `
  --sqlite (Join-Path `$outDir 'supervisor.sqlite') `
  --report (Join-Path `$outDir 'supervisor.md') `
  --prompt `$Prompt
"@
  Set-Content -LiteralPath $runPath -Value $run -Encoding UTF8
}

$readmePath = Join-Path $out 'README.md'
if ((-not (Test-Path -LiteralPath $readmePath)) -or $Force) {
  $readme = @"
# .kritical

Generated by Kritical.SCXCode `Add-KritAgenticRepo.ps1`.

Files:

- `agents/agent-pack.json` — selected Kritical agent pack.
- `mcp/mcp-tools.bundle.json` — MCP bundle for Kilo/Cline/Roo/agent tools.
- `AGENT-INSTRUCTIONS.md` — repo-local instructions to paste or reference from agent tools.
- `supervisor/run-supervisor.ps1` — repo-local wrapper for the Kritical mixed supervisor.

Kill switch: delete this `.kritical` folder. Native tools are untouched.
"@
  Set-Content -LiteralPath $readmePath -Value $readme -Encoding UTF8
}

[pscustomobject]@{
  Repo = $target
  Pack = $packId
  Output = $out
  Instructions = $instructionsPath
  Supervisor = $runPath
  KillSwitch = "Delete $out"
} | Format-List
