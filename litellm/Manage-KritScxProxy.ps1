<#
.SYNOPSIS
  Manage the Kritical SCX LiteLLM proxy as a MANUAL-start Windows background service
  (implemented as an on-demand Scheduled Task — reliable for a Python console app without NSSM).
  Tracks PID + exe of everything it launches. HR16 modes. HR29: stopping it returns every agent
  to direct API — Claude/Codex never depend on it.

.PARAMETER Mode  Install | Start | Stop | Status | Remove   (default Status)
  Install: register the task (StartType = manual/on-demand). Does NOT start it.
  Start  : start the proxy, record PID/exe to the run registry, health-probe.
  Stop   : stop the proxy, clear registry entry.
  Status : show task state, tracked PID, /health probe.
  Remove : stop + unregister the task.

.EXAMPLE  pwsh Manage-KritScxProxy.ps1 -Mode Install     # register, manual, not started
.EXAMPLE  pwsh Manage-KritScxProxy.ps1 -Mode Start       # bring it up on demand
#>
[CmdletBinding()]
param([ValidateSet('Install','Start','Stop','Status','Remove')][string]$Mode='Status',
      [int]$Port=4180, [string]$BindHost='127.0.0.1')
$ErrorActionPreference='Continue'
$TASK   = 'KriticalSCXProxy'
$venvPy = 'C:\KriticalSCX\venv-litellm-test\Scripts\python.exe'
$litellm= 'C:\KriticalSCX\venv-litellm-test\Scripts\litellm.exe'
# SCX-only by default (HR1: native SCX tooling never uses OpenAI/Anthropic keys).
# Traditional passthrough (anthropic/*, openai/*) loads ONLY when the operator
# explicitly opts in via KRIT_SCX_ALLOW_TRADITIONAL_KEYS=1 (DANGER — breaks the pipeline).
$ldir = 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.SCXCode\litellm'
$allowTrad = ([Environment]::GetEnvironmentVariable('KRIT_SCX_ALLOW_TRADITIONAL_KEYS','User') -eq '1') -or ($env:KRIT_SCX_ALLOW_TRADITIONAL_KEYS -eq '1')
$config = Join-Path $ldir $(if ($allowTrad) { 'kritical-scx-traditional.config.yaml' } else { 'kritical-scx.config.yaml' })
$runDir = 'C:\KriticalSCX\run'; $pidFile = Join-Path $runDir 'pids.json'
New-Item -ItemType Directory -Force $runDir | Out-Null

function Test-Health { try { (Invoke-WebRequest "http://$BindHost`:$Port/health/liveliness" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
function Get-ListenerPid { try { (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop).OwningProcess | Select-Object -First 1 } catch { $null } }
function Write-Registry($p) {
  $reg = @{}; if (Test-Path $pidFile) { $reg = Get-Content $pidFile -Raw | ConvertFrom-Json -AsHashtable }
  if ($p) { $reg['litellm_proxy'] = @{ pid=$p; exe=$litellm; port=$Port; started=(Get-Date -Format o) } }
  else { $reg.Remove('litellm_proxy') }
  $reg | ConvertTo-Json -Depth 5 | Set-Content $pidFile -Encoding utf8
}
function Show-Status {
  Write-Host "`n=== Kritical SCX Proxy — Status ===" -ForegroundColor Cyan
  $t = Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
  Write-Host "  scheduled task : $(if($t){"registered (state=$($t.State))"}else{'not installed'})"
  $lp = Get-ListenerPid
  Write-Host "  listener :$Port : $(if($lp){"pid $lp"}else{'none'})"
  Write-Host "  /health        : $(if(Test-Health){'HEALTHY'}else{'unreachable'})" -ForegroundColor $(if(Test-Health){'Green'}else{'Yellow'})
  if (Test-Path $pidFile) { Write-Host "  run registry   : $pidFile"; Get-Content $pidFile -Raw | Write-Host }
  Write-Host "  KILL SWITCH    : Manage-KritScxProxy.ps1 -Mode Stop   ·  emergency: C:\KriticalSCX\safety\Restore-WorkingClaude.ps1" -ForegroundColor Yellow
}

switch ($Mode) {
  'Install' {
    if (-not (Test-Path $litellm)) { throw "litellm not found at $litellm — install the venv first." }
    # Start from the config dir with PYTHONPATH set so the HR27 write-through callback
    # (kritical_scx_logger) imports and loads. Wrapped via cmd so PYTHONPATH is set per-run.
    $ldir = Split-Path $config
    # HR29 additive: make THEGRID_API_KEY available to the proxy PROCESS only.
    # Resolved from $env:THEGRID_API_KEY, else the JoshONLY secrets store, and
    # embedded into the task launch cmd. It is NOT written to the operator's
    # global (HKCU) environment, so a plain `claude`/shell session inherits
    # nothing — turning the proxy off returns every agent to direct API.
    $gridKey = $env:THEGRID_API_KEY
    if (-not $gridKey) {
      $gridFile = Get-ChildItem 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY' -Filter 'thegrid-apiKey*.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($gridFile) { $gridKey = (Get-Content $gridFile.FullName -Raw).Trim() }
    }
    $setGrid = if ($gridKey) { "set `"THEGRID_API_KEY=$gridKey`" && " } else { '' }
    Write-Host "  thegrid key    : $(if($gridKey){'resolved (embedded in task env only)'}else{'NOT found — thegrid-code-standard will be unroutable'})" -ForegroundColor $(if($gridKey){'Green'}else{'Yellow'})
    $cmdArgs = "/c set `"PYTHONPATH=$ldir`" && ${setGrid}`"$litellm`" --config `"$config`" --host $BindHost --port $Port"
    $action  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $ldir
    $settings= New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    # NO trigger => manual / on-demand only (safety).
    Register-ScheduledTask -TaskName $TASK -Action $action -Settings $settings -Description 'Kritical SCX LiteLLM proxy (manual start)' -Force | Out-Null
    Write-Host "Registered '$TASK' — MANUAL start, not running. Start with: -Mode Start" -ForegroundColor Green
    Show-Status
  }
  'Start' {
    if (-not (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue)) { throw "task not installed — run -Mode Install" }
    if (Get-ListenerPid) { Write-Host "already listening on :$Port" -ForegroundColor Yellow }
    else {
      Start-ScheduledTask -TaskName $TASK
      for ($i=0; $i -lt 20 -and -not (Test-Health); $i++) { Start-Sleep 2 }
    }
    $p = Get-ListenerPid; Write-Registry $p
    Write-Host "$(if(Test-Health){"HEALTHY (pid $p)"}else{'did not become healthy — check task history'})" -ForegroundColor $(if(Test-Health){'Green'}else{'Red'})
    Show-Status
  }
  'Stop' {
    Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
    $p = Get-ListenerPid; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Write-Registry $null
    Write-Host "Proxy stopped. All agents now go direct to their APIs (HR29)." -ForegroundColor Green
  }
  'Remove' {
    Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
    $p = Get-ListenerPid; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Unregister-ScheduledTask -TaskName $TASK -Confirm:$false -ErrorAction SilentlyContinue
    Write-Registry $null
    Write-Host "Task removed." -ForegroundColor Green
  }
  'Status' { Show-Status }
}
