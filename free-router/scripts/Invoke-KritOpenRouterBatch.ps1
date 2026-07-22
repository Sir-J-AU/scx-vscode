#requires -Version 7.0
<#
.SYNOPSIS
  Offload planning/review tasks to OpenRouter free models in parallel.

.DESCRIPTION
  Reads tasks from JSON or a direct prompt, fans out to selected free models,
  and writes receipts. DryRun is default. Live requires OPENROUTER_API_KEY.
#>
[CmdletBinding()]
param(
  [string] $Prompt,
  [string] $TasksPath,
  [string[]] $Models = @(
    'qwen/qwen3-coder:free',
    'poolside/laguna-m.1:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'cohere/north-mini-code:free',
    'openai/gpt-oss-120b:free'
  ),
  [switch] $Live,
  [int] $MaxConcurrency = 2,
  [int] $MaxTokens = 900,
  [string] $OutDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'out\openrouter-batch')
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$tasks = @()
if ($TasksPath) {
  $raw = Get-Content -LiteralPath $TasksPath -Raw | ConvertFrom-Json
  $tasks = if ($raw.tasks) { @($raw.tasks) } else { @($raw) }
} elseif ($Prompt) {
  $tasks = @([pscustomobject]@{ id = 'TASK-001'; prompt = $Prompt })
} else {
  throw 'Provide -Prompt or -TasksPath.'
}

$key = $env:OPENROUTER_API_KEY
if (-not $key) { $key = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User') }
if ($Live -and -not $key) { throw 'OPENROUTER_API_KEY missing. Run Import-KritSecretsToEnv.ps1 first.' }

$scriptBlock = {
  param($Task, $Model, $Live, $Key, $MaxTokens, $OutDir)
  $safeId = (($Task.id ?? 'task') -replace '[^A-Za-z0-9_.-]', '_')
  $safeModel = ($Model -replace '[^A-Za-z0-9_.-]', '_')
  $outPath = Join-Path $OutDir "$safeId--$safeModel.json"
  $prompt = [string]$Task.prompt
  $result = [ordered]@{
    task_id = $Task.id
    model = $Model
    live = [bool]$Live
    ok = $false
    generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
  if (-not $Live) {
    $result.ok = $true
    $result.text = "DRY-RUN would call $Model for task $($Task.id)"
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding UTF8
    return $result
  }
  try {
    $body = @{
      model = $Model
      messages = @(
        @{ role = 'system'; content = 'You are a Kritical coding-system offload lane. Return concise, test-oriented implementation guidance. Do not ask for secrets.' },
        @{ role = 'user'; content = $prompt }
      )
      temperature = 0.2
      max_tokens = $MaxTokens
    } | ConvertTo-Json -Depth 20
    $headers = @{
      Authorization = "Bearer $Key"
      'HTTP-Referer' = 'https://kritical.net'
      'X-Title' = 'Kritical CodingSystem'
    }
    $resp = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/chat/completions' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 120
    $result.ok = $true
    $result.usage = $resp.usage
    $result.text = $resp.choices[0].message.content
  } catch {
    $result.error = $_.Exception.Message
  }
  $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outPath -Encoding UTF8
  $result
}

$jobs = [System.Collections.Generic.List[object]]::new()
foreach ($task in $tasks) {
  foreach ($model in $Models) {
    while (@($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $MaxConcurrency) {
      Start-Sleep -Milliseconds 300
      foreach ($done in @($jobs | Where-Object { $_.State -ne 'Running' -and -not $_.HasMoreData })) {
        [void]$jobs.Remove($done)
      }
    }
    $jobs.Add((Start-ThreadJob -ScriptBlock $scriptBlock -ArgumentList $task,$model,[bool]$Live,$key,$MaxTokens,$OutDir)) | Out-Null
  }
}

$all = @()
while ($jobs.Count -gt 0) {
  foreach ($job in @($jobs)) {
    if ($job.State -ne 'Running') {
      $all += Receive-Job $job
      Remove-Job $job -Force
      [void]$jobs.Remove($job)
    }
  }
  if ($jobs.Count -gt 0) { Start-Sleep -Milliseconds 300 }
}

$summary = [ordered]@{
  generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  live = [bool]$Live
  tasks = @($tasks).Count
  models = $Models
  ok = @($all | Where-Object { $_.ok }).Count
  failed = @($all | Where-Object { -not $_.ok }).Count
  out_dir = $OutDir
  results = $all
}
$summaryPath = Join-Path $OutDir 'summary.json'
$summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 8
Write-Host "Summary: $summaryPath" -ForegroundColor Cyan
