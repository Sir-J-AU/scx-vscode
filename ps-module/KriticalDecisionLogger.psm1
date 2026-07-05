#requires -Version 7.0
<#
.SYNOPSIS
    Canonical decision/prompt/response logger for HARD RULE 27 (.5182).

.DESCRIPTION
    Simple-for-idiots interface: one-line calls append rows to
    `documentation/human/<yyyy-mm-dd>/<category>.jsonl` or
    `documentation/ai/<yyyy-mm-dd>/<category>.jsonl` with SHA256 exact-dupe skip
    + SimHash near-dupe link.

    Default emit target is JSONL. Opt-in SQL Express `KriticalBrain.dbo.decision_log`
    via `$env:KRITICAL_LOGGER_TARGET = 'db'` or `'both'`, or per-call `-EmitToDb`.

    Feeds `Kritical.NodeJS.SCXCodeAgent` (queued) as the primary session-memory
    store for the synthetic mega-context-window.

.CONTRACT
    inputs:
      - Content: string (required) — the raw prompt / response / decision
      - Side: human | ai
      - Category: prompt | decision | context | direction (human) OR response | action | commit (ai)
      - Wave: optional string (e.g. .5182)
      - SessionId: optional string
    outputs:
      - JSONL row appended to documentation/{human|ai}/<yyyy-mm-dd>/<category>.jsonl
      - Optional SQL Express upsert to KriticalBrain.dbo.decision_log
      - Sidecar .counters.json increments occurrence_count on exact-dupe
    sideEffects:
      - Creates the target folder + JSONL file if missing (idempotent)
      - Never overwrites or deletes existing rows (append-only per HR23)
    invariants:
      - Every returned row has non-empty content_sha256 + simhash
      - SHA exact-dupe within same day OR last 7 days = SKIP write (counter++ instead)
      - SimHash Hamming ≤ 3 = APPEND with dup_of link (do NOT collapse)

.EXAMPLE
    Import-Module ./scripts/lib/KriticalDecisionLogger.psm1 -Force
    Add-KriticalHumanPrompt -Content "let's ship the flag matrix" -Category direction -Wave .5182

.EXAMPLE
    Add-KriticalAIResponse -Content "shipped" -Model claude-opus-4-7[1m] -Provider claude-code -Wave .5182 -EmitToDb

.NOTES
    Per HARD RULE 27 in CLAUDE.md.
    Paired test: scripts/audits/Test-KriticalDecisionLogger.ps1
    SQL schema:  scripts/db/decision_log_schema.sql
#>

# -----------------------------------------------------------------------------
# Module state
# -----------------------------------------------------------------------------

$script:LoggerRepoRoot = $null
$script:LoggerDocRoot = $null

function Resolve-KriticalLoggerRoot {
    <#
    .SYNOPSIS
        Locate the repo root by walking up until an anchor is found. Anchor precedence:
          1. $env:KRITICAL_DECISION_LOG_ROOT (explicit override)
          2. .git/ directory (most repos)
          3. package.json / pyproject.toml / CLAUDE.md / README.md
    .DESCRIPTION
        Repo-agnostic — works from Kritical.SCXCode, any Kritical.* sister, or
        the KRT connector. Overridable via env var for portable/embedded scenarios.
    #>
    [CmdletBinding()]
    param(
        [string] $StartPath = $PSScriptRoot
    )

    if ($script:LoggerRepoRoot -and (Test-Path $script:LoggerRepoRoot)) {
        return $script:LoggerRepoRoot
    }

    if ($env:KRITICAL_DECISION_LOG_ROOT) {
        $override = $env:KRITICAL_DECISION_LOG_ROOT
        if (Test-Path $override) {
            $script:LoggerRepoRoot = (Resolve-Path -LiteralPath $override).Path
            $script:LoggerDocRoot = Join-Path $script:LoggerRepoRoot 'documentation'
            return $script:LoggerRepoRoot
        }
    }

    $current = Resolve-Path -LiteralPath $StartPath -ErrorAction Stop
    $current = $current.Path

    $anchors = @('.git', 'package.json', 'pyproject.toml', 'CLAUDE.md', 'README.md')

    for ($i = 0; $i -lt 8; $i++) {
        foreach ($anchor in $anchors) {
            if (Test-Path (Join-Path $current $anchor)) {
                $script:LoggerRepoRoot = $current
                $script:LoggerDocRoot = Join-Path $current 'documentation'
                return $current
            }
        }
        $parent = Split-Path -Parent $current
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }

    throw "Could not locate repo root (walked up from $StartPath looking for .git/package.json/CLAUDE.md/README.md). Set `$env:KRITICAL_DECISION_LOG_ROOT to override."
}

