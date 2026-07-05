#requires -Version 7.0
<#
.SYNOPSIS
    Install the Kritical.SCX.LiteLLM local proxy — universal front for SCX
    accessible by any coding agent that speaks OpenAI-shape or Anthropic-shape.

.DESCRIPTION
    HR16 idempotent 4-mode installer:
        -Mode Install : pip install litellm[proxy], drop config, start service
        -Mode Remove  : stop service, remove config, uninstall pip package (opt)
        -Mode Heal    : verify litellm on PATH, verify config, restart if down
        -Mode Status  : print running state + probe /health

    Reads SCX_API_KEY from HKCU. Binds LiteLLM proxy to 127.0.0.1:4180 (never
    to 0.0.0.0). Any 3rd-party agent (Codex CLI / Aider / Cline / Continue /
    OpenCode / goose / etc) points at http://127.0.0.1:4180 and is talking
    to SCX under the hood, translated by LiteLLM, augmented by the Kritical
    Node bridge (queued sister).

.PARAMETER Mode
    Install | Remove | Heal | Status
.PARAMETER Port
    LiteLLM proxy port. Default 4180.
.PARAMETER Host
    Bind address. Default 127.0.0.1. NEVER change to 0.0.0.0 without operator
    typed ack (proxy has your SCX key).
.PARAMETER PythonExe
    Python interpreter to use. Default 'python' on PATH.
.PARAMETER IUnderstand
    Required for -Mode Remove.

.EXAMPLE
    pwsh ./litellm/Install-KritScxLiteLLM.ps1 -Mode Install
.EXAMPLE
    pwsh ./litellm/Install-KritScxLiteLLM.ps1 -Mode Status

.NOTES
    Author: Joshua Finley — (c) 2026 Kritical Pty Ltd
    Contact: sales@kritical.net · ph. 1300 274 655
    Per HARD RULE 16 (idempotent modes) + HR17 (never claim started without probe).
