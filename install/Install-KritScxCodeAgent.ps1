<#
.SYNOPSIS
  Install / Remove / Heal / Status for Kritical.NodeJS.SCXCodeAgent (HR16).

.DESCRIPTION
  Brings up the Node bridge daemon on top of the Kritical SCX LiteLLM proxy.
  The daemon is an ADDITIVE layer (HR29): removing it returns every downstream
  agent to direct-API. HR14: the daemon's node_modules NEVER live inside the
  OneDrive-synced repo — install builds a runtime mirror under %LOCALAPPDATA%.

  Modes:
    Install : build runtime mirror off OneDrive, npm install, ensure LiteLLM
              upstream, start the daemon, HR17 health-probe, write a receipt.
    Remove  : stop the daemon. LEAVES the LiteLLM proxy running unless -CascadeRemove.
    Heal    : restart the daemon if its PID is dead or /health is unreachable.
    Status  : provider slots + LiteLLM upstream health + daemon PID/health + kill switch.

  DRY-RUN by default (prints the plan). Add -Apply to execute (repo convention).

.PARAMETER Mode          Install | Remove | Heal | Status   (default Status)
.PARAMETER Apply         Actually execute (default: dry-run preview).
.PARAMETER AgentPort     Daemon front port (default 4180).
.PARAMETER UpstreamPort  LiteLLM upstream port (default 4182).
.PARAMETER BindHost      Bind address (default 127.0.0.1 — localhost only, HR29).
.PARAMETER CascadeRemove With -Mode Remove, also stop the LiteLLM proxy.

.EXAMPLE  pwsh Install-KritScxCodeAgent.ps1 -Mode Status
.EXAMPLE  pwsh Install-KritScxCodeAgent.ps1 -Mode Install -Apply
.EXAMPLE  pwsh Install-KritScxCodeAgent.ps1 -Mode Remove -Apply         # daemon only, proxy stays up
#>
[CmdletBinding()]
param(
  [ValidateSet('Install','Remove','Heal','Status')][string]$Mode = 'Status',
  [switch]$Apply,
  [int]$AgentPort = 4180,
  [int]$UpstreamPort = 4182,
  [string]$BindHost = '127.0.0.1',
  [switch]$CascadeRemove
)

