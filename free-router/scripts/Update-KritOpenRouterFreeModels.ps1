#requires -Version 7.0
<#
.SYNOPSIS
  Refresh OpenRouter free model candidates for Kritical CodingSystem.

.DESCRIPTION
  Calls OpenRouter /models with OPENROUTER_API_KEY when present, filters free
  text models, ranks coding/agentic candidates, and writes a local JSON catalog.
  Does not print secrets.
#>
[CmdletBinding()]
param(
  [string] $OutputPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'out\openrouter-free-model-candidates.json'),
  [int] $Top = 40
)

$ErrorActionPreference = 'Stop'
$key = $env:OPENROUTER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User') }
if (-not $key) { throw 'OPENROUTER_API_KEY missing. Run Import-KritSecretsToEnv.ps1 first.' }

function Get-Score {
  param([object] $Model)
  $id = [string]$Model.id
  $name = [string]($Model.name ?? '')
  $hay = ($id + ' ' + $name + ' ' + (($Model.description ?? '') -as [string])).ToLowerInvariant()
  $score = 0
  if ($id -match 'qwen/qwen3-coder') { $score += 180 }
  elseif ($id -match 'poolside/laguna-m\.1') { $score += 170 }
  elseif ($id -match 'poolside/laguna') { $score += 155 }
  elseif ($id -match 'nvidia/nemotron-3-ultra') { $score += 150 }
  elseif ($id -match 'nvidia/nemotron-3-super') { $score += 145 }
  elseif ($id -match 'openai/gpt-oss-120b') { $score += 135 }
  elseif ($id -match 'cohere/north-mini-code') { $score += 130 }
  elseif ($id -match 'nousresearch/hermes') { $score += 120 }
  elseif ($id -match 'deepseek') { $score += 115 }
  elseif ($id -match 'google/gemma-4') { $score += 100 }
  elseif ($id -match 'llama-3\.3-70b') { $score += 90 }
  elseif ($id -match 'openrouter/free') { $score += 50 }
  elseif ($hay -match 'code|coder|program|software|agent|tool|reason') { $score += 40 }
  $ctx = 0
  try { $ctx = [int64]($Model.context_length ?? 0) } catch {}
  if ($ctx -ge 1000000) { $score += 30 }
  elseif ($ctx -ge 250000) { $score += 20 }
  elseif ($ctx -ge 128000) { $score += 10 }
  return $score
}

$headers = @{
  Authorization = "Bearer $key"
  'HTTP-Referer' = 'https://kritical.net'
  'X-Title' = 'Kritical CodingSystem'
}
$resp = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/models' -Headers $headers -TimeoutSec 30
$models = @($resp.data)
$free = foreach ($m in $models) {
  $id = [string]$m.id
  $pricing = $m.pricing
  $isFreeId = $id -like '*:free'
  $promptPrice = [double]::PositiveInfinity
  $completionPrice = [double]::PositiveInfinity
  try { $promptPrice = [double]$pricing.prompt } catch {}
  try { $completionPrice = [double]$pricing.completion } catch {}
  if ($isFreeId -or ($promptPrice -eq 0 -and $completionPrice -eq 0)) {
    [pscustomobject]@{
      id = $id
      name = $m.name
      context_length = $m.context_length
      architecture = $m.architecture
      supported_parameters = $m.supported_parameters
      pricing = $m.pricing
      score = (Get-Score $m)
      recommended_use = if ($id -match 'qwen.*coder|laguna') { 'coding-agent' }
        elseif ($id -match 'nemotron|gpt-oss|deepseek') { 'reasoning-orchestration' }
        elseif ($id -match 'hermes') { 'persistent-agent' }
        else { 'auxiliary-free-lane' }
    }
  }
}

$ranked = @($free | Sort-Object -Property score, context_length -Descending | Select-Object -First $Top)
$out = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  source = 'https://openrouter.ai/api/v1/models'
  total_models = $models.Count
  free_models = @($free).Count
  ranking_policy = 'coding/agentic keywords + context length + zero pricing/:free suffix'
  recommended_failover = @($ranked | Select-Object -ExpandProperty id)
  candidates = $ranked
}
New-Item -ItemType Directory -Path (Split-Path $OutputPath) -Force | Out-Null
$out | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$out | ConvertTo-Json -Depth 8
Write-Host "Wrote $OutputPath" -ForegroundColor Cyan