# -----------------------------------------------------------------------------
# Hashing (SHA256 + SimHash 64-bit)
# -----------------------------------------------------------------------------

function Get-KriticalContentSha256 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Content
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
        return -join ($hash | ForEach-Object { $_.ToString('x2') })
    } finally {
        $sha.Dispose()
    }
}

function Get-KriticalContentSimHash {
    <#
    .SYNOPSIS
        Compute a 64-bit SimHash of the content for near-dupe detection.
    .DESCRIPTION
        Tokenises on whitespace + punctuation, hashes each token to 64 bits,
        weights tokens equally (extend later for term-frequency weighting),
        computes bit-vector sum, threshold at 0 → SimHash. Returns as 64-char
        binary string (portable across storage).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Content
    )

    $tokens = ($Content.ToLowerInvariant() -split '[\s\p{P}]+' | Where-Object { $_.Length -ge 3 })
    if (-not $tokens -or $tokens.Count -eq 0) {
        return ('0' * 64)
    }

    $bits = New-Object 'int[]' 64

    foreach ($token in $tokens) {
        $tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($token)
        $md5 = [System.Security.Cryptography.MD5]::Create()
        try {
            $hashBytes = $md5.ComputeHash($tokenBytes)
        } finally {
            $md5.Dispose()
        }
        # take first 8 bytes as 64-bit hash
        for ($i = 0; $i -lt 64; $i++) {
            $byteIdx = [math]::Floor($i / 8)
            $bitIdx = $i % 8
            $bit = ($hashBytes[$byteIdx] -shr $bitIdx) -band 1
            if ($bit -eq 1) { $bits[$i]++ } else { $bits[$i]-- }
        }
    }

    $sb = [System.Text.StringBuilder]::new(64)
    for ($i = 0; $i -lt 64; $i++) {
        [void]$sb.Append(($bits[$i] -gt 0 ? '1' : '0'))
    }
    return $sb.ToString()
}

function Get-KriticalSimHashHammingDistance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $A,
        [Parameter(Mandatory)] [string] $B
    )
    if ($A.Length -ne $B.Length) {
        throw "SimHash strings must be same length (got $($A.Length) vs $($B.Length))"
    }
    $d = 0
    for ($i = 0; $i -lt $A.Length; $i++) {
        if ($A[$i] -ne $B[$i]) { $d++ }
    }
    return $d
}

# -----------------------------------------------------------------------------
# Path helpers
# -----------------------------------------------------------------------------

function Get-KriticalLoggerJsonlPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $Category,
        [datetime] $When = (Get-Date).ToUniversalTime()
    )

    $root = Resolve-KriticalLoggerRoot
    $dateFolder = $When.ToString('yyyy-MM-dd')
    $dir = Join-Path $script:LoggerDocRoot (Join-Path $Side $dateFolder)

    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    return Join-Path $dir "$Category.jsonl"
}

function Get-KriticalLoggerCounterPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $Category,
        [datetime] $When = (Get-Date).ToUniversalTime()
    )
    $jsonl = Get-KriticalLoggerJsonlPath -Side $Side -Category $Category -When $When
    return ($jsonl -replace '\.jsonl$', '.counters.json')
}

# -----------------------------------------------------------------------------
# Dedup check (SHA exact within last N days)
# -----------------------------------------------------------------------------

