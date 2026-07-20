#Requires -Version 7
<#
.SYNOPSIS
    Install SCX access into VS Code (via Continue.dev, Cline, or Roo Code) using
    the Kritical HKCU env-var convention. Idempotent Install / Remove / Heal /
    Status modes per HR16.

.DESCRIPTION
    - Reads SCX Ben key from
      C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos\scx-benApiKey-MMDDYYYY-vNNN.txt
    - Persists HKCU SCX_API_KEY + KRIT_SCX_MODEL_DEFAULT
    - Drops the Kritical Continue config template to $env:USERPROFILE\.continue\config.json
      (with backup of any prior config to config.json.bak.krit-YYYYMMDD-HHmmss)
    - Verifies Continue extension installed via `code --list-extensions`
    - Emits per-part PASS/FAIL/SKIP/ALREADY/HEALED/REMOVED receipt

.PARAMETER Mode
    Install (default) — set env + drop config + verify Continue installed
    Remove            — remove env vars and config drop; never touch operator-authored config
    Heal              — re-run whatever's missing / broken
    Status            — read-only inventory

.PARAMETER Path
    Continue (default) — drop Continue.dev config template
    Cline              — drop Cline settings (currently docs-only pending Cline settings-file location docs)
    RooCode            — drop Roo Code settings
    All                — apply to every installed extension

.PARAMETER SecretsDir
    Where to find the SCX key file. Defaults to Kritical convention.

.PARAMETER DefaultModel
    Which SCX model to set as KRIT_SCX_MODEL_DEFAULT. Defaults to MiniMax-M2.7.

.EXAMPLE
    pwsh ./Install-KritScxVsCode.ps1
    pwsh ./Install-KritScxVsCode.ps1 -Mode Status
    pwsh ./Install-KritScxVsCode.ps1 -Mode Remove
    pwsh ./Install-KritScxVsCode.ps1 -Path All -Mode Heal
