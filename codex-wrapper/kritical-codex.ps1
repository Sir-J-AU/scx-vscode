#requires -Version 7.0
<#
.SYNOPSIS
    kritical-codex — SCX-branded, agentic OpenAI Codex against Southern Cross AI.

.DESCRIPTION
    Runs your existing `codex` CLI pointed at SCX, agentically, with SCX_API_KEY only:

      - Uses your REAL ~/.codex home, so every MCP server, connector and plugin you already
        have is available (full reuse) — but NEVER modifies ~/.codex. All SCX settings are
        passed as per-invocation `-c` overrides, so vanilla `codex` (run without this wrapper)
        is 100% untouched (HR29).
      - Routes through the local flatten-shim (scx-agentic-shim.mjs on 127.0.0.1:4199), which
        makes codex's agentic tools work on SCX. Auto-starts the shim if it isn't running.
      - Picks an AGENTIC-CAPABLE SCX model (models that emit tool calls — see
        ../docs/SCX-AGENTIC-BRIDGE-SPEC.md §1f). Follows the VS Code extension's current model
        selection when it's agentic-capable, else falls back to `coder`.
      - NEVER touches OPENAI_* / ANTHROPIC_* env or config (HR1/HR29). SCX_API_KEY only.

.PARAMETER Model      Force a specific SCX model. Default: extension's current selection, else `coder`.
.PARAMETER NoBanner   Skip the Kritical brand banner.
.PARAMETER NoLog      Skip HR27 write-through.
.PARAMETER NoShim     Point codex straight at api.scx.ai (no shim) — non-agentic / chat only.
.PARAMETER CodexArgs  Everything after the wrapper's own params is passed through to codex.

.EXAMPLE  pwsh ./kritical-codex.ps1
.EXAMPLE  pwsh ./kritical-codex.ps1 -Model MiniMax-M2.7 -- exec "review this file"

.NOTES  Joshua Finley — Kritical Pty Ltd — (c) 2026 — sales@kritical.net — 1300 274 655.
        HR1/HR29 (SCX-only, additive) · HR27 (logged) · HR28 (mechanism names).
#>
[CmdletBinding()]
param(
    # NOTE: for scripted passthrough pass codex args via -CodexArgs (e.g. -CodexArgs exec,--skip-git-repo-check).
    # The VS Code button launches with no args -> interactive codex, so this never bites there.
    [string] $Model,
    [switch] $NoBanner,
    [switch] $NoLog,
    [switch] $NoShim,
    [Parameter(ValueFromRemainingArguments)] [string[]] $CodexArgs
)

$repoRoot    = Split-Path -Parent $PSScriptRoot
$assetsDir   = Join-Path $PSScriptRoot 'assets'
$bannerPath  = Join-Path $assetsDir 'KriticalLogo.txt'
$brandSpec   = Join-Path $assetsDir 'brand-spec.json'
$shimScript  = Join-Path $PSScriptRoot 'scx-agentic-shim.mjs'
$shimPort    = 4199
$shimBase    = "http://127.0.0.1:$shimPort/v1"
$scxDirect   = 'https://api.scx.ai/v1'

# Models proven to drive agentic codex on SCX (emit tool calls AND accepted by codex through the shim).
# NOTE: 'coder' emits function_calls fine on the raw API but codex rejects it with model_not_found
# (reserved-name clash) — so it's excluded here; use it in the chat panel instead. MAGPiE / Qwen3-32B
# are chat-only (no tool calls). See spec §1f.
$agenticModels = @('gpt-oss-120b','MiniMax-M2.7','gemma-4-31B-it','Meta-Llama-3.3-70B-Instruct','Llama-4-Maverick-17B-128E-Instruct')
$defaultAgentic = 'MiniMax-M2.7'

# HR1/HR29: SCX key only. We never read/write OPENAI_* or ANTHROPIC_*.
$scxKey = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User'); if (-not $scxKey) { $scxKey = $env:SCX_API_KEY }
if (-not $scxKey) {
    Write-Host 'SCX_API_KEY is not set (HKCU). Set it, then re-run kritical-codex.ps1.' -ForegroundColor Red
    exit 3
}