function Test-KriticalExistingSha {
    <#
    .SYNOPSIS
        Search recent JSONL files for an existing content_sha256.
    .OUTPUTS
        $null if not found, else the row object.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $Sha256,
        [int] $DaysBack = 7
    )

    $root = Resolve-KriticalLoggerRoot
    $sideDir = Join-Path $script:LoggerDocRoot $Side
    if (-not (Test-Path $sideDir)) { return $null }

    $cutoff = (Get-Date).ToUniversalTime().AddDays(-$DaysBack)

    $folders = Get-ChildItem -Path $sideDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
        Where-Object {
            try {
                [datetime]::ParseExact($_.Name, 'yyyy-MM-dd', $null) -ge $cutoff
            } catch { $false }
        }

    foreach ($folder in $folders) {
        $jsonlFiles = Get-ChildItem -Path $folder.FullName -Filter '*.jsonl' -ErrorAction SilentlyContinue
        foreach ($jf in $jsonlFiles) {
            # cheap grep-first: skip files that don't even contain the hash string
            $content = Get-Content -LiteralPath $jf.FullName -Raw -ErrorAction SilentlyContinue
            if (-not $content) { continue }
            if ($content -notmatch [regex]::Escape($Sha256)) { continue }
            # parse rows
            $lines = $content -split "`r?`n" | Where-Object { $_.Length -gt 2 }
            foreach ($line in $lines) {
                try {
                    $row = $line | ConvertFrom-Json -ErrorAction Stop
                    if ($row.content_sha256 -eq $Sha256) {
                        return $row
                    }
                } catch {
                    continue
                }
            }
        }
    }
    return $null
}

function Find-KriticalNearDupe {
    <#
    .SYNOPSIS
        Search recent JSONL for a row with SimHash Hamming distance ≤ MaxDistance.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $SimHash,
        [int] $MaxDistance = 3,
        [int] $DaysBack = 7
    )

    $root = Resolve-KriticalLoggerRoot
    $sideDir = Join-Path $script:LoggerDocRoot $Side
    if (-not (Test-Path $sideDir)) { return $null }

    $cutoff = (Get-Date).ToUniversalTime().AddDays(-$DaysBack)

    $folders = Get-ChildItem -Path $sideDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
        Where-Object {
            try {
                [datetime]::ParseExact($_.Name, 'yyyy-MM-dd', $null) -ge $cutoff
            } catch { $false }
        }

    foreach ($folder in $folders) {
        $jsonlFiles = Get-ChildItem -Path $folder.FullName -Filter '*.jsonl' -ErrorAction SilentlyContinue
        foreach ($jf in $jsonlFiles) {
            $lines = Get-Content -LiteralPath $jf.FullName -ErrorAction SilentlyContinue
            foreach ($line in $lines) {
                if (-not $line -or $line.Length -lt 10) { continue }
                try {
                    $row = $line | ConvertFrom-Json -ErrorAction Stop
                } catch { continue }
                if (-not $row.simhash) { continue }
                try {
                    $d = Get-KriticalSimHashHammingDistance -A $SimHash -B $row.simhash
                } catch { continue }
                if ($d -le $MaxDistance) {
                    return [pscustomobject]@{ Row = $row; Distance = $d }
                }
            }
        }
    }
    return $null
}

# -----------------------------------------------------------------------------
# Counter (occurrence tracking for exact dupes)
# -----------------------------------------------------------------------------

function Update-KriticalDupeCounter {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $Category,
        [Parameter(Mandatory)] [string] $Sha256,
        [datetime] $When = (Get-Date).ToUniversalTime()
    )
    $counterPath = Get-KriticalLoggerCounterPath -Side $Side -Category $Category -When $When
    $counters = @{}
    if (Test-Path $counterPath) {
        try {
            $raw = Get-Content -LiteralPath $counterPath -Raw
            $obj = $raw | ConvertFrom-Json
            $obj.PSObject.Properties | ForEach-Object { $counters[$_.Name] = $_.Value }
        } catch {}
    }
    if ($counters.ContainsKey($Sha256)) {
        $counters[$Sha256] = [int]$counters[$Sha256] + 1
    } else {
        $counters[$Sha256] = 2  # original + 1 duplicate seen now
    }
    $counters | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $counterPath -Encoding UTF8
    return $counters[$Sha256]
}

# -----------------------------------------------------------------------------
# Core write primitive
# -----------------------------------------------------------------------------

