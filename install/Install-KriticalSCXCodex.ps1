<#
.SYNOPSIS
  Install / Remove / Heal / Status for SCX Codex — agentic OpenAI Codex on Southern Cross AI (HR16).

.DESCRIPTION
  Wires the `codex` CLI to talk to SCX agentically, SCX_API_KEY only, with ZERO changes to the
  operator's real ~/.codex (vanilla codex stays pristine — HR29). It:
    - ensures the SCX agentic flatten-shim is running on 127.0.0.1:4199,
    - installs a `kcodex` launcher (on PATH) that runs codex-wrapper/kritical-codex.ps1,
      which routes codex at SCX via per-invocation `-c` overrides + the shim.
  Removing the layer returns the operator to vanilla `codex` untouched.

  DRY-RUN by default (prints the plan). Add -Apply to execute (repo convention).

.PARAMETER Mode   Install | Remove | Heal | Status   (default Status)
.PARAMETER Apply  Actually execute (default: dry-run preview).

.EXAMPLE  pwsh install/Install-KriticalSCXCodex.ps1 -Mode Status
.EXAMPLE  pwsh install/Install-KriticalSCXCodex.ps1 -Mode Install -Apply

.NOTES  Joshua Finley — Kritical Pty Ltd — (c) 2026. Spec: docs/SCX-AGENTIC-BRIDGE-SPEC.md.
#>
[CmdletBinding()]
param(
  [ValidateSet('Install','Remove','Heal','Status')][string]$Mode = 'Status',
  [switch]$Apply
)

$ErrorActionPreference = 'Continue'
$repoRoot   = Split-Path $PSScriptRoot -Parent
$wrapper    = Join-Path $repoRoot 'codex-wrapper\kritical-codex.ps1'
$shim       = Join-Path $repoRoot 'codex-wrapper\scx-agentic-shim.mjs'
$shimPort   = 4199
$binDir     = Join-Path $env:LOCALAPPDATA 'Kritical\bin'
$kcodexCmd  = Join-Path $binDir 'kcodex.cmd'
$receiptsDir= Join-Path $repoRoot 'receipts'
$KILL       = "Install-KriticalSCXCodex.ps1 -Mode Remove -Apply   ·  or just run vanilla 'codex' (untouched)"

