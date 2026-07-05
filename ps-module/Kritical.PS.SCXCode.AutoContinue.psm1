#Requires -Version 7
<#
.SYNOPSIS
    Kritical.PS.SCXCode.AutoContinue — multi-turn auto-continuation for SCX
    responses so a single logical answer can span many API turns.

.DESCRIPTION
    SCX enforces a per-turn max_tokens ceiling. This module loops SCX with
    a polite "continue verbatim, no meta" prompt after each partial reply,
    respects natural terminators (period / question / bracket / fence
    close) as a stop signal, dedups near-duplicate paragraphs via SimHash,
    and returns ONE merged markdown string plus a single HR27 write-through
    row (not N fragments).

    Sibling of Kritical.PS.SCXCode.psm1 — the base module handles single-turn
    calls, model listing, embeddings, etc. Import both.

.CONTRACT
    inputs:
      - Prompt        (required)
      - Model         (default from Get-KritScxConfig)
      - MaxContinues  (default 10)
      - PerTurnCeiling(default 8192)
      - SystemPrompt  (optional)
      - SessionId     (optional — HR27 conversation grouping)
      - Wave          (optional — Kritical wave tag)
    outputs:
      - Single merged response string (or PSObject envelope via -PassThru)
      - HR27 row appended to documentation/ai/<yyyy-mm-dd>/response.jsonl
      - Kritical brand banner emitted once per PS session (non-intrusive)
    sideEffects:
      - Zero disk writes outside HR27 store
      - Zero global env writes
    invariants:
      - No single SCX call exceeds PerTurnCeiling
      - Response merge removes adjacent near-duplicate paragraphs (SimHash Hamming <= 3)
      - Loop terminates on: natural terminator + non-full-length chunk,
        OR explicit end_turn / stop_reason,
        OR MaxContinues cap

.EXAMPLE
    Invoke-KritScxAutoContinue -Prompt "Write a comprehensive architecture doc for X" `
        -Model coder -MaxContinues 10

.EXAMPLE
    $r = Invoke-KritScxAutoContinue -Prompt $bigTask -PassThru
    $r.MergedResponse
    $r.TurnCount
    $r.StopReason
    $r.TotalTokensApprox

.NOTES
    Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
    Contact: sales@kritical.net — ph. 1300 274 655
    Per HR27 (.5182) — auto-logs to documentation/ai/.
    Per HR28 (.5183) — descriptive naming, no operator metaphors in identifiers.
#>

# -----------------------------------------------------------------------------
# Non-intrusive Kritical brand banner (once per PS session)
# -----------------------------------------------------------------------------

$script:KriticalSCXCodeBannerEmitted = $false

function Show-KriticalSCXCodeBanner {
    <#
    .SYNOPSIS
        Emit the Kritical.SCXCode brand banner once per PS session.
        Idempotent — subsequent calls are no-ops.
    #>
    [CmdletBinding()]
    param()
    if ($script:KriticalSCXCodeBannerEmitted) { return }
    $script:KriticalSCXCodeBannerEmitted = $true

    # try canonical banner from OneDrive first, then bundled asset, then plain-text fallback
    $bannerPaths = @(
        (Join-Path $env:USERPROFILE 'OneDrive - Kritical Pty Ltd\Kritical-Branding\public\KriticalLogo.txt'),
        (Join-Path $env:USERPROFILE 'OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos\KriticalLogo.txt'),
        (Join-Path $PSScriptRoot '../Assets/kritical-logo.txt')
    )
    $banner = $null
    foreach ($p in $bannerPaths) {
        if (Test-Path $p) {
            try { $banner = Get-Content -LiteralPath $p -Raw; break } catch {}
        }
    }

    if ($banner) {
        Write-Host $banner -ForegroundColor Cyan
    } else {
        Write-Host ''
        Write-Host '  Kritical.SCXCode — sovereign AI coding on Southern Cross AI' -ForegroundColor Cyan
        Write-Host '  Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655' -ForegroundColor DarkCyan
        Write-Host ''
    }
}

# -----------------------------------------------------------------------------
# Natural-terminator heuristic + SimHash near-dupe pass
# -----------------------------------------------------------------------------

$script:SCXNaturalTerminatorRegex = '(?<=\S)(?:\.\s*$|\?\s*$|!\s*$|```\s*$|---\s*$|\}\s*$|>\s*$)'

