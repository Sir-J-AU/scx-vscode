#Requires -Version 7
<#
.SYNOPSIS
    Invoke-KritScxAutoCompact — token-budgeted context management for SCX agentic requests.

.DESCRIPTION
    Enforces a per-model context ceiling by:
      1. Computing exact payload size (prompt + system + tools + history)
      2. If over budget: summarises oldest history chunks OR strips lowest-priority tools
         to recover headroom without losing the task's coherence
      3. Returns the trimmed request body + a flag indicating what was compacted

    Default OFF (HR29 passthrough). Enable via $env:KRIT_SCX_AUTO_COMPACT=1.

    Per HR28: no metaphor identifiers. Mechanism is auto-compact.

.EXAMPLE
    $trimmed = Invoke-KritScxAutoCompact -RequestBody $body -Model gpt-oss-120b
    $trimmed.IsCompacted  # true if something was dropped
    $trimmed.Body         # safe-to-send body
    $trimmed.Ceiling      # the model's real ceiling
    $trimmed.Used         # chars before compact
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [hashtable]$RequestBody,

    [string]$Model = 'MiniMax-M2.7',

    [switch]$PassThru
)

# ── model ceilings (chars = tokens × 4; from live needle-recall probes) ──
$script:ModelCeilings = @{
    'gpt-oss-120b'    = 108_000 * 4   # 432k chars — tightest wrapper ceiling
    'deepseek-v3.1'   = 129_000 * 4   # 516k chars
    'minimax-m2.7'    = 195_000 * 4   # 780k chars — exceeds advertised 192k
    'scx-coder'       = 108_000 * 4
    'coder'            = 108_000 * 4
    'default'          = 108_000 * 4   # conservative fallback
}

$script:OutputReserve   = 2_000 * 4   # chars reserved for model reply
$script:SafetyMargin    = 4_000        # JSON overhead fudge
$script:MaxHistoryItems = 32            # hard cap on conversation history items

function Get-ModelCeiling {
    param([string]$Model)
    foreach ($key in $script:ModelCeilings.Keys) {
        if ($Model -match $key) { return $script:ModelCeilings[$key] }
    }
    return $script:ModelCeilings['default']
}

function Get-PayloadChars {
    param([hashtable]$Body)
    try {
        return [System.Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $Body -Depth 100 -Compress))
    } catch {
        return [System.Text.Encoding]::UTF8.GetByteCount($Body.ToString())
    }
}

function Remove-LowPriorityTools {
    # Drop academic_search, movie_tv_search, trending_movies, trending_tv, 
    # coin_data, stock_chart, flight_tracker — these are plan-gated server tools
    # that are first to cause upstream_invalid_function_calling_output.
    param([hashtable]$Body)
    if (-not $Body.tools -or $Body.tools.Count -eq 0) { return $Body, $false }
    $priorities = @{
        'function'         = 100
        'code_interpreter'  = 90
        'web_search'        = 80
        'retrieve'          = 75
        'file_retrieval'    = 70
        'mcp_search'        = 60
        'academic_search'   = 20
        'movie_tv_search'   = 15
        'trending_movies'   = 15
        'trending_tv'       = 15
        'coin_data'         = 10
        'coin_ohlc'         = 10
        'stock_chart'       = 10
        'stock_price'       = 10
        'flight_tracker'    = 10
        'flight_live_tracker'= 10
        'travel_advisor'    = 10
        'weather'           = 5
        'trove_search'      = 5
        'youtube_search'    = 5
        'reddit_search'     = 5
        'x_search'         = 5
    }
    $cutoff = 40  # drop anything below this priority score
    $filtered = @($Body.tools | Where-Object {
        $t = $_
        $type = if ($t.type) { $t.type } else { 'function' }
        ($priorities[$type] ?? 30) -ge $cutoff
    })
    $wasTrimmed = ($filtered.Count -lt $Body.tools.Count)
    $newBody = [hashtable]$Body.Clone()
    $newBody.tools = $filtered
    return $newBody, $wasTrimmed
}

function Remove-OldestHistory {
    # Drop the oldest 2 non-system messages to recover budget
    param([hashtable]$Body)
    $msgs = $Body.messages
    if (-not $msgs -or $msgs.Count -le 4) { return $Body, $false }
    # Keep: system (always first), last 2 user+assistant pairs, drop oldest 2 non-system
    $system = @($msgs | Where-Object { $_.role -eq 'system' })
    $rest   = @($msgs | Where-Object { $_.role -ne 'system' })
    if ($rest.Count -le 4) { return $Body, $false }
    $trimmed = $rest[2..($rest.Count - 1)]
    $newBody = [hashtable]$Body.Clone()
    $newBody.messages = @($system) + $trimmed
    return $newBody, ($trimmed.Count -lt $rest.Count)
}

function Invoke-KritScxAutoCompact {
    param([hashtable]$Body, [string]$Model)
    # HR29: OFF by default — only compact when explicitly enabled
    if ((Get-Content env:KRIT_SCX_AUTO_COMPACT -EA SilentlyContinue) -ne '1') {
        return @{ Body = $Body; IsCompacted = $false; Ceiling = 0; Used = 0; Strategy = 'disabled' }
    }

    $ceiling = Get-ModelCeiling -Model $Model
    $used    = Get-PayloadChars -Body $Body
    $budget  = $ceiling - $script:OutputReserve - $script:SafetyMargin

    if ($used -le $budget) {
        return @{ Body = $Body; IsCompacted = $false; Ceiling = $ceiling; Used = $used; Strategy = 'none' }
    }

    $strategy = @()
    $current  = $Body

    # Step 1: trim lowest-priority tools first (cheapest — no context loss)
    $beforeTools = Get-PayloadChars -Body $current
    $current, $toolTrimmed = Remove-LowPriorityTools -Body $current
    if ($toolTrimmed) { $strategy += 'tool-priority' }

    # Step 2: if still over, drop oldest history
    if ((Get-PayloadChars -Body $current) -gt $budget) {
        $current, $histTrimmed = Remove-OldestHistory -Body $current
        if ($histTrimmed) { $strategy += 'history-trim' }
    }

    # Step 3: last resort — truncate the last user message content to 40%
    if ((Get-PayloadChars -Body $current) -gt $budget) {
        $msgs = $current.messages
        if ($msgs -and $msgs.Count -gt 0) {
            $lastIdx = $msgs.Count - 1
            $lastMsg = $msgs[$lastIdx]
            if ($lastMsg.content -is [string] -and $lastMsg.content.Length -gt 500) {
                $trimLen = [math]::Floor($lastMsg.content.Length * 0.4)
                $msgs[$lastIdx] = @{
                    role    = $lastMsg.role
                    content = $lastMsg.content.Substring(0, $trimLen) + "`n[... truncated by Kritical SCX auto-compact ...]"
                }
                $current.messages = $msgs
                $strategy += 'content-truncate'
            }
        }
    }

    $stillOver = (Get-PayloadChars -Body $current) -gt $budget
    return @{
        Body       = $current
        IsCompacted = ($strategy.Count -gt 0)
        Ceiling    = $ceiling
        Used       = Get-PayloadChars -Body $current
        Strategy   = if ($strategy.Count -eq 0) { 'none' } else { $strategy -join '+' }
        WasTrimmed = $stillOver  # true = even after all steps still over budget (may 400)
    }
}

$result = Invoke-KritScxAutoCompact -Body $RequestBody -Model $Model
if ($PassThru) { return $result }
else { return $result.Body }