#>
[CmdletBinding()]
param(
    [ValidateSet('Install','Remove','Heal','Status')][string]$Mode = 'Install',
    [ValidateSet('Continue','Cline','RooCode','All')][string]$Path = 'Continue',
    [string]$SecretsDir = 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos',
    [string]$DefaultModel = 'MiniMax-M2.7'
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ContinueDir = Join-Path $env:USERPROFILE '.continue'
$script:ContinueCfg = Join-Path $script:ContinueDir 'config.json'
$script:ReceiptDir = Join-Path $script:RepoRoot 'receipts'
if (-not (Test-Path $script:ReceiptDir)) { New-Item -ItemType Directory -Path $script:ReceiptDir -Force | Out-Null }

function Get-ScxKeyFile {
    $files = Get-ChildItem -LiteralPath $SecretsDir -Filter 'scx-benApiKey-*.txt' -ErrorAction SilentlyContinue
    return ($files | Sort-Object Name -Descending | Select-Object -First 1)
}

function Test-HkcuVar([string]$name) { $v = [Environment]::GetEnvironmentVariable($name, 'User'); return $v -and $v.Length -gt 0 }

function Set-HkcuVar([string]$name, [string]$value) {
    $existing = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($existing -eq $value) { return 'ALREADY' }
    [Environment]::SetEnvironmentVariable($name, $value, 'User')
    if ($existing) { return 'UPDATED' } else { return 'SET' }
}

function Remove-HkcuVar([string]$name) {
    if (-not (Test-HkcuVar $name)) { return 'ALREADY-ABSENT' }
    [Environment]::SetEnvironmentVariable($name, $null, 'User')
    return 'REMOVED'
}

function Test-CodeExtension([string]$id, [string]$CodeExe = 'code') {
    try {
        $exts = & $CodeExe --list-extensions 2>$null
        return ($exts -contains $id)
    } catch { return $false }
}

# .5231 (bughunt) — is the dropped Continue config already present AND a valid Kritical config?
# Used by Heal so a healthy config is never clobbered (which would wipe operator edits to it).
function Test-KritContinueConfigValid {
    if (-not (Test-Path $script:ContinueCfg)) { return $false }
    try {
        $body = Get-Content -LiteralPath $script:ContinueCfg -Raw
        if ($body -notmatch 'Kritical SCX config for Continue.dev') { return $false }  # operator-authored — not ours to judge
        $null = $body | ConvertFrom-Json -ErrorAction Stop                              # must be valid JSON
        return $true
    } catch { return $false }
}

# .5231 (bughunt) — when $Heal is set, only re-install parts that are actually missing/broken.
# A valid, Kritical-authored Continue config is left untouched (Heal must not overwrite operator edits).
function Invoke-InstallContinue([switch]$Heal) {
    $results = [ordered]@{}

    # 1. Read SCX key from Kritical secrets dir
    $keyFile = Get-ScxKeyFile
    if (-not $keyFile) {
        $results['SecretRead'] = 'FAIL: no scx-benApiKey-*.txt in ' + $SecretsDir
        return $results
    }
    $rawKey = (Get-Content -LiteralPath $keyFile.FullName -Raw).Trim()
    $results['SecretRead'] = "OK: $($keyFile.Name) (len=$($rawKey.Length))"

    # 2. HKCU env vars
    $results['HKCU_SCX_API_KEY']            = Set-HkcuVar 'SCX_API_KEY' $rawKey
    $results['HKCU_ANTHROPIC_BASE_URL']     = 'UNTOUCHED: SCXCode never reads, writes, or removes this'
    $results['HKCU_KRIT_SCX_MODEL_DEFAULT'] = Set-HkcuVar 'KRIT_SCX_MODEL_DEFAULT' $DefaultModel

    # 3. Continue installed? (.5165h — detect stable + Insiders, prefer whichever is on PATH)
    $codeExe = $null
    foreach ($cand in 'code', 'code-insiders') {
        if (Get-Command $cand -ErrorAction SilentlyContinue) { $codeExe = $cand; break }
    }
    # Fall back to known install paths if not on PATH
    if (-not $codeExe) {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd",
            "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
            "${env:ProgramFiles}\Microsoft VS Code\bin\code.cmd"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $codeExe = $c; break }
        }
    }
    if (-not $codeExe) {
        $results['ContinueExt'] = 'SKIP: no VS Code (stable or Insiders) found — install manually then re-run'
    } else {
        $results['CodeFlavor'] = "$codeExe"
        if (Test-CodeExtension 'continue.continue' -CodeExe $codeExe) {
            $results['ContinueExt'] = "ALREADY-INSTALLED: continue.continue (via $(Split-Path -Leaf $codeExe))"
        } else {
            Write-Host "  installing continue.continue via $codeExe --install-extension..."
            & $codeExe --install-extension continue.continue | Out-Null
            $results['ContinueExt'] = "INSTALLED via $(Split-Path -Leaf $codeExe)"
        }
        # .5165h — also install the Kritical SCXCode VSIX itself if present in repo
        $vsix = Get-ChildItem (Join-Path $script:RepoRoot 'src\SCXCode-*.vsix') -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending | Select-Object -First 1
        if ($vsix) {
            Write-Host "  installing $($vsix.Name) via $codeExe --install-extension..."
            & $codeExe --install-extension $vsix.FullName | Out-Null
            $results['SCXCodeVsix'] = "INSTALLED: $($vsix.Name) via $(Split-Path -Leaf $codeExe)"
        } else {
            $results['SCXCodeVsix'] = 'SKIP: no VSIX found in src/ — build first via npx vsce package'
        }
    }

    # 4. Drop config template with backup
    if (-not (Test-Path $script:ContinueDir)) { New-Item -ItemType Directory -Path $script:ContinueDir -Force | Out-Null }
    $tpl = Join-Path $script:RepoRoot 'config-templates\continue-config.json'
    if (-not (Test-Path $tpl)) {
        $results['ConfigDrop'] = "FAIL: template not found at $tpl"
    } elseif ($Heal -and (Test-KritContinueConfigValid)) {
        # .5231 (bughunt) — Heal must be idempotent: a valid Kritical config already exists, so leave
        # it (and any operator edits to it) untouched instead of re-dropping the template over the top.
        $results['ConfigDrop'] = 'ALREADY-VALID: Kritical config present — left untouched (Heal)'
    } else {
        if (Test-Path $script:ContinueCfg) {
            $bak = "$script:ContinueCfg.bak.krit-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item -LiteralPath $script:ContinueCfg -Destination $bak
            Copy-Item -LiteralPath $tpl -Destination $script:ContinueCfg -Force
            $results['ConfigDrop'] = "OK: replaced (backup at $bak)"
        } else {
            Copy-Item -LiteralPath $tpl -Destination $script:ContinueCfg
            $results['ConfigDrop'] = "OK: created"
        }
    }

    return $results
}

function Invoke-RemoveContinue {
    $results = [ordered]@{}
    $results['HKCU_SCX_API_KEY']            = Remove-HkcuVar 'SCX_API_KEY'
    $results['HKCU_ANTHROPIC_BASE_URL']     = 'UNTOUCHED: SCXCode never reads, writes, or removes this'
    $results['HKCU_KRIT_SCX_MODEL_DEFAULT'] = Remove-HkcuVar 'KRIT_SCX_MODEL_DEFAULT'
    # Config drop — only remove if it's OURS (matches our template signature)
    if (Test-Path $script:ContinueCfg) {
        $body = Get-Content -LiteralPath $script:ContinueCfg -Raw
        if ($body -match 'Kritical SCX config for Continue.dev') {
            Remove-Item -LiteralPath $script:ContinueCfg -Force
            $results['ConfigDrop'] = 'REMOVED: Kritical-authored config'
        } else {
            $results['ConfigDrop'] = 'SKIPPED: operator-authored config preserved (not Kritical signature)'
        }
    } else {
        $results['ConfigDrop'] = 'ALREADY-ABSENT'
    }
    $results['ContinueExt'] = 'SKIPPED: Continue extension NOT uninstalled — operator may want to keep it'
    return $results
}

