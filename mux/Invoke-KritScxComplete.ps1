<#
.SYNOPSIS
  Get a COMPLETE SCX response of any size — auto-continues when the model truncates at max_tokens
  (finish_reason='length') and stitches the parts into one answer. Handles tiny -> tens-of-thousands
  of tokens. Size presets with sane defaults; or set the knobs explicitly.

.PARAMETER Prompt        The user prompt.
.PARAMETER Size          tiny | small | medium | large | huge   (default medium). Sets per-call tokens + max continuations.
.PARAMETER Model         SCX model (default scx-coder).
.PARAMETER System        Optional system prompt.
.PARAMETER MaxTokensPerCall  Override the per-call token cap.
.PARAMETER MaxContinues  Override the max number of continuation calls.
.PARAMETER Raw           Return the object (Content/Calls/TotalTokens/Truncated) instead of just the text.
.EXAMPLE  Invoke-KritScxComplete -Prompt "Write a 400-line PowerShell module for X" -Size large
.EXAMPLE  $r = Invoke-KritScxComplete -Prompt "..." -Size huge -Raw ; $r.Content | Set-Content out.ps1
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Prompt,
      [ValidateSet('tiny','small','medium','large','huge')][string]$Size='medium',
      [string]$Model='scx-coder', [string]$System,
      [int]$MaxTokensPerCall, [int]$MaxContinues, [switch]$Raw,
      [string]$Base='http://127.0.0.1:4180/v1/chat/completions', [string]$Key='sk-kritical-scx-local')
$ErrorActionPreference='Stop'
# ---- size presets. PRIMARY lever = a big single-call max_tokens (scx-coder has 192k context,
# so it returns large outputs cleanly in ONE call — no stitching artifacts). Continuation is only
# a fallback for outputs that exceed even the big cap; naive stitching can split syntax at chunk
# boundaries, so prefer a large `per` and few `cont`. ----
$presets = @{
  tiny   = @{ per=512;   cont=0 }
  small  = @{ per=2048;  cont=1 }
  medium = @{ per=6144;  cont=2 }
  large  = @{ per=12288; cont=3 }
  huge   = @{ per=16384; cont=6 }   # ~16k/call, up to ~100k total
}
$per  = if ($MaxTokensPerCall) { $MaxTokensPerCall } else { $presets[$Size].per }
$cont = if ($PSBoundParameters.ContainsKey('MaxContinues')) { $MaxContinues } else { $presets[$Size].cont }

$messages = @()
if ($System) { $messages += @{ role='system'; content=$System } }
$messages += @{ role='user'; content=$Prompt }

$full = New-Object System.Text.StringBuilder
$calls = 0; $totalTok = 0; $truncated = $false
for ($i = 0; $i -le $cont; $i++) {
  $body = @{ model=$Model; max_tokens=$per; temperature=0; messages=$messages } | ConvertTo-Json -Depth 8
  $r = Invoke-RestMethod $Base -Method Post -TimeoutSec 180 -Headers @{ Authorization="Bearer $Key" } -ContentType 'application/json' -Body $body
  $calls++; $totalTok += [int]$r.usage.total_tokens
  $chunk = [string]$r.choices[0].message.content
  [void]$full.Append($chunk)
  $finish = $r.choices[0].finish_reason
  Write-Verbose "call ${calls}: +$($chunk.Length) chars, finish=$finish, total_tok=$totalTok"
  if ($finish -ne 'length') { $truncated = $false; break }
  $truncated = $true
  if ($i -eq $cont) { break }   # hit continuation cap
  # continue: feed the partial back and ask to resume exactly where it stopped
  $messages += @{ role='assistant'; content=$chunk }
  $messages += @{ role='user'; content='Continue from the EXACT character where you stopped. Do NOT repeat anything already written. Do NOT add any markdown code fences (no ```). Do NOT add commentary. Output only the raw continuation.' }
}
# stitch: drop any stray markdown fence lines (continuation artifacts) so code joins cleanly
$content = ($full.ToString() -replace '(?m)^\s*```[a-zA-Z0-9]*\s*$','').Trim()
$out = [pscustomobject]@{ Content=$content; Calls=$calls; TotalTokens=$totalTok; Truncated=$truncated; Size=$Size }
if ($Raw) { $out } else { $out.Content }
if ($truncated) { Write-Warning "Still truncated after $calls calls ($totalTok tok). Use -Size huge or raise -MaxContinues." }
