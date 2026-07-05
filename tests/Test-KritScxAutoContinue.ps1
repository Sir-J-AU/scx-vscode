#requires -Version 7.0
<#
.SYNOPSIS
    Paired test for Kritical.PS.SCXCode.AutoContinue (HR21 + HR28).
.DESCRIPTION
    Exercises the auto-continuation module without making a live SCX call.
    Uses a fake single-turn shim that returns pre-scripted chunks so we can
    prove:
      G1  module imports + exports 7 primitives
      G2  natural-terminator regex accepts complete sentences
      G3  natural-terminator regex rejects mid-sentence cut-offs
      G4  natural-terminator regex rejects chunks near per-turn ceiling
      G5  Remove-KritScxDuplicateParagraphs drops adjacent duplicates
      G6  Remove-KritScxDuplicateParagraphs preserves non-adjacent duplicates
      G7  Get-KritScxResponseText handles Anthropic-shape (content array)
      G8  Get-KritScxResponseText handles OpenAI-shape (choices array)
      G9  Get-KritScxStopReason handles both envelope shapes
      G10 Show-KriticalSCXCodeBanner is idempotent (second call is no-op)
.NOTES
    Per HR21. Paired with ps-module/Kritical.PS.SCXCode.AutoContinue.psm1.
    Run: pwsh tests/Test-KritScxAutoContinue.ps1
    Live SCX calls are OUT of scope for this test — see
    tests/Test-KritScxAutoContinue-Live.ps1 (queued) for that.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
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

$modulePath = Join-Path $PSScriptRoot '..\ps-module\Kritical.PS.SCXCode.AutoContinue.psm1'
$modulePath = (Resolve-Path $modulePath).Path
$loggerPath = Join-Path $PSScriptRoot '..\ps-module\KriticalDecisionLogger.psm1'
$loggerPath = (Resolve-Path $loggerPath).Path

Write-Host ''
Write-Host 'Test-KritScxAutoContinue — HR21 + HR28 paired test' -ForegroundColor Cyan
Write-Host "  module: $modulePath"
Write-Host ''

# ------------------------------------------------------------
# G1  Module imports + exports 7 primitives
# ------------------------------------------------------------
Assert-Gate -Name 'G1 module imports + exports 7 primitives' -Test {
    Import-Module $loggerPath -Force
    Import-Module $modulePath -Force
    $expected = @(
        'Invoke-KritScxAutoContinue',
        'Invoke-KritScxSingleTurn',
        'Show-KriticalSCXCodeBanner',
        'Test-KritScxNaturalTerminator',
        'Remove-KritScxDuplicateParagraphs',
        'Get-KritScxResponseText',
        'Get-KritScxStopReason'
    )
    $exported = (Get-Module 'Kritical.PS.SCXCode.AutoContinue').ExportedFunctions.Keys
    $missing = $expected | Where-Object { $_ -notin $exported }
    return -not $missing
} -Detail 'expected exports missing'

# ------------------------------------------------------------
# G2  Natural terminator accepts complete sentence
# ------------------------------------------------------------
Assert-Gate -Name 'G2 natural terminator accepts complete sentence' -Test {
    Test-KritScxNaturalTerminator -Chunk 'This response ends cleanly.' -PerTurnCeiling 8192
} -Detail 'expected True for period-terminated chunk'

# ------------------------------------------------------------
# G3  Natural terminator rejects mid-sentence cut-off
# ------------------------------------------------------------
Assert-Gate -Name 'G3 natural terminator rejects mid-sentence cut-off' -Test {
    -not (Test-KritScxNaturalTerminator -Chunk 'This gets cut off mid way and the model was' -PerTurnCeiling 8192)
} -Detail 'expected False for chunk without terminator'

# ------------------------------------------------------------
# G4  Natural terminator rejects near-ceiling chunk (likely cut by limit)
# ------------------------------------------------------------
Assert-Gate -Name 'G4 natural terminator rejects near-ceiling chunk' -Test {
    # build a chunk that ends with a period but is ~7000 chars (close to 8192/4*4 = 8192 tokens)
    $sentence = 'This is a plausible-looking sentence that ends with a period. '
    $filler = $sentence * 500  # ~30000 chars, way over ceiling
    -not (Test-KritScxNaturalTerminator -Chunk $filler -PerTurnCeiling 8192)
} -Detail 'expected False for chunk near per-turn ceiling'

