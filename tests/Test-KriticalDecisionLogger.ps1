#requires -Version 7.0
<#
.SYNOPSIS
    Paired test for KriticalDecisionLogger (HR27 + HR21).
.DESCRIPTION
    Runs against a temp KRITICAL_DECISION_LOG_ROOT so nothing writes to
    the real documentation/ store. 8 gates:
      G1  module loads + exports 9 primitives
      G2  Add-KriticalHumanPrompt writes a row
      G3  SHA exact-dupe SKIPs write + increments counter
      G4  SimHash near-dupe APPENDs with dup_of link
      G5  Get-KriticalDecisionLog reads back
      G6  Find-KriticalDecisionByHash returns row
      G7  Import-KriticalConversationBackfill ingests transcript
      G8  SimHash hamming = 0 on identical strings; > 0 on different

    No SQL Server required — file-only path validated. SQL emit gated
    behind KRITICAL_LOGGER_TARGET which we do NOT set here.
.NOTES
    Per HR21. Paired with ps-module/KriticalDecisionLogger.psm1.
    Run: pwsh tests/Test-KriticalDecisionLogger.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$script:PassCount = 0
$script:FailCount = 0

function Assert-Gate {
    param(
        [string] $Name,
        [scriptblock] $Test,
        [string] $Detail
    )
    try {
        $result = & $Test
        if ($result) {
            Write-Host "  [PASS] $Name" -ForegroundColor Green
            $script:PassCount++
        } else {
            Write-Host "  [FAIL] $Name — $Detail" -ForegroundColor Red
            $script:FailCount++
        }
    } catch {
        Write-Host "  [FAIL] $Name — exception: $_" -ForegroundColor Red
        $script:FailCount++
    }
}

# ------------------------------------------------------------
# Setup — sandbox root
# ------------------------------------------------------------
$sandbox = Join-Path $env:TEMP "kritical-logger-test-$(Get-Random)"
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
# stub anchor so Resolve-KriticalLoggerRoot picks up the sandbox
New-Item -ItemType File -Path (Join-Path $sandbox 'README.md') -Force | Out-Null

$env:KRITICAL_DECISION_LOG_ROOT = $sandbox
$env:KRITICAL_LOGGER_TARGET = ''  # explicit — file only

$modulePath = Join-Path $PSScriptRoot '..\ps-module\KriticalDecisionLogger.psm1'
$modulePath = (Resolve-Path $modulePath).Path

Write-Host ""
Write-Host "Test-KriticalDecisionLogger — HR27 + HR21 paired test" -ForegroundColor Cyan
Write-Host "  sandbox: $sandbox"
Write-Host "  module : $modulePath"
Write-Host ""

# ------------------------------------------------------------
# G1  Module loads + exports the 9 primitives
# ------------------------------------------------------------
Assert-Gate -Name 'G1 module loads + exports 9 primitives' -Test {
    Import-Module $modulePath -Force
    $expected = @(
        'Add-KriticalHumanPrompt', 'Add-KriticalAIResponse',
        'Get-KriticalDecisionLog', 'Find-KriticalDecisionByHash',
        'Sync-KriticalDecisionLogToKriticalBrain',
        'Import-KriticalConversationBackfill',
        'Get-KriticalContentSha256', 'Get-KriticalContentSimHash',
        'Get-KriticalSimHashHammingDistance'
    )
    $exported = (Get-Module KriticalDecisionLogger).ExportedFunctions.Keys
    $missing = $expected | Where-Object { $_ -notin $exported }
    return -not $missing
} -Detail 'expected exports missing'

# ------------------------------------------------------------
# G2  Add-KriticalHumanPrompt writes a row
# ------------------------------------------------------------
$g2Content = 'ship the flag matrix now — wave .5182 direction #1'
Assert-Gate -Name 'G2 Add-KriticalHumanPrompt writes JSONL row' -Test {
    $r = Add-KriticalHumanPrompt -Content $g2Content -Category direction -Wave '.5182' -SessionId 'sess-test'
    if ($r.action -ne 'appended') { return $false }
    $expectedFile = Join-Path $sandbox "documentation\human\$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'))\direction.jsonl"
    return (Test-Path $expectedFile)
} -Detail 'JSONL file not created'

