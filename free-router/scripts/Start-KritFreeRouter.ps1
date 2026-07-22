#requires -Version 7.0
<#
.SYNOPSIS
    Start the Kritical Free LLM Router — LiteLLM proxy with free-first routing.

.DESCRIPTION
    Idempotent 4-mode launcher (HR16) for the free-provider LiteLLM config:
      -Mode Start   : Start the free router on localhost
      -Mode Stop    : Stop the router
      -Mode Heal    : Verify and restart if unhealthy
      -Mode Status  : Print state + probe health

    Binds to 127.0.0.1:4182 by default (free tier port).
    Also supports starting the SCX+OpenRouter hybrid on :4180.

.PARAMETER Mode
    Start | Stop | Heal | Status
.PARAMETER Config
    Which config to load:
      'free'      -> kritical-scx-free.config.yaml (default, port 4182)
      'openrouter'-> kritical-scx-openrouter.config.yaml (port 4180)
      'scx'       -> kritical-scx.config.yaml (port 4180)
.PARAMETER Port
    Override the default port.
.PARAMETER Host
    Bind address. Default 127.0.0.1.

.EXAMPLE
    pwsh ./Start-KritFreeRouter.ps1 -Mode Start
.EXAMPLE
    pwsh ./Start-KritFreeRouter.ps1 -Mode Status
.EXAMPLE
    pwsh ./Start-KritFreeRouter.ps1 -Mode Start -Config openrouter

.NOTES
    Author: Joshua Finley — (c) 2026 Kritical Pty Ltd
    Contact: sales@kritical.net · ph. 1300 274 655
    HR16 (idempotent modes) · HR17 (probe before claiming started) · HR29 (additive)
#>
[CmdletBinding()]
param(
    [ValidateSet('Start','Stop','Heal','Status')] [string] $Mode = 'Status',
    [ValidateSet('free','openrouter','scx')] [string] $Config = 'free',
    [int] $Port = 0,  # 0 = auto from config
    [string] $BindHost = '127.0.0.1',
    [string] $PythonExe = 'python'
)

# ------------------------------------------------------------
# Resolve paths
# ------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
$configs = @{
    free       = Join-Path $repoRoot 'litellm\kritical-scx-free.config.yaml'
    openrouter = Join-Path $repoRoot 'litellm\kritical-scx-openrouter.config.yaml'
    scx        = Join-Path $repoRoot 'litellm\kritical-scx.config.yaml'
}
$defaultPorts = @{ free = 4182; openrouter = 4180; scx = 4180 }

$configPath = $configs[$Config]
if (-not (Test-Path $configPath)) {
    # Fall back to looking in parent repo
    $parentLitellm = Join-Path (Split-Path -Parent $repoRoot) 'litellm'
    $configs2 = @{
        free       = Join-Path $parentLitellm 'kritical-scx-free.config.yaml'
        openrouter = Join-Path $parentLitellm 'kritical-scx-openrouter.config.yaml'
        scx        = Join-Path $parentLitellm 'kritical-scx.config.yaml'
    }
    $configPath = $configs2[$Config]
}

if ($Port -eq 0) { $Port = $defaultPorts[$Config] }

$pidFile = Join-Path $env:LOCALAPPDATA "Kritical\SCXCode\litellm-$Config.pid"
$logFile = Join-Path $env:LOCALAPPDATA "Kritical\SCXCode\litellm-$Config.log"

# ------------------------------------------------------------
# Banner
# ------------------------------------------------------------
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║ Kritical Free LLM Router                                 ║' -ForegroundColor Cyan
Write-Host ("  ║ Mode: $Mode  |  Config: $Config  |  Port: $Port".PadRight(60) + '║') -ForegroundColor Cyan
Write-Host '  ║ Joshua Finley · Kritical Pty Ltd · sales@kritical.net     ║' -ForegroundColor Cyan
Write-Host '  ║ ph. 1300 274 655                                          ║' -ForegroundColor Cyan
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
function Test-RouterHealth {
    param([int]$Port, [string]$BindHost = '127.0.0.1')
    try {
        $r = Invoke-WebRequest -Uri "http://$BindHost`:$Port/health/liveliness" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $r.StatusCode -eq 200
    }
    catch { return $false }
}

