#requires -Version 7.0
<#
.SYNOPSIS
    kritical-openrouter — OpenRouter/free agentic Codex wrapper.

.DESCRIPTION
    Runs your existing `codex` CLI pointed at OpenRouter's /free endpoint,
    giving you free inference from a rotating pool of frontier models.

    - Uses your REAL ~/.codex home (full MCP reuse) — NEVER modifies it.
    - All settings passed as per-invocation -c overrides (HR29 additive).
    - Defaults to direct OpenRouter so SCX 429s cannot be hit accidentally.
    - Optional local-router mode uses the LiteLLM master key and local model names.
    - Supports reasoning tokens and streaming.

.PARAMETER Model
    Force a specific OpenRouter model slug. Default: openrouter/free
.PARAMETER UseLocalRouter
    Route through the local Kritical free router on 127.0.0.1:4182 instead of OpenRouter direct.
.PARAMETER AllowScxFallback
    Permit fallback to SCX direct if OpenRouter is unavailable. Off by default.
.PARAMETER NoBanner
    Skip the Kritical brand banner.
.PARAMETER CodexArgs
    Everything after wrapper params is passed through to codex.
.PARAMETER Exec
    Run `codex exec` non-interactively.
.PARAMETER Prompt
    Prompt to pass to `codex exec` when -Exec is supplied.
.PARAMETER Bypass
    Pass Codex's explicit bypass flag for automation in trusted worktrees.
.PARAMETER RawCodexOutput
    Do not filter known noisy Codex metadata diagnostics in -Exec mode.
.PARAMETER Isolated
    For -Exec smoke/proof runs, ignore user config/rules and avoid MCP startup.

.EXAMPLE
    pwsh ./kritical-openrouter.ps1
.EXAMPLE
    pwsh ./kritical-openrouter.ps1 -Exec -Prompt "refactor this file"
.EXAMPLE
    pwsh ./kritical-openrouter.ps1 -Model openrouter/free -Exec -Prompt "review"

.NOTES
    Author: Joshua Finley — (c) 2026 Kritical Pty Ltd
    Contact: sales@kritical.net · ph. 1300 274 655
    HR1/HR29 (additive, SCX-compatible) · HR27 (logged)
#>
[CmdletBinding()]
param(
    [string] $Model = 'openrouter/free',
    [switch] $NoBanner,
    [switch] $UseLocalRouter,
    [switch] $AllowScxFallback,
    [switch] $Exec,
    [string] $Prompt,
    [switch] $Bypass,
    [switch] $RawCodexOutput,
    [switch] $Isolated,
    [Parameter(ValueFromRemainingArguments)] [string[]] $CodexArgs
)

$repoRoot   = Split-Path -Parent $PSScriptRoot
$assetsDir  = Join-Path $repoRoot 'assets'
$bannerPath = Join-Path $assetsDir 'KriticalLogo.txt'

# Endpoint resolution: local router -> direct OpenRouter -> SCX fallback
$localRouter = 'http://127.0.0.1:4182/v1'
$openRouter  = 'https://openrouter.ai/api/v1'