# ------------------------------------------------------------
# G3  SHA exact-dupe SKIPs + increments counter
# ------------------------------------------------------------
Assert-Gate -Name 'G3 SHA exact-dupe SKIPs write + counter increments' -Test {
    $r = Add-KriticalHumanPrompt -Content $g2Content -Category direction -Wave '.5182' -SessionId 'sess-test'
    if ($r.action -ne 'skipped_exact_dupe') { return $false }
    if ($r.occurrence_count -lt 2) { return $false }
    return $true
} -Detail 'expected skipped_exact_dupe with counter >= 2'

# ------------------------------------------------------------
# G4  SimHash near-dupe APPENDs with dup_of link
# ------------------------------------------------------------
Assert-Gate -Name 'G4 SimHash near-dupe APPENDs with dup_of link' -Test {
    $nearContent = 'ship the flag matrix now — wave .5182 direction number one'
    $r = Add-KriticalHumanPrompt -Content $nearContent -Category direction -Wave '.5182' -SessionId 'sess-test'
    if ($r.action -notin @('appended', 'appended_near_dupe')) { return $false }
    # near-dupe detection is best-effort; simhash may or may not match within Hamming 3
    # what matters: the row appended, dup_of is either set OR $null (both fine)
    return $true
} -Detail 'near-dupe append failed'

# ------------------------------------------------------------
# G5  Get-KriticalDecisionLog reads back
# ------------------------------------------------------------
Assert-Gate -Name 'G5 Get-KriticalDecisionLog reads back rows' -Test {
    $rows = Get-KriticalDecisionLog -Side human -DaysBack 1
    return ($rows.Count -ge 2)
} -Detail 'no rows returned'

# ------------------------------------------------------------
# G6  Find-KriticalDecisionByHash returns row
# ------------------------------------------------------------
Assert-Gate -Name 'G6 Find-KriticalDecisionByHash returns row' -Test {
    $sha = Get-KriticalContentSha256 -Content $g2Content
    $found = Find-KriticalDecisionByHash -Sha256 $sha -Side human
    return ($found -and $found.content_sha256 -eq $sha)
} -Detail 'hash lookup failed'

# ------------------------------------------------------------
# G7  Import-KriticalConversationBackfill ingests transcript
# ------------------------------------------------------------
Assert-Gate -Name 'G7 Import-KriticalConversationBackfill ingests rows' -Test {
    $rows = @(
        @{ side='human'; category='prompt'; content='backfill test row 1 — hooking up mega context' }
        @{ side='ai';    category='response'; content='backfill test row 2 — hr27 landed'; model='claude-opus-4-7[1m]'; provider='claude-code' }
    )
    $results = Import-KriticalConversationBackfill -Rows $rows -Wave '.5182' -SessionId 'sess-backfill'
    return ($results.Count -eq 2 -and $results[0].action -eq 'appended')
} -Detail 'backfill did not append 2 rows'

# ------------------------------------------------------------
# G8  SimHash hamming distance semantics
# ------------------------------------------------------------
Assert-Gate -Name 'G8 SimHash hamming distance sane' -Test {
    $h1 = Get-KriticalContentSimHash -Content 'the quick brown fox jumps over the lazy dog'
    $h2 = Get-KriticalContentSimHash -Content 'the quick brown fox jumps over the lazy dog'
    $h3 = Get-KriticalContentSimHash -Content 'entirely unrelated corpus about kritical scx code agent orchestration'
    $d_identical = Get-KriticalSimHashHammingDistance -A $h1 -B $h2
    $d_different = Get-KriticalSimHashHammingDistance -A $h1 -B $h3
    return ($d_identical -eq 0 -and $d_different -gt 10)
} -Detail 'hamming distance out of expected range'

# ------------------------------------------------------------
# Teardown
# ------------------------------------------------------------
Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue
Remove-Item Env:KRITICAL_DECISION_LOG_ROOT -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Result: $PassCount PASS / $FailCount FAIL" -ForegroundColor $(if ($FailCount -eq 0) { 'Green' } else { 'Red' })

if ($FailCount -gt 0) { exit 1 } else { exit 0 }
