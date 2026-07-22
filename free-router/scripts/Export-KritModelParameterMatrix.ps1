#requires -Version 7.0
<#
.SYNOPSIS
  Export model parameter/capability matrix for Kritical CodingSystem.

.DESCRIPTION
  Combines live OpenRouter free-model discovery and mined SCX model metadata into
  Markdown and JSON files for model routing/tuning.
#>
[CmdletBinding()]
param(
  [string] $OpenRouterPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'out\openrouter-free-model-candidates.json'),
  [string] $ScxModelsPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'UpstreamDocumentation\scx-models.live.json'),
  [string] $OutJson = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'out\model-parameter-matrix.json'),
  [string] $OutMarkdown = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'docs\MODEL-PARAMETER-MATRIX.md')
)

$ErrorActionPreference = 'Stop'
$rows = [System.Collections.Generic.List[object]]::new()

if (Test-Path -LiteralPath $OpenRouterPath) {
  $or = Get-Content -LiteralPath $OpenRouterPath -Raw | ConvertFrom-Json
  foreach ($m in @($or.candidates)) {
    $rows.Add([pscustomobject]@{
      plane = 'openrouter-free'
      id = $m.id
      name = $m.name
      context_length = $m.context_length
      max_output_length = $null
      input_modalities = (@($m.architecture.input_modalities) -join ',')
      output_modalities = (@($m.architecture.output_modalities) -join ',')
      parameters = (@($m.supported_parameters) -join ',')
      features = ''
      prompt_price = $m.pricing.prompt
      completion_price = $m.pricing.completion
      currency = 'usd'
      recommended_use = $m.recommended_use
      score = $m.score
    }) | Out-Null
  }
}

if (Test-Path -LiteralPath $ScxModelsPath) {
  $scx = Get-Content -LiteralPath $ScxModelsPath -Raw | ConvertFrom-Json
  foreach ($m in @($scx.models)) {
    $rows.Add([pscustomobject]@{
      plane = 'scx'
      id = $m.id
      name = $m.name
      context_length = $m.context_length
      max_output_length = $m.max_output_length
      input_modalities = (@($m.input_modalities) -join ',')
      output_modalities = (@($m.output_modalities) -join ',')
      parameters = (@($m.supported_sampling_parameters) -join ',')
      features = (@($m.supported_features) -join ',')
      prompt_price = $m.pricing.prompt
      completion_price = $m.pricing.completion
      currency = $m.currency
      recommended_use = if (@($m.supported_features) -contains 'moderation') { 'guardrail' }
        elseif (@($m.output_modalities) -contains 'embeddings') { 'embedding' }
        elseif ($m.id -eq 'coder') { 'coding-synthesis' }
        elseif (@($m.supported_features) -contains 'reasoning') { 'reasoning-synthesis' }
        else { 'scx-lane' }
      score = $null
    }) | Out-Null
  }
}

New-Item -ItemType Directory -Path (Split-Path $OutJson) -Force | Out-Null
$out = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  openrouter_source = $OpenRouterPath
  scx_source = $ScxModelsPath
  count = $rows.Count
  rows = $rows
}
$out | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutJson -Encoding UTF8

$md = @(
  '# Kritical Model Parameter Matrix',
  '',
  ('Generated UTC: {0}' -f $out.generated_utc),
  '',
  '| Plane | Model | Context | Max Out | Params | Features | Use |',
  '|---|---|---:|---:|---|---|---|'
)
foreach ($r in $rows | Sort-Object plane, @{Expression='score';Descending=$true}, context_length -Descending) {
  $params = ([string]$r.parameters) -replace '\|','/'
  $features = ([string]$r.features) -replace '\|','/'
  $md += "| $($r.plane) | `$($r.id)` | $($r.context_length) | $($r.max_output_length) | $params | $features | $($r.recommended_use) |"
}
New-Item -ItemType Directory -Path (Split-Path $OutMarkdown) -Force | Out-Null
Set-Content -LiteralPath $OutMarkdown -Value ($md -join "`n") -Encoding UTF8

[pscustomobject]@{
  Json = $OutJson
  Markdown = $OutMarkdown
  Count = $rows.Count
}