function Invoke-Status {
    $results = [ordered]@{}
    $results['SCX_API_KEY_HKCU']          = if (Test-HkcuVar 'SCX_API_KEY')             { 'SET (len=' + ([Environment]::GetEnvironmentVariable('SCX_API_KEY','User').Length) + ')' } else { 'ABSENT' }
    $results['ANTHROPIC_BASE_URL_HKCU']   = 'UNINSPECTED: SCXCode never reads, writes, or removes this'
    $results['KRIT_SCX_MODEL_DEFAULT']    = if (Test-HkcuVar 'KRIT_SCX_MODEL_DEFAULT')  { [Environment]::GetEnvironmentVariable('KRIT_SCX_MODEL_DEFAULT','User') }           else { 'ABSENT' }
    $results['SecretFile']                = if (Get-ScxKeyFile)                        { (Get-ScxKeyFile).Name }                                                             else { 'ABSENT' }
    $results['ContinueExt']               = if (Test-CodeExtension 'continue.continue'){ 'INSTALLED' }                                                                       else { 'NOT-INSTALLED' }
    $results['ContinueConfig']            = if (Test-Path $script:ContinueCfg)         { 'PRESENT (' + (Get-Item $script:ContinueCfg).Length + ' bytes)' }                   else { 'ABSENT' }
    if (Test-Path $script:ContinueCfg) {
        $body = Get-Content -LiteralPath $script:ContinueCfg -Raw
        $results['ContinueConfig_Kritical'] = if ($body -match 'Kritical SCX config for Continue.dev') { 'KRITICAL-AUTHORED' } else { 'OPERATOR-AUTHORED (Install-KritScxVsCode will NOT overwrite without backup)' }
    }
    return $results
}

# --- main dispatch ---
Write-Host "Install-KritScxVsCode.ps1  (Mode=$Mode  Path=$Path)"
Write-Host ""

$results = switch ($Mode) {
    'Install' { if ($Path -in 'Continue','All') { Invoke-InstallContinue } else { [ordered]@{ 'Path' = "TODO: $Path installer pending — see docs/ARCHITECTURE.md" } } }
    'Remove'  { Invoke-RemoveContinue }
    'Heal'    {
        # .5231 (bughunt) — Heal is now idempotent: it still re-runs the installer for missing/broken
        # parts (env vars + extension are individually idempotent), but passes -Heal so a VALID
        # Kritical Continue config is preserved rather than clobbered (which wiped operator edits).
        $s = Invoke-Status
        $missing = $s.GetEnumerator() | Where-Object { $_.Value -match 'ABSENT|NOT-INSTALLED' }
        if (-not $missing) { [ordered]@{ 'Heal' = 'ALL HEALTHY — no action' } }
        else { Write-Host "  detected $($missing.Count) missing/broken part(s) — healing (config preserved if valid)"; Invoke-InstallContinue -Heal }
    }
    'Status'  { Invoke-Status }
}

foreach ($k in $results.Keys) {
    $v = $results[$k]
    $color = switch -Wildcard ($v) {
        'FAIL*'          { 'Red' }
        'SET'            { 'Green' }
        'UPDATED'        { 'Green' }
        'INSTALLED'      { 'Green' }
        'OK*'            { 'Green' }
        'ALREADY*'       { 'Yellow' }
        'REMOVED'        { 'Cyan' }
        'SKIP*'          { 'Yellow' }
        default          { 'White' }
    }
    Write-Host ("  {0,-30} {1}" -f $k, $v) -ForegroundColor $color
}

# Emit receipt
$receipt = [ordered]@{
    tool = 'Install-KritScxVsCode'
    utc = (Get-Date).ToUniversalTime().ToString('o')
    mode = $Mode
    path = $Path
    results = $results
}
$outFile = Join-Path $script:ReceiptDir ("install-krit-scx-vscode-$Mode-$(Get-Date -Format 'yyyyMMdd-HHmmss').json")
$tmp = [IO.Path]::GetTempFileName()
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp -Encoding utf8
Move-Item -LiteralPath $tmp -Destination $outFile -Force
Write-Host ""
Write-Host "  receipt: $outFile"