# ------------------------------------------------------------
# G5  Remove-KritScxDuplicateParagraphs drops adjacent duplicates
# ------------------------------------------------------------
Assert-Gate -Name 'G5 dedup drops adjacent duplicate paragraphs' -Test {
    $para = 'This is a long enough paragraph to survive the short-filter threshold in the dedup pass and should be deduped when adjacent.'
    $text = "$para`n`n$para`n`nA distinct paragraph following the dupes should survive because it's not a near-match to the para before it."
    $out = Remove-KritScxDuplicateParagraphs -Text $text
    # should be strictly shorter than input
    return $out.Length -lt $text.Length
} -Detail 'expected adjacent dupes collapsed'

# ------------------------------------------------------------
# G6  Remove-KritScxDuplicateParagraphs preserves non-adjacent duplicates
# ------------------------------------------------------------
Assert-Gate -Name 'G6 dedup preserves non-adjacent duplicates' -Test {
    $para = 'A repeatable paragraph long enough to be considered for dedup — this exceeds the short threshold cleanly.'
    $other = 'A totally different intermediate paragraph that breaks the adjacency check between the two duplicates that follow.'
    $text = "$para`n`n$other`n`n$para"
    $out = Remove-KritScxDuplicateParagraphs -Text $text
    # length should be preserved (± minor whitespace normalisation)
    return $out.Length -ge ($text.Length - 5)
} -Detail 'expected non-adjacent dupes preserved'

# ------------------------------------------------------------
# G7  Get-KritScxResponseText handles Anthropic shape
# ------------------------------------------------------------
Assert-Gate -Name 'G7 response-text extraction — Anthropic shape' -Test {
    $envelope = [pscustomobject]@{
        content = @(
            [pscustomobject]@{ type = 'text'; text = 'Hello from Anthropic shape.' }
        )
    }
    $t = Get-KritScxResponseText -Response $envelope
    return $t -eq 'Hello from Anthropic shape.'
} -Detail 'expected extraction from content array'

# ------------------------------------------------------------
# G8  Get-KritScxResponseText handles OpenAI shape
# ------------------------------------------------------------
Assert-Gate -Name 'G8 response-text extraction — OpenAI shape' -Test {
    $envelope = [pscustomobject]@{
        choices = @(
            [pscustomobject]@{
                message = [pscustomobject]@{ content = 'Hello from OpenAI shape.' }
            }
        )
    }
    $t = Get-KritScxResponseText -Response $envelope
    return $t -eq 'Hello from OpenAI shape.'
} -Detail 'expected extraction from choices array'

# ------------------------------------------------------------
# G9  Get-KritScxStopReason handles both shapes
# ------------------------------------------------------------
Assert-Gate -Name 'G9 stop-reason extraction — both shapes' -Test {
    $anthropic = [pscustomobject]@{ stop_reason = 'end_turn' }
    $openai = [pscustomobject]@{
        choices = @(
            [pscustomobject]@{ finish_reason = 'stop' }
        )
    }
    (Get-KritScxStopReason -Response $anthropic) -eq 'end_turn' `
        -and (Get-KritScxStopReason -Response $openai) -eq 'stop'
} -Detail 'expected canonical stop reason from each shape'

# ------------------------------------------------------------
# G10 Show-KriticalSCXCodeBanner is idempotent
# ------------------------------------------------------------
Assert-Gate -Name 'G10 banner idempotent (second call no-op)' -Test {
    # capture output of two calls; banner state persists via $script scope
    $first = & {
        # reset the guard so we can capture the first-emit output
        (Get-Module 'Kritical.PS.SCXCode.AutoContinue').SessionState.PSVariable.Set('KriticalSCXCodeBannerEmitted', $false)
        Show-KriticalSCXCodeBanner 6>&1 | Out-String
    }
    $second = & {
        Show-KriticalSCXCodeBanner 6>&1 | Out-String
    }
    # first call should emit at least one banner line; second should be empty
    ($first.Length -gt 0) -and ($second.Length -eq 0)
} -Detail 'expected banner emit once then silent'

# ------------------------------------------------------------
Write-Host ''
Write-Host "Result: $PassCount PASS / $FailCount FAIL" -ForegroundColor $(if ($FailCount -eq 0) { 'Green' } else { 'Red' })

if ($FailCount -gt 0) { exit 1 } else { exit 0 }