function Get-RouterPid {
    if (Test-Path $pidFile) {
        try {
            $procId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) { return $procId }
        }
        catch {}
    }
    return $null
}

# ------------------------------------------------------------
# STATUS
# ------------------------------------------------------------
if ($Mode -eq 'Status') {
    Write-Host '--- Provider keys (HKCU) ---' -ForegroundColor Cyan
    $keyVars = @('OPENROUTER_API_KEY','GOOGLE_API_KEY','GROQ_API_KEY','TOGETHER_API_KEY',
                 'FIREWORKS_API_KEY','DEEPSEEK_API_KEY','COHERE_API_KEY','MISTRAL_API_KEY','SCX_API_KEY')
    $keyVars | ForEach-Object {
        $val = [Environment]::GetEnvironmentVariable($_, 'User')
        $color = if ($val) { 'Green' } else { 'Yellow' }
        $status = if ($val) { "present (len=$($val.Length))" } else { 'ABSENT' }
        Write-Host "  $_ : $status" -ForegroundColor $color
    }

    Write-Host ''
    Write-Host '--- Toolchain ---' -ForegroundColor Cyan
    $pyOk = Get-Command $PythonExe -ErrorAction SilentlyContinue
    Write-Host ('  Python:          ' + $(if ($pyOk) { $pyOk.Source } else { 'ABSENT' })) -ForegroundColor $(if ($pyOk) { 'Green' } else { 'Red' })
    $litellmOk = Get-Command litellm -ErrorAction SilentlyContinue
    Write-Host ('  litellm command: ' + $(if ($litellmOk) { $litellmOk.Source } else { 'ABSENT' })) -ForegroundColor $(if ($litellmOk) { 'Green' } else { 'Yellow' })
    Write-Host ('  Config file:     ' + $(if (Test-Path $configPath) { $configPath } else { 'ABSENT' })) -ForegroundColor $(if (Test-Path $configPath) { 'Green' } else { 'Red' })

    Write-Host ''
    Write-Host '--- Router state ---' -ForegroundColor Cyan
    $routerPid = Get-RouterPid
    Write-Host ('  PID file:        ' + $(if ($routerPid) { "$pidFile (PID=$routerPid)" } else { 'no live PID' })) -ForegroundColor $(if ($routerPid) { 'Green' } else { 'Yellow' })
    $healthy = Test-RouterHealth -Port $Port -BindHost $BindHost
    Write-Host ('  /health:         ' + $(if ($healthy) { "http://$BindHost`:$Port — HEALTHY" } else { 'unreachable' })) -ForegroundColor $(if ($healthy) { 'Green' } else { 'Yellow' })

    Write-Host ''
    Write-Host '--- HR29 kill switch ---' -ForegroundColor Cyan
    Write-Host "  Stop:  pwsh ./Start-KritFreeRouter.ps1 -Mode Stop -Config $Config" -ForegroundColor Yellow
    return
}

# ------------------------------------------------------------
# STOP
# ------------------------------------------------------------
if ($Mode -eq 'Stop') {
    $routerPid = Get-RouterPid
    if ($routerPid) {
        Write-Host "Stopping router (PID $routerPid)..." -ForegroundColor Yellow
        try { Stop-Process -Id $routerPid -Force } catch {}
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        Write-Host 'Router stopped.' -ForegroundColor Green
    }
    else {
        Write-Host 'No running router found.' -ForegroundColor Yellow
    }
    return
}

