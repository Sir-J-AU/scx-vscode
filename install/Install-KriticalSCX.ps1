<#
.SYNOPSIS
  Kritical SCX — one-shot idempotent installer/orchestrator for the whole stack.
  Designed to be hostable for:  irm https://kritical.au/scx/install.ps1 | iex   (URL TBD)

  HR16 modes. HR29: every layer is additive; Uninstall returns you to stock Claude/Codex.

.PARAMETER Mode   Install | Status | Repair | Uninstall   (default Status — safe)
.PARAMETER RepoRoot  Root holding Kritical.SCXCode + Kritical.VSCode.PluginControlPanel.
.EXAMPLE  pwsh Install-KriticalSCX.ps1 -Mode Status
.EXAMPLE  pwsh Install-KriticalSCX.ps1 -Mode Install
#>
[CmdletBinding()]
param([ValidateSet('Install','Status','Repair','Uninstall')][string]$Mode='Status',
      [string]$RepoRoot="C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github",
      [string]$Venv='C:\KriticalSCX\venv-litellm-test')
$ErrorActionPreference='Continue'
$scx     = Join-Path $RepoRoot 'Kritical.SCXCode'
$pcp     = Join-Path $RepoRoot 'Kritical.VSCode.PluginControlPanel'
$pack    = Join-Path $scx 'codex-wrapper\pack\Apply-KriticalCodexPack.ps1'
$proxyMgr= Join-Path $scx 'litellm\Manage-KritScxProxy.ps1'
$routeTst= Join-Path $scx 'litellm\Test-KritScxRouting.ps1'
$models  = Join-Path $scx 'models\Get-KritScxModels.ps1'
$vpy     = Join-Path $Venv 'Scripts\python.exe'
function Ok($b){ if($b){'✅'}else{'❌'} }

# .5231b (re-hunt) — HR18: never Remove-Item -Recurse -Force a path without interrogating NTFS reparse
# points first. A junction/symlink inside the VS Code extensions folder that points back at a parent (or
# anywhere else) would make -Recurse follow the link and either loop or delete the WRONG target's
# contents. This helper deletes reparse points as the link itself (no -Recurse traversal) and only
# recurses into genuine directories.
function Remove-ItemReparseSafe {
  param([Parameter(ValueFromPipeline=$true)]$InputObject)
  process {
    foreach ($it in @($InputObject)) {
      if (-not $it) { continue }
      $item = if ($it -is [System.IO.FileSystemInfo]) { $it } else { Get-Item -LiteralPath "$it" -Force -ea 0 }
      if (-not $item) { continue }
      if ($item.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
        # Delete the link node only — do NOT traverse into whatever it points at.
        try { [System.IO.Directory]::Delete($item.FullName, $false) }
        catch { Remove-Item -LiteralPath $item.FullName -Force -ea 0 }
      } else {
        Remove-Item -LiteralPath $item.FullName -Recurse -Force -ea 0
      }
    }
  }
}

function Show-Status {
  Write-Host "`n=== Kritical SCX — Stack Status ===" -ForegroundColor Cyan
  Write-Host "  $(Ok (Get-Command node -ea 0))  node   $(try{node -v}catch{})"
  Write-Host "  $(Ok (Get-Command python -ea 0))  python $(try{(python --version) 2>&1}catch{})"
  Write-Host "  $(Ok (Get-Command code-insiders -ea 0))  code-insiders"
  Write-Host "  $(Ok (Test-Path $vpy))  litellm venv"
  # .5231 (bughunt) — "installed" must actually import litellm, not re-use the venv-exists predicate.
  $litellmVer = if (Test-Path $vpy) { try { & $vpy -c "import litellm;print(litellm.__version__)" 2>$null } catch {} }
  Write-Host "  $(Ok ([bool]$litellmVer)) litellm installed  $litellmVer"
  Write-Host "  $(Ok (Test-Path 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe'))  Kritical.SCXCodex.exe"
  Write-Host "  $(Ok (Test-Path 'C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json'))  Kritical.SCXCodex build receipt"
  $ext = try { (code-insiders --list-extensions) -match 'plugin-control-panel' } catch { $false }
  Write-Host "  $(Ok $ext)  Plugin Control Panel extension"
  $proxy = try { (Invoke-WebRequest 'http://127.0.0.1:4180/health/liveliness' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
  Write-Host "  $(Ok $proxy)  LiteLLM proxy :4180"
  Write-Host "  $(Ok (Test-Path 'C:\KriticalSCX\safety\Restore-WorkingClaude.ps1'))  emergency escape"
  Write-Host "`n  SEE IT WORKING:  pwsh `"$routeTst`"" -ForegroundColor Green
  Write-Host "  KILL SWITCH:     pwsh Install-KriticalSCX.ps1 -Mode Uninstall   ·  emergency: C:\KriticalSCX\safety\Restore-WorkingClaude.ps1" -ForegroundColor Yellow
}

switch ($Mode) {
  'Install' {
    Write-Host '[1/5] prereqs' -ForegroundColor Cyan
    foreach($c in 'node','python','code-insiders','git'){ if(-not(Get-Command $c -ea 0)){ Write-Host "  MISSING: $c — install it first" -ForegroundColor Red } }
    Write-Host '[2/5] litellm venv' -ForegroundColor Cyan
    if (-not (Test-Path $vpy)) { python -m venv $Venv; & $vpy -m pip install --quiet --upgrade pip }
    & $vpy -c "import litellm" 2>$null; $hasLitellm = ($LASTEXITCODE -eq 0)
    if (-not $hasLitellm) {
      "orjson==3.11.9" | Set-Content "$Venv\constraints.txt"
      $env:PIP_ONLY_BINARY='orjson'; & $vpy -m pip install "litellm[proxy]" --constraint "$Venv\constraints.txt"
    }
    Write-Host '[3/5] codex pack' -ForegroundColor Cyan; & $pack -Mode Install | Out-Null
    Write-Host '[4/5] VS Code extension' -ForegroundColor Cyan
    $vsix = Get-ChildItem 'C:\KriticalSCX\*.vsix' -ea 0 | Select-Object -First 1
    if ($vsix) { code-insiders --install-extension $vsix.FullName 2>$null | Out-Null }
    Write-Host '[5/5] model cache seed' -ForegroundColor Cyan; & $models | Out-Null
    Show-Status
  }
  'Repair'    { & $pack -Mode Heal | Out-Null; & $models -Refresh | Out-Null; Show-Status }
  'Uninstall' {
    & $pack -Mode Remove | Out-Null
    & $proxyMgr -Mode Remove | Out-Null
    Get-ChildItem "$env:USERPROFILE\.vscode-insiders\extensions" -Directory -ea 0 | Where-Object Name -like 'kritical.plugin-control-panel*' | Remove-ItemReparseSafe   # .5231b (re-hunt) — HR18 reparse-point guard before recursive delete
    Write-Host "Uninstalled Kritical layers. Stock Claude + Codex untouched." -ForegroundColor Green
    Write-Host "If anything feels off: pwsh C:\KriticalSCX\safety\Restore-WorkingClaude.ps1" -ForegroundColor Yellow
  }
  'Status'    { Show-Status }
}
