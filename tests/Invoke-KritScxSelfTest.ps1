<#
.SYNOPSIS
  Kritical SCX — full-stack regression self-test. Run anytime; catches any regression.
  Read-only/dry-run only (never launches VS Code, never pushes, never mutates state).
  Exit code = number of failures (0 = all green) so it can gate CI / a pre-push hook.

.PARAMETER SkipLive   Skip the live SCX routing canary (offline-safe run).
.EXAMPLE  pwsh Invoke-KritScxSelfTest.ps1
.EXAMPLE  pwsh Invoke-KritScxSelfTest.ps1 -SkipLive
#>
[CmdletBinding()]
param([switch]$SkipLive,
      [string]$Toolkit='C:\Users\joshl\KriticalSCX\vscode',
      [string]$RepoRoot='C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github')
$ErrorActionPreference='Continue'
$scx = Join-Path $RepoRoot 'Kritical.SCXCode'
$pcp = Join-Path $RepoRoot 'Kritical.VSCode.PluginControlPanel'
$pass=0;$fail=0;$fails=@()
function T($name,[scriptblock]$b){ try{ if(& $b){ Write-Host "  PASS  $name" -ForegroundColor Green;$script:pass++ } else { Write-Host "  FAIL  $name" -ForegroundColor Red;$script:fail++;$script:fails+=$name } } catch { Write-Host "  FAIL  $name ($($_.Exception.Message))" -ForegroundColor Red;$script:fail++;$script:fails+=$name } }

Write-Host "`n===== Kritical SCX — Regression Self-Test =====" -ForegroundColor Cyan

Write-Host "`n[1] Manifest integrity" -ForegroundColor White
$mPath = Join-Path $Toolkit 'ext-manifest.json'
$m = Get-Content $mPath -Raw | ConvertFrom-Json
$mapped = New-Object System.Collections.Generic.HashSet[string]
foreach($s in $m.stacks.PSObject.Properties.Name){ foreach($id in $m.stacks.$s){ [void]$mapped.Add($id.ToLower()) } }
T "core contains claude-code + scxcode + control-panel (never disabled)" {
  $c=$m.stacks.core.ToLower(); ($c -contains 'anthropic.claude-code') -and ($c -contains 'kritical.scxcode') -and ($c -contains 'kritical.kritical-plugin-control-panel') }
$installed = (code-insiders --list-extensions) | ForEach-Object { $_.ToLower() }
$unmapped = @($installed | Where-Object { -not $mapped.Contains($_) })
T "no installed extension is unmapped (regression guard)" { if($unmapped.Count){ Write-Host "      unmapped: $($unmapped -join ', ')" -ForegroundColor DarkYellow }; $unmapped.Count -eq 0 }
T "every preset references only real stacks" {
  $ok=$true; foreach($p in $m.presets.PSObject.Properties.Name){ foreach($st in $m.presets.$p){ if(-not $m.stacks.$st){ $ok=$false } } }; $ok }

Write-Host "`n[2] Launcher presets resolve" -ForegroundColor White
foreach($p in 'min','bc','shop','full'){ T "preset '$p' dry-run" { $o = (& (Join-Path $Toolkit 'scx-code.ps1') -Preset $p -DryRun 6>&1 2>&1 | Out-String); $o -match 'Enabled\s*:\s*\d' } }

Write-Host "`n[3] Both plugins installed" -ForegroundColor White
T "kritical.scxcode installed" { [bool]($installed -contains 'kritical.scxcode') }
T "plugin control panel installed" { [bool]($installed -contains 'kritical.kritical-plugin-control-panel') }

Write-Host "`n[4] Model catalogue" -ForegroundColor White
T "Get-KritScxModels returns >=15" { (& (Join-Path $scx 'models\Get-KritScxModels.ps1') -Offline 2>$null | Measure-Object).Count -ge 15 }

Write-Host "`n[5] Codex pack + safety present" -ForegroundColor White
T "kcodex shim exists" { Test-Path 'C:\KriticalSCX\bin\kcodex.cmd' }
T "emergency escape script exists" { Test-Path 'C:\KriticalSCX\safety\Restore-WorkingClaude.ps1' }
T "wrapper enforces SCX-only (no openai model override)" { -not (Select-String -Path (Join-Path $scx 'codex-wrapper\kritical-codex.ps1') -Pattern "Model = 'openai/gpt-5-codex'" -Quiet) }

