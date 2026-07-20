#requires -Version 7.0
<#
.SYNOPSIS
  End-to-end proof harness for Kritical.SCXCode free-router + SCX-native agent packs.

.DESCRIPTION
  Offline by default: validates registry correctness, secret loader parsing,
  agent-pack manifests, SQLite backing store, supervisor dry-run, Python syntax,
  PowerShell syntax, and VS Code build. Use -Live to add bounded live probes.

.NOTES
  Author: Joshua Finley — (c) 2026 Kritical Pty Ltd. All rights reserved.
#>
[CmdletBinding()]
param(
  [switch] $Live,
  [switch] $SkipBuild,
  [string] $ProofDb = (Join-Path $env:TEMP 'kritical-scxcode-e2e-proof.db'),
  [string] $Report = (Join-Path (Split-Path -Parent $PSScriptRoot) 'out\e2e-proof.md')
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pass = 0
$fail = 0
$skip = 0
$rows = [System.Collections.Generic.List[object]]::new()

function Add-Result {
  param([string] $Name, [string] $Status, [string] $Detail = '')
  $rows.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail }) | Out-Null
  switch ($Status) {
    'PASS' { $script:pass++; Write-Host "  PASS $Name" -ForegroundColor Green }
    'SKIP' { $script:skip++; Write-Host "  SKIP $Name $Detail" -ForegroundColor DarkGray }
    default { $script:fail++; Write-Host "  FAIL $Name $Detail" -ForegroundColor Red }
  }
}

function Remove-Ansi {
  param([string] $Text)
  if ($null -eq $Text) { return '' }
  return ($Text -replace "`e\[[0-9;]*m", '')
}

function Test-PowerShellParse {
  param([string] $Path)
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  return @($errors).Count -eq 0
}

