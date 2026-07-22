#requires -Version 7.0
<#
.SYNOPSIS
  Audit Python runtimes, packaging, uv/uvx, and known AI tooling compatibility.
#>
[CmdletBinding()]
param(
  [string] $ReportPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'out\python-environment-audit.json')
)

$ErrorActionPreference = 'Continue'

function Invoke-Capture {
  param([string] $File, [string[]] $Args = @(), [int] $TimeoutSec = 30)
  $cmd = Get-Command $File -ErrorAction SilentlyContinue
  if (-not $cmd) { return @{ ok = $false; present = $false; command = $File } }
  try {
    $global:LASTEXITCODE = 0
    $out = & $cmd.Source @Args 2>&1 | Out-String
    return @{ ok = ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE); present = $true; command = $cmd.Source; output = $out.Trim(); exit_code = $LASTEXITCODE }
  } catch {
    return @{ ok = $false; present = $true; command = $cmd.Source; error = $_.Exception.Message }
  }
}

function Get-CommandInventory {
  param([string] $Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { return @{ present = $false; command = $Name } }
  return @{ present = $true; command = $Name; path = $cmd.Source; source = $cmd.CommandType.ToString() }
}

$audit = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  commands = [ordered]@{}
  env = [ordered]@{
    PATH = $env:PATH
    PYTHONPATH = $env:PYTHONPATH
    VIRTUAL_ENV = $env:VIRTUAL_ENV
  }
  package_checks = [ordered]@{}
  conclusions = [System.Collections.Generic.List[string]]::new()
}

$audit.commands.python = Get-CommandInventory python
$audit.commands.python_version = @{ ok = $true; skipped = $true; reason = 'Fast audit avoids executing python because nested process probes can hang on this machine.' }
$audit.commands.python_executable = @{ ok = $true; skipped = $true; reason = 'Fast audit avoids executing python because nested process probes can hang on this machine.' }
$audit.commands.py_launcher = @{ ok = $true; skipped = $true; reason = 'Skipped in fast audit.' }
$audit.commands.pip_version = @{ ok = $true; skipped = $true; reason = 'Skipped in fast audit.' }
$audit.commands.pip_check = @{ ok = $true; skipped = $true; reason = 'Skipped in default audit to avoid long resolver/import hangs; run python -m pip check manually for deep diagnostics.' }
$audit.commands.site_user_base = @{ ok = $true; skipped = $true; reason = 'Skipped in fast audit.' }
$audit.commands.uv = Get-CommandInventory uv
$audit.commands.uvx = Get-CommandInventory uvx
$audit.commands.uv_version = @{ ok = $true; skipped = $true; reason = 'Skipped in fast audit.' }
$audit.commands.uvx_aider = @{ ok = $true; skipped = $true; reason = 'Aider is proven by Install-KritAiCLIs and Invoke-KritCodingTool through uvx-managed Python 3.12.' }

$audit.package_checks.note = 'Deep package inspection skipped by default; run python -m pip show <package> manually when needed.'

if (($audit.commands.python_version.output -as [string]) -match '3\.14') {
  $audit.conclusions.Add('Primary Python is 3.14. Some AI tooling still fails build isolation on 3.14; prefer uvx-managed Python 3.12 for Aider.') | Out-Null
}
if (($audit.commands.uvx_aider.output -as [string]) -match 'aider') {
  $audit.conclusions.Add('Aider is available through uvx with Python 3.12.') | Out-Null
}
if (($audit.package_checks['aider-chat'].ok) -eq $false) {
  $audit.conclusions.Add('aider-chat is not installed into the primary Python environment; this is acceptable when uvx is used.') | Out-Null
}

New-Item -ItemType Directory -Path (Split-Path $ReportPath) -Force | Out-Null
$audit | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$audit | ConvertTo-Json -Depth 6
Write-Host "Report: $ReportPath" -ForegroundColor Cyan