function Test-KritScxNaturalTerminator {
    <#
    .SYNOPSIS
        Return $true if the chunk ends with a natural end-of-response marker
        AND is short enough that the model likely stopped naturally rather
        than from hitting the per-turn token ceiling.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Chunk,
        [Parameter(Mandatory)] [int]    $PerTurnCeiling
    )
    $trimmed = $Chunk.TrimEnd()
    if ($trimmed -notmatch $script:SCXNaturalTerminatorRegex) { return $false }
    # if chunk is close to the ceiling, the model likely stopped from limit, not naturally
    $approxTokens = [math]::Ceiling($Chunk.Length / 4.0)
    if ($approxTokens -ge (0.8 * $PerTurnCeiling)) { return $false }
    return $true
}

function Remove-KritScxDuplicateParagraphs {
    <#
    .SYNOPSIS
        Post-merge pass — drop paragraph blocks that repeat the immediately-
        prior paragraph via SimHash Hamming <= 3.
    .DESCRIPTION
        Only removes ADJACENT duplicates (a paragraph that near-matches the
        one right before it). Non-adjacent repeats are preserved because they
        often carry different context.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Text
    )

    # try to reuse the logger's SimHash if available
    $loggerLoaded = Get-Module KriticalDecisionLogger -ErrorAction SilentlyContinue
    if (-not $loggerLoaded) {
        $modPath = Join-Path $PSScriptRoot 'KriticalDecisionLogger.psm1'
        if (Test-Path $modPath) {
            try { Import-Module $modPath -Force -ErrorAction Stop; $loggerLoaded = $true } catch {}
        }
    }

    $paragraphs = [regex]::Split($Text, '(?m)\r?\n\s*\r?\n')
    if ($paragraphs.Count -lt 2) { return $Text }

    $kept = New-Object System.Collections.Generic.List[string]
    $prevSimHash = $null

    foreach ($p in $paragraphs) {
        $pTrim = $p.Trim()
        if ($pTrim.Length -lt 40) {
            # too short to meaningfully dedup, keep as-is
            $kept.Add($p)
            $prevSimHash = $null
            continue
        }

        if ($loggerLoaded) {
            try {
                $h = Get-KriticalContentSimHash -Content $pTrim
                if ($prevSimHash) {
                    $d = Get-KriticalSimHashHammingDistance -A $prevSimHash -B $h
                    if ($d -le 3) { continue }  # drop near-dupe
                }
                $prevSimHash = $h
            } catch {
                # fall back to exact-match
                if ($kept.Count -gt 0 -and $kept[$kept.Count - 1].Trim() -eq $pTrim) { continue }
            }
        } else {
            if ($kept.Count -gt 0 -and $kept[$kept.Count - 1].Trim() -eq $pTrim) { continue }
        }

        $kept.Add($p)
    }

    return ($kept -join "`n`n")
}

# -----------------------------------------------------------------------------
# SCX single-turn call (internal — prefers Invoke-KritScxChat if the base
# Kritical.PS.SCXCode module is loaded, else raw REST)
# -----------------------------------------------------------------------------

function Invoke-KritScxSingleTurn {
    <#
    .SYNOPSIS
        One SCX API call. Not the auto-continuer — that's Invoke-KritScxAutoContinue.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [array]  $Messages,
        [Parameter(Mandatory)] [string] $Model,
        [int]    $MaxTokens = 4096,
        [string] $SystemPrompt,
        [string] $ApiKey,
        [string] $BaseUrl = 'https://api.scx.ai'
    )

    # prefer existing base-module function if loaded
    $mainMod = Get-Command Invoke-KritScxChat -ErrorAction SilentlyContinue
    if ($mainMod) {
        $params = @{
            Messages = $Messages
            Model    = $Model
            MaxTokens = $MaxTokens
        }
        if ($SystemPrompt) { $params.SystemPrompt = $SystemPrompt }
        return & $mainMod @params
    }

    # raw REST fallback (Anthropic-shape at /v1/messages)
    $body = @{
        model = $Model
        max_tokens = $MaxTokens
        messages = $Messages
    }
    if ($SystemPrompt) { $body.system = $SystemPrompt }
    $bodyJson = $body | ConvertTo-Json -Depth 10

    $hdr = @{
        'x-api-key' = $ApiKey
        'anthropic-version' = '2023-06-01'
        'content-type' = 'application/json'
    }
    $r = Invoke-RestMethod -Uri "$BaseUrl/v1/messages" -Method Post -Headers $hdr -Body $bodyJson -ErrorAction Stop
    return $r
}

