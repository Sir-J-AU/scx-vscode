#requires -Version 7.0
<#
.SYNOPSIS
  Install Kritical agent-pack config snippets for coding tools.

.DESCRIPTION
  Reads a secretless agent-pack manifest and emits per-tool config snippets under
  %LOCALAPPDATA%\Kritical\SCXCode\agent-packs. Optionally persists helper env
  vars to HKCU. It does not overwrite native tool config files unless -WriteNative
  is supplied; even then every write is additive and backed up.

.NOTES
  Author: Joshua Finley — (c) 2026 Kritical Pty Ltd. All rights reserved.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('kritical-free-router','scx-native','kritical-agentic-mega-pipeline')]
  [string] $Pack = 'kritical-free-router',
  [ValidateSet('Install','Status','Remove')]
  [string] $Mode = 'Status',
  [switch] $PersistHKCU,
  [switch] $WriteNative
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packPath = Join-Path $repoRoot "free-router\agent-packs\$Pack.agent-pack.json"
if (-not (Test-Path -LiteralPath $packPath)) { throw "Agent pack missing: $packPath" }
$manifest = Get-Content -LiteralPath $packPath -Raw | ConvertFrom-Json
$outRoot = Join-Path $env:LOCALAPPDATA "Kritical\SCXCode\agent-packs\$Pack"

function Backup-File {
  param([string] $Path)
  if (Test-Path -LiteralPath $Path) {
    Copy-Item -LiteralPath $Path -Destination "$Path.bak.$(Get-Date -Format yyyyMMddHHmmss)" -Force
  }
}

function Write-JsonFile {
  param([string] $Path, [object] $Object)
  New-Item -ItemType Directory -Path (Split-Path $Path) -Force | Out-Null
  $Object | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

if ($Mode -eq 'Status') {
  [pscustomobject]@{
    Pack = $manifest.id
    Name = $manifest.name
    Output = $outRoot
    Installed = (Test-Path -LiteralPath $outRoot)
    Router = $manifest.router.base_url
    KeyEnv = ($manifest.router.api_key_env ?? $manifest.router.local_master_key_env)
  } | Format-List
  Write-Host "Kill switch: delete $outRoot and remove any generated native snippets." -ForegroundColor Yellow
  return
}

if ($Mode -eq 'Remove') {
  if (Test-Path -LiteralPath $outRoot) {
    Remove-Item -LiteralPath $outRoot -Recurse -Force
  }
  Write-Host "Removed generated pack output: $outRoot" -ForegroundColor Yellow
  return
}

if ($PersistHKCU) {
  if ($manifest.router.local_master_key_env -and $manifest.router.local_master_key_default) {
    [Environment]::SetEnvironmentVariable($manifest.router.local_master_key_env, $manifest.router.local_master_key_default, 'User')
  }
}

New-Item -ItemType Directory -Path $outRoot -Force | Out-Null
Write-JsonFile -Path (Join-Path $outRoot 'pack.json') -Object $manifest

$tools = $manifest.tools.PSObject.Properties
foreach ($tool in $tools) {
  $name = $tool.Name
  $cfg = $tool.Value
  $snippet = [ordered]@{
    tool = $name
    pack = $manifest.id
    baseUrl = ($cfg.base_url ?? $cfg.apiBase)
    apiKeyEnv = ($cfg.api_key_env ?? $cfg.apiKeyEnv)
    model = $cfg.model
    generatedUtc = (Get-Date).ToUniversalTime().ToString('o')
    notes = $cfg.notes
  }
  Write-JsonFile -Path (Join-Path $outRoot "$name.config.json") -Object $snippet
}

if ($WriteNative) {
  $vsCodeSettings = Join-Path $env:APPDATA 'Code\User\settings.json'
  $deep = $manifest.tools.deepcode
  if ($deep -and $deep.vscode_settings) {
    $native = [ordered]@{}
    if (Test-Path -LiteralPath $vsCodeSettings) {
      $native = Get-Content -LiteralPath $vsCodeSettings -Raw | ConvertFrom-Json -AsHashtable
      Backup-File -Path $vsCodeSettings
    }
    foreach ($prop in $deep.vscode_settings.PSObject.Properties) {
      $native[$prop.Name] = $prop.Value
    }
    Write-JsonFile -Path $vsCodeSettings -Object $native
    Write-Host "Updated VS Code DeepCode settings: $vsCodeSettings" -ForegroundColor Green
  }
}

Write-Host "Installed $($manifest.name) snippets to $outRoot" -ForegroundColor Green
Write-Host "Kill switch: delete $outRoot; native tools can keep or ignore these snippets independently." -ForegroundColor Yellow