function Write-KriticalDecisionRow {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('human','ai')] [string] $Side,
        [Parameter(Mandatory)] [string] $Category,
        [Parameter(Mandatory)] [string] $Content,
        [string] $Wave,
        [string] $SessionId,
        [string] $Model,
        [string] $Provider,
        [string] $Source = 'manual',
        [datetime] $Timestamp = (Get-Date).ToUniversalTime(),
        [switch] $EmitToDb,
        [switch] $ForceWriteEvenIfDupe
    )

    if ([string]::IsNullOrWhiteSpace($Content)) {
        throw "Content is required and cannot be empty."
    }

    $sha = Get-KriticalContentSha256 -Content $Content
    $simhash = Get-KriticalContentSimHash -Content $Content

    # exact-dupe check
    $existing = $null
    if (-not $ForceWriteEvenIfDupe) {
        $existing = Test-KriticalExistingSha -Side $Side -Sha256 $sha -DaysBack 7
    }

    if ($existing -and -not $ForceWriteEvenIfDupe) {
        $newCount = Update-KriticalDupeCounter -Side $Side -Category $Category -Sha256 $sha -When $Timestamp
        return [pscustomobject]@{
            id = $existing.id
            action = 'skipped_exact_dupe'
            occurrence_count = $newCount
            existing_row = $existing
        }
    }

    # near-dupe check (informational)
    $nearDupe = $null
    if (-not $ForceWriteEvenIfDupe) {
        $nearDupe = Find-KriticalNearDupe -Side $Side -SimHash $simhash -MaxDistance 3 -DaysBack 7
    }

    $sidePrefix = if ($Side -eq 'human') { 'h' } else { 'a' }
    $id = "$sidePrefix-$($sha.Substring(0, 8))"

    $preview = if ($Content.Length -gt 120) { $Content.Substring(0, 120) } else { $Content }

    $row = [ordered]@{
        id = $id
        ts_utc = $Timestamp.ToString('o')
        side = $Side
        category = $Category
        wave = $Wave
        session_id = $SessionId
        content_sha256 = $sha
        simhash = $simhash
        content_len = $Content.Length
        content_preview_120 = $preview
        content = $Content
        model = $Model
        provider = $Provider
        source = $Source
        dup_of = if ($nearDupe) { $nearDupe.Row.id } else { $null }
        dup_hamming = if ($nearDupe) { $nearDupe.Distance } else { $null }
        occurrence_count = 1
    }

    $jsonlPath = Get-KriticalLoggerJsonlPath -Side $Side -Category $Category -When $Timestamp
    $jsonLine = ($row | ConvertTo-Json -Depth 5 -Compress)
    Add-Content -LiteralPath $jsonlPath -Value $jsonLine -Encoding UTF8

    $emitTarget = if ($EmitToDb) { 'db' } else { $env:KRITICAL_LOGGER_TARGET }
    if ($emitTarget -in @('db','both')) {
        try {
            Sync-KriticalDecisionRowToDb -Row $row -ErrorAction Stop
        } catch {
            Write-Warning "SQL emit failed for row $id : $_"
        }
    }

    return [pscustomobject]@{
        id = $id
        action = if ($nearDupe) { 'appended_near_dupe' } else { 'appended' }
        jsonl_path = $jsonlPath
        row = $row
    }
}

# -----------------------------------------------------------------------------
# Public API — human side
# -----------------------------------------------------------------------------

function Add-KriticalHumanPrompt {
    <#
    .SYNOPSIS
        Append an operator prompt/decision/context/direction to the human store.
    .EXAMPLE
        Add-KriticalHumanPrompt -Content "ship it" -Category direction -Wave .5182
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position=0)] [string] $Content,
        [ValidateSet('prompt','decision','context','direction')] [string] $Category = 'prompt',
        [string] $Wave,
        [string] $SessionId,
        [string] $Source = 'manual',
        [datetime] $Timestamp = (Get-Date).ToUniversalTime(),
        [switch] $EmitToDb,
        [switch] $ForceWriteEvenIfDupe
    )
    return Write-KriticalDecisionRow -Side human -Category $Category -Content $Content `
        -Wave $Wave -SessionId $SessionId -Source $Source -Timestamp $Timestamp `
        -EmitToDb:$EmitToDb -ForceWriteEvenIfDupe:$ForceWriteEvenIfDupe
}

# -----------------------------------------------------------------------------
# Public API — ai side
# -----------------------------------------------------------------------------

