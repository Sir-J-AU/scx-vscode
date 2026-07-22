#requires -Version 7.0
<#
.SYNOPSIS
  One command interface for Kritical CodingSystem.

.DESCRIPTION
  Coordinates free model discovery, tool install/status, target repo bootstrap,
  Node supervisor queue API submission, local queue fallback, and queue runner.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('Status','DiscoverFreeModels','InstallTools','ProbeTools','AddRepo','Enqueue','RunOnce','Loop','Stop')]
  [string] $Mode = 'Status',

  [string] $RepoPath,
  [string] $Prompt,
  [string] $Id,
  [string] $QueuePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'out\coding-queue.json'),
  [string] $NodeSupervisorBaseUrl = 'http://127.0.0.1:4321',
  [ValidateSet('local','node-api','both')]
  [string] $QueueTarget = 'local',
  [int] $MaxConcurrency = 1,
  [switch] $Live,
  [switch] $StartRouters,
  [switch] $InvokeTool,
  [ValidateSet('codex','claude','opencode','kilo','aider','hermes','auto')]
  [string] $Tool = 'auto',
  [string[]] $TestCommand = @(),
  [string[]] $Tools = @('kilo','codex','claude','opencode','aider')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeClient = Join-Path $repoRoot 'ps-module\Kritical.PS.NodeClientAPI.psm1'
Import-Module $nodeClient -Force

function New-WorkId {
  'KCS-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
}

function Add-LocalQueueItem {
  param([string] $WorkId, [string] $WorkPrompt, [string] $TargetRepo, [string] $RunMode)
  if (-not (Test-Path -LiteralPath $QueuePath)) {
    New-Item -ItemType Directory -Path (Split-Path $QueuePath) -Force | Out-Null
    @{ queue = @() } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $QueuePath -Encoding UTF8
  }
  $q = Get-Content -LiteralPath $QueuePath -Raw | ConvertFrom-Json
  $items = @($q.queue)
  $items += [pscustomobject]@{
    id = $WorkId
    status = 'queued'
    repo = $TargetRepo
    prompt = $WorkPrompt
    mode = $RunMode
    created_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
  $q.queue = $items
  $q | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $QueuePath -Encoding UTF8
  [pscustomobject]@{ ok = $true; target = 'local'; queue = $QueuePath; id = $WorkId }
}

switch ($Mode) {
  'Status' {
    & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Test-KritCodingSystem.ps1')
    break
  }
  'DiscoverFreeModels' {
    & pwsh -NoProfile -File (Join-Path $repoRoot 'free-router\scripts\Update-KritOpenRouterFreeModels.ps1')
    break
  }
  'InstallTools' {
    & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Install-KritAiCLIs.ps1') -Mode Install -Only $Tools
    break
  }
  'ProbeTools' {
    & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Invoke-KritCodingTool.ps1') -Mode DryRun -Tool $Tool -ReportPath (Join-Path $repoRoot 'out\coding-tool-probe.json')
    break
  }
  'AddRepo' {
    if (-not $RepoPath) { throw '-RepoPath is required for AddRepo.' }
    & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Add-KritAgenticRepo.ps1') -RepoPath $RepoPath -Pack mega
    break
  }
  'Enqueue' {
    if (-not $Prompt) { throw '-Prompt is required for Enqueue.' }
    $workId = if ($Id) { $Id } else { New-WorkId }
    $targetRepo = if ($RepoPath) { (Resolve-Path -LiteralPath $RepoPath).Path } else { (Get-Location).Path }
    $runMode = if ($Live) { 'live' } else { 'dry-run' }
    $results = @()
    if ($QueueTarget -in @('local','both')) {
      $results += Add-LocalQueueItem -WorkId $workId -WorkPrompt $Prompt -TargetRepo $targetRepo -RunMode $runMode
    }
    if ($QueueTarget -in @('node-api','both')) {
      $nodePrompt = $Prompt
      if ($nodePrompt.Length -gt 500) {
        $nodePrompt = "Kritical CodingSystem task $workId. Full prompt is in local queue/MCP instructions. Repo: $targetRepo. Use .kritical/AGENT-INSTRUCTIONS.md and supervisor report workflow."
      }
      try {
        $results += Add-KritNodeSupervisorQueueItem -Id $workId -Prompt $nodePrompt -MaxConcurrency $MaxConcurrency -BaseUrl $NodeSupervisorBaseUrl
      } catch {
        $results += [pscustomobject]@{ ok = $false; target = 'node-api'; error = $_.Exception.Message }
      }
    }
    $results
    break
  }
  'RunOnce' {
    $runnerArgs = @('-NoProfile','-File',(Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1'),'-Mode','RunOnce','-QueuePath',$QueuePath,'-Tool',$Tool)
    if ($Live) { $runnerArgs += '-Live' }
    if ($StartRouters) { $runnerArgs += '-StartRouters' }
    if ($InvokeTool) { $runnerArgs += '-InvokeTool' }
    if ($TestCommand.Count -gt 0) { $runnerArgs += @('-TestCommand') + $TestCommand }
    & pwsh @runnerArgs
    break
  }
  'Loop' {
    $runnerArgs = @('-NoProfile','-File',(Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1'),'-Mode','Loop','-QueuePath',$QueuePath,'-Tool',$Tool)
    if ($Live) { $runnerArgs += '-Live' }
    if ($StartRouters) { $runnerArgs += '-StartRouters' }
    if ($InvokeTool) { $runnerArgs += '-InvokeTool' }
    if ($TestCommand.Count -gt 0) { $runnerArgs += @('-TestCommand') + $TestCommand }
    & pwsh @runnerArgs
    break
  }
  'Stop' {
    & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1') -Mode Stop -QueuePath $QueuePath
    try { Stop-KritNodeSupervisor -BaseUrl $NodeSupervisorBaseUrl } catch { Write-Warning $_.Exception.Message }
    break
  }
}
