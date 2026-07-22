#requires -Version 7.0
<#
.SYNOPSIS
  Load external Kritical secret files into process and HKCU environment variables.

.DESCRIPTION
  Secretless repo bootstrapper. Reads key files from a directory outside the git
  checkout, maps known filename patterns to provider env vars, and optionally
  persists them to HKCU. No secret values are written into this repository.

  Default secret root:
    C:\Users\<user>\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY

.PARAMETER Mode
  Status | Load | Remove

.PARAMETER SecretsRoot
  External folder containing *.txt key files.

.PARAMETER PersistUser
  Persist loaded values to HKCU User environment variables.

.PARAMETER ProcessOnly
  Load values into the current PowerShell process only.

.PARAMETER IncludeScx
  Also map SCX key patterns to SCX_API_KEY.

.PARAMETER IncludeFreeProviders
  Map free-provider key patterns such as OpenRouter, Mistral, Groq, Together,
  Fireworks, Google, DeepSeek, and Cohere.

.EXAMPLE
  pwsh ./Import-KritSecretsToEnv.ps1 -Mode Load -PersistUser

.EXAMPLE
  pwsh ./Import-KritSecretsToEnv.ps1 -Mode Status

.NOTES
  Author: Joshua Finley — (c) 2026 Kritical Pty Ltd. All rights reserved.
  HR29: additive; remove env vars or do not run this loader and underlying tools
  keep their native config surfaces.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('Status','Load','Remove')]
  [string] $Mode = 'Status',
  [string] $SecretsRoot = (Join-Path $env:USERPROFILE 'OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY'),
  [switch] $PersistUser,
  [switch] $ProcessOnly,
  [switch] $IncludeScx = $true,
  [switch] $IncludeFreeProviders = $true
)

$ErrorActionPreference = 'Stop'

if ($PersistUser -and $ProcessOnly) {
  throw 'Choose either -PersistUser or -ProcessOnly, not both.'
}

$mappings = @(
  @{ Env='OPENROUTER_API_KEY'; Patterns=@('Openrouter-*key*.txt','openrouter-*key*.txt','*OPENROUTER*API*KEY*.txt'); Enabled=$IncludeFreeProviders },
  @{ Env='MISTRAL_API_KEY';    Patterns=@('Mistral-*key*.txt','mistral-*key*.txt','*MISTRAL*API*KEY*.txt');       Enabled=$IncludeFreeProviders },
  @{ Env='GROQ_API_KEY';       Patterns=@('Groq-*key*.txt','groq-*key*.txt','*GROQ*API*KEY*.txt');                Enabled=$IncludeFreeProviders },
  @{ Env='TOGETHER_API_KEY';   Patterns=@('Together-*key*.txt','together-*key*.txt','*TOGETHER*API*KEY*.txt');    Enabled=$IncludeFreeProviders },
  @{ Env='FIREWORKS_API_KEY';  Patterns=@('Fireworks-*key*.txt','fireworks-*key*.txt','*FIREWORKS*API*KEY*.txt'); Enabled=$IncludeFreeProviders },
  @{ Env='GOOGLE_API_KEY';     Patterns=@('Google-*key*.txt','google-*key*.txt','Gemini-*key*.txt','*GOOGLE*API*KEY*.txt'); Enabled=$IncludeFreeProviders },
  @{ Env='DEEPSEEK_API_KEY';   Patterns=@('DeepSeek-*key*.txt','deepseek-*key*.txt','*DEEPSEEK*API*KEY*.txt');    Enabled=$IncludeFreeProviders },
  @{ Env='COHERE_API_KEY';     Patterns=@('Cohere-*key*.txt','cohere-*key*.txt','*COHERE*API*KEY*.txt');          Enabled=$IncludeFreeProviders },
  @{ Env='SCX_API_KEY';        Patterns=@('scx.ai-apikey-*.txt','SCX-*key*.txt','*SCX*API*KEY*.txt');             Enabled=$IncludeScx }
)

function Get-FirstSecretFile {
  param([string[]] $Patterns)
  foreach ($pattern in $Patterns) {
    $match = Get-ChildItem -LiteralPath $SecretsRoot -Filter $pattern -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($match) { return $match }
  }
  return $null
}

function Read-SecretText {
  param([System.IO.FileInfo] $File)
  $raw = [System.IO.File]::ReadAllText($File.FullName).Trim()
  if (-not $raw) { throw "Secret file is empty: $($File.FullName)" }
  $line = ($raw -split "\r?\n" | Where-Object { $_.Trim() -and $_ -notmatch '^\s*#' } | Select-Object -First 1)
  return $line.Trim()
}

function Get-EnvPreview {
  param([string] $Value)
  if (-not $Value) { return 'ABSENT' }
  return ('present len={0} sha256={1}' -f $Value.Length, (([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object ToString x2) -join '').Substring(0,16))
}

if (-not (Test-Path -LiteralPath $SecretsRoot)) {
  if ($Mode -eq 'Status') {
    Write-Host "Secrets root missing: $SecretsRoot" -ForegroundColor Yellow
    exit 0
  }
  throw "Secrets root missing: $SecretsRoot"
}

$rows = foreach ($m in $mappings | Where-Object Enabled) {
  $file = Get-FirstSecretFile -Patterns $m.Patterns
  $userVal = [Environment]::GetEnvironmentVariable($m.Env, 'User')
  $procVal = [Environment]::GetEnvironmentVariable($m.Env, 'Process')
  [pscustomobject]@{
    EnvVar = $m.Env
    File = if ($file) { $file.FullName } else { $null }
    Process = Get-EnvPreview $procVal
    User = Get-EnvPreview $userVal
  }
}

if ($Mode -eq 'Status') {
  $rows | Format-Table -AutoSize
  Write-Host ''
  Write-Host 'Kill switch: remove the HKCU env vars or do not import this loader; native tools keep their own config.' -ForegroundColor Yellow
  return
}

if ($Mode -eq 'Remove') {
  foreach ($row in $rows) {
    if ($PSCmdlet.ShouldProcess($row.EnvVar, 'remove from Process and User environment')) {
      [Environment]::SetEnvironmentVariable($row.EnvVar, $null, 'Process')
      if (-not $ProcessOnly) { [Environment]::SetEnvironmentVariable($row.EnvVar, $null, 'User') }
      Write-Host "Removed $($row.EnvVar)" -ForegroundColor Yellow
    }
  }
  return
}

foreach ($m in $mappings | Where-Object Enabled) {
  $file = Get-FirstSecretFile -Patterns $m.Patterns
  if (-not $file) {
    Write-Host "SKIP $($m.Env): no matching secret file" -ForegroundColor DarkYellow
    continue
  }
  $secret = Read-SecretText -File $file
  if ($PSCmdlet.ShouldProcess($m.Env, "load from $($file.Name)")) {
    [Environment]::SetEnvironmentVariable($m.Env, $secret, 'Process')
    if ($PersistUser -or (-not $ProcessOnly)) {
      [Environment]::SetEnvironmentVariable($m.Env, $secret, 'User')
    }
    Write-Host ("LOADED {0} from {1} ({2})" -f $m.Env, $file.Name, (Get-EnvPreview $secret)) -ForegroundColor Green
  }
}

Write-Host ''
Write-Host 'Kill switch: rerun with -Mode Remove, or remove these HKCU env vars manually. No repo files contain key values.' -ForegroundColor Yellow