function Add-KriticalAIResponse {
    <#
    .SYNOPSIS
        Append an AI response/action/commit to the ai store.
    .EXAMPLE
        Add-KriticalAIResponse -Content "shipped hr27 logger" -Category response `
            -Model claude-opus-4-7[1m] -Provider claude-code -Wave .5182
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position=0)] [string] $Content,
        [ValidateSet('response','action','commit')] [string] $Category = 'response',
        [string] $Model,
        [string] $Provider,
        [string] $Wave,
        [string] $SessionId,
        [string] $Source = 'manual',
        [datetime] $Timestamp = (Get-Date).ToUniversalTime(),
        [switch] $EmitToDb,
        [switch] $ForceWriteEvenIfDupe
    )
    return Write-KriticalDecisionRow -Side ai -Category $Category -Content $Content `
        -Model $Model -Provider $Provider -Wave $Wave -SessionId $SessionId `
        -Source $Source -Timestamp $Timestamp `
        -EmitToDb:$EmitToDb -ForceWriteEvenIfDupe:$ForceWriteEvenIfDupe
}

# -----------------------------------------------------------------------------
# Query
# -----------------------------------------------------------------------------

function Get-KriticalDecisionLog {
    <#
    .SYNOPSIS
        Read rows from the decision log. Filters by side / date / category /
        substring / session_id / wave.
    .EXAMPLE
        Get-KriticalDecisionLog -Side human -Date 2026-07-04
    .EXAMPLE
        Get-KriticalDecisionLog -ContainsText "scxcode" -DaysBack 30
    .EXAMPLE
        Get-KriticalDecisionLog -SessionId sess-5182-5183-scxcode-scaffold -DaysBack 30
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('human','ai','both')] [string] $Side = 'both',
        [string] $Date,             # yyyy-MM-dd; overrides DaysBack when set
        [int] $DaysBack = 1,
        [string] $Category,
        [string] $ContainsText,
        [string] $SessionId,
        [string] $Wave,
        [switch] $IncludeArchived
    )

    Resolve-KriticalLoggerRoot | Out-Null
    $sides = if ($Side -eq 'both') { @('human','ai') } else { @($Side) }

    $rows = @()
    foreach ($s in $sides) {
        $sideDir = Join-Path $script:LoggerDocRoot $s
        if (-not (Test-Path $sideDir)) { continue }

        if ($Date) {
            $folders = @(Get-Item -Path (Join-Path $sideDir $Date) -ErrorAction SilentlyContinue)
        } else {
            $cutoff = (Get-Date).ToUniversalTime().AddDays(-$DaysBack)
            $folders = Get-ChildItem -Path $sideDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
                Where-Object {
                    try { [datetime]::ParseExact($_.Name, 'yyyy-MM-dd', $null) -ge $cutoff }
                    catch { $false }
                }
        }

        if ($IncludeArchived) {
            $archiveRoot = Join-Path $sideDir '_ARCHIVED-*'
            $archived = Get-ChildItem -Path $archiveRoot -Directory -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' }
            $folders = @($folders) + @($archived)
        }

        foreach ($folder in $folders) {
            if (-not $folder) { continue }
            $filter = if ($Category) { "$Category.jsonl" } else { '*.jsonl' }
            $files = Get-ChildItem -Path $folder.FullName -Filter $filter -ErrorAction SilentlyContinue
            foreach ($f in $files) {
                $lines = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue
                foreach ($line in $lines) {
                    if (-not $line -or $line.Length -lt 10) { continue }
                    try {
                        $row = $line | ConvertFrom-Json -ErrorAction Stop
                    } catch { continue }
                    if ($ContainsText -and ($row.content -notmatch [regex]::Escape($ContainsText))) { continue }
                    if ($SessionId -and $row.session_id -ne $SessionId) { continue }
                    if ($Wave -and $row.wave -ne $Wave) { continue }
                    $rows += $row
                }
            }
        }
    }

    return $rows
}

function Find-KriticalDecisionByHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Sha256,
        [ValidateSet('human','ai','both')] [string] $Side = 'both',
        [int] $DaysBack = 365
    )
    $sides = if ($Side -eq 'both') { @('human','ai') } else { @($Side) }
    foreach ($s in $sides) {
        $found = Test-KriticalExistingSha -Side $s -Sha256 $Sha256 -DaysBack $DaysBack
        if ($found) { return $found }
    }
    return $null
}