# ------------------------------------------------------------
# Resolve an AGENTIC-CAPABLE model (follow the extension's current selection when possible)
# ------------------------------------------------------------
# .5231 (bughunt) — track WHERE $Model came from so the auto-correct warning can be accurate:
# an explicit -Model (operator typed it) vs. the shared VS Code selection file.
$modelFromSharedFile = $false
if (-not $Model) {
    $sharedModel = Join-Path $env:USERPROFILE '.kritical-scx\current-model.json'
    if (Test-Path $sharedModel) { try { $Model = (Get-Content $sharedModel -Raw | ConvertFrom-Json).id; if ($Model) { $modelFromSharedFile = $true } } catch {} }
}
if ($Model) {
    # accept case-insensitively; snap to the canonical agentic id
    $match = $agenticModels | Where-Object { $_ -ieq $Model } | Select-Object -First 1
    if ($match) { $Model = $match }
    elseif ($Model -notin $agenticModels) {
        # .5231 (bughunt) — the old message always said "Override with -Model", which is misleading
        # when the value came from the shared current-model.json (the VS Code model selection). Word
        # the guidance based on the actual source of $Model.
        if ($modelFromSharedFile) {
            Write-Host "  '$Model' (from the VS Code model selection / shared current-model.json) can't drive agentic codex on SCX — using '$defaultAgentic' this session. Pick an agentic model in VS Code, or pass -Model to override." -ForegroundColor DarkYellow
        } else {
            Write-Host "  '$Model' can't drive agentic codex on SCX — using '$defaultAgentic' this session. Override with -Model." -ForegroundColor DarkYellow
        }
        $Model = $defaultAgentic
    }
} else { $Model = $defaultAgentic }

