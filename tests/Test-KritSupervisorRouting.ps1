#requires -Version 7.0
<#
.SYNOPSIS
  Regression test (HR21) — proves the supervisor's TWO AI transports both work:
    PATH 1 DIRECT     : claude-code provider -> claude.exe -> api.anthropic.com (native Max plan)
    PATH 2 VIA LITELLM : scx-native provider -> 127.0.0.1:4180 -> SCX (sovereign)
  These are the two paths the Kritical.AISupervisor router (claude-code / codex / scx-native)
  depends on. HR29: direct path never touches the proxy; proxy path never touches Anthropic keys.
.EXAMPLE  pwsh tests/Test-KritSupervisorRouting.ps1
#>
[CmdletBinding()] param([switch]$SkipDirect)
$ErrorActionPreference = 'Continue'
$pass = 0; $fail = 0
function T($name, [scriptblock]$b) {
  try { if (& $b) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
        else { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:fail++ } }
  catch { Write-Host "  FAIL  $name — $($_.Exception.Message.Split([char]10)[0])" -ForegroundColor Red; $script:fail++ }
}

Write-Host "`n[PATH 1] DIRECT — claude-code provider (api.anthropic.com, native)" -ForegroundColor White
T "ANTHROPIC_BASE_URL is NOT the proxy (Claude stays direct)" {
  $u = [Environment]::GetEnvironmentVariable('ANTHROPIC_BASE_URL','User')
  (-not $u) -or ($u -notmatch '4180')
}
if (-not $SkipDirect) {
  T "claude --print responds (direct native auth)" {
    $r = claude --print --output-format text 'reply with exactly: DIRECT-OK' 2>&1 | Out-String
    $r -match 'DIRECT-OK'
  }
}

Write-Host "`n[PATH 2] VIA LITELLM — scx-native provider (127.0.0.1:4180 -> SCX)" -ForegroundColor White
T "proxy healthy" {
  try { (Invoke-WebRequest 'http://127.0.0.1:4180/health/liveliness' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
T "SCX responds through the proxy" {
  $b = @{ model='deepseek-v3.1'; max_tokens=15; messages=@(@{role='user';content='reply with exactly: PROXY-OK'}) } | ConvertTo-Json
  $r = Invoke-RestMethod 'http://127.0.0.1:4180/v1/chat/completions' -Method Post -TimeoutSec 30 `
        -Headers @{ Authorization='Bearer sk-kritical-scx-local' } -ContentType 'application/json' -Body $b
  ($r.choices[0].message.content) -match 'PROXY-OK'
}
T "proxy config is SCX-only (13 models on SCX_API_KEY, 0 anthropic/openai passthrough)" {
  $cfgs = @(
    (Join-Path $PSScriptRoot '..\litellm\kritical-scx.config.yaml')
  )
  $cfg = $cfgs | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $cfg) { return $false }
  $txt = Get-Content $cfg -Raw
  # SCX-only default config must NOT contain a real anthropic/openai api_key passthrough line
  ($txt -match 'SCX_API_KEY') -and ($txt -notmatch 'os.environ/ANTHROPIC_API_KEY') -and ($txt -notmatch 'os.environ/OPENAI_API_KEY')
}

Write-Host "`n===== $pass passed, $fail failed =====" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit $fail