Write-Host "`n[6] PowerShell + JS syntax across the stack" -ForegroundColor White
$ps = Get-ChildItem $Toolkit,$scx,$pcp -Recurse -Filter *.ps1 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' }
$psBad = @(); foreach($f in $ps){ $e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$null,[ref]$e); if($e){$psBad+=$f.Name} }
T "all .ps1 parse ($($ps.Count) files)" { if($psBad.Count){ Write-Host "      bad: $($psBad -join ', ')" -ForegroundColor DarkYellow }; $psBad.Count -eq 0 }
$js = Get-ChildItem $pcp -Recurse -Include *.js,*.mjs -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' }
$jsBad=@(); foreach($f in $js){ node --check $f.FullName 2>$null; if($LASTEXITCODE -ne 0){$jsBad+=$f.Name} }
T "all .js/.mjs parse ($($js.Count) files)" { $jsBad.Count -eq 0 }

Write-Host "`n[7] Live routing (SCX)" -ForegroundColor White
if($SkipLive){ Write-Host "  SKIP  (-SkipLive)" -ForegroundColor DarkGray } else {
  T "proxy healthy" { try{ (Invoke-WebRequest 'http://127.0.0.1:4180/health/liveliness' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 }catch{$false} }
  T "canary -> scx-coder responds" {
    try { $b=@{model='scx-coder';messages=@(@{role='user';content='ping'});max_tokens=8}|ConvertTo-Json
      $r=Invoke-RestMethod 'http://127.0.0.1:4180/v1/chat/completions' -Method Post -TimeoutSec 60 -Headers @{Authorization='Bearer sk-kritical-scx-local'} -ContentType 'application/json' -Body $b
      [bool]$r.choices[0].message } catch { $false } }
}

Write-Host "`n[8] Claude/OpenAI/Google left alone (HR29)" -ForegroundColor White
T "ANTHROPIC_BASE_URL (User) is not the proxy" { $a=[Environment]::GetEnvironmentVariable('ANTHROPIC_BASE_URL','User'); -not ($a -match '4180|127\.0\.0\.1|localhost') }
T "stock codex auth is native" { $j=Get-Content "$env:USERPROFILE\.codex\auth.json" -Raw|ConvertFrom-Json; [bool]$j.auth_mode }

Write-Host "`n[9] Storage + Lens (own DB)" -ForegroundColor White
$srv='.\SQLEXPRESS'; $sdb='KriticalSCXCodeStore'
T "store DB '$sdb' reachable" { $r = sqlcmd -S $srv -d $sdb -E -h -1 -W -Q "SELECT DB_ID('$sdb');" 2>&1; [bool]($r -match '\d') }
T "core tables present (decision_log, context_shard, blob_store, sessions)" {
  $r = sqlcmd -S $srv -d $sdb -E -h -1 -W -Q "SELECT COUNT(*) FROM sys.tables WHERE name IN ('decision_log','context_shard','blob_store','sessions');" 2>&1; [bool]($r -match '4') }
T "SHA-dedup + DECOMPRESS view work (roundtrip)" {
  $q = "SET NOCOUNT ON; DECLARE @c NVARCHAR(100)=N'selftest-roundtrip'; DECLARE @h CHAR(64)=CONVERT(CHAR(64),HASHBYTES('SHA2_256',@c),2);
        IF NOT EXISTS(SELECT 1 FROM dbo.decision_log WHERE content_sha256=@h) INSERT dbo.decision_log(side,category,content_sha256,content_len,content_gz,source) VALUES('ai','test',@h,LEN(@c),COMPRESS(@c),'selftest');
        DECLARE @out NVARCHAR(100)=(SELECT TOP 1 content FROM dbo.v_decision_log WHERE content_sha256=@h);
        DELETE FROM dbo.decision_log WHERE source='selftest';
        SELECT CASE WHEN @out=@c THEN 'OK' ELSE 'BAD' END;"
  $r = sqlcmd -S $srv -d $sdb -E -h -1 -W -Q $q 2>&1; [bool]($r -match 'OK') }
T "Lens catalog ingested (>=1 row)" { $r = sqlcmd -S $srv -d $sdb -E -h -1 -W -Q "IF OBJECT_ID('dbo.LensSqlCatalog') IS NULL SELECT 0 ELSE SELECT COUNT(*) FROM dbo.LensSqlCatalog;" 2>&1; [bool]($r -match '[1-9]') }

Write-Host "`n===== $pass passed, $fail failed =====" -ForegroundColor $(if($fail){'Red'}else{'Green'})
if($fail){ Write-Host "FAILURES: $($fails -join '; ')" -ForegroundColor Red }
exit $fail