function Say([string]$m,[string]$c='Gray'){ Write-Host $m -ForegroundColor $c }
function Plan([string]$m){ Say "  [dry-run] would: $m" 'DarkYellow' }
function Have([string]$n){ [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function ScxKey(){ $k=[Environment]::GetEnvironmentVariable('SCX_API_KEY','User'); if(-not $k){$k=$env:SCX_API_KEY}; return $k }
function ShimHealthy(){ try { (Invoke-WebRequest "http://127.0.0.1:$shimPort/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
function OnUserPath([string]$p){ (([Environment]::GetEnvironmentVariable('PATH','User') -split ';') | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $p.TrimEnd('\')) }).Count -gt 0 }

function Start-Shim {
  if (ShimHealthy) { return $true }
  if (-not (Have 'node')) { Say "  node not found — cannot start the shim." 'Red'; return $false }
  Start-Process node -ArgumentList "`"$shim`"" -WindowStyle Hidden | Out-Null
  for ($i=0; $i -lt 15 -and -not (ShimHealthy); $i++) { Start-Sleep -Milliseconds 400 }
  return (ShimHealthy)
}

function Show-Status {
  Say "`n=== SCX Codex — Status ===" 'Cyan'
  Say ("  node          : {0}" -f $(if(Have 'node'){'present'}else{'MISSING'}))          $(if(Have 'node'){'Green'}else{'Red'})
  Say ("  codex         : {0}" -f $(if(Have 'codex'){(Get-Command codex).Source}else{'MISSING'})) $(if(Have 'codex'){'Green'}else{'Red'})
  Say ("  SCX_API_KEY   : {0}" -f $(if(ScxKey){'set (HKCU)'}else{'MISSING'}))            $(if(ScxKey){'Green'}else{'Red'})
  Say ("  agentic shim  : {0}" -f $(if(ShimHealthy){"healthy :$shimPort"}else{'not running'})) $(if(ShimHealthy){'Green'}else{'Yellow'})
  Say ("  kcodex on PATH: {0}" -f $(if((Test-Path $kcodexCmd) -and (OnUserPath $binDir)){"yes ($kcodexCmd)"}else{'no'}))
  Say ("  wrapper       : {0}" -f $(if(Test-Path $wrapper){'present'}else{'MISSING'}))
  Say "  vanilla ~/.codex is NEVER modified by this layer (HR29)." 'DarkGray'
  Say "  KILL SWITCH   : $KILL" 'Yellow'
}

switch ($Mode) {

  'Install' {
    Say "=== Install SCX Codex (agentic codex on SCX) ===" 'Cyan'
    $ok = $true
    foreach ($dep in @(@{n='node';have=(Have 'node')}, @{n='codex';have=(Have 'codex')})) {
      if (-not $dep.have) { Say "  MISSING: $($dep.n). Install it, then re-run." 'Red'; $ok=$false }
    }
    if (-not (ScxKey)) { Say "  MISSING: SCX_API_KEY (HKCU). Set it, then re-run." 'Red'; $ok=$false }
    if (-not (Test-Path $wrapper)) { Say "  MISSING wrapper: $wrapper" 'Red'; $ok=$false }
    if (-not $ok) { Say "  Prerequisites not met — nothing changed." 'Red'; break }

    if ($Apply) {
      if (Start-Shim) { Say "  shim healthy on :$shimPort" 'Green' } else { Say "  shim did NOT become healthy — check node + $shim" 'Yellow' }
      New-Item -ItemType Directory -Force $binDir | Out-Null
      # kcodex launcher (cmd shim so it works from any shell); forwards all args to the wrapper.
      "@echo off`r`npwsh -NoProfile -File `"$wrapper`" %*" | Set-Content $kcodexCmd -Encoding ascii
      if (-not (OnUserPath $binDir)) {
        $userPath = [Environment]::GetEnvironmentVariable('PATH','User')
        [Environment]::SetEnvironmentVariable('PATH', ($userPath.TrimEnd(';') + ';' + $binDir), 'User')
        Say "  added to User PATH: $binDir  (open a new shell to pick it up)" 'DarkCyan'
      }
      Say "  installed 'kcodex' -> $kcodexCmd" 'Green'
      New-Item -ItemType Directory -Force $receiptsDir | Out-Null
      $utc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
      [ordered]@{ wave='.5231'; utc=$utc; component='scx-codex'; mode='Install'; shimHealthy=(ShimHealthy); kcodex=$kcodexCmd; binOnPath=(OnUserPath $binDir); scxKey=[bool](ScxKey) } |
        ConvertTo-Json | Set-Content (Join-Path $receiptsDir "wave-$utc-scx-codex-install.json") -Encoding utf8
    } else {
      Plan "ensure shim running (node $shim on :$shimPort)"
      Plan "write $kcodexCmd -> pwsh -File $wrapper %*"
      Plan "add $binDir to User PATH"
      Plan "write install receipt to receipts/"
      Say "`nDRY-RUN complete. Re-run with -Apply to execute." 'Cyan'
    }
    Show-Status
    if ($Apply) { Say "`nUse it:  kcodex   (interactive agentic codex on SCX)  ·  vanilla 'codex' is unchanged." 'Cyan' }
  }

  'Remove' {
    Say "=== Remove SCX Codex layer (vanilla codex stays) ===" 'Cyan'
    if ($Apply) {
      try { $p = (Get-NetTCPConnection -LocalPort $shimPort -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -First 1; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Say "  shim stopped." 'Green' } } catch {}
      if (Test-Path $kcodexCmd) { Remove-Item $kcodexCmd -Force; Say "  removed $kcodexCmd" 'Green' }
      if (OnUserPath $binDir) {
        $np = (([Environment]::GetEnvironmentVariable('PATH','User') -split ';') | Where-Object { $_ -and ($_.TrimEnd('\') -ine $binDir.TrimEnd('\')) }) -join ';'
        [Environment]::SetEnvironmentVariable('PATH', $np, 'User'); Say "  removed $binDir from User PATH" 'Green'
      }
      Say "  Done. `codex` is exactly as it was (never modified)." 'Green'
    } else {
      Plan "stop the shim on :$shimPort"; Plan "delete $kcodexCmd"; Plan "remove $binDir from User PATH"
      Say "`nDRY-RUN complete. Re-run with -Apply to execute." 'Cyan'
    }
  }

  'Heal' {
    Say "=== Heal SCX Codex ===" 'Cyan'
    if ((Test-Path $kcodexCmd) -and (ShimHealthy)) { Say "  healthy — nothing to heal." 'Green'; Show-Status; break }
    if ($Apply) { & $PSCommandPath -Mode Install -Apply } else { Plan "re-run Install -Apply (shim/launcher missing)"; Say "`nDRY-RUN complete." 'Cyan' }
  }

  'Status' { Show-Status }
}