function Get-KritScxResponseText {
    <#
    .SYNOPSIS
        Extract the text payload from any SCX response envelope shape
        (Anthropic or OpenAI shape).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Response)

    if ($Response.content) {
        # Anthropic shape: content is an array of blocks
        if ($Response.content -is [array]) {
            $text = ($Response.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join ''
            if ($text) { return $text }
        }
        if ($Response.content -is [string]) { return $Response.content }
    }
    if ($Response.choices -and $Response.choices[0].message.content) {
        # OpenAI shape
        return $Response.choices[0].message.content
    }
    return "$Response"
}

function Get-KritScxStopReason {
    <#
    .SYNOPSIS
        Extract the model stop reason from any SCX response envelope shape.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Response)
    if ($Response.stop_reason) { return $Response.stop_reason }
    if ($Response.choices -and $Response.choices[0].finish_reason) { return $Response.choices[0].finish_reason }
    return 'unknown'
}

# -----------------------------------------------------------------------------
# THE AUTO-CONTINUATION WRAPPER — Invoke-KritScxAutoContinue
# -----------------------------------------------------------------------------

function Invoke-KritScxAutoContinue {
    <#
    .SYNOPSIS
        Auto-continue SCX across N turns; merge into ONE deduped response.
    .DESCRIPTION
        Turns SCX's per-turn max_tokens ceiling into an effectively unbounded
        response by looping with "continue verbatim, no meta" prompts,
        respecting natural terminators, and deduping adjacent-near-repeats
        via SimHash. Emits ONE HR27 row for the merged response.
    .EXAMPLE
        Invoke-KritScxAutoContinue -Prompt "Write a full architecture doc for X" `
            -Model coder -MaxContinues 10
    .EXAMPLE
        # PassThru returns the full envelope for diagnostics
        $r = Invoke-KritScxAutoContinue -Prompt $task -PassThru
        $r.MergedResponse
        $r.TurnCount
        $r.StopReason
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position=0)] [string] $Prompt,
        [string] $Model,
        [string] $SystemPrompt,
        [int]    $MaxContinues = 10,
        [int]    $PerTurnCeiling = 8192,
        [string] $ContinuePrompt = 'continue from exactly where you left off. no preamble, no meta.',
        [string] $SessionId,
        [string] $Wave,
        [switch] $PassThru,
        [switch] $NoBanner,
        [switch] $NoLog
    )

    if (-not $NoBanner) { Show-KriticalSCXCodeBanner }

    # resolve model + auth
    $cfg = if (Get-Command Get-KritScxConfig -ErrorAction SilentlyContinue) { Get-KritScxConfig } else { $null }
    if (-not $Model) {
        if ($cfg -and $cfg.DefaultModel) { $Model = $cfg.DefaultModel } else { $Model = 'MiniMax-M2.7' }
    }
    $apiKey = if ($cfg -and $cfg.PrimaryKey) { $cfg.PrimaryKey } else { [Environment]::GetEnvironmentVariable('SCX_API_KEY','User') }
    $baseUrl = if ($cfg -and $cfg.BaseUrl) { $cfg.BaseUrl } else { 'https://api.scx.ai' }
    if (-not $apiKey) { throw "No SCX_API_KEY available. Set HKCU env SCX_API_KEY first." }

    if (-not $SessionId) { $SessionId = "autocontinue-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
    if (-not $Wave) { $Wave = '.5183' }

    $conversation = @( @{ role = 'user'; content = $Prompt } )
    $accumulatedChunks = New-Object System.Collections.Generic.List[string]
    $lastStopReason = 'unknown'
    $turnCount = 0
    $errors = 0

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    for ($t = 1; $t -le $MaxContinues; $t++) {
        $turnCount = $t
        Write-Verbose "AutoContinue turn $t / $MaxContinues on $Model"
        try {
            $resp = Invoke-KritScxSingleTurn `
                -Messages $conversation `
                -Model $Model `
                -MaxTokens $PerTurnCeiling `
                -SystemPrompt $SystemPrompt `
                -ApiKey $apiKey `
                -BaseUrl $baseUrl
        } catch {
            Write-Warning "AutoContinue turn $t failed: $($_.Exception.Message)"
            $errors++
            if ($errors -ge 2) { break }
            Start-Sleep -Seconds 2
            continue
        }

        $chunk = Get-KritScxResponseText -Response $resp
        $stopReason = Get-KritScxStopReason -Response $resp
        $lastStopReason = $stopReason

        if (-not $chunk -or $chunk.Length -eq 0) {
            Write-Warning "AutoContinue turn $t returned empty chunk. Breaking."
            break
        }

        $accumulatedChunks.Add($chunk)

        # completion heuristic
        $natural = Test-KritScxNaturalTerminator -Chunk $chunk -PerTurnCeiling $PerTurnCeiling
        # honour explicit end_turn / stop
        $modelSaidStop = $stopReason -in @('end_turn','stop','stop_sequence','end_of_turn','done')

        if ($natural -or $modelSaidStop) {
            Write-Verbose "AutoContinue stopping — natural=$natural modelStop=$modelSaidStop stopReason=$stopReason turn=$t"
            break
        }

        # else append + continue
        $conversation += @{ role = 'assistant'; content = $chunk }
        $conversation += @{ role = 'user';      content = $ContinuePrompt }
    }

    $stopwatch.Stop()
    $merged = ($accumulatedChunks -join "`n`n")
    $mergedDeduped = Remove-KritScxDuplicateParagraphs -Text $merged

    # HR27 write-through — one row for the full auto-continued response
    if (-not $NoLog) {
        $loggerLoaded = Get-Module KriticalDecisionLogger -ErrorAction SilentlyContinue
        if (-not $loggerLoaded) {
            $modPath = Join-Path $PSScriptRoot 'KriticalDecisionLogger.psm1'
            if (Test-Path $modPath) {
                try { Import-Module $modPath -Force -ErrorAction Stop } catch {}
            }
        }
        if (Get-Command Add-KriticalAIResponse -ErrorAction SilentlyContinue) {
            try {
                Add-KriticalHumanPrompt -Content $Prompt -Category prompt `
                    -Wave $Wave -SessionId $SessionId -Source 'scx-autocontinue' | Out-Null
                Add-KriticalAIResponse -Content $mergedDeduped -Category response `
                    -Model $Model -Provider 'scx' -Wave $Wave -SessionId $SessionId `
                    -Source 'scx-autocontinue' | Out-Null
            } catch {
                Write-Warning "HR27 log failed: $($_.Exception.Message)"
            }
        }
    }

    if ($PassThru) {
        return [pscustomobject]@{
            MergedResponse    = $mergedDeduped
            RawChunks         = $accumulatedChunks.ToArray()
            TurnCount         = $turnCount
            StopReason        = $lastStopReason
            Model             = $Model
            SessionId         = $SessionId
            Wave              = $Wave
            DurationSec       = [int]$stopwatch.Elapsed.TotalSeconds
            TotalTokensApprox = [int][math]::Ceiling($mergedDeduped.Length / 4.0)
            Errors            = $errors
            PromptLen         = $Prompt.Length
            MergedLen         = $mergedDeduped.Length
            DedupSaved        = $merged.Length - $mergedDeduped.Length
        }
    } else {
        return $mergedDeduped
    }
}

# -----------------------------------------------------------------------------
# Export
# -----------------------------------------------------------------------------

Export-ModuleMember -Function `
    Invoke-KritScxAutoContinue, `
    Invoke-KritScxSingleTurn, `
    Show-KriticalSCXCodeBanner, `
    Test-KritScxNaturalTerminator, `
    Remove-KritScxDuplicateParagraphs, `
    Get-KritScxResponseText, `
    Get-KritScxStopReason