#>
[CmdletBinding()]
param(
    [ValidateSet('Install','Remove','Heal','Status')] [string] $Mode = 'Install',
    [int]    $Port = 4180,
    [string] $BindHost = '127.0.0.1',
    [string] $PythonExe = 'python',
    [switch] $IUnderstand
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $PSScriptRoot 'kritical-scx.config.yaml'
$pidFile = Join-Path $env:LOCALAPPDATA 'Kritical\SCXCode\litellm.pid'
$logFile = Join-Path $env:LOCALAPPDATA 'Kritical\SCXCode\litellm.log'

# ------------------------------------------------------------
# Kritical brand banner
# ------------------------------------------------------------
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║ Kritical.SCX.LiteLLM — universal front for SCX             ║' -ForegroundColor Cyan
Write-Host "  ║ Mode: $Mode".PadRight(60) + '║' -ForegroundColor Cyan
Write-Host '  ║ Joshua Finley · Kritical Pty Ltd · sales@kritical.net     ║' -ForegroundColor Cyan
Write-Host '  ║ ph. 1300 274 655                                          ║' -ForegroundColor Cyan
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ------------------------------------------------------------
# helpers
# ------------------------------------------------------------
function Test-KritLiteLLMHealth {
    param([int]$Port, [string]$BindHost = '127.0.0.1')
    try {
        $r = Invoke-WebRequest -Uri "http://$BindHost`:$Port/health/liveliness" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Get-KritLiteLLMPid {
    if (Test-Path $pidFile) {
        try {
            $pid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
            $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($p) { return $pid }
        } catch {}
    }
    return $null
}

# ------------------------------------------------------------
# STATUS
# ------------------------------------------------------------
if ($Mode -eq 'Status') {
    $scxKey    = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
    $anthKey   = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')
    $openaiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')
    $genKey    = [Environment]::GetEnvironmentVariable('GENERIC_API_KEY','User')
    $genBase   = [Environment]::GetEnvironmentVariable('GENERIC_API_BASE','User')

    Write-Host '--- Provider keys (HKCU) ---' -ForegroundColor Cyan
    Write-Host ('  SCX_API_KEY:        ' + $(if ($scxKey)    { 'present (len=' + $scxKey.Length + ')' }    else { 'ABSENT (SCX slot dormant)' })) -ForegroundColor $(if ($scxKey)    { 'Green' } else { 'Yellow' })
    Write-Host ('  ANTHROPIC_API_KEY:  ' + $(if ($anthKey)   { 'present (len=' + $anthKey.Length + ')' }   else { 'ABSENT (Anthropic slot dormant)' })) -ForegroundColor $(if ($anthKey)   { 'Green' } else { 'Yellow' })
    Write-Host ('  OPENAI_API_KEY:     ' + $(if ($openaiKey) { 'present (len=' + $openaiKey.Length + ')' } else { 'ABSENT (OpenAI slot dormant)' })) -ForegroundColor $(if ($openaiKey) { 'Green' } else { 'Yellow' })
    Write-Host ('  GENERIC_API_KEY:    ' + $(if ($genKey)    { 'present (len=' + $genKey.Length + ')' }    else { 'ABSENT (Generic slot dormant)' })) -ForegroundColor $(if ($genKey)    { 'Green' } else { 'Yellow' })
    Write-Host ('  GENERIC_API_BASE:   ' + $(if ($genBase)   { $genBase }                                   else { 'ABSENT' })) -ForegroundColor $(if ($genBase)   { 'Green' } else { 'Yellow' })
    Write-Host ''

    Write-Host '--- Toolchain ---' -ForegroundColor Cyan
    $pyOk = Get-Command $PythonExe -ErrorAction SilentlyContinue
    Write-Host ('  Python:             ' + $(if ($pyOk)      { $pyOk.Source }                              else { 'ABSENT' })) -ForegroundColor $(if ($pyOk)      { 'Green' } else { 'Red' })
    $litellmOk = Get-Command litellm -ErrorAction SilentlyContinue
    Write-Host ('  litellm command:    ' + $(if ($litellmOk) { $litellmOk.Source }                         else { 'ABSENT' })) -ForegroundColor $(if ($litellmOk) { 'Green' } else { 'Yellow' })
    Write-Host ('  Config file:        ' + $(if (Test-Path $configPath) { $configPath } else { 'ABSENT' })) -ForegroundColor $(if (Test-Path $configPath) { 'Green' } else { 'Red' })
    Write-Host ''

    Write-Host '--- Proxy state ---' -ForegroundColor Cyan
    $pid = Get-KritLiteLLMPid
    Write-Host ('  PID file:           ' + $(if ($pid) { "$pidFile (PID=$pid)" } else { 'no live PID' })) -ForegroundColor $(if ($pid) { 'Green' } else { 'Yellow' })
    $healthy = Test-KritLiteLLMHealth -Port $Port -BindHost $BindHost
    Write-Host ('  /health/liveliness: ' + $(if ($healthy) { "http://$BindHost`:$Port — HEALTHY" } else { 'unreachable' })) -ForegroundColor $(if ($healthy) { 'Green' } else { 'Yellow' })
    Write-Host ''

    # HR29 kill switch — always tell the operator how to disable us
    Write-Host '--- HR29 kill switch (this proxy is ADDITIVE, not required) ---' -ForegroundColor Cyan
    Write-Host '  To stop this proxy and revert every downstream agent to direct-API calls:' -ForegroundColor Gray
    Write-Host '    pwsh ./Install-KritScxLiteLLM.ps1 -Mode Remove -IUnderstand' -ForegroundColor Yellow
    Write-Host '  With the proxy off:' -ForegroundColor Gray
    Write-Host '    - Claude Code -> api.anthropic.com direct (uses ANTHROPIC_API_KEY)' -ForegroundColor Gray
    Write-Host '    - Codex CLI   -> api.openai.com direct  (uses OPENAI_API_KEY)' -ForegroundColor Gray
    Write-Host '    - SCX PS mod  -> api.scx.ai direct       (uses SCX_API_KEY)' -ForegroundColor Gray
    Write-Host '  Every agent above works with the proxy on OR off — the proxy just makes provider-swap easier.' -ForegroundColor Gray
    return
}

# ------------------------------------------------------------
# INSTALL
# ------------------------------------------------------------
if ($Mode -eq 'Install') {
    # Preflight
    $key = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
    if (-not $key) {
        Write-Host '[install] SCX_API_KEY not set in HKCU. Set it via:' -ForegroundColor Red
        Write-Host '  [Environment]::SetEnvironmentVariable(''SCX_API_KEY'', ''<key>'', ''User'')' -ForegroundColor Yellow
        exit 1
    }
    $py = Get-Command $PythonExe -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Host "[install] Python not found ($PythonExe). Install Python 3.10+ first." -ForegroundColor Red
        exit 1
    }

    # pip install litellm[proxy] into user site-packages (avoids OneDrive per HR14)
    Write-Host '[install] pip install litellm[proxy] (user scope)...'
    & $PythonExe -m pip install --user --upgrade 'litellm[proxy]' 2>&1 | Out-Host

    $litellmOk = Get-Command litellm -ErrorAction SilentlyContinue
    if (-not $litellmOk) {
        Write-Host '[install] litellm not on PATH after install. Adding user Scripts dir:' -ForegroundColor Yellow
        $userScripts = "$env:APPDATA\Python\Scripts"
        if (Test-Path $userScripts) {
            $curPath = [Environment]::GetEnvironmentVariable('PATH','User')
            if ($curPath -notmatch [regex]::Escape($userScripts)) {
                [Environment]::SetEnvironmentVariable('PATH', "$curPath;$userScripts", 'User')
                Write-Host "[install] Added $userScripts to HKCU PATH — new terminals will see litellm." -ForegroundColor Green
            }
            $env:PATH += ";$userScripts"
        }
    }

    # ensure state dirs
    New-Item -ItemType Directory -Path (Split-Path $pidFile) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null

    # start (background)
    $existing = Get-KritLiteLLMPid
    if ($existing) {
        Write-Host "[install] Already running (PID $existing). Skipping start." -ForegroundColor Green
    } else {
        Write-Host "[install] Starting litellm on $BindHost`:$Port ..."
        $args = @('--config', $configPath, '--host', $BindHost, '--port', "$Port")
        $p = Start-Process -FilePath 'litellm' -ArgumentList $args `
            -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" `
            -PassThru -WindowStyle Hidden
        $p.Id | Set-Content -LiteralPath $pidFile -Encoding ASCII

        # HR17: probe before claiming started
        Start-Sleep -Seconds 5
        $ok = $false
        for ($i = 0; $i -lt 10; $i++) {
            if (Test-KritLiteLLMHealth -Port $Port -BindHost $BindHost) { $ok = $true; break }
            Start-Sleep -Seconds 2
        }
        if ($ok) {
            Write-Host "[install] LiteLLM proxy HEALTHY at http://$BindHost`:$Port (PID $($p.Id))" -ForegroundColor Green
            Write-Host "[install] Log: $logFile" -ForegroundColor Gray
            Write-Host ''
            Write-Host 'How to use from any coding agent:' -ForegroundColor Cyan
            Write-Host '  Codex CLI     → export OPENAI_BASE_URL=http://127.0.0.1:4180 ; export OPENAI_API_KEY=sk-kritical-scx-local'
            Write-Host '  Aider         → aider --openai-api-base http://127.0.0.1:4180 --openai-api-key sk-kritical-scx-local'
            Write-Host '  Cline / Continue / OpenCode / goose → configure openai-compatible endpoint http://127.0.0.1:4180'
            Write-Host '  Claude Code   → ANTHROPIC_BASE_URL=http://127.0.0.1:4180 (Anthropic-shape supported by LiteLLM)'
        } else {
            Write-Host "[install] Started but /health failed after 25s. Check $logFile" -ForegroundColor Red
            exit 1
        }
    }
    return
}

# ------------------------------------------------------------
# HEAL
# ------------------------------------------------------------
if ($Mode -eq 'Heal') {
    $key = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
    if (-not $key) { Write-Host '[heal] SCX_API_KEY missing. Cannot heal without key.' -ForegroundColor Red; exit 1 }

    $healthy = Test-KritLiteLLMHealth -Port $Port -BindHost $BindHost
    if ($healthy) { Write-Host '[heal] Proxy already healthy. No action.' -ForegroundColor Green; return }

    Write-Host '[heal] Proxy not responding. Restarting...' -ForegroundColor Yellow
    $existing = Get-KritLiteLLMPid
    if ($existing) {
        try { Stop-Process -Id $existing -Force } catch {}
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue

    # delegate to Install to spin up
    & $PSCommandPath -Mode Install -Port $Port -BindHost $BindHost -PythonExe $PythonExe
    return
}

# ------------------------------------------------------------
# REMOVE (rotate-not-delete per HR23)
# ------------------------------------------------------------
if ($Mode -eq 'Remove') {
    if (-not $IUnderstand) {
        Write-Host '[remove] Refusing without -IUnderstand.' -ForegroundColor Red
        exit 1
    }
    $existing = Get-KritLiteLLMPid
    if ($existing) {
        Write-Host "[remove] Stopping litellm PID $existing"
        try { Stop-Process -Id $existing -Force } catch {}
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
    # rotate log per HR23 rather than delete
    if (Test-Path $logFile) {
        $archive = "$logFile.archived-$((Get-Date).ToString('yyyyMMddHHmmss'))"
        Move-Item -Path $logFile -Destination $archive
        Write-Host "[remove] Log rotated to $archive (HR23: never delete)."
    }
    Write-Host '[remove] LiteLLM proxy stopped. Config + package left in place.' -ForegroundColor Green
    return
}
