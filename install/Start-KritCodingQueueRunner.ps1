#requires -Version 7.0
<#
.SYNOPSIS
  Free-first Kritical CodingSystem queue runner.

.DESCRIPTION
  Drains a simple JSON queue through the mixed free-router + SCX supervisor.
  Designed for long-running unattended coding planning/review loops. It does not
  directly edit files; agents that apply patches must be invoked explicitly by a
  downstream tool after reviewing the supervisor report.

.QUEUE SCHEMA
  {
    "queue": [
      {
        "id": "TASK-001",
        "status": "queued",
        "repo": "C:\\Path\\Repo",
        "prompt": "Detailed design/task prompt",
        "mode": "dry-run"
      }
    ]
  }
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('Status','RunOnce','Loop','Stop')]
  [string] $Mode = 'Status',

  [string] $QueuePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'out\coding-queue.json'),

  [int] $SleepSeconds = 60,
  [int] $MaxIterations = 0,
  [switch] $Live,
  [switch] $StartRouters,
  [switch] $InvokeTool,
  [ValidateSet('codex','claude','opencode','kilo','aider','hermes','auto')]
  [string] $Tool = 'auto',
  [string[]] $TestCommand = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repoRoot 'out'
$stopFlag = Join-Path $stateDir 'KRITCODING-STOP.flag'
$lockPath = Join-Path $stateDir 'kritical-coding-runner.lock.json'

function Read-Queue {
  if (-not (Test-Path -LiteralPath $QueuePath)) {
    New-Item -ItemType Directory -Path (Split-Path $QueuePath) -Force | Out-Null
    @{ queue = @() } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $QueuePath -Encoding UTF8
  }
  $q = Get-Content -LiteralPath $QueuePath -Raw | ConvertFrom-Json
  if (-not $q.queue) { $q | Add-Member -NotePropertyName queue -NotePropertyValue @() -Force }
  return $q
}

function Write-Queue {
  param([object] $Queue)
  $tmp = [IO.Path]::GetTempFileName()
  $Queue | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $QueuePath -Force
}

function Set-ItemStatus {
  param([object] $Queue, [string] $Id, [string] $Status, [string] $Report = '', [string] $ErrorText = '')
  foreach ($item in @($Queue.queue)) {
    if ($item.id -eq $Id) {
      $item | Add-Member -NotePropertyName status -NotePropertyValue $Status -Force
      $item | Add-Member -NotePropertyName updated_utc -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
      if ($Report) { $item | Add-Member -NotePropertyName report -NotePropertyValue $Report -Force }
      if ($ErrorText) { $item | Add-Member -NotePropertyName error -NotePropertyValue $ErrorText -Force }
      break
    }
  }
  Write-Queue $Queue
}

function Start-OptionalRouters {
  if (-not $StartRouters) { return }
  & pwsh -NoProfile -File (Join-Path $repoRoot 'free-router\scripts\Start-KritFreeRouter.ps1') -Mode Heal -Config free | Out-Host
}

