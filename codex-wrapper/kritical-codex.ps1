#requires -Version 7.0
<#
.SYNOPSIS
    kritical-codex — Kritical + SCX branded wrapper around OpenAI Codex CLI.

.DESCRIPTION
    Launches operator's existing `codex` CLI with Kritical + SCX defaults:
      - Points OPENAI_BASE_URL at the local Kritical LiteLLM proxy (:4180)
        WHEN the proxy is running. Otherwise falls back to whatever the
        operator has configured (default: api.openai.com direct).
      - Preselects a Kritical-tuned default model (scx-coder or openai/gpt-5-codex)
      - Emits the Kritical brand banner once at startup (bundled asset)
      - Shows SCX co-brand line ("Sovereign Australian AI — Southern Cross AI")
      - HR27 write-through of the invocation (prompt + wrapper args) IF the
        decision logger module is available.
      - HR29-compliant: never touches HKCU env vars. Sets env per-invocation only.
        Removing this wrapper leaves the operator's plain `codex` CLI unchanged.

.PARAMETER Model
    Model to preselect. Default 'scx-coder' when SCX_API_KEY present, else
    'openai/gpt-5-codex' when OPENAI_API_KEY present, else no override.
.PARAMETER BaseUrl
    OpenAI-shape base URL. Default 'http://127.0.0.1:4180' when the local
    LiteLLM proxy is healthy, else leaves the operator's existing setting.
.PARAMETER NoBanner
    Skip the Kritical brand banner emit.
.PARAMETER NoLog
    Skip HR27 write-through.
.PARAMETER CodexArgs
    Passthrough — everything after `--` goes to the underlying codex CLI.

.EXAMPLE
    pwsh ./codex-wrapper/kritical-codex.ps1
.EXAMPLE
    pwsh ./codex-wrapper/kritical-codex.ps1 -Model scx-coder -- exec "review this file"
.EXAMPLE
    pwsh ./codex-wrapper/kritical-codex.ps1 -NoBanner -- --help

.NOTES
    Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
    Contact: sales@kritical.net — ph. 1300 274 655
    Per HR29 (.5184) — additive layer only. Wrapper adds convenience defaults;
    does NOT modify operator dotfiles / HKCU env / global codex config.
    Per HR27 (.5182) — invocation logged to documentation/{human,ai}/.
    Per HR28 (.5183) — mechanism-named identifiers only.
#>
[CmdletBinding()]
param(
    [string] $Model,
    [string] $BaseUrl,
    [switch] $NoBanner,
    [switch] $NoLog,
    [Parameter(ValueFromRemainingArguments)] [string[]] $CodexArgs
)

# ------------------------------------------------------------
# Resolve wrapper location + bundled assets
# ------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $PSScriptRoot 'assets'
$bannerPath = Join-Path $assetsDir 'KriticalLogo.txt'
$brandSpecPath = Join-Path $assetsDir 'brand-spec.json'

# ------------------------------------------------------------
# HR29 preflight — never overwrite operator vars, never disrupt Claude Code
# ------------------------------------------------------------
$origOpenAIBaseUrl = $env:OPENAI_BASE_URL   # remember current process state
$origOpenAIKey     = $env:OPENAI_API_KEY    # .5214 — restore this too so the local proxy dummy key never leaks
$origAnthropicBaseUrl = $env:ANTHROPIC_BASE_URL

# HR29 hard invariant: we NEVER touch ANTHROPIC_BASE_URL. Ever.
# Claude Code + any Anthropic-shape client is unaffected by this wrapper.

# ------------------------------------------------------------
# Provider slot detection (HR29)
# ------------------------------------------------------------
$scxKey    = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
$openaiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')

# ------------------------------------------------------------
# Choose model + base URL (HR29 fallback-safe)
# ------------------------------------------------------------
# HR29 fix (.5185): resolve the ENDPOINT first, then pick the model to match it.
# Selecting 'scx-coder' merely because SCX_API_KEY exists — while routing Codex at
# api.openai.com because the proxy is down — makes Codex request an unknown model
# ("scx api key taking over" error). Model must follow a healthy SCX endpoint.
if (-not $BaseUrl) {
    # probe local LiteLLM
    $proxyHealthy = $false
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4180/health/liveliness' `
            -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $proxyHealthy = $true }
    } catch {}

    if ($proxyHealthy) {
        $BaseUrl = 'http://127.0.0.1:4180'
    } elseif ($origOpenAIBaseUrl) {
        # operator has an existing override — respect it
        $BaseUrl = $origOpenAIBaseUrl
    } else {
        # neither proxy nor override — leave env unset so codex uses its default
        $BaseUrl = $null
    }
}

if (-not $Model) {
    # SCX is the ONLY thing kcodex overrides, and ONLY with an SCX key + healthy local proxy.
    # Otherwise: leave everything unset -> stock codex uses its NATIVE OpenAI/ChatGPT auth + model.
    # We deliberately do NOT touch OpenAI, Anthropic, or Google routing/keys (operator .5186).
    if ($scxKey -and $BaseUrl -eq 'http://127.0.0.1:4180') { $Model = 'scx-coder' }
    else { $Model = $null }  # pure passthrough — native codex, native keys (HR29)
}

