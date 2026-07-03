#Requires -Version 7
<#
.SYNOPSIS
    Idempotent installer for the AI CLIs the Kritical supervisor + scx-vscode
    ecosystem can route through. Reuses winget / npm / choco / pip / pipx wherever
    they exist, never re-installs what's already present.  HR16-compliant modes.

.DESCRIPTION
    Providers handled (add rows as new CLIs land — each is a hashtable in $CLI_MAP):
      claude    (@anthropic-ai/claude-code)   -> npm global
      codex     (@openai/codex)               -> npm global
      opencode  (opencode-ai)                 -> npm global
      openai    (openai-cli)                  -> pip
      gemini    (google-cloud-cli or npm)     -> winget preferred
      aider     (aider-chat)                  -> pip / pipx preferred

    Every CLI row declares:
      Check   : path/pattern to detect existing install
      Install : one-shot install command per package manager
      TestCmd : how to verify the install worked (returns non-empty on success)

.PARAMETER Mode
    Install (default) — install everything missing; PATH-heal on completion
    Remove            — uninstall via same PM (never removes if not installed by us)
    Heal              — re-run whatever's missing/broken; safe on already-installed
    Status            — read-only inventory: which CLIs present, versions, PATH state

.PARAMETER Only
    Restrict actions to a subset:  -Only claude,codex,opencode

.PARAMETER SkipPathHeal
    Skip adding AppData\Roaming\npm to HKCU PATH (Install/Heal only).

.EXAMPLE
    pwsh Install-KritAiCLIs.ps1 -Mode Status
    pwsh Install-KritAiCLIs.ps1 -Mode Install -Only codex,opencode
    pwsh Install-KritAiCLIs.ps1 -Mode Heal
