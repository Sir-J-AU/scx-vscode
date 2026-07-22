#requires -Version 7.0
<#
.SYNOPSIS
    Register, rotate, and manage free API keys for the Kritical LLM Router.

.DESCRIPTION
    Central key management for all free inference providers.
    Stores keys in HKCU environment variables (Kritical convention).
    Never writes keys to disk in plain text outside HKCU.

    Providers supported (see config/free-providers-registry.json):
      OpenRouter, Google AI Studio, Groq, Together AI, Fireworks AI,
      DeepSeek, Cohere, Mistral AI

.PARAMETER Provider
    Which provider to register. Use 'all' to check status of all.
    Values: openrouter, google, groq, together, fireworks, deepseek, cohere, mistral, all

.PARAMETER Key
    The API key to register. Omit to prompt securely.

.PARAMETER Remove
    Remove the key for the specified provider from HKCU.

.PARAMETER Status
    Show status of all registered keys (default if no action specified).

.PARAMETER Rotate
    Generate a new key reminder and archive the old one (manual process).

.PARAMETER Validate
    Test that the registered key works with a live API call.

.EXAMPLE
    pwsh ./Register-KritFreeApiKey.ps1 -Provider openrouter -Key "sk-or-v1-..."
.EXAMPLE
    pwsh ./Register-KritFreeApiKey.ps1 -Status
.EXAMPLE
    pwsh ./Register-KritFreeApiKey.ps1 -Provider openrouter -Validate
.EXAMPLE
    pwsh ./Register-KritFreeApiKey.ps1 -Provider openrouter -Remove

.NOTES
    Author: Joshua Finley — (c) 2026 Kritical Pty Ltd
    Contact: sales@kritical.net · ph. 1300 274 655
    HR1/HR29: additive, never disruptive. Keys stay in HKCU only.
