#requires -Version 7.0
<#
.SYNOPSIS
  Prove the direct OpenRouter free-model path without touching SCX.

.DESCRIPTION
  Loads OPENROUTER_API_KEY from process or HKCU, verifies /models contains the
  requested zero-price model, then optionally performs a tiny chat completion.
  Writes a JSON receipt and never prints key material.
#>
[CmdletBinding()]
param(
  [string] $Model = 'openrouter/free',
  [string] $Prompt = 'Reply with exactly: KRITICAL_OPENROUTER_PATH_OK',
  [int] $MaxTokens = 24,
  [switch] $SkipChat,
  [string] $OutPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'out\openrouter-path-proof.json')
)

$ErrorActionPreference = 'Stop'

function Get-KritEnvValue {
  param([Parameter(Mandatory)] [string] $Name)
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, 'User') }
  return $value
}

$key = Get-KritEnvValue -Name 'OPENROUTER_API_KEY'
if (-not $key) {
  throw 'OPENROUTER_API_KEY missing. Run free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -ProcessOnly or -PersistUser.'
}

$headers = @{
  Authorization = "Bearer $key"
  'HTTP-Referer' = 'https://kritical.net'
  'X-Title' = 'Kritical OpenRouter Path Proof'
}

$started = Get-Date
$modelsResponse = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/models' -Headers $headers -TimeoutSec 30
$models = @($modelsResponse.data)
$selected = $models | Where-Object { [string]$_.id -eq $Model } | Select-Object -First 1
if (-not $selected) {
  throw "OpenRouter model '$Model' was not returned by /models."
}

$promptPrice = $null
$completionPrice = $null
try { $promptPrice = [double]$selected.pricing.prompt } catch {}
try { $completionPrice = [double]$selected.pricing.completion } catch {}

$receipt = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  base_url = 'https://openrouter.ai/api/v1'
  model = $Model
  model_found = $true
  zero_price = ($promptPrice -eq 0 -and $completionPrice -eq 0)
  context_length = $selected.context_length
  supported_parameters = $selected.supported_parameters
  pricing = $selected.pricing
  chat_ok = $false
}

if (-not $SkipChat) {
  $body = @{
    model = $Model
    messages = @(
      @{ role = 'system'; content = 'You are a terse connectivity probe. Follow the user instruction exactly.' },
      @{ role = 'user'; content = $Prompt }
    )
    temperature = 0
    max_tokens = $MaxTokens
  } | ConvertTo-Json -Depth 20

  try {
    $chat = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/chat/completions' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 120
    $text = [string]$chat.choices[0].message.content
    $receipt.chat_ok = [bool]$text
    $receipt.response_model = $chat.model
    $receipt.response_preview = if ($text.Length -gt 160) { $text.Substring(0, 160) } else { $text }
    $receipt.usage = $chat.usage
  }
  catch {
    $receipt.chat_error = $_.Exception.Message
  }
}

$receipt.elapsed_ms = [int]((Get-Date) - $started).TotalMilliseconds
New-Item -ItemType Directory -Path (Split-Path $OutPath) -Force | Out-Null
$receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutPath -Encoding UTF8
$receipt | ConvertTo-Json -Depth 8
Write-Host "OpenRouter proof: $OutPath" -ForegroundColor Cyan
if (-not $receipt.zero_price) { exit 2 }
if (-not $SkipChat -and -not $receipt.chat_ok) { exit 3 }
