<#
.SYNOPSIS
  Kritical SCX muxing engine (MVP) — "context from thin air". Splits a task across N source shards,
  fires N CONCURRENT SCX calls (one per shard) through the local proxy, persists each shard summary
  to KriticalSCXCodeStore.dbo.context_shard, then a synthesiser call merges them into ONE answer.

  Effective context = per-call window x concurrency. HR29: SCX-only, localhost proxy, never touches Claude/Codex.

.PARAMETER Task         The question/instruction to answer across all shards.
.PARAMETER Shards       Array of file paths OR literal text blocks (each becomes one concurrent call).
.PARAMETER Concurrency  Max parallel SCX calls (default 4).
.PARAMETER Model        SCX model (default scx-coder).
.PARAMETER SessionId    Grouping key for context_shard rows.
.EXAMPLE
  Invoke-KritScxMux.ps1 -Task "What does this codebase do?" -Shards (Get-ChildItem *.ps1).FullName -Concurrency 4
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Task,
      [Parameter(Mandatory)][string[]]$Shards,
      [int]$Concurrency=4, [string]$Model='scx-coder',
      [string]$SessionId="mux-$(Get-Date -Format yyyyMMddHHmmss)")
$ErrorActionPreference='Continue'
# HARD requirement: ForEach-Object -Parallel + $using: are PowerShell 7+ only. Under Windows PowerShell 5.1
# the parallel block silently resolves to 0 shards. Fail clearly instead of producing an empty result.
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Invoke-KritScxMux requires PowerShell 7+ (ForEach-Object -Parallel). Launch with 'pwsh', not 'powershell.exe'."
}
$base='http://127.0.0.1:4180/v1/chat/completions'; $key='sk-kritical-scx-local'
$venvPy='C:\KriticalSCX\venv-litellm-test\Scripts\python.exe'

# resolve shards: existing path -> file content; else literal text
$items = @($Shards | ForEach-Object { if (Test-Path $_ -PathType Leaf) { [pscustomobject]@{ ref=(Split-Path $_ -Leaf); text=(Get-Content $_ -Raw) } } else { [pscustomobject]@{ ref='inline'; text=$_ } } })
Write-Host "Muxing '$Task' across $($items.Count) shards @ concurrency $Concurrency (session $SessionId)" -ForegroundColor Cyan

$sw=[System.Diagnostics.Stopwatch]::StartNew()
# (b) N concurrent SCX calls — one summary per shard
$summaries = $items | ForEach-Object -ThrottleLimit $Concurrency -Parallel {
  $it=$_; $b=$using:base; $k=$using:key; $m=$using:Model; $t=$using:Task
  $body = @{ model=$m; max_tokens=220; temperature=0; messages=@(@{role='user';content="Task: $t`n`nSummarise the SOURCE below for that task in <=100 words; keep concrete facts/names. SOURCE:`n`n$($it.text)"}) } | ConvertTo-Json -Depth 6
  try { $r=Invoke-RestMethod $b -Method Post -TimeoutSec 90 -Headers @{Authorization="Bearer $k"} -ContentType 'application/json' -Body $body
        [pscustomobject]@{ source_ref=$it.ref; content=$r.choices[0].message.content; token_count=[int]$r.usage.total_tokens } }
  catch { [pscustomobject]@{ source_ref=$it.ref; content="(shard failed: $($_.Exception.Message))"; token_count=0 } }
}
Write-Host "  $($summaries.Count) shard summaries in $($sw.ElapsedMilliseconds)ms" -ForegroundColor Green

# (c) persist shards to context_shard (pyodbc). Write JSON BOM-free so python json.load doesn't choke.
$rows = $summaries | ForEach-Object { [pscustomobject]@{ session_id=$SessionId; source_ref=$_.source_ref; content=$_.content; token_count=$_.token_count } }
$tmp="$env:TEMP\mux-shards-$(Get-Random).json"
[System.IO.File]::WriteAllText($tmp, ($rows | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
if (Test-Path $venvPy) {
  $ingestOut = & $venvPy "$PSScriptRoot\mux_shards_ingest.py" $tmp 2>&1
  $ingestOk  = ($LASTEXITCODE -eq 0)
  $ingestOut | ForEach-Object { Write-Host "  $_" -ForegroundColor $(if($ingestOk){'Green'}else{'Red'}) }
  if (-not $ingestOk) { Write-Warning "SHARD PERSISTENCE FAILED — context_shard NOT updated for session $SessionId" }
} else { Write-Warning "venv python missing at $venvPy — shards NOT persisted to context_shard" }
Remove-Item $tmp -EA SilentlyContinue

# (d) synthesiser — merge shard summaries into one answer
$merged = ($summaries | ForEach-Object { "[$($_.source_ref)] $($_.content)" }) -join "`n`n"
$synthBody = @{ model=$Model; max_tokens=1500; temperature=0.2; messages=@(@{role='user';content="Task: $Task`n`nBelow are per-source summaries. Synthesise ONE coherent answer to the task, weaving them together and citing sources by [ref]. Summaries:`n`n$merged"}) } | ConvertTo-Json -Depth 6
$answer = try { (Invoke-RestMethod $base -Method Post -TimeoutSec 120 -Headers @{Authorization="Bearer $key"} -ContentType 'application/json' -Body $synthBody).choices[0].message.content } catch { "(synthesis failed: $($_.Exception.Message))" }

Write-Host "`n===== SYNTHESISED ANSWER (session $SessionId, ${Concurrency}x over $($items.Count) shards) =====" -ForegroundColor Cyan
Write-Host $answer
Write-Host "`n(shard rows persisted to KriticalSCXCodeStore.dbo.context_shard; query: SELECT source_ref,token_count FROM dbo.context_shard WHERE session_id='$SessionId')" -ForegroundColor DarkGray
[pscustomobject]@{ SessionId=$SessionId; Shards=$items.Count; Answer=$answer }