#>
[CmdletBinding()]
param(
    [ValidateSet('openrouter','google','groq','together','fireworks','deepseek','cohere','mistral','all')]
    [string] $Provider = 'all',
    [string] $Key,
    [switch] $Remove,
    [switch] $Status,
    [switch] $Rotate,
    [switch] $Validate
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------
# Provider definitions — maps friendly name -> env var + validation endpoint
# ------------------------------------------------------------
$PROVIDERS = @{
    openrouter = @{
        envVar = 'OPENROUTER_API_KEY'
        validateUrl = 'https://openrouter.ai/api/v1/auth/key'
        modelSlug = 'openrouter/free'
        baseUrl = 'https://openrouter.ai/api/v1'
        freeTier = 'Unlimited (rate-limited)'
    }
    google = @{
        envVar = 'GOOGLE_API_KEY'
        validateUrl = $null  # Google uses different validation
        modelSlug = 'gemini-2.5-flash'
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
        freeTier = '15 RPM, 1M TPM'
    }
    groq = @{
        envVar = 'GROQ_API_KEY'
        validateUrl = 'https://api.groq.com/openai/v1/models'
        modelSlug = 'llama-3.3-70b-versatile'
        baseUrl = 'https://api.groq.com/openai/v1'
        freeTier = '~500K tokens/day'
    }
    together = @{
        envVar = 'TOGETHER_API_KEY'
        validateUrl = 'https://api.together.xyz/v1/models'
        modelSlug = 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
        baseUrl = 'https://api.together.xyz/v1'
        freeTier = '~1M tokens/day'
    }
    fireworks = @{
        envVar = 'FIREWORKS_API_KEY'
        validateUrl = 'https://api.fireworks.ai/inference/v1/models'
        modelSlug = 'accounts/fireworks/models/llama-v3p3-70b-instruct'
        baseUrl = 'https://api.fireworks.ai/inference/v1'
        freeTier = '~500K tokens/day'
    }
    deepseek = @{
        envVar = 'DEEPSEEK_API_KEY'
        validateUrl = 'https://api.deepseek.com/v1/models'
        modelSlug = 'deepseek-chat'
        baseUrl = 'https://api.deepseek.com/v1'
        freeTier = '~500K tokens/day'
    }
    cohere = @{
        envVar = 'COHERE_API_KEY'
        validateUrl = 'https://api.cohere.com/v1/models'
        modelSlug = 'command-r'
        baseUrl = 'https://api.cohere.com/v1'
        freeTier = '~1M tokens/month'
    }
    mistral = @{
        envVar = 'MISTRAL_API_KEY'
        validateUrl = 'https://api.mistral.ai/v1/models'
        modelSlug = 'codestral-latest'
        baseUrl = 'https://api.mistral.ai/v1'
        freeTier = '2B tokens/day'
    }
}

# ------------------------------------------------------------
# Banner
# ------------------------------------------------------------
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║ Kritical Free API Key Manager                            ║' -ForegroundColor Cyan
Write-Host '  ║ Joshua Finley · Kritical Pty Ltd · sales@kritical.net     ║' -ForegroundColor Cyan
Write-Host '  ║ ph. 1300 274 655                                          ║' -ForegroundColor Cyan
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
function Get-KeyStatus($provName) {
    $def = $PROVIDERS[$provName]
    $val = [Environment]::GetEnvironmentVariable($def.envVar, 'User')
    $status = if ($val) { 'REGISTERED' } else { 'MISSING' }
    $masked = if ($val) { $val.Substring(0, [Math]::Min(8, $val.Length)) + '...' } else { '---' }
    return [pscustomobject]@{
        Provider = $provName
        EnvVar = $def.envVar
        Status = $status
        Preview = $masked
        FreeTier = $def.freeTier
    }
}

function Test-KeyLive($provName) {
    $def = $PROVIDERS[$provName]
    $key = [Environment]::GetEnvironmentVariable($def.envVar, 'User')
    if (-not $key) { return [pscustomobject]@{ Provider = $provName; Live = $false; Error = 'No key registered' } }

    try {
        if ($provName -eq 'google') {
            # Google uses a different validation pattern
            $url = "$($def.baseUrl)/models?key=$key"
            $r = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 -ErrorAction Stop
            return [pscustomobject]@{ Provider = $provName; Live = $true; Error = $null; Models = @($r.models).Count }
        }
        elseif ($provName -eq 'openrouter') {
            # OpenRouter auth/key endpoint
            $r = Invoke-RestMethod -Uri $def.validateUrl -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 10 -ErrorAction Stop
            return [pscustomobject]@{ Provider = $provName; Live = $true; Error = $null; Data = $r.data }
        }
        else {
            $r = Invoke-RestMethod -Uri $def.validateUrl -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 10 -ErrorAction Stop
            return [pscustomobject]@{ Provider = $provName; Live = $true; Error = $null; Models = @($r.data).Count }
        }
    }
    catch {
        return [pscustomobject]@{ Provider = $provName; Live = $false; Error = $_.Exception.Message }
    }
}

# ------------------------------------------------------------
# STATUS mode (default)
# ------------------------------------------------------------
if ($Status -or ($Provider -eq 'all' -and -not $Key -and -not $Remove -and -not $Rotate -and -not $Validate)) {
    Write-Host '--- Free API Key Status ---' -ForegroundColor Cyan
    $PROVIDERS.Keys | Sort-Object | ForEach-Object {
        $s = Get-KeyStatus $_
        $color = if ($s.Status -eq 'REGISTERED') { 'Green' } else { 'Yellow' }
        Write-Host "  $($s.Provider.PadRight(12))  $($s.Status.PadRight(12))  $($s.Preview.PadRight(15))  $($s.FreeTier)" -ForegroundColor $color
    }
    Write-Host ''
    Write-Host 'To register a key:  pwsh ./Register-KritFreeApiKey.ps1 -Provider <name> -Key <key>' -ForegroundColor Gray
    Write-Host 'To validate a key:  pwsh ./Register-KritFreeApiKey.ps1 -Provider <name> -Validate' -ForegroundColor Gray
    return
}

# ------------------------------------------------------------
# REMOVE mode
# ------------------------------------------------------------
if ($Remove) {
    if ($Provider -eq 'all') {
        Write-Host 'ERROR: -Remove requires a specific provider. Use -Provider <name> -Remove' -ForegroundColor Red
        exit 1
    }
    $def = $PROVIDERS[$Provider]
    $existing = [Environment]::GetEnvironmentVariable($def.envVar, 'User')
    if (-not $existing) {
        Write-Host "No key found for $Provider ($($def.envVar))" -ForegroundColor Yellow
        return
    }
    [Environment]::SetEnvironmentVariable($def.envVar, $null, 'User')
    Write-Host "Removed $Provider key from HKCU ($($def.envVar))" -ForegroundColor Green
    return
}

# ------------------------------------------------------------
# VALIDATE mode
# ------------------------------------------------------------
if ($Validate) {
    if ($Provider -eq 'all') {
        Write-Host '--- Validating all registered keys ---' -ForegroundColor Cyan
        $PROVIDERS.Keys | Sort-Object | ForEach-Object {
            $result = Test-KeyLive $_
            $color = if ($result.Live) { 'Green' } else { 'Red' }
            $msg = if ($result.Live) { 'LIVE' } else { "FAIL: $($result.Error)" }
            Write-Host "  $($result.Provider.PadRight(12))  $msg" -ForegroundColor $color
        }
    }
    else {
        Write-Host "--- Validating $Provider ---" -ForegroundColor Cyan
        $result = Test-KeyLive $Provider
        $color = if ($result.Live) { 'Green' } else { 'Red' }
        if ($result.Live) {
            Write-Host "  $Provider key is LIVE and working" -ForegroundColor Green
            if ($result.Models) { Write-Host "  Available models: $($result.Models)" -ForegroundColor Gray }
        }
        else {
            Write-Host "  $Provider key FAILED: $($result.Error)" -ForegroundColor Red
        }
    }
    return
}

# ------------------------------------------------------------
# ROTATE mode
# ------------------------------------------------------------
if ($Rotate) {
    if ($Provider -eq 'all') {
        Write-Host 'ERROR: -Rotate requires a specific provider' -ForegroundColor Red
        exit 1
    }
    $def = $PROVIDERS[$Provider]
    $existing = [Environment]::GetEnvironmentVariable($def.envVar, 'User')
    if ($existing) {
        $archiveVar = "$($def.envVar)_ARCHIVED_$(Get-Date -Format yyyyMMddHHmmss)"
        [Environment]::SetEnvironmentVariable($archiveVar, $existing, 'User')
        Write-Host "Archived existing key to $archiveVar" -ForegroundColor Yellow
    }
    Write-Host "Rotate $Provider key:" -ForegroundColor Cyan
    Write-Host "  1. Visit the provider dashboard to generate a new key"
    Write-Host "  2. Run: pwsh ./Register-KritFreeApiKey.ps1 -Provider $Provider -Key <new-key>"
    return
}

# ------------------------------------------------------------
# REGISTER mode (default when Provider + Key specified)
# ------------------------------------------------------------
if ($Provider -eq 'all') {
    Write-Host 'ERROR: -Provider must be a specific provider name when registering a key' -ForegroundColor Red
    exit 1
}

$def = $PROVIDERS[$Provider]

# Prompt securely if key not provided
if (-not $Key) {
    $secureKey = Read-Host -Prompt "Enter $Provider API key" -AsSecureString
    $Key = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    )
}