$ErrorActionPreference = 'Continue'
$repoRoot     = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # ...\Kritical.SCXCode
$agentSrc     = Split-Path $PSScriptRoot -Parent                         # ...\node-agent
$runtimeRoot  = Join-Path $env:LOCALAPPDATA 'Kritical\SCXCode\agent-runtime'
$stateDir     = Join-Path $env:LOCALAPPDATA 'Kritical\SCXCode'
$pidFile      = Join-Path $stateDir 'node-agent.pid'
$logFile      = Join-Path $stateDir 'node-agent.log'
$receiptsDir  = Join-Path $repoRoot 'receipts'
$litellmMgr   = Join-Path $repoRoot 'litellm\Manage-KritScxProxy.ps1'
$KILL_SWITCH  = "Install-KritScxCodeAgent.ps1 -Mode Remove -Apply   ·  emergency: C:\KriticalSCX\safety\Restore-WorkingClaude.ps1"

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Plan([string]$m) { Say ("  [dry-run] would: " + $m) 'DarkYellow' }
function Test-Health([int]$port) {
  try { (Invoke-WebRequest "http://$BindHost`:$port/health/liveliness" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
function Get-DaemonPid {
  if (Test-Path $pidFile) { $p = (Get-Content $pidFile -Raw).Trim(); if ($p -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) { return [int]$p } }
  return $null
}
function Get-ProviderSlots {
  $slots = [ordered]@{}
  foreach ($k in 'SCX_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','GENERIC_API_KEY') {
    $present = [bool]([Environment]::GetEnvironmentVariable($k,'User')) -or [bool]([Environment]::GetEnvironmentVariable($k,'Process'))
    $slots[$k] = $present
  }
  return $slots
}

function Show-Status {
  Say "`n=== Kritical.NodeJS.SCXCodeAgent — Status ===" 'Cyan'
  Say "  Provider slots (HKCU):"
  foreach ($kv in (Get-ProviderSlots).GetEnumerator()) {
    Say ("    {0,-18} {1}" -f $kv.Key, $(if ($kv.Value) { 'LIVE' } else { 'dormant' })) $(if ($kv.Value) { 'Green' } else { 'DarkGray' })
  }
  $upHealthy = Test-Health $UpstreamPort
  $upHealthy4180 = Test-Health 4180
  Say ("  LiteLLM upstream :$UpstreamPort : {0}" -f $(if ($upHealthy) { 'HEALTHY' } else { 'unreachable' })) $(if ($upHealthy) { 'Green' } else { 'Yellow' })
  if (-not $upHealthy -and $upHealthy4180) { Say "    (a LiteLLM proxy IS healthy on :4180 — the daemon can use it as upstream via -UpstreamPort 4180)" 'DarkYellow' }
  $dpid = Get-DaemonPid
  Say ("  Node daemon      : {0}" -f $(if ($dpid) { "pid $dpid" } else { 'not running' }))
  Say ("  daemon /health   :$AgentPort : {0}" -f $(if (Test-Health $AgentPort) { 'HEALTHY' } else { 'unreachable' })) $(if (Test-Health $AgentPort) { 'Green' } else { 'Yellow' })
  Say ("  runtime mirror   : {0}" -f $(if (Test-Path (Join-Path $runtimeRoot 'node_modules')) { $runtimeRoot } else { 'not built' }))
  Say "  KILL SWITCH      : $KILL_SWITCH" 'Yellow'
}

function Resolve-Upstream {
  # Prefer our dedicated upstream port; fall back to an already-healthy 4180 proxy
  # so we never spawn a duplicate LiteLLM on top of the operator's working one.
  if (Test-Health $UpstreamPort) { return $UpstreamPort }
  if (Test-Health 4180) { Say "  Reusing existing healthy LiteLLM on :4180 as upstream (no duplicate spawned)." 'DarkCyan'; return 4180 }
  return $UpstreamPort
}

switch ($Mode) {

  'Install' {
    Say "=== Install Kritical.NodeJS.SCXCodeAgent ===" 'Cyan'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Say "node not found on PATH — install Node >= 20 first." 'Red'; break }

    # 1. runtime mirror off OneDrive (HR14)
    if ($Apply) {
      New-Item -ItemType Directory -Force $runtimeRoot | Out-Null
      New-Item -ItemType Directory -Force $stateDir | Out-Null
      Copy-Item (Join-Path $agentSrc 'src') $runtimeRoot -Recurse -Force
      Copy-Item (Join-Path $agentSrc 'package.json') $runtimeRoot -Force
    } else { Plan "mirror node-agent src + package.json to $runtimeRoot (HR14: off OneDrive)" }

    # 2. npm install in the mirror, cache under %TEMP% (HR14)
    if ($Apply) {
      Push-Location $runtimeRoot
      $env:npm_config_cache = Join-Path $env:TEMP 'kritical-scxcode-agent-npm-cache'
      Say "  npm install (fastify) in runtime mirror ..." 'DarkGray'
      & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | Select-Object -Last 3 | ForEach-Object { Say "    $_" }
      Pop-Location
    } else { Plan "npm install --omit=dev in $runtimeRoot (cache in %TEMP%)" }

    # 3. ensure LiteLLM upstream
    $up = if ($Apply) { Resolve-Upstream } else { $UpstreamPort }
    if (-not (Test-Health $up)) {
      if ($Apply -and (Test-Path $litellmMgr)) {
        Say "  Upstream not healthy — starting LiteLLM via Manage-KritScxProxy.ps1 ..." 'DarkGray'
        & pwsh -NoProfile -File $litellmMgr -Mode Start -Port $UpstreamPort | Out-Null
        $up = Resolve-Upstream
      } else { Plan "ensure LiteLLM upstream on :$UpstreamPort (cascade Manage-KritScxProxy.ps1 -Mode Start)" }
    } else { Say "  LiteLLM upstream healthy on :$up." 'Green' }

    # 4. start the daemon (HR17: probe before declaring up)
    if ($Apply) {
      if (Get-DaemonPid) { Say "  daemon already running (pid $(Get-DaemonPid))." 'Yellow' }
      else {
        $env:KRITICAL_AGENT_PORT = "$AgentPort"; $env:KRITICAL_AGENT_HOST = $BindHost
        $env:KRIT_AGENT_UPSTREAM = "http://$BindHost`:$up"
        $srv = Join-Path $runtimeRoot 'src\server.mjs'
        $p = Start-Process node -ArgumentList "`"$srv`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $stateDir 'node-agent.err.log')
        $p.Id | Set-Content $pidFile -Encoding ascii
        for ($i=0; $i -lt 15 -and -not (Test-Health $AgentPort); $i++) { Start-Sleep 1 }
      }
      if (Test-Health $AgentPort) { Say "  HEALTHY — daemon on http://$BindHost`:$AgentPort (upstream :$up)" 'Green' }
      else { Say "  daemon did not become healthy — see $logFile" 'Red' }
    } else { Plan "Start-Process node src/server.mjs on :$AgentPort (upstream :$up), PID -> $pidFile, probe /health" }

    # 5. receipt (HR26)
    if ($Apply) {
      New-Item -ItemType Directory -Force $receiptsDir | Out-Null
      $utc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
      $receipt = [ordered]@{
        wave='.5184'; utc=$utc; component='node-agent'; mode='Install'
        agentPort=$AgentPort; upstreamPort=$up; bindHost=$BindHost
        daemonPid=(Get-DaemonPid); daemonHealthy=(Test-Health $AgentPort)
        upstreamHealthy=(Test-Health $up); runtimeRoot=$runtimeRoot
        providerSlots=(Get-ProviderSlots)
      }
      $rp = Join-Path $receiptsDir "wave-$utc-node-agent-install.json"
      $receipt | ConvertTo-Json -Depth 5 | Set-Content $rp -Encoding utf8
      Say "  receipt: $rp" 'DarkCyan'
    } else { Plan "write receipt to receipts/wave-<utc>-node-agent-install.json (HR26)" }

    Show-Status
    if (-not $Apply) { Say "`nDRY-RUN complete. Re-run with -Apply to execute." 'Cyan' }
  }

  'Remove' {
    Say "=== Remove Kritical.NodeJS.SCXCodeAgent (daemon layer) ===" 'Cyan'
    $dpid = Get-DaemonPid
    if ($Apply) {
      try { Invoke-WebRequest "http://$BindHost`:$AgentPort/admin/kill" -Method Post -UseBasicParsing -TimeoutSec 3 | Out-Null } catch {}
      Start-Sleep 1
      if ($dpid -and (Get-Process -Id $dpid -ErrorAction SilentlyContinue)) { Stop-Process -Id $dpid -Force -ErrorAction SilentlyContinue }
      if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
      Say "  daemon stopped. Downstream agents now go direct to their APIs (HR29)." 'Green'
      if ($CascadeRemove -and (Test-Path $litellmMgr)) { Say "  -CascadeRemove: stopping LiteLLM proxy too ..." 'DarkYellow'; & pwsh -NoProfile -File $litellmMgr -Mode Stop | Out-Null }
      else { Say "  LiteLLM proxy LEFT RUNNING (HR29 additive — inner layer survives). Use -CascadeRemove to stop it." 'DarkGray' }
    } else {
      Plan "POST /admin/kill + stop pid $dpid + remove $pidFile"
      if ($CascadeRemove) { Plan "cascade-stop the LiteLLM proxy (Manage-KritScxProxy.ps1 -Mode Stop)" } else { Plan "leave LiteLLM proxy running (HR29)" }
      Say "`nDRY-RUN complete. Re-run with -Apply to execute." 'Cyan'
    }
  }

  'Heal' {
    Say "=== Heal Kritical.NodeJS.SCXCodeAgent ===" 'Cyan'
    $healthy = (Get-DaemonPid) -and (Test-Health $AgentPort)
    if ($healthy) { Say "  daemon healthy (pid $(Get-DaemonPid)) — nothing to heal." 'Green'; Show-Status; break }
    if ($Apply) {
      Say "  daemon unhealthy — restarting via Install ..." 'Yellow'
      if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
      & $PSCommandPath -Mode Install -Apply -AgentPort $AgentPort -UpstreamPort $UpstreamPort -BindHost $BindHost
    } else { Plan "restart the daemon (re-run Install -Apply)"; Say "`nDRY-RUN complete. Re-run with -Apply." 'Cyan' }
  }

  'Status' { Show-Status }
}
