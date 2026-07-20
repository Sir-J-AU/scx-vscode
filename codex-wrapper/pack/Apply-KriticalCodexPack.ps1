<#
.SYNOPSIS
  Apply / remove / heal / status the compiled Kritical.SCXCodex Pack.

.DESCRIPTION
  The pack now recompiles a branded Codex package as Kritical.SCXCodex.exe from a
  disposable upstream worktree. Stock codex and native provider/auth settings stay
  untouched. No .cmd launcher is created by this script.
#>
[CmdletBinding()]
param(
  [ValidateSet('Install','Remove','Heal','Status')][string]$Mode = 'Status',
  [string]$Manifest = "$PSScriptRoot\pack-manifest.json"
)

$ErrorActionPreference = 'Stop'
$manifestData = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$buildScript = Join-Path $PSScriptRoot 'Build-KriticalSCXCodex.ps1'
$packageDir = $manifestData.compiled_package_dir
$entrypoint = $manifestData.compiled_entrypoint
$receipt = Join-Path $packageDir '.kritical-scxcodex-build.receipt.json'

function Remove-LegacyShimFiles {
  $legacyPaths = @(
    'C:\KriticalSCX\bin\scxcodex.cmd',
    'C:\KriticalSCX\bin\kcodex.cmd',
    (Join-Path $env:LOCALAPPDATA 'Kritical\bin\scxcodex.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Kritical\bin\kcodex.cmd')
  )
  foreach ($path in $legacyPaths) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      Remove-Item -LiteralPath $path -Force
      Write-Host "removed legacy shim $path" -ForegroundColor Yellow
    }
  }
}

function Assert-UnderKriticalRoot([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetFullPath('C:\KriticalSCX')
  if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside C:\KriticalSCX: $resolved"
  }
  $resolved
}

function Show-Status {
  Write-Host "`n=== Kritical.SCXCodex Pack — Status ===" -ForegroundColor Cyan
  Write-Host "  pack version   : $($manifestData.pack_version)"
  Write-Host "  build script   : $(if(Test-Path $buildScript){'present'}else{'MISSING'}) $buildScript"
  Write-Host "  source clone   : $(if(Test-Path (Join-Path $manifestData.source_clone '.git')){'present'}else{'absent'}) $($manifestData.source_clone)"
  Write-Host "  package dir    : $(if(Test-Path $packageDir){'present'}else{'missing'}) $packageDir"
  Write-Host "  entrypoint     : $(if(Test-Path $entrypoint){'present'}else{'missing'}) $entrypoint"
  Write-Host "  receipt        : $(if(Test-Path $receipt){'present'}else{'missing'}) $receipt"
  Write-Host "  stock codex    : untouched"
  Write-Host "  provider auth  : native OpenAI/Anthropic/Codex settings unread + unchanged"
  Write-Host "`n  REBUILD: pwsh Apply-KriticalCodexPack.ps1 -Mode Heal" -ForegroundColor Yellow
  Write-Host "  REMOVE : pwsh Apply-KriticalCodexPack.ps1 -Mode Remove" -ForegroundColor Yellow
}

switch ($Mode) {
  'Install' {
    Remove-LegacyShimFiles
    & $buildScript -Mode Build -Manifest $Manifest
  }
  'Heal' {
    Remove-LegacyShimFiles
    if (Test-Path -LiteralPath $entrypoint) {
      & $buildScript -Mode Verify -Manifest $Manifest
    } else {
      & $buildScript -Mode Build -Manifest $Manifest
    }
  }
  'Remove' {
    Remove-LegacyShimFiles
    $safePackageDir = Assert-UnderKriticalRoot $packageDir
    $safeBuildRoot = Assert-UnderKriticalRoot $manifestData.build_root
    if (Test-Path -LiteralPath $safePackageDir) {
      Remove-Item -LiteralPath $safePackageDir -Recurse -Force
      Write-Host "removed compiled package $safePackageDir" -ForegroundColor Yellow
    }
    if (Test-Path -LiteralPath $safeBuildRoot) {
      & $buildScript -Mode Clean -Manifest $Manifest
    }
    Write-Host "Kritical.SCXCodex compiled pack removed. Stock codex remains untouched." -ForegroundColor Green
  }
  'Status' { Show-Status }
}