# ------------------------------------------------------------
# START
# ------------------------------------------------------------
if ($Mode -eq 'Start') {
    # Preflight checks
    if (-not (Test-Path $configPath)) {
        Write-Host "Config not found: $configPath" -ForegroundColor Red
        exit 1
    }

    $py = Get-Command $PythonExe -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Host "Python not found ($PythonExe). Install Python 3.10+ first." -ForegroundColor Red
        exit 1
    }

    $litellmOk = Get-Command litellm -ErrorAction SilentlyContinue
    if (-not $litellmOk) {
        Write-Host 'Installing litellm[proxy]...' -ForegroundColor Yellow
        & $PythonExe -m pip install --user --upgrade 'litellm[proxy]' 2>&1 | Out-Host
        $userScripts = "$env:APPDATA\Python\Scripts"
        if (Test-Path $userScripts) { $env:PATH += ";$userScripts" }
    }

    # Ensure at least one key is present
    $hasKey = @('OPENROUTER_API_KEY','GOOGLE_API_KEY','GROQ_API_KEY','TOGETHER_API_KEY',
                'FIREWORKS_API_KEY','DEEPSEEK_API_KEY','COHERE_API_KEY','MISTRAL_API_KEY','SCX_API_KEY') |
        ForEach-Object { [Environment]::GetEnvironmentVariable($_, 'User') } | Where-Object { $_ }
    if (-not $hasKey) {
        Write-Host 'WARNING: No API keys found in HKCU. Register keys first:' -ForegroundColor Yellow
        Write-Host '  pwsh ./Register-KritFreeApiKey.ps1 -Provider openrouter -Key <key>' -ForegroundColor Gray
        Write-Host 'Continuing anyway (router will start but may return 404 for all models)...' -ForegroundColor Yellow
    }

    # Start
    $existing = Get-RouterPid
    if ($existing) {
        $healthy = Test-RouterHealth -Port $Port -BindHost $BindHost
        if ($healthy) {
            Write-Host "Router already healthy at http://$BindHost`:$Port (PID $existing)" -ForegroundColor Green
            return
        }
        Write-Host "Stale PID found, cleaning up..." -ForegroundColor Yellow
        try { Stop-Process -Id $existing -Force } catch {}
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Path (Split-Path $pidFile) -Force -ErrorAction SilentlyContinue | Out-Null
    New-Item -ItemType Directory -Path (Split-Path $logFile) -Force -ErrorAction SilentlyContinue | Out-Null

    Write-Host "Starting router on $BindHost`:$Port with $Config config..." -ForegroundColor Cyan
    $args = @('--config', $configPath, '--host', $BindHost, '--port', "$Port")
    $p = Start-Process -FilePath 'litellm' -ArgumentList $args `
        -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" `
        -PassThru -WindowStyle Hidden
    $p.Id | Set-Content -LiteralPath $pidFile -Encoding ASCII

    # HR17: probe before claiming started
    Start-Sleep -Seconds 5
    $ok = $false
    for ($i = 0; $i -lt 10; $i++) {
        if (Test-RouterHealth -Port $Port -BindHost $BindHost) { $ok = $true; break }
        Start-Sleep -Seconds 2
    }

    if ($ok) {
        Write-Host "Router HEALTHY at http://$BindHost`:$Port (PID $($p.Id))" -ForegroundColor Green
        Write-Host "Log: $logFile" -ForegroundColor Gray
        Write-Host ''
        Write-Host 'Usage:' -ForegroundColor Cyan
        Write-Host "  OpenAI-shape:  http://$BindHost`:$Port/v1/chat/completions" -ForegroundColor Gray
        Write-Host "  Models list:   http://$BindHost`:$Port/v1/models" -ForegroundColor Gray
        Write-Host ''
        Write-Host 'Agent config examples:' -ForegroundColor Cyan
        Write-Host "  Claude Code:   claude config set apiUrl http://$BindHost`:$Port" -ForegroundColor Gray
        Write-Host "  Codex CLI:     codex -c model_providers.custom.base_url=http://$BindHost`:$Port" -ForegroundColor Gray
        Write-Host "  Continue.dev:  Set apiBase to http://$BindHost`:$Port in config.json" -ForegroundColor Gray
    }
    else {
        Write-Host "Started but /health failed after 25s. Check $logFile" -ForegroundColor Red
        exit 1
    }
    return
}

# ------------------------------------------------------------
# HEAL
# ------------------------------------------------------------
if ($Mode -eq 'Heal') {
    $healthy = Test-RouterHealth -Port $Port -BindHost $BindHost
    if ($healthy) {
        Write-Host 'Router already healthy. No action.' -ForegroundColor Green
        return
    }
    Write-Host 'Router unhealthy. Restarting...' -ForegroundColor Yellow
    & $PSCommandPath -Mode Stop -Config $Config -Port $Port -BindHost $BindHost
    Start-Sleep -Seconds 2
    & $PSCommandPath -Mode Start -Config $Config -Port $Port -BindHost $BindHost
    return
}