Push-Location $repoRoot
try {
  Write-Host 'Kritical SCXCode E2E Proof' -ForegroundColor Cyan

  $registryTest = & pwsh -NoProfile -File (Join-Path $repoRoot 'tests\Test-KritFreeRouterRegistry.ps1') 2>&1
  Add-Result 'free provider registry paired test' ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })) (($registryTest | Select-Object -Last 3) -join ' ')

  foreach ($path in @(
    'free-router\scripts\Import-KritSecretsToEnv.ps1',
    'free-router\scripts\Install-KritAgentPack.ps1',
    'free-router\scripts\Start-KritFreeRouter.ps1',
    'free-router\scripts\Update-KritOpenRouterFreeModels.ps1',
    'free-router\scripts\Export-KritModelParameterMatrix.ps1',
    'free-router\scripts\Invoke-KritOpenRouterBatch.ps1',
    'free-router\scripts\Test-KritOpenRouterPath.ps1',
    'install\Add-KritAgenticRepo.ps1',
    'install\Initialize-KritScxBackingStore.ps1',
    'install\Install-KritAiCLIs.ps1',
    'install\Invoke-KritCodingTool.ps1',
    'install\Invoke-KritCodingSystem.ps1',
    'install\Invoke-KritCodingGate.ps1',
    'install\Start-KritCodingQueueRunner.ps1',
    'install\Test-KritCodingSystem.ps1',
    'install\Test-KritPythonEnvironment.ps1',
    'mux\Invoke-KritScxMux.ps1'
  )) {
    Add-Result "PowerShell parses $path" ($(if (Test-PowerShellParse (Join-Path $repoRoot $path)) { 'PASS' } else { 'FAIL' }))
  }

  foreach ($module in @(
    'ps-module\Kritical.PS.NodeClientAPI.psm1'
  )) {
    Add-Result "PowerShell parses $module" ($(if (Test-PowerShellParse (Join-Path $repoRoot $module)) { 'PASS' } else { 'FAIL' }))
  }

  foreach ($json in @(
    'free-router\config\free-providers-registry.json',
    'free-router\agent-packs\kritical-free-router.agent-pack.json',
    'free-router\agent-packs\scx-native.agent-pack.json',
    'free-router\agent-packs\kritical-agentic-mega-pipeline.agent-pack.json',
    'free-router\agent-packs\kritical-mcp-tools.bundle.json',
    'free-router\config\free-agentic-model-catalog.json',
    'free-router\config\coding-tool-runtime-registry.json',
    'free-router\agents\deepcode.config.json'
  )) {
    try {
      Get-Content -LiteralPath (Join-Path $repoRoot $json) -Raw | ConvertFrom-Json | Out-Null
      Add-Result "JSON parses $json" 'PASS'
    } catch {
      Add-Result "JSON parses $json" 'FAIL' $_.Exception.Message
    }
  }

  $pyCompile = & python -B -m py_compile `
    (Join-Path $repoRoot 'mux\Invoke-KritAgentSupervisor.py') `
    (Join-Path $repoRoot 'mux\Invoke-KritScxMuxMatrix.py') 2>&1
  Add-Result 'Python supervisor/matrix compile' ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })) (($pyCompile | Select-Object -Last 5) -join ' ')

  $init = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Initialize-KritScxBackingStore.ps1') -Mode Install -SqlitePath $ProofDb 2>&1
  Add-Result 'SQLite backing store initializes' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $ProofDb)) { 'PASS' } else { 'FAIL' })) (($init | Select-Object -Last 3) -join ' ')

  $supervisorReport = Join-Path $env:TEMP 'kritical-scxcode-supervisor-proof.md'
  $supervisor = & python (Join-Path $repoRoot 'mux\Invoke-KritAgentSupervisor.py') `
    --mode dry-run `
    --sqlite $ProofDb `
    --report $supervisorReport `
    -q 'Validate the mixed free-router plus SCX-native supervisor lane contract.' 2>&1
  Add-Result 'mixed supervisor dry-run validates both planes' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $supervisorReport)) { 'PASS' } else { 'FAIL' })) (($supervisor | Select-Object -Last 5) -join ' ')

  foreach ($pack in @('kritical-free-router','scx-native','kritical-agentic-mega-pipeline')) {
    $packOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'free-router\scripts\Install-KritAgentPack.ps1') -Mode Install -Pack $pack 2>&1
    Add-Result "agent pack installs $pack" ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })) (($packOut | Select-Object -Last 2) -join ' ')
  }

  $tmpRepo = Join-Path $env:TEMP 'kritical-scxcode-agentic-repo-proof'
  if (Test-Path -LiteralPath $tmpRepo) {
    $resolvedTmp = (Resolve-Path -LiteralPath $tmpRepo).Path
    $resolvedTempRoot = (Resolve-Path -LiteralPath $env:TEMP).Path
    if (-not $resolvedTmp.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove temp proof path outside TEMP: $resolvedTmp"
    }
    Remove-Item -LiteralPath $resolvedTmp -Recurse -Force
  }
  New-Item -ItemType Directory -Path $tmpRepo -Force | Out-Null
  & git -C $tmpRepo init 2>&1 | Out-Null
  $repoAdd = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Add-KritAgenticRepo.ps1') -RepoPath $tmpRepo -Pack mega 2>&1
  $repoProofOk = $LASTEXITCODE -eq 0 -and
    (Test-Path -LiteralPath (Join-Path $tmpRepo '.kritical\AGENT-INSTRUCTIONS.md')) -and
    (Test-Path -LiteralPath (Join-Path $tmpRepo '.kritical\mcp\mcp-tools.bundle.json')) -and
    (Test-Path -LiteralPath (Join-Path $tmpRepo '.kritical\supervisor\run-supervisor.ps1'))
  Add-Result 'target repo agentic bootstrap writes instructions and MCP bundle' ($(if ($repoProofOk) { 'PASS' } else { 'FAIL' })) (($repoAdd | Select-Object -Last 5) -join ' ')

  $systemStatusPath = Join-Path $env:TEMP 'kritical-coding-system-status.json'
  $systemStatus = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Test-KritCodingSystem.ps1') -ReportPath $systemStatusPath 2>&1
  Add-Result 'Kritical CodingSystem readiness checker emits JSON' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $systemStatusPath)) { 'PASS' } else { 'FAIL' })) (($systemStatus | Select-Object -Last 3) -join ' ')

  $queuePath = Join-Path $env:TEMP 'kritical-coding-queue-proof.json'
  $queueObj = @{
    queue = @(
      @{
        id = 'E2E-QUEUE-001'
        status = 'queued'
        repo = $repoRoot
        prompt = 'Dry-run proof that the Kritical CodingSystem queue runner can invoke supervisor lanes.'
        mode = 'dry-run'
      }
    )
  }
  $queueObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $queuePath -Encoding UTF8
  $queueOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1') -Mode RunOnce -QueuePath $queuePath 2>&1
  $queueAfter = Get-Content -LiteralPath $queuePath -Raw | ConvertFrom-Json
  $queueOk = $LASTEXITCODE -eq 0 -and @($queueAfter.queue)[0].status -eq 'supervisor_reported'
  Add-Result 'Kritical CodingSystem queue runner drains one dry-run task' ($(if ($queueOk) { 'PASS' } else { 'FAIL' })) (($queueOut | Select-Object -Last 5) -join ' ')

  $toolProbeReport = Join-Path $env:TEMP 'kritical-coding-tool-probe.json'
  $toolProbe = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Invoke-KritCodingTool.ps1') -Mode DryRun -Tool auto -RepoPath $repoRoot -ReportPath $toolProbeReport 2>&1
  Add-Result 'coding tool executable probe emits report' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $toolProbeReport)) { 'PASS' } else { 'FAIL' })) (($toolProbe | Select-Object -Last 5) -join ' ')

  $queueToolPath = Join-Path $env:TEMP 'kritical-coding-queue-tool-proof.json'
  $queueToolObj = @{
    queue = @(
      @{
        id = 'E2E-TOOL-001'
        status = 'queued'
        repo = $repoRoot
        prompt = 'Dry-run proof that the queue runner can probe real coding tool executables after supervisor reporting.'
        mode = 'dry-run'
      }
    )
  }
  $queueToolObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $queueToolPath -Encoding UTF8
  $queueToolOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1') -Mode RunOnce -QueuePath $queueToolPath -InvokeTool -Tool auto 2>&1
  $queueToolAfter = Get-Content -LiteralPath $queueToolPath -Raw | ConvertFrom-Json
  $queueToolOk = $LASTEXITCODE -eq 0 -and @($queueToolAfter.queue)[0].status -eq 'tool_probe_complete'
  Add-Result 'queue runner probes local coding tool executables' ($(if ($queueToolOk) { 'PASS' } else { 'FAIL' })) (($queueToolOut | Select-Object -Last 5) -join ' ')

  $queueGatePath = Join-Path $env:TEMP 'kritical-coding-queue-gate-proof.json'
  $queueGateObj = @{
    queue = @(
      @{
        id = 'E2E-GATE-001'
        status = 'queued'
        repo = $repoRoot
        prompt = 'Dry-run proof that test commands gate queue completion.'
        mode = 'dry-run'
        test_commands = @('pwsh -NoProfile -Command "exit 0"')
      }
    )
  }
  $queueGateObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $queueGatePath -Encoding UTF8
  $queueGateOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Start-KritCodingQueueRunner.ps1') -Mode RunOnce -QueuePath $queueGatePath 2>&1
  $queueGateAfter = Get-Content -LiteralPath $queueGatePath -Raw | ConvertFrom-Json
  $queueGateOk = $LASTEXITCODE -eq 0 -and @($queueGateAfter.queue)[0].status -eq 'validated_good'
  Add-Result 'queue runner marks validated_good only after gate passes' ($(if ($queueGateOk) { 'PASS' } else { 'FAIL' })) (($queueGateOut | Select-Object -Last 5) -join ' ')

  $matrixOut = & pwsh -NoProfile -File (Join-Path $repoRoot 'free-router\scripts\Export-KritModelParameterMatrix.ps1') 2>&1
  $matrixOk = $LASTEXITCODE -eq 0 -and
    (Test-Path -LiteralPath (Join-Path $repoRoot 'out\model-parameter-matrix.json')) -and
    (Test-Path -LiteralPath (Join-Path $repoRoot 'docs\MODEL-PARAMETER-MATRIX.md'))
  Add-Result 'model parameter matrix exports' ($(if ($matrixOk) { 'PASS' } else { 'FAIL' })) (($matrixOut | Select-Object -Last 5) -join ' ')

  $pyAuditPath = Join-Path $env:TEMP 'kritical-python-env-audit.json'
  $pyAudit = & pwsh -NoProfile -File (Join-Path $repoRoot 'install\Test-KritPythonEnvironment.ps1') -ReportPath $pyAuditPath 2>&1
  Add-Result 'Python environment audit emits JSON' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $pyAuditPath)) { 'PASS' } else { 'FAIL' })) (($pyAudit | Select-Object -Last 5) -join ' ')

  $orBatchDir = Join-Path $env:TEMP 'kritical-openrouter-batch-proof'
  $orBatch = & pwsh -NoProfile -File (Join-Path $repoRoot 'free-router\scripts\Invoke-KritOpenRouterBatch.ps1') -Prompt 'dry-run proof' -Models 'qwen/qwen3-coder:free' -OutDir $orBatchDir 2>&1
  Add-Result 'OpenRouter batch offload dry-run emits receipts' ($(if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $orBatchDir 'summary.json'))) { 'PASS' } else { 'FAIL' })) (($orBatch | Select-Object -Last 5) -join ' ')

  $orProofPath = Join-Path $env:TEMP 'kritical-openrouter-path-proof.json'
  $orKey = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'Process')
  if (-not $orKey) { $orKey = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User') }
  if (-not $orKey) {
    Add-Result 'direct OpenRouter free path proves zero-price model and optional chat' 'SKIP' 'OPENROUTER_API_KEY absent; run free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly to enable this optional lane'
  } else {
    $orProofArgs = @('-NoProfile','-File',(Join-Path $repoRoot 'free-router\scripts\Test-KritOpenRouterPath.ps1'),'-OutPath',$orProofPath)
    if (-not $Live) { $orProofArgs += '-SkipChat' }
    $orProof = & pwsh @orProofArgs 2>&1
    $orProofJson = if (Test-Path -LiteralPath $orProofPath) { Get-Content -LiteralPath $orProofPath -Raw | ConvertFrom-Json } else { $null }
    $orProofOk = $LASTEXITCODE -eq 0 -and $orProofJson -and $orProofJson.model_found -and $orProofJson.zero_price -and ((-not $Live) -or $orProofJson.chat_ok)
    Add-Result 'direct OpenRouter free path proves zero-price model and optional chat' ($(if ($orProofOk) { 'PASS' } else { 'FAIL' })) (($orProof | Select-Object -Last 5) -join ' ')
  }

  if (-not $SkipBuild) {
    $build = & npm --prefix (Join-Path $repoRoot 'src') run build 2>&1
    Add-Result 'VS Code extension builds' ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })) (($build | Select-Object -Last 5) -join ' ')
  } else {
    Add-Result 'VS Code extension builds' 'SKIP' '-SkipBuild supplied'
  }

  if ($Live) {
    $scxKey = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
    if ($scxKey) {
      $env:SCX_API_KEY = $scxKey
      $liveOutput = & node (Join-Path $repoRoot 'tests\Test-KritScxLiveSurface.mjs') --live 2>&1
      Add-Result 'live SCX surface probe' ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })) (($liveOutput | Select-Object -Last 5) -join ' ')
    } else {
      Add-Result 'live SCX surface probe' 'SKIP' 'SCX_API_KEY absent in HKCU'
    }
  } else {
    Add-Result 'live SCX surface probe' 'SKIP' 'run with -Live'
  }

  New-Item -ItemType Directory -Path (Split-Path $Report) -Force | Out-Null
  $md = @(
    '# Kritical SCXCode E2E Proof',
    '',
    ('Generated UTC: {0}' -f (Get-Date).ToUniversalTime().ToString('o')),
    '',
    '| Check | Status | Detail |',
    '|---|---|---|'
  )
  foreach ($row in $rows) {
    $detail = (Remove-Ansi $row.Detail) -replace 'System\.Management\.Automation\.RemoteException','' -replace '\|','/' -replace "`r?`n",' '
    $md += "| $($row.Name) | $($row.Status) | $detail |"
  }
  $md += ''
  $md += "Summary: $pass passed, $fail failed, $skip skipped."
  Set-Content -LiteralPath $Report -Value ($md -join "`n") -Encoding UTF8
  Write-Host "Proof report: $Report" -ForegroundColor Cyan
}
finally {
  Pop-Location
}

Write-Host "`n$pass passed, $fail failed, $skip skipped" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit $fail
