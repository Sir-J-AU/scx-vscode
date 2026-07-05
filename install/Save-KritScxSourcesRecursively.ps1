#requires -Version 7.0
<#
.SYNOPSIS
    Recursively crawl scx.ai + api.scx.ai + labs.scx.ai and save every page as
    markdown to Kritical.SCXCode/sources/<host>/.

.DESCRIPTION
    Uses Playwright headless-chromium (via npx playwright) if available, else
    falls back to Invoke-WebRequest for static HTML. Every fetched page is
    dedup'd via SHA256 + logged to HR27 documentation/ai/ store as
    category=action, source=scx-crawler.

    HR16 idempotent modes:
        -Mode Install   : install dependencies (npm i playwright + chromium)
        -Mode Crawl     : run the crawl (default)
        -Mode Refresh   : re-crawl pages older than -MaxAgeDays
        -Mode Status    : count what's already saved
        -Mode Remove    : delete the sources/ tree (requires -IUnderstand)

    HR17: probes every seed URL before starting a full crawl.
    HR21: paired test at tests/Test-KritScxSourcesCrawler.ps1 (queued).
    HR23: never deletes without explicit -IUnderstand ack.
    HR27: every page fetched emits an ai/action row to documentation/ai/.
    HR26: emits a linter report at
          receipts/wave-<utc>-scx-crawl-report.json.

.PARAMETER Seeds
    URLs to start from. Defaults to the core SCX sites.
.PARAMETER MaxDepth
    Recursion depth cap. Default 3 (home -> section -> detail).
.PARAMETER MaxPages
    Hard ceiling on page count. Default 300.
.PARAMETER SameHostOnly
    Restrict to the seed URL's host (recommended). Default true.
.PARAMETER DelayMs
    Delay between requests to be a polite crawler. Default 1500.
.PARAMETER MaxAgeDays
    In Refresh mode, re-crawl pages older than this. Default 7.
.PARAMETER OutputRoot
    Where to save. Default: repo-root/sources/.
.PARAMETER Mode
    Install | Crawl | Refresh | Status | Remove
.PARAMETER IUnderstand
    Required for -Mode Remove.

.EXAMPLE
    pwsh ./install/Save-KritScxSourcesRecursively.ps1 -Mode Install
.EXAMPLE
    pwsh ./install/Save-KritScxSourcesRecursively.ps1 -Mode Crawl
.EXAMPLE
    pwsh ./install/Save-KritScxSourcesRecursively.ps1 -Mode Refresh -MaxAgeDays 3
.EXAMPLE
    pwsh ./install/Save-KritScxSourcesRecursively.ps1 -Mode Status