# ------------------------------------------------------------
# Kritical brand banner (once per invocation)
# ------------------------------------------------------------
if (-not $NoBanner) {
    if (Test-Path $bannerPath) {
        try {
            $banner = Get-Content -LiteralPath $bannerPath -Raw
            Write-Host $banner -ForegroundColor Cyan
        } catch {
            Write-Host ''
            Write-Host '  Kritical.SCXCode — kritical-codex wrapper' -ForegroundColor Cyan
        }
    }
    # brand-spec-driven footer
    $tagline = 'Your last call. And your first move.'
    $positioning = "Geelong & The Bellarine's IT & Cybersecurity Specialists"
    $phone = '1300 274 655'
    $email = 'sales@kritical.net'
    if (Test-Path $brandSpecPath) {
        try {
            $spec = Get-Content -LiteralPath $brandSpecPath -Raw | ConvertFrom-Json
            if ($spec.messaging.tagline)      { $tagline = $spec.messaging.tagline }
            if ($spec.messaging.positioning)  { $positioning = $spec.messaging.positioning }
            if ($spec.contact.phoneMain)      { $phone = $spec.contact.phoneMain }
            if ($spec.contact.emailSales)     { $email = $spec.contact.emailSales }
        } catch {}
    }
    Write-Host ''
    Write-Host "  $tagline" -ForegroundColor DarkCyan
    Write-Host "  $positioning" -ForegroundColor DarkCyan
    Write-Host "  Kritical Pty Ltd · $email · ph. $phone" -ForegroundColor DarkCyan
    Write-Host '  Sovereign Australian AI — powered by Southern Cross AI (SCX)' -ForegroundColor Yellow
    Write-Host ''
    if ($BaseUrl) {
        Write-Host "  Codex endpoint: $BaseUrl  (provider slot -> $($Model ?? '(codex default)'))" -ForegroundColor Gray
    } else {
        Write-Host "  Codex endpoint: (codex CLI default — api.openai.com)" -ForegroundColor Gray
    }
    Write-Host ''
}

# ------------------------------------------------------------
# HR27 write-through (best effort)
# ------------------------------------------------------------
if (-not $NoLog) {
    $loggerPath = Join-Path $repoRoot 'ps-module/KriticalDecisionLogger.psm1'
    if (Test-Path $loggerPath) {
        try {
            Import-Module $loggerPath -Force -ErrorAction SilentlyContinue
            $invocation = @{
                wrapper = 'kritical-codex.ps1'
                model = $Model
                base_url = $BaseUrl
                codex_args = ($CodexArgs -join ' ')
                pwd = (Get-Location).Path
            } | ConvertTo-Json -Compress
            if (Get-Command Add-KriticalAIResponse -ErrorAction SilentlyContinue) {
                Add-KriticalAIResponse -Content "kritical-codex invocation: $invocation" `
                    -Category action -Source 'kritical-codex-wrapper' `
                    -Provider 'openai-via-litellm' -Model $Model | Out-Null
            }
        } catch {}
    }
}

# ------------------------------------------------------------
# Confirm codex CLI is present
# ------------------------------------------------------------
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
    Write-Host ''
    Write-Host 'codex CLI not found on PATH.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Install OpenAI Codex CLI (Rust, MIT):' -ForegroundColor Yellow
    Write-Host '  winget install OpenAI.Codex        # Windows' -ForegroundColor Gray
    Write-Host '  brew install codex                  # macOS' -ForegroundColor Gray
    Write-Host '  cargo install --git https://github.com/openai/codex codex-cli' -ForegroundColor Gray
    Write-Host ''
    Write-Host 'Then re-run kritical-codex.ps1.' -ForegroundColor Yellow
    exit 2
}

# ------------------------------------------------------------
# Per-invocation env (HR29: process scope only, never HKCU)
# ------------------------------------------------------------
if ($BaseUrl) { $env:OPENAI_BASE_URL = $BaseUrl }
if ($BaseUrl -eq 'http://127.0.0.1:4180') {
    # LiteLLM master key — never sent to real OpenAI
    $env:OPENAI_API_KEY = 'sk-kritical-scx-local'
}
if ($Model) { $env:KRITICAL_CODEX_DEFAULT_MODEL = $Model }

# ------------------------------------------------------------
# Delegate to codex
# ------------------------------------------------------------
try {
    if ($Model -and ($CodexArgs -notcontains '--model') -and ($CodexArgs -notcontains '-m')) {
        # naive default-model injection — passes through if codex ignores it
        & codex --model $Model @CodexArgs
    } else {
        & codex @CodexArgs
    }
    $exitCode = $LASTEXITCODE
} finally {
    # HR29: restore original env — wrapper leaves zero residue
    $env:OPENAI_BASE_URL = $origOpenAIBaseUrl
    $env:OPENAI_API_KEY  = $origOpenAIKey   # .5214 — restore so the sk-kritical-scx-local dummy never persists
    # ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY were NEVER touched — Claude Code unaffected (HR29)
    Remove-Item Env:KRITICAL_CODEX_DEFAULT_MODEL -ErrorAction SilentlyContinue
}

exit $exitCode
