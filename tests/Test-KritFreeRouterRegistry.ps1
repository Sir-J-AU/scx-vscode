#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$registryPath = Join-Path $repoRoot 'free-router\config\free-providers-registry.json'
$pass = 0
$fail = 0

function Test-Case {
  param([string] $Name, [bool] $Condition)
  if ($Condition) {
    Write-Host "  PASS $Name" -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host "  FAIL $Name" -ForegroundColor Red
    $script:fail++
  }
}

Write-Host 'Kritical Free Router Registry — paired test' -ForegroundColor Cyan
$registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
$providers = @($registry.providers)
$mistral = $providers | Where-Object id -eq 'mistral-free' | Select-Object -First 1
$openrouter = $providers | Where-Object id -eq 'openrouter-free' | Select-Object -First 1

Test-Case 'registry parses' ($null -ne $registry)
Test-Case 'OpenRouter provider present' ($null -ne $openrouter)
Test-Case 'Mistral provider present' ($null -ne $mistral)
Test-Case 'Mistral corrected to 2B input tokens/day' ([int64]$mistral.free_tier.daily_tokens_in -eq 2000000000)
Test-Case 'Mistral corrected to 2B output tokens/day' ([int64]$mistral.free_tier.daily_tokens_out -eq 2000000000)
Test-Case 'Mistral source marked operator_verified' ($mistral.free_tier.source -eq 'operator_verified')
Test-Case 'Mistral participates in coding agents' (@($mistral.coding_tools) -contains 'codex-cli' -and @($mistral.coding_tools) -contains 'deepcode')
Test-Case 'free priority puts Mistral before 500K providers' (
  ([array]::IndexOf(@($registry.routing.default_free_priority), 'mistral-free') -lt [array]::IndexOf(@($registry.routing.default_free_priority), 'groq-free')) -and
  ([array]::IndexOf(@($registry.routing.default_free_priority), 'mistral-free') -lt [array]::IndexOf(@($registry.routing.default_free_priority), 'fireworks-free'))
)

Write-Host "`n$pass passed, $fail failed" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit $fail
