#requires -Version 7.0
<#
.SYNOPSIS
    One-time setup: read the OpenRouter API key from the Kritical secrets file
    and register it in HKCU for the Kritical Free Router.

.DESCRIPTION
    Reads the OpenRouter key from:
      C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\Openrouter-joshua.finleyAtKriticalDotNet-key2-7July2026.txt

    Registers it via Register-KritFreeApiKey.ps1 in HKCU.
    Also creates a PowerShell profile snippet for easy shell variable access.

.EXAMPLE
    pwsh ./Setup-OpenRouterKey.ps1

.NOTES
    Author: Joshua Finley — (c) 2026 Kritical Pty Ltd
    HR1: key never committed to git. Lives in HKCU only.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$secretPath = 'C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\Openrouter-joshua.finleyAtKriticalDotNet-key2-7July2026.txt'
$registerScript = Join-Path $PSScriptRoot 'scripts\Register-KritFreeApiKey.ps1'

Write-Host 'Kritical OpenRouter Key Setup' -ForegroundColor Cyan
Write-Host '=============================' -ForegroundColor Cyan

# Read key from secrets file
if (-not (Test-Path $secretPath)) {
    Write-Host "ERROR: Secrets file not found: $secretPath" -ForegroundColor Red
    Write-Host 'Please ensure the file exists and contains your OpenRouter API key.' -ForegroundColor Yellow
    exit 1
}

$key = (Get-Content -LiteralPath $secretPath -Raw).Trim()
if (-not $key -or $key.Length -lt 20) {
    Write-Host 'ERROR: Key appears invalid (too short or empty)' -ForegroundColor Red
    exit 1
}

Write-Host "Read key from secrets file (len=$($key.Length))" -ForegroundColor Green

# Register via the key manager
if (-not (Test-Path $registerScript)) {
    Write-Host "ERROR: Register script not found: $registerScript" -ForegroundColor Red
    Write-Host 'Run from the free-router directory.' -ForegroundColor Yellow
    exit 1
}

& $registerScript -Provider openrouter -Key $key

# Also add to current process environment for immediate use
$env:OPENROUTER_API_KEY = $key

# Create PowerShell profile snippet for easy loading
$profileSnippet = @"
# Kritical Free Router — OpenRouter key auto-load
`$env:OPENROUTER_API_KEY = '$key'
"@

Write-Host ''
Write-Host 'Setup complete!' -ForegroundColor Green
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Start the router:  pwsh ./scripts/Start-KritFreeRouter.ps1 -Mode Start -Config free' -ForegroundColor Gray
Write-Host '  2. Run codex:         pwsh ./scripts/kritical-openrouter.ps1' -ForegroundColor Gray
Write-Host '  3. Or add more keys:  pwsh ./scripts/Register-KritFreeApiKey.ps1 -Status' -ForegroundColor Gray