#>
[CmdletBinding()]
param(
    [ValidateSet('Install','Remove','Heal','Status')][string]$Mode = 'Install',
    [ValidateSet('claude','codex','opencode','openai','gemini','aider','all')][string[]]$Only = @('all'),
    [switch]$SkipPathHeal
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:NpmPrefix = Join-Path $env:APPDATA 'npm'
$script:ReceiptDir = Join-Path $script:RepoRoot 'receipts'
if (-not (Test-Path $script:ReceiptDir)) { New-Item -ItemType Directory -Path $script:ReceiptDir -Force | Out-Null }

# ────────────────────────────────────────────────────────────────
# CLI registry — add rows here as new CLIs join the fallback chain
# ────────────────────────────────────────────────────────────────
$CLI_MAP = @{
    'claude' = @{
        DisplayName = 'Anthropic Claude Code CLI'
        NpmPackage  = '@anthropic-ai/claude-code'
        BinName     = 'claude.cmd'
        InstallCmd  = { npm install -g @anthropic-ai/claude-code --silent 2>&1 | Out-String }
        RemoveCmd   = { npm uninstall -g @anthropic-ai/claude-code 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://docs.claude.com/claude-code'
    }
    'codex' = @{
        DisplayName = 'OpenAI Codex CLI'
        NpmPackage  = '@openai/codex'
        BinName     = 'codex.cmd'
        InstallCmd  = { npm install -g @openai/codex --silent 2>&1 | Out-String }
        RemoveCmd   = { npm uninstall -g @openai/codex 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://github.com/openai/codex'
    }
    'opencode' = @{
        DisplayName = 'OpenCode AI CLI'
        NpmPackage  = 'opencode-ai'
        BinName     = 'opencode.cmd'
        InstallCmd  = { npm install -g opencode-ai --silent 2>&1 | Out-String }
        RemoveCmd   = { npm uninstall -g opencode-ai 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://opencode.ai'
    }
    'openai' = @{
        DisplayName = 'OpenAI Python CLI'
        PipPackage  = 'openai-cli'
        BinName     = 'openai'
        InstallCmd  = { pip install --user openai-cli --quiet 2>&1 | Out-String }
        RemoveCmd   = { pip uninstall -y openai-cli 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://github.com/janlukasschroeder/openai-cli'
    }
    'aider' = @{
        DisplayName = 'Aider AI pair-programmer'
        PipPackage  = 'aider-chat'
        BinName     = 'aider'
        InstallCmd  = { pip install --user aider-chat --quiet 2>&1 | Out-String }
        RemoveCmd   = { pip uninstall -y aider-chat 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://aider.chat'
    }
    'gemini' = @{
        DisplayName = 'Google Gemini CLI (via gcloud)'
        WingetId    = 'Google.CloudSDK'
        BinName     = 'gcloud.cmd'
        InstallCmd  = { winget install --id Google.CloudSDK -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-String }
        RemoveCmd   = { winget uninstall --id Google.CloudSDK 2>&1 | Out-String }
        TestCmd     = { param($bin) & $bin --version 2>&1 | Out-String }
        Homepage    = 'https://cloud.google.com/sdk'
        Note        = 'gemini access is via gcloud + Vertex AI once installed. Prefer this over standalone pip package.'
    }
}

# ────────────────────────────────────────────────────────────────
# helpers
# ────────────────────────────────────────────────────────────────

function Find-CliBin { param([string]$binName)
    # Try PATH first
    $onPath = Get-Command $binName -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    # Try npm global prefix
    $npmBin = Join-Path $script:NpmPrefix $binName
    if (Test-Path $npmBin) { return $npmBin }
    # Try local user AppData
    $userLocal = Join-Path $env:LOCALAPPDATA "Programs\$($binName -replace '\.cmd$|\.exe$', '')\$binName"
    if (Test-Path $userLocal) { return $userLocal }
    return $null
}

function Test-PackageManager { param([string]$pm)
    return [bool](Get-Command $pm -ErrorAction SilentlyContinue)
}

function Add-NpmPrefixToPath {
    $current = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($current -like "*$script:NpmPrefix*") { return 'ALREADY-IN-PATH' }
    $new = if ($current) { "$current;$script:NpmPrefix" } else { $script:NpmPrefix }
    [Environment]::SetEnvironmentVariable('PATH', $new, 'User')
    # Also update current session
    $env:PATH = "$env:PATH;$script:NpmPrefix"
    return 'ADDED-TO-HKCU-PATH'
}

function Install-OneCLI { param([string]$name, [hashtable]$row)
    $bin = Find-CliBin -binName $row.BinName
    if ($bin) {
        $version = try { (& $row.TestCmd $bin).Trim().Split("`n")[0] } catch { 'unknown' }
        return @{ Status = 'ALREADY-INSTALLED'; Bin = $bin; Version = $version }
    }
    # Choose package manager based on row shape
    $usePM = if ($row.NpmPackage) { 'npm' }
             elseif ($row.PipPackage) { 'pip' }
             elseif ($row.WingetId)   { 'winget' }
             else                     { 'unknown' }
    if (-not (Test-PackageManager $usePM)) {
        return @{ Status = "FAIL-NO-PM ($usePM missing)"; Bin = $null; Version = $null }
    }
    Write-Host "  installing $name via $usePM ..."
    $out = & $row.InstallCmd
    $bin = Find-CliBin -binName $row.BinName
    if ($bin) {
        $version = try { (& $row.TestCmd $bin).Trim().Split("`n")[0] } catch { 'unknown' }
        return @{ Status = 'INSTALLED'; Bin = $bin; Version = $version; Output = ($out -replace "`r`n$", '') }
    }
    return @{ Status = "FAIL-INSTALL-DID-NOT-YIELD-BINARY"; Output = ($out -replace "`r`n$", ''); Bin = $null; Version = $null }
}

function Remove-OneCLI { param([string]$name, [hashtable]$row)
    $bin = Find-CliBin -binName $row.BinName
    if (-not $bin) { return @{ Status = 'ALREADY-ABSENT' } }
    Write-Host "  removing $name ..."
    $out = & $row.RemoveCmd
    $stillHere = Find-CliBin -binName $row.BinName
    if (-not $stillHere) { return @{ Status = 'REMOVED'; Output = ($out -replace "`r`n$", '') } }
    return @{ Status = 'FAIL-STILL-PRESENT'; Bin = $stillHere; Output = ($out -replace "`r`n$", '') }
}

function Get-OneCLIStatus { param([string]$name, [hashtable]$row)
    $bin = Find-CliBin -binName $row.BinName
    if (-not $bin) { return @{ Status = 'ABSENT'; Bin = $null; Version = $null } }
    $version = try { (& $row.TestCmd $bin).Trim().Split("`n")[0] } catch { 'unknown' }
    return @{ Status = 'PRESENT'; Bin = $bin; Version = $version }
}

# ────────────────────────────────────────────────────────────────
# main dispatch
# ────────────────────────────────────────────────────────────────

Write-Host "Install-KritAiCLIs.ps1  (Mode=$Mode  Only=$($Only -join ','))"
Write-Host ""
Write-Host "  npm global prefix : $script:NpmPrefix"
Write-Host "  in HKCU PATH      : $(([Environment]::GetEnvironmentVariable('PATH','User')) -like ""*$script:NpmPrefix*"")"
Write-Host "  package managers  : winget=$(Test-PackageManager winget) npm=$(Test-PackageManager npm) choco=$(Test-PackageManager choco) pip=$(Test-PackageManager pip) pipx=$(Test-PackageManager pipx)"
Write-Host ""

$targets = if ($Only -contains 'all') { $CLI_MAP.Keys } else { $Only }
$results = [ordered]@{}

foreach ($name in $targets) {
    $row = $CLI_MAP[$name]
    if (-not $row) { $results[$name] = @{ Status = "UNKNOWN-CLI" }; continue }
    Write-Host "== $name ($($row.DisplayName)) =="
    $results[$name] = switch ($Mode) {
        'Install' { Install-OneCLI -name $name -row $row }
        'Remove'  { Remove-OneCLI -name $name -row $row }
        'Heal'    { $s = Get-OneCLIStatus -name $name -row $row; if ($s.Status -eq 'PRESENT') { $s } else { Install-OneCLI -name $name -row $row } }
        'Status'  { Get-OneCLIStatus -name $name -row $row }
    }
    $r = $results[$name]
    $color = switch -Wildcard ($r.Status) {
        'PRESENT'          { 'Green' }
        'INSTALLED'        { 'Green' }
        'ALREADY-*'        { 'Yellow' }
        'REMOVED'          { 'Cyan' }
        'FAIL*'            { 'Red' }
        'ABSENT'           { 'Yellow' }
        default            { 'White' }
    }
    Write-Host ("   status  : {0}" -f $r.Status) -ForegroundColor $color
    if ($r.Bin)     { Write-Host ("   bin     : {0}" -f $r.Bin) }
    if ($r.Version) { Write-Host ("   version : {0}" -f $r.Version) }
    Write-Host ""
}

# Optional PATH heal (Install/Heal only)
if ($Mode -in 'Install','Heal' -and -not $SkipPathHeal) {
    Write-Host "== PATH heal =="
    $pathResult = Add-NpmPrefixToPath
    $results['_pathHeal'] = @{ Status = $pathResult }
    Write-Host "   $pathResult"
    Write-Host ""
}

# Emit receipt
$receipt = [ordered]@{
    tool = 'Install-KritAiCLIs'
    utc  = (Get-Date).ToUniversalTime().ToString('o')
    mode = $Mode
    only = $Only
    results = $results
}
$outFile = Join-Path $script:ReceiptDir ("install-krit-ai-clis-$Mode-$(Get-Date -Format 'yyyyMMdd-HHmmss').json")
$tmp = [IO.Path]::GetTempFileName()
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp -Encoding utf8
Move-Item -LiteralPath $tmp -Destination $outFile -Force
Write-Host "  receipt: $outFile"