function Invoke-One {
  $q = Read-Queue
  $item = @($q.queue | Where-Object { $_.status -in @('queued','pending',$null,'') } | Select-Object -First 1)
  if (-not $item) {
    Write-Host 'No queued work.' -ForegroundColor DarkYellow
    return $false
  }

  $id = if ($item.id) { [string]$item.id } else { "TASK-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" }
  if (-not $item.id) { $item | Add-Member -NotePropertyName id -NotePropertyValue $id -Force }
  $prompt = [string]$item.prompt
  if (-not $prompt) { throw "Queue item $id has no prompt." }
  $targetRepo = if ($item.repo) { [string]$item.repo } else { $repoRoot }
  $runMode = if ($Live -or $item.mode -eq 'live') { 'live' } else { 'dry-run' }
  $itemTestCommands = @()
  if ($item.test_commands) { $itemTestCommands = @($item.test_commands | ForEach-Object { [string]$_ }) }
  if ($TestCommand.Count -gt 0) { $itemTestCommands = @($TestCommand) }
  $safeRepoName = ($id -replace '[^A-Za-z0-9_.-]', '_')
  $outDir = Join-Path $stateDir "coding-runs\$safeRepoName"
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $db = Join-Path $outDir 'supervisor.sqlite'
  $report = Join-Path $outDir 'supervisor.md'
  $toolReport = Join-Path $outDir 'coding-tool.json'
  $gateDir = Join-Path $outDir 'gate'

  Set-ItemStatus -Queue $q -Id $id -Status 'in_progress'
  Push-Location $targetRepo
  try {
    $fullPrompt = @"
Kritical CodingSystem queue item: $id
Target repo: $targetRepo

Use the Kritical mega-pipeline policy:
- Free/local lanes first for exploration.
- SCX lanes for synthesis and hard debugging.
- No paid-explicit-only providers unless already configured and allowed.
- Use MCP/store/chunk context when available.
- Return exact next actions, files to change, proof commands, and blockers.

Task:
$prompt
"@
    $out = & python (Join-Path $repoRoot 'mux\Invoke-KritAgentSupervisor.py') `
      --mode $runMode `
      --sqlite $db `
      --report $report `
      --task $fullPrompt 2>&1
    $ok = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $report)
    Pop-Location
    $q2 = Read-Queue
    if ($ok) {
      $toolOk = $true
      if ($InvokeTool) {
        $toolPrompt = @"
Use the supervisor report and target repo instructions to continue this Kritical CodingSystem task.

Queue item: $id
Target repo: $targetRepo
Supervisor report: $report

Original task:
$prompt
"@
        $toolOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Invoke-KritCodingTool.ps1') `
          -Mode DryRun `
          -Tool $Tool `
          -RepoPath $targetRepo `
          -Prompt $toolPrompt `
          -ReportPath $toolReport 2>&1
        $toolOk = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $toolReport)
        if ($toolOk) {
          Set-ItemStatus -Queue $q2 -Id $id -Status 'tool_probe_complete' -Report $report
        } else {
          Set-ItemStatus -Queue $q2 -Id $id -Status 'tool_probe_failed' -Report $report -ErrorText (($toolOut | Select-Object -Last 20) -join "`n")
        }
      } else {
        Set-ItemStatus -Queue $q2 -Id $id -Status 'supervisor_reported' -Report $report
      }
      if ($toolOk -and $itemTestCommands.Count -gt 0) {
        $gateOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Invoke-KritCodingGate.ps1') `
          -RepoPath $targetRepo `
          -Command $itemTestCommands `
          -OutDir $gateDir 2>&1
        $gateOk = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $gateDir 'gate-receipt.json'))
        $qGate = Read-Queue
        if ($gateOk) {
          Set-ItemStatus -Queue $qGate -Id $id -Status 'validated_good' -Report $report
        } else {
          Set-ItemStatus -Queue $qGate -Id $id -Status 'failed_gate' -Report $report -ErrorText (($gateOut | Select-Object -Last 30) -join "`n")
        }
      }
      Write-Host "Completed queue item $id -> $report" -ForegroundColor Green
    } else {
      Set-ItemStatus -Queue $q2 -Id $id -Status 'failed' -Report $report -ErrorText (($out | Select-Object -Last 20) -join "`n")
      Write-Host "Failed queue item $id" -ForegroundColor Red
    }
    return $true
  } catch {
    try { Pop-Location } catch {}
    $q3 = Read-Queue
    Set-ItemStatus -Queue $q3 -Id $id -Status 'failed' -ErrorText $_.Exception.Message
    throw
  }
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

if ($Mode -eq 'Stop') {
  Set-Content -LiteralPath $stopFlag -Value ((Get-Date).ToUniversalTime().ToString('o')) -Encoding UTF8
  Write-Host "Stop flag written: $stopFlag" -ForegroundColor Yellow
  return
}

if ($Mode -eq 'Status') {
  $q = Read-Queue
  [pscustomobject]@{
    QueuePath = $QueuePath
    Count = @($q.queue).Count
    Queued = @($q.queue | Where-Object { $_.status -in @('queued','pending',$null,'') }).Count
    StopFlag = (Test-Path -LiteralPath $stopFlag)
    LockPath = $lockPath
    KillSwitch = "pwsh install\Start-KritCodingQueueRunner.ps1 -Mode Stop"
  } | Format-List
  return
}

if (Test-Path -LiteralPath $stopFlag) {
  Remove-Item -LiteralPath $stopFlag -Force
}

@{
  pid = $PID
  started_utc = (Get-Date).ToUniversalTime().ToString('o')
  queue = $QueuePath
} | ConvertTo-Json | Set-Content -LiteralPath $lockPath -Encoding UTF8

Start-OptionalRouters

if ($Mode -eq 'RunOnce') {
  [void](Invoke-One)
  return
}

$iter = 0
while ($true) {
  if (Test-Path -LiteralPath $stopFlag) {
    Write-Host "Stop flag present: $stopFlag" -ForegroundColor Yellow
    break
  }
  $iter++
  [void](Invoke-One)
  if ($MaxIterations -gt 0 -and $iter -ge $MaxIterations) { break }
  Start-Sleep -Seconds $SleepSeconds
}