# -----------------------------------------------------------------------------
# SQL Express ingest
# -----------------------------------------------------------------------------

function Sync-KriticalDecisionRowToDb {
    <#
    .SYNOPSIS
        Upsert one row into KriticalBrain.dbo.decision_log.
    .NOTES
        Requires SqlServer PS module OR falls back to sqlcmd.exe on PATH.
        Idempotent — safe to re-call with same content_sha256.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Row,
        [string] $Server = '.\SQLEXPRESS',
        [string] $Database = 'KriticalBrain'
    )

    $sqlModule = Get-Module -ListAvailable -Name SqlServer -ErrorAction SilentlyContinue | Select-Object -First 1
    $useSqlcmd = -not $sqlModule -and (Get-Command sqlcmd.exe -ErrorAction SilentlyContinue)

    if (-not $sqlModule -and -not $useSqlcmd) {
        throw "Neither SqlServer PS module nor sqlcmd.exe available. Install SqlServer module or SQL Server client tools."
    }

    $safeContent = if ($Row.content) { $Row.content -replace "'", "''" } else { '' }
    $safePreview = if ($Row.content_preview_120) { $Row.content_preview_120 -replace "'", "''" } else { '' }

    $sql = @"
MERGE dbo.decision_log AS target
USING (SELECT '$($Row.content_sha256)' AS content_sha256) AS src
    ON target.content_sha256 = src.content_sha256
WHEN MATCHED THEN
    UPDATE SET occurrence_count = target.occurrence_count + 1, last_seen_utc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (id, ts_utc, side, category, wave, session_id, content_sha256, simhash,
            content_len, content_preview_120, content, model, provider, source,
            dup_of, dup_hamming, occurrence_count, first_seen_utc, last_seen_utc)
    VALUES ('$($Row.id)', '$($Row.ts_utc)', '$($Row.side)', '$($Row.category)',
            NULLIF('$($Row.wave)', ''), NULLIF('$($Row.session_id)', ''),
            '$($Row.content_sha256)', '$($Row.simhash)', $($Row.content_len),
            N'$safePreview', N'$safeContent',
            NULLIF('$($Row.model)', ''), NULLIF('$($Row.provider)', ''),
            NULLIF('$($Row.source)', ''),
            NULLIF('$($Row.dup_of)', ''), $(if ($null -ne $Row.dup_hamming) { $Row.dup_hamming } else { 'NULL' }),
            1, SYSUTCDATETIME(), SYSUTCDATETIME());
"@

    if ($sqlModule) {
        Import-Module SqlServer -ErrorAction Stop
        Invoke-Sqlcmd -ServerInstance $Server -Database $Database -Query $sql -ErrorAction Stop
    } else {
        $tmp = New-TemporaryFile
        Set-Content -LiteralPath $tmp -Value $sql -Encoding UTF8
        & sqlcmd.exe -S $Server -d $Database -E -i $tmp | Out-Null
        Remove-Item $tmp -Force
        if ($LASTEXITCODE -ne 0) { throw "sqlcmd exit $LASTEXITCODE" }
    }
}