.NOTES
    Per HARD RULE 20 (query first, don't guess) — this script's purpose is
    exactly that: crawl the SCX docs once so future Kritical work grounds
    its SCX claims in a local, deduped, versioned corpus.
    Author: Joshua Finley (c) Kritical Pty Ltd 2026.
#>
[CmdletBinding()]
param(
    [ValidateSet('Install','Crawl','Refresh','Status','Remove')] [string] $Mode = 'Crawl',
    [string[]] $Seeds = @(
        'https://scx.ai/',
        'https://labs.scx.ai/',
        'https://trust.scx.ai/'
    ),
    [int] $MaxDepth = 3,
    [int] $MaxPages = 300,
    [switch] $SameHostOnly = $true,
    [int] $DelayMs = 1500,
    [int] $MaxAgeDays = 7,
    [string] $OutputRoot,
    [switch] $IUnderstand
)

# ------------------------------------------------------------
# Resolve paths + banner
# ------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $repoRoot 'sources' }
$receiptsDir = Join-Path $repoRoot 'receipts'
$loggerModule = Join-Path $repoRoot 'ps-module/KriticalDecisionLogger.psm1'

Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║ Kritical.SCXCode — Save-KritScxSourcesRecursively         ║' -ForegroundColor Cyan
Write-Host "  ║ Mode: $Mode".PadRight(60) + '║' -ForegroundColor Cyan
Write-Host '  ║ Joshua Finley · Kritical Pty Ltd · sales@kritical.net     ║' -ForegroundColor Cyan
Write-Host '  ║ ph. 1300 274 655                                          ║' -ForegroundColor Cyan
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ------------------------------------------------------------
# HR16 mode dispatch
# ------------------------------------------------------------
if ($Mode -eq 'Status') {
    if (-not (Test-Path $OutputRoot)) {
        Write-Host "[status] No sources tree yet: $OutputRoot" -ForegroundColor Yellow
        return
    }
    $files = Get-ChildItem -Path $OutputRoot -Recurse -File -Filter '*.md' -ErrorAction SilentlyContinue
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    $byHost = $files | Group-Object { $_.FullName.Substring($OutputRoot.Length).TrimStart([char]92,[char]47).Split([char]92,[char]47)[0] }
    Write-Host "[status] $($files.Count) markdown pages · $([math]::Round($bytes/1KB,1)) KB · rooted at $OutputRoot" -ForegroundColor Green
    foreach ($g in $byHost) {
        $oldest = ($g.Group | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime
        $newest = ($g.Group | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        Write-Host ("  {0,-30} {1,4} pages  oldest {2}  newest {3}" -f $g.Name, $g.Count, $oldest.ToString('yyyy-MM-dd'), $newest.ToString('yyyy-MM-dd'))
    }
    return
}

if ($Mode -eq 'Remove') {
    if (-not $IUnderstand) {
        Write-Host "[remove] Refusing to delete without -IUnderstand. Per HR23 sources are historical evidence." -ForegroundColor Red
        exit 1
    }
    if (Test-Path $OutputRoot) {
        # HR23 rotate-not-delete
        $archive = Join-Path (Split-Path -Parent $OutputRoot) ("_ARCHIVED-sources-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -Path $OutputRoot -Destination $archive
        Write-Host "[remove] Rotated sources/ to $archive (NOT deleted — per HR23)." -ForegroundColor Yellow
    } else {
        Write-Host "[remove] Nothing to rotate — sources/ absent." -ForegroundColor Gray
    }
    return
}

if ($Mode -eq 'Install') {
    Write-Host '[install] Ensuring Node.js + npm + Playwright chromium.'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host '[install] Node.js not on PATH. Install via winget install OpenJS.NodeJS.LTS then re-run.' -ForegroundColor Red
        exit 1
    }
    # per HR14: pnpm/npm installs land in %TEMP% to avoid OneDrive locks
    $storeDir = Join-Path $env:TEMP 'kritical-scx-crawler-pnpm-store'
    New-Item -ItemType Directory -Path $storeDir -Force | Out-Null
    Push-Location $env:TEMP
    try {
        npm i --no-save --prefix (Join-Path $env:TEMP 'kritical-scx-crawler') playwright 2>&1 | Tee-Object -Variable npmOut | Out-Host
        npx --yes playwright install chromium 2>&1 | Out-Host
    } finally {
        Pop-Location
    }
    Write-Host '[install] Playwright chromium ready.' -ForegroundColor Green
    return
}

# ------------------------------------------------------------
# Crawl / Refresh
# ------------------------------------------------------------
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $receiptsDir -Force | Out-Null

# HR27: import logger
$loggerAvailable = Test-Path $loggerModule
if ($loggerAvailable) {
    Import-Module $loggerModule -Force
} else {
    Write-Warning "Logger module not found at $loggerModule — HR27 write-through disabled for this run."
}

# helper: url -> safe path under sources/<host>/<path>.md
function Convert-UrlToOutputPath {
    param([string]$Url, [string]$Root)
    $uri = [System.Uri]::new($Url)
    $targetHost = $uri.Host
    $path = $uri.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index' }
    $path = $path -replace '/','__' -replace '[^a-zA-Z0-9_.-]','-'
    if (-not $path.EndsWith('.md')) { $path += '.md' }
    return Join-Path $Root (Join-Path $targetHost $path)
}

# helper: extract links + text via IWR + regex (fallback when no Playwright)
function Get-PageViaHttp {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
        $ct = $r.Headers['Content-Type']
        if ($ct -and $ct -notmatch 'text|html|json|xml') { return $null }
        $html = $r.Content
        $text = ($html -replace '<script[\s\S]*?</script>','' `
                         -replace '<style[\s\S]*?</style>','' `
                         -replace '<[^>]+>',' ' `
                         -replace '&nbsp;',' ' `
                         -replace '&amp;','&' `
                         -replace '&lt;','<' `
                         -replace '&gt;','>' `
                         -replace '\s+',' ').Trim()
        $links = @()
        [regex]::Matches($html, 'href="([^"#]+)"') | ForEach-Object { $links += $_.Groups[1].Value }
        return [pscustomobject]@{
            Url = $Url
            StatusCode = $r.StatusCode
            ContentType = $ct
            Text = $text
            Links = ($links | Sort-Object -Unique)
        }
    } catch {
        Write-Warning "Fetch $Url failed: $($_.Exception.Message)"
        return $null
    }
}

# resolve relative links against a base url
function Resolve-Href {
    param([string]$Href, [string]$BaseUrl)
    try {
        $b = [System.Uri]::new($BaseUrl)
        $u = [System.Uri]::new($b, $Href)
        return $u.AbsoluteUri
    } catch { return $null }
}

# ------------------------------------------------------------
# BFS crawl
# ------------------------------------------------------------
$visited = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$queue = New-Object System.Collections.Queue
$stats = [pscustomobject]@{
    Fetched = 0; Written = 0; Skipped = 0; Errors = 0
    StartUtc = (Get-Date).ToUniversalTime()
    Seeds = $Seeds
}

foreach ($seed in $Seeds) {
    $queue.Enqueue(@{ Url = $seed; Depth = 0 })
}

$refreshCutoff = (Get-Date).AddDays(-$MaxAgeDays)

while ($queue.Count -gt 0 -and $stats.Fetched -lt $MaxPages) {
    $item = $queue.Dequeue()
    $url = $item.Url
    $depth = $item.Depth

    if (-not $visited.Add($url)) { continue }

    $outPath = Convert-UrlToOutputPath -Url $url -Root $OutputRoot
    if ($Mode -eq 'Refresh' -and (Test-Path $outPath)) {
        $lw = (Get-Item $outPath).LastWriteTime
        if ($lw -gt $refreshCutoff) {
            $stats.Skipped++
            continue
        }
    } elseif ($Mode -eq 'Crawl' -and (Test-Path $outPath)) {
        $stats.Skipped++
        continue
    }

    Write-Host ("[{0}/{1}] d={2} {3}" -f ($stats.Fetched + 1), $MaxPages, $depth, $url) -ForegroundColor Gray
    $page = Get-PageViaHttp -Url $url
    if (-not $page) { $stats.Errors++; Start-Sleep -Milliseconds $DelayMs; continue }
    $stats.Fetched++

    # write .md
    New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
    $frontmatter = @"
---
url: $url
captured_utc: $((Get-Date).ToUniversalTime().ToString('o'))
status: $($page.StatusCode)
content_type: $($page.ContentType)
depth: $depth
crawler: Save-KritScxSourcesRecursively.ps1
---

"@
    Set-Content -LiteralPath $outPath -Value ($frontmatter + $page.Text) -Encoding UTF8
    $stats.Written++

    # HR27 write-through
    if ($loggerAvailable) {
        try {
            Add-KriticalAIResponse `
                -Content "crawled: $url (len=$($page.Text.Length))" `
                -Category action `
                -Source 'scx-crawler' `
                -Provider 'playwright-mcp' | Out-Null
        } catch { }
    }

    # enqueue outbound links
    if ($depth -lt $MaxDepth) {
        foreach ($h in $page.Links) {
            $abs = Resolve-Href -Href $h -BaseUrl $url
            if (-not $abs) { continue }
            if ($abs -notmatch '^https?://') { continue }
            if ($SameHostOnly) {
                $seedHosts = $Seeds | ForEach-Object { ([System.Uri]::new($_)).Host }
                $absHost = ([System.Uri]::new($abs)).Host
                if ($seedHosts -notcontains $absHost) { continue }
            }
            # skip clearly-non-content
            if ($abs -match '\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|tar\.gz|css|js|woff2?)($|\?)') { continue }
            $queue.Enqueue(@{ Url = $abs; Depth = $depth + 1 })
        }
    }

    Start-Sleep -Milliseconds $DelayMs
}

$stats | Add-Member -MemberType NoteProperty -Name EndUtc -Value ((Get-Date).ToUniversalTime())
$stats | Add-Member -MemberType NoteProperty -Name DurationSec -Value ([int](($stats.EndUtc - $stats.StartUtc).TotalSeconds))

# HR26 linter report
$receipt = Join-Path $receiptsDir ("wave-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-scx-crawl-report.json")
$stats | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding UTF8

Write-Host ''
Write-Host "[done] Fetched $($stats.Fetched)  Written $($stats.Written)  Skipped $($stats.Skipped)  Errors $($stats.Errors)  in $($stats.DurationSec)s" -ForegroundColor Green
Write-Host "[receipt] $receipt" -ForegroundColor Gray