# ------------------------------------------------------------
# Endpoint: shim (agentic) unless -NoShim
# ------------------------------------------------------------
function Test-ShimHealthy { try { (Invoke-WebRequest "http://127.0.0.1:$shimPort/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
$baseUrl = if ($NoShim) { $scxDirect } else { $shimBase }
$shimStartedByUs = $false

if (-not $NoShim -and -not (Test-ShimHealthy)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { Write-Host 'node not found — cannot start the agentic shim. Install Node >= 20, or use -NoShim for chat-only.' -ForegroundColor Red; exit 4 }
    Write-Host "  Starting SCX agentic shim on 127.0.0.1:$shimPort ..." -ForegroundColor DarkGray
    # .5231 (bughunt-confirmed) — Start-Process inherits the CURRENT process env, so explicitly pin the
    # values the shim reads (KRIT_SHIM_PORT / KRIT_SHIM_UPSTREAM / SCX_API_KEY). Without this the shim
    # falls back to ITS OWN defaults — so a non-default -ShimPort silently mismatches the health probe,
    # and the HKCU-resolved SCX key may never reach the child (breaking auth on a fresh session).
    $env:SCX_API_KEY       = $scxKey
    $env:KRIT_SHIM_PORT    = "$shimPort"
    $env:KRIT_SHIM_UPSTREAM = $scxDirect
    $shimProc = Start-Process node -ArgumentList "`"$shimScript`"" -WindowStyle Hidden -PassThru
    $shimStartedByUs = $true
    $shimPid = $shimProc.Id   # .5231 — track the exact PID we launched for a safe teardown
    for ($i = 0; $i -lt 15 -and -not (Test-ShimHealthy); $i++) { Start-Sleep -Milliseconds 400 }
    if (-not (Test-ShimHealthy)) { Write-Host '  shim did not become healthy — falling back to direct (chat-only).' -ForegroundColor Yellow; $baseUrl = $scxDirect; $NoShim = $true }
}

# ------------------------------------------------------------
# Kritical brand banner (once)
# ------------------------------------------------------------
if (-not $NoBanner) {
    if (Test-Path $bannerPath) { try { Write-Host (Get-Content -LiteralPath $bannerPath -Raw) -ForegroundColor Cyan } catch {} }
    $tag = 'Your last call. And your first move.'; $pos = "Geelong & The Bellarine's IT & Cybersecurity Specialists"
    $phone = '1300 274 655'; $email = 'sales@kritical.net'
    if (Test-Path $brandSpec) { try { $s = Get-Content -LiteralPath $brandSpec -Raw | ConvertFrom-Json; if ($s.messaging.tagline) { $tag = $s.messaging.tagline }; if ($s.messaging.positioning) { $pos = $s.messaging.positioning }; if ($s.contact.phoneMain) { $phone = $s.contact.phoneMain }; if ($s.contact.emailSales) { $email = $s.contact.emailSales } } catch {} }
    Write-Host ''
    Write-Host "  $tag" -ForegroundColor DarkCyan
    Write-Host "  $pos" -ForegroundColor DarkCyan
    Write-Host "  Kritical Pty Ltd · $email · ph. $phone" -ForegroundColor DarkCyan
    Write-Host '  Sovereign Australian AI — powered by Southern Cross AI (SCX)' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  ══ Kritical.SCXCodex ══  OpenAI Codex, customised for Southern Cross AI' -ForegroundColor Cyan
    Write-Host '     https://scx.ai · a Seriously Kritical(TM) Production · vanilla codex untouched' -ForegroundColor DarkCyan
    Write-Host ''
    Write-Host "  Agentic codex on SCX · model: $Model · endpoint: $baseUrl" -ForegroundColor Gray
    Write-Host '  Your real ~/.codex (MCP servers, plugins) is reused but NEVER modified.' -ForegroundColor DarkGray
    Write-Host ''
}

# ------------------------------------------------------------
# HR27 write-through (best effort)
# ------------------------------------------------------------
if (-not $NoLog) {
    $loggerPath = Join-Path $repoRoot 'ps-module/KriticalDecisionLogger.psm1'
    if (Test-Path $loggerPath) {
        try {
            Import-Module $loggerPath -Force -ErrorAction SilentlyContinue
            if (Get-Command Add-KriticalAIResponse -ErrorAction SilentlyContinue) {
                $inv = @{ wrapper = 'kritical-codex.ps1'; model = $Model; base_url = $baseUrl; shim = (-not $NoShim); codex_args = ($CodexArgs -join ' '); pwd = (Get-Location).Path } | ConvertTo-Json -Compress
                Add-KriticalAIResponse -Content "kritical-codex invocation: $inv" -Category action -Source 'kritical-codex-wrapper' -Provider 'scx' -Model $Model | Out-Null
            }
        } catch {}
    }
}

# ------------------------------------------------------------
# Resolve codex CLI (robust across npm shim / arm64 vendor exe / winget / cargo / brew)
# ------------------------------------------------------------
function Resolve-CodexCommand {
    # Prefer the compiled branded package when installed. This keeps the VS Code "SCX Codex"
    # button on Kritical.SCXCodex.exe instead of silently falling back to a stock `codex` on PATH.
    $compiled = 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe'
    if (Test-Path $compiled -ErrorAction SilentlyContinue) { return $compiled }
    $pinned = [Environment]::GetEnvironmentVariable('KRITICAL_SCXCODEX_PATH','Process')
    if ($pinned -and (Test-Path $pinned -ErrorAction SilentlyContinue)) { return $pinned }
    $pinnedUser = [Environment]::GetEnvironmentVariable('KRITICAL_SCXCODEX_PATH','User')
    if ($pinnedUser -and (Test-Path $pinnedUser -ErrorAction SilentlyContinue)) { return $pinnedUser }
    $c = Get-Command codex -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    $cands = @(
        (Join-Path $env:APPDATA 'npm\codex.cmd'), (Join-Path $env:APPDATA 'npm\codex.ps1'),
        [Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','Process'),
        (Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-arm64\vendor\aarch64-pc-windows-msvc\bin\codex.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\codex.exe'), (Join-Path $env:USERPROFILE '.cargo\bin\codex.exe'),
        '/opt/homebrew/bin/codex', '/usr/local/bin/codex'
    ) | Where-Object { $_ -and (Test-Path $_ -ErrorAction SilentlyContinue) }
    if ($cands.Count) { return $cands[0] }
    return $null
}
$codexCmd = Resolve-CodexCommand
if (-not $codexCmd) {
    Write-Host 'codex CLI not found (checked PATH, npm-global, winget, cargo, brew).' -ForegroundColor Red
    Write-Host '  Install: npm install -g @openai/codex   (or winget install OpenAI.Codex)' -ForegroundColor Yellow
    exit 2
}

# ------------------------------------------------------------
# Launch codex with SCX routing as per-invocation -c OVERRIDES.
# These never touch ~/.codex on disk — vanilla codex stays pristine.
# ------------------------------------------------------------
$overrides = @(
    '-c', 'model_provider=scx',
    '-c', 'model_providers.scx.name="Southern Cross AI"',
    '-c', "model_providers.scx.base_url=`"$baseUrl`"",
    '-c', 'model_providers.scx.env_key="SCX_API_KEY"',
    '-c', 'model_providers.scx.wire_api="responses"',
    '-c', "model=`"$Model`""
)
try {
    & $codexCmd @overrides @CodexArgs
    $exit = $LASTEXITCODE
} finally {
    # HR29 kill switch: if we started the shim for this session, take it down again.
    # .5231 (bughunt-confirmed) — kill the EXACT node PID we launched, with an identity check. The old
    # code killed whoever owned $shimPort at teardown — if our shim had already died and another process
    # (or an unrelated dev server) grabbed 4199, it would force-kill that innocent process.
    if ($shimStartedByUs -and $shimPid) {
        try {
            $sp = Get-Process -Id $shimPid -ErrorAction SilentlyContinue
            if ($sp -and $sp.ProcessName -eq 'node') { Stop-Process -Id $shimPid -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
}
exit $exit