function Sync-KriticalDecisionLogToKriticalBrain {
    <#
    .SYNOPSIS
        Bulk-sync JSONL rows to SQL Express KriticalBrain.dbo.decision_log.
    #>
    [CmdletBinding()]
    param(
        [datetime] $Since = (Get-Date).AddDays(-7).ToUniversalTime(),
        [ValidateSet('human','ai','both')] [string] $Side = 'both',
        [string] $Server = '.\SQLEXPRESS',
        [string] $Database = 'KriticalBrain',
        [switch] $DryRun
    )

    Resolve-KriticalLoggerRoot | Out-Null
    $sides = if ($Side -eq 'both') { @('human','ai') } else { @($Side) }

    $stats = [pscustomobject]@{
        RowsScanned = 0
        RowsInserted = 0
        RowsSkipped = 0
        Errors = 0
    }

    foreach ($s in $sides) {
        $sideDir = Join-Path $script:LoggerDocRoot $s
        if (-not (Test-Path $sideDir)) { continue }

        $folders = Get-ChildItem -Path $sideDir -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
            Where-Object {
                try { [datetime]::ParseExact($_.Name, 'yyyy-MM-dd', $null) -ge $Since.Date }
                catch { $false }
            }

        foreach ($folder in $folders) {
            $files = Get-ChildItem -Path $folder.FullName -Filter '*.jsonl' -ErrorAction SilentlyContinue
            foreach ($f in $files) {
                $lines = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue
                foreach ($line in $lines) {
                    if (-not $line -or $line.Length -lt 10) { continue }
                    try {
                        $row = $line | ConvertFrom-Json -ErrorAction Stop
                    } catch { $stats.Errors++; continue }
                    $stats.RowsScanned++
                    if ($DryRun) { continue }
                    try {
                        Sync-KriticalDecisionRowToDb -Row $row -Server $Server -Database $Database
                        $stats.RowsInserted++
                    } catch {
                        $stats.Errors++
                        Write-Warning "Row $($row.id) failed: $_"
                    }
                }
            }
        }
    }

    return $stats
}

# -----------------------------------------------------------------------------
# Backfill
# -----------------------------------------------------------------------------

function Import-KriticalConversationBackfill {
    <#
    .SYNOPSIS
        Backfill a conversation transcript into the decision store.
    .DESCRIPTION
        Accepts a hashtable array of {side, category, content, ts_utc?, model?, provider?}
        or a path to a JSONL file with the same shape. Writes via the normal
        Add-Kritical* primitives so dedup applies.
    .EXAMPLE
        $rows = @(
            @{ side='human'; category='prompt'; content='...' }
            @{ side='ai';    category='response'; content='...' }
        )
        Import-KriticalConversationBackfill -Rows $rows -Wave .5182 -SessionId sess-scx-review
    #>
    [CmdletBinding()]
    param(
        [Parameter(ParameterSetName='Rows')] [array] $Rows,
        [Parameter(ParameterSetName='Path')] [string] $TranscriptPath,
        [string] $Wave,
        [string] $SessionId,
        [switch] $EmitToDb
    )

    if ($TranscriptPath) {
        if (-not (Test-Path $TranscriptPath)) {
            throw "Transcript not found: $TranscriptPath"
        }
        $lines = Get-Content -LiteralPath $TranscriptPath
        $Rows = @()
        foreach ($line in $lines) {
            if (-not $line -or $line.Length -lt 5) { continue }
            try { $Rows += ($line | ConvertFrom-Json) } catch {}
        }
    }

    $results = @()
    foreach ($r in $Rows) {
        $side = $r.side
        $category = $r.category
        $content = $r.content
        $ts = if ($r.ts_utc) {
            try { [datetime]::Parse($r.ts_utc).ToUniversalTime() } catch { (Get-Date).ToUniversalTime() }
        } else { (Get-Date).ToUniversalTime() }

        if (-not $content -or [string]::IsNullOrWhiteSpace($content)) { continue }

        if ($side -eq 'human') {
            $result = Add-KriticalHumanPrompt -Content $content -Category $category `
                -Wave $Wave -SessionId $SessionId -Source 'backfill' `
                -Timestamp $ts -EmitToDb:$EmitToDb
        } elseif ($side -eq 'ai') {
            $result = Add-KriticalAIResponse -Content $content -Category $category `
                -Model $r.model -Provider $r.provider `
                -Wave $Wave -SessionId $SessionId -Source 'backfill' `
                -Timestamp $ts -EmitToDb:$EmitToDb
        } else {
            Write-Warning "Skipping row with unknown side: $side"
            continue
        }
        $results += $result
    }
    return $results
}

# -----------------------------------------------------------------------------
# Exports
# -----------------------------------------------------------------------------

Export-ModuleMember -Function `
    Add-KriticalHumanPrompt, `
    Add-KriticalAIResponse, `
    Get-KriticalDecisionLog, `
    Find-KriticalDecisionByHash, `
    Sync-KriticalDecisionLogToKriticalBrain, `
    Import-KriticalConversationBackfill, `
    Get-KriticalContentSha256, `
    Get-KriticalContentSimHash, `
    Get-KriticalSimHashHammingDistance