if (-not $Key -or $Key.Length -lt 8) {
    Write-Host 'ERROR: Key too short or empty' -ForegroundColor Red
    exit 1
}

# Archive existing key before overwrite
$existing = [Environment]::GetEnvironmentVariable($def.envVar, 'User')
if ($existing) {
    $archiveVar = "$($def.envVar)_ARCHIVED_$(Get-Date -Format yyyyMMddHHmmss)"
    [Environment]::SetEnvironmentVariable($archiveVar, $existing, 'User')
    Write-Host "Archived previous key to $archiveVar" -ForegroundColor Yellow
}

# Store in HKCU
[Environment]::SetEnvironmentVariable($def.envVar, $Key, 'User')
Write-Host "Registered $Provider API key in HKCU ($($def.envVar))" -ForegroundColor Green
Write-Host "  Free tier: $($def.freeTier)" -ForegroundColor Gray
Write-Host "  Base URL:  $($def.baseUrl)" -ForegroundColor Gray

# Auto-validate
Write-Host ''
Write-Host 'Validating key...' -ForegroundColor Cyan
$validation = Test-KeyLive $Provider
if ($validation.Live) {
    Write-Host "  Key is LIVE and ready to use!" -ForegroundColor Green
}
else {
    Write-Host "  WARNING: Key validation failed: $($validation.Error)" -ForegroundColor Yellow
    Write-Host "  The key is stored but may not work. Check the key value." -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host "  1. Start the router:  pwsh ./Start-KritFreeRouter.ps1" -ForegroundColor Gray
Write-Host "  2. Configure your coding tool to use http://127.0.0.1:4182" -ForegroundColor Gray
Write-Host "  3. Or use a wrapper:  pwsh ./kritical-openrouter.ps1" -ForegroundColor Gray