function Test-Endpoint($url) {
    try { (Invoke-WebRequest "$url/health/liveliness" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

function Get-KritEnvValue {
    param([Parameter(Mandatory)] [string] $Name, [string] $Default)
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, 'User') }
    if (-not $value) { $value = $Default }
    return $value
}

# Resolve endpoint priority
$baseUrl = $null
if ($UseLocalRouter) {
    if (Test-Endpoint ($localRouter -replace '/v1$','')) { $baseUrl = $localRouter }
    else {
        Write-Host 'ERROR: Local Kritical free router is not listening on 127.0.0.1:4182.' -ForegroundColor Red
        Write-Host '  Start it: pwsh .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config free' -ForegroundColor Gray
        exit 1
    }
}
else {
    # Direct OpenRouter — test with a lightweight call.
    $orKey = Get-KritEnvValue -Name 'OPENROUTER_API_KEY'
    if ($orKey) {
        try {
            Invoke-RestMethod -Uri "$openRouter/models" -Headers @{ Authorization = "Bearer $orKey" } -TimeoutSec 5 | Out-Null
            $baseUrl = $openRouter
        }
        catch { $baseUrl = $null }
    }
}

if (-not $baseUrl -and $AllowScxFallback) {
    $scxKey = Get-KritEnvValue -Name 'SCX_API_KEY'
    if ($scxKey) {
        $baseUrl = 'https://api.scx.ai/v1'
        if ($Model -eq 'openrouter/free') { $Model = 'MiniMax-M2.7' }
        Write-Host 'OpenRouter unavailable — falling back to SCX direct' -ForegroundColor Yellow
    }
}

if (-not $baseUrl) {
    Write-Host 'ERROR: OpenRouter unavailable. Load OPENROUTER_API_KEY before using this wrapper.' -ForegroundColor Red
    Write-Host '  pwsh .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly' -ForegroundColor Gray
    Write-Host '  or persist it with -PersistUser if you want new shells to inherit it.' -ForegroundColor Gray
    exit 1
}

# Resolve key
$envKey = if ($baseUrl -eq $openRouter) {
    'OPENROUTER_API_KEY'
}
elseif ($baseUrl -eq $localRouter) {
    if ($Model -eq 'openrouter/free') { $Model = 'free-default' }
    if (-not (Get-KritEnvValue -Name 'KRIT_FREE_ROUTER_MASTER_KEY')) {
        $env:KRIT_FREE_ROUTER_MASTER_KEY = 'sk-kritical-free-local'
    }
    'KRIT_FREE_ROUTER_MASTER_KEY'
}
else {
    'SCX_API_KEY'
}

# Banner
if (-not $NoBanner) {
    if (Test-Path $bannerPath) { try { Write-Host (Get-Content -LiteralPath $bannerPath -Raw) -ForegroundColor Cyan } catch {} }
    Write-Host ''
    Write-Host '  Your last call. And your first move.' -ForegroundColor DarkCyan
    Write-Host "  Geelong & The Bellarine's IT & Cybersecurity Specialists" -ForegroundColor DarkCyan
    Write-Host '  Kritical Pty Ltd · sales@kritical.net · ph. 1300 274 655' -ForegroundColor DarkCyan
    Write-Host '  Free AI Inference — powered by OpenRouter + Kritical Router' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  ══ Kritical.OpenRouter.Codex ══  Free frontier models, agentically' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "  Endpoint: $baseUrl" -ForegroundColor Gray
    Write-Host "  Model:    $Model" -ForegroundColor Gray
    Write-Host "  Key env:  $envKey" -ForegroundColor Gray
    Write-Host '  Your real ~/.codex (MCP servers, plugins) is reused but NEVER modified.' -ForegroundColor DarkGray
    Write-Host ''
}

# Resolve codex CLI
function Resolve-CodexCommand {
    $compiled = 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe'
    if (Test-Path $compiled -ErrorAction SilentlyContinue) { return $compiled }
    $c = Get-Command codex -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    $cands = @(
        (Join-Path $env:APPDATA 'npm\codex.cmd'),
        (Join-Path $env:APPDATA 'npm\codex.ps1'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\codex.exe')
    ) | Where-Object { $_ -and (Test-Path $_ -ErrorAction SilentlyContinue) }
    if ($cands.Count) { return $cands[0] }
    return $null
}
$codexCmd = Resolve-CodexCommand
if (-not $codexCmd) {
    Write-Host 'codex CLI not found. Install: npm install -g @openai/codex' -ForegroundColor Red
    exit 2
}

# Launch codex with OpenRouter routing as per-invocation overrides
$overrides = @(
    '-c', 'model_provider=openrouter',
    '-c', 'model_providers.openrouter.name="OpenRouter"',
    '-c', "model_providers.openrouter.base_url=`"$baseUrl`"",
    '-c', "model_providers.openrouter.env_key=`"$envKey`"",
    '-c', 'model_providers.openrouter.wire_api="responses"',
    '-c', "model=`"$Model`""
)

# Pass additional OpenRouter headers via env (for rankings)
$env:HTTP_REFERER = 'https://kritical.net'
$env:X_TITLE = 'Kritical OpenRouter Codex'

$lastMessagePath = $null
if ($Exec) {
    if (-not $Prompt) {
        Write-Host 'ERROR: -Exec requires -Prompt.' -ForegroundColor Red
        exit 1
    }
    $execArgs = @('exec', '--skip-git-repo-check', '--color', 'never')
    if ($Isolated) { $execArgs += @('--ignore-user-config', '--ignore-rules', '--ephemeral') }
    if (-not $RawCodexOutput) {
        $lastMessagePath = Join-Path $env:TEMP ("kritical-openrouter-codex-last-{0}.txt" -f ([guid]::NewGuid().ToString('n')))
        $execArgs += @('--output-last-message', $lastMessagePath)
    }
    if ($Bypass) { $execArgs += '--dangerously-bypass-approvals-and-sandbox' }
    $execArgs += $Prompt
    $CodexArgs = $execArgs + @($CodexArgs)
}
$CodexArgs = @($CodexArgs | Where-Object { $null -ne $_ -and [string]$_ -ne '' })

try {
    if ($Exec -and -not $RawCodexOutput) {
        $out = & $codexCmd @overrides @CodexArgs 2>&1
        $exit = $LASTEXITCODE
        if ($exit -eq 0 -and $lastMessagePath -and (Test-Path -LiteralPath $lastMessagePath)) {
            Get-Content -LiteralPath $lastMessagePath -Raw
        }
        else {
            foreach ($line in @($out)) {
                $text = [string]$line
                if ($text -match 'failed to refresh available models:.*missing field `models`') {
                    Write-Host 'Codex metadata refresh warning: OpenRouter /models shape is not Codex-native; inference still uses the requested OpenRouter model.' -ForegroundColor DarkYellow
                    continue
                }
                if ($text -match '^(\s*)body:\s*\{"data":') { continue }
                Write-Output $line
            }
        }
    }
    else {
        & $codexCmd @overrides @CodexArgs
        $exit = $LASTEXITCODE
    }
}
finally {
    # Cleanup
}
exit $exit
