#requires -Version 7.0
<#
.SYNOPSIS
  Run explicit validation commands for a Kritical CodingSystem queue item.

.DESCRIPTION
  Executes test/build/proof commands in order, writes JSON and Markdown receipts,
  and returns non-zero if any required command fails.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string] $RepoPath,
  [Parameter(Mandatory)][string[]] $Command,
  [string] $OutDir = (Join-Path (Get-Location).Path 'out\kritical-gate'),
  [int] $TimeoutSec = 900
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoPath).Path
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-GateCommand {
  param([string] $Text, [int] $Index)
  $logPath = Join-Path $OutDir ('gate-{0:00}.log' -f $Index)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'pwsh'
  [void]$psi.ArgumentList.Add('-NoProfile')
  [void]$psi.ArgumentList.Add('-Command')
  [void]$psi.ArgumentList.Add($Text)
  $psi.WorkingDirectory = $repo
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $started = Get-Date
  $p = [System.Diagnostics.Process]::Start($psi)
  $finished = $p.WaitForExit($TimeoutSec * 1000)
  if (-not $finished) {
    try { $p.Kill($true) } catch {}
  }
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $body = @(
    "COMMAND: $Text",
    "STARTED: $($started.ToUniversalTime().ToString('o'))",
    "FINISHED: $((Get-Date).ToUniversalTime().ToString('o'))",
    "EXIT: $(if ($finished) { $p.ExitCode } else { 'TIMEOUT' })",
    '',
    '--- STDOUT ---',
    $stdout,
    '',
    '--- STDERR ---',
    $stderr
  ) -join "`n"
  Set-Content -LiteralPath $logPath -Value $body -Encoding UTF8
  [pscustomobject]@{
    command = $Text
    ok = ($finished -and $p.ExitCode -eq 0)
    exit_code = if ($finished) { $p.ExitCode } else { $null }
    timeout = -not $finished
    log = $logPath
    started_utc = $started.ToUniversalTime().ToString('o')
    finished_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
}

$i = 0
foreach ($cmd in $Command) {
  $i++
  $result = Invoke-GateCommand -Text $cmd -Index $i
  $results.Add($result) | Out-Null
  if (-not $result.ok) { break }
}

$receipt = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  repo = $repo
  ok = -not @($results | Where-Object { -not $_.ok })
  commands = $results
}
$jsonPath = Join-Path $OutDir 'gate-receipt.json'
$mdPath = Join-Path $OutDir 'gate-receipt.md'
$receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$md = @(
  '# Kritical Coding Gate Receipt',
  '',
  ('Repo: `{0}`' -f $repo),
  ('Result: **{0}**' -f $(if ($receipt.ok) { 'PASS' } else { 'FAIL' })),
  '',
  '| Command | Status | Log |',
  '|---|---|---|'
)
foreach ($r in $results) {
  $md += "| `$($r.command)` | $(if ($r.ok) { 'PASS' } else { 'FAIL' }) | `$($r.log)` |"
}
Set-Content -LiteralPath $mdPath -Value ($md -join "`n") -Encoding UTF8

[pscustomobject]@{
  ok = $receipt.ok
  json = $jsonPath
  markdown = $mdPath
  count = $results.Count
}

if (-not $receipt.ok) { exit 1 }
