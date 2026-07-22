#requires -Version 7.0
<#
.SYNOPSIS
  Read-only readiness check for the Kritical CodingSystem.

.DESCRIPTION
  Checks local CLIs, VS Code extensions, key env vars, local router endpoints,
  agent-pack manifests, MCP bundle, and sister supervisor repos. Emits a JSON
  receipt without printing secrets.
#>
[CmdletBinding()]
param(
  [string] $ReportPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'out\kritical-coding-system-status.json')
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-CommandPresent {
  param([string] $Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { return @{ present = $false } }
  $ver = try { (& $cmd.Source --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { '' }
  return @{ present = $true; path = $cmd.Source; version = $ver }
}

function Test-AiderPresent {
  $aider = Get-Command aider -ErrorAction SilentlyContinue
  if ($aider) {
    $ver = try { (& $aider.Source --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { '' }
    return @{ present = $true; path = $aider.Source; version = $ver; mode = 'direct' }
  }
  $uvx = Get-Command uvx -ErrorAction SilentlyContinue
  if (-not $uvx) { return @{ present = $false } }
  $ver = try { (& $uvx.Source --python 3.12 --from aider-chat aider --version 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { '' }
  return @{ present = ($ver -match 'aider'); path = $uvx.Source; version = $ver; mode = 'uvx-python-3.12' }
}

function Test-EnvVar {
  param([string] $Name)
  $v = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, 'User') }
  if (-not $v) { return @{ present = $false } }
  $bytes = [Text.Encoding]::UTF8.GetBytes($v)
  $sha = [Security.Cryptography.SHA256]::HashData($bytes)
  return @{
    present = $true
    length = $v.Length
    sha256_prefix = ([BitConverter]::ToString($sha).Replace('-', '').ToLowerInvariant().Substring(0, 16))
  }
}

function Test-Http {
  param([string] $Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return @{ ok = $true; status = [int]$r.StatusCode }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Test-VsCodeExtension {
  param([string] $ExtensionId)
  $code = Get-Command code -ErrorAction SilentlyContinue
  if (-not $code) { return @{ present = $false; reason = 'code CLI absent' } }
  $list = & $code.Source --list-extensions 2>$null
  return @{ present = @($list) -contains $ExtensionId }
}

$cliNames = @('codex','claude','kilo','opencode','aider','hermes','node','npm','python','pwsh','git')
$envNames = @(
  'SCX_API_KEY',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'DEEPSEEK_API_KEY',
  'COHERE_API_KEY',
  'KRIT_FREE_ROUTER_MASTER_KEY'
)

$status = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  repo = $repoRoot
  cli = [ordered]@{}
  env = [ordered]@{}
  endpoints = [ordered]@{
    free_router = Test-Http 'http://127.0.0.1:4182/health/liveliness'
    codex_shim = Test-Http 'http://127.0.0.1:4199/v1/models'
    chunk_server = Test-Http 'http://127.0.0.1:4270/health'
  }
  vscode_extensions = [ordered]@{
    kilo = Test-VsCodeExtension 'kilocode.kilo-code'
    cline = Test-VsCodeExtension 'saoudrizwan.claude-dev'
    continue = Test-VsCodeExtension 'Continue.continue'
  }
  manifests = [ordered]@{}
  sister_supervisors = [ordered]@{
    nodejs = Test-Path -LiteralPath 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.NodeJS'
    powershell = Test-Path -LiteralPath 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.PS'
  }
}

foreach ($name in $cliNames) {
  $status.cli[$name] = if ($name -eq 'aider') { Test-AiderPresent } else { Test-CommandPresent $name }
}
foreach ($name in $envNames) { $status.env[$name] = Test-EnvVar $name }

foreach ($file in @(
  'free-router\agent-packs\kritical-free-router.agent-pack.json',
  'free-router\agent-packs\scx-native.agent-pack.json',
  'free-router\agent-packs\kritical-agentic-mega-pipeline.agent-pack.json',
  'free-router\agent-packs\kritical-mcp-tools.bundle.json',
  'free-router\config\free-agentic-model-catalog.json',
  'free-router\config\free-providers-registry.json'
)) {
  $path = Join-Path $repoRoot $file
  try {
    Get-Content -LiteralPath $path -Raw | ConvertFrom-Json | Out-Null
    $status.manifests[$file] = @{ present = $true; parses = $true }
  } catch {
    $status.manifests[$file] = @{ present = (Test-Path -LiteralPath $path); parses = $false; error = $_.Exception.Message }
  }
}

New-Item -ItemType Directory -Path (Split-Path $ReportPath) -Force | Out-Null
$status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$status | ConvertTo-Json -Depth 10
Write-Host "Report: $ReportPath" -ForegroundColor Cyan
