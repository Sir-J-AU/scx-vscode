<#
.SYNOPSIS
  Build / verify / clean the compiled Kritical.SCXCodex package from upstream Codex.

.DESCRIPTION
  Creates a disposable git worktree from the upstream Codex clone, applies the Kritical
  branding overlay inside that worktree only, compiles Codex, stages a package with a
  real Kritical.SCXCodex.exe entrypoint, and verifies the compiled binary contains the
  required SCX branding strings. Native OpenAI/Anthropic/Codex auth and provider keys
  are never read, printed, changed, or removed.
#>
[CmdletBinding()]
param(
  [ValidateSet('Build','Verify','Status','Clean')][string]$Mode = 'Build',
  [string]$Manifest = "$PSScriptRoot\pack-manifest.json",
  [string]$Target = '',
  [string]$CargoProfile = 'dev-small',
  [switch]$NoBootstrap
)

$ErrorActionPreference = 'Stop'

function Read-Manifest([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Manifest not found: $Path" }
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-UnderKriticalRoot([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetFullPath('C:\KriticalSCX')
  if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside C:\KriticalSCX: $resolved"
  }
  $resolved
}

function Invoke-Logged([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [hashtable]$ExtraEnv = $null) {
  Write-Host ("+ {0} {1}" -f $FilePath, ($ArgumentList -join ' ')) -ForegroundColor DarkGray
  $old = @{}
  if ($ExtraEnv) {
    foreach ($key in $ExtraEnv.Keys) {
      $old[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
      [Environment]::SetEnvironmentVariable($key, [string]$ExtraEnv[$key], 'Process')
    }
  }
  try {
    Push-Location -LiteralPath $WorkingDirectory
    try {
      & $FilePath @ArgumentList
    } finally {
      Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE" }
  } finally {
    if ($ExtraEnv) {
      foreach ($key in $ExtraEnv.Keys) {
        [Environment]::SetEnvironmentVariable($key, $old[$key], 'Process')
      }
    }
  }
}

function Resolve-CommandPath([string]$Name, [string[]]$Fallbacks = @()) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($path in $Fallbacks) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

function Update-ProcessPathForBuildTools {
  $paths = @(
    "$env:USERPROFILE\.cargo\bin",
    "$env:APPDATA\npm",
    "$env:ProgramFiles\nodejs"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($path in $paths) {
    if ((";${env:PATH};") -notlike "*;$path;*") { $env:PATH = "$path;$env:PATH" }
  }
}

function Find-VcVarsAll {
  $candidates = @(
    'C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvarsall.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvarsall.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat',
    'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath 2>$null
    if (-not $installPath) {
      $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    }
    if ($installPath) {
      $path = Join-Path $installPath 'VC\Auxiliary\Build\vcvarsall.bat'
      if (Test-Path -LiteralPath $path) { return $path }
    }
  }
  return $null
}

function Import-VcVarsEnvironment([string]$VcVarsAll) {
  $archArg = if ($script:BuildTarget -eq 'aarch64-pc-windows-msvc') { 'arm64' } else { 'x64' }
  $cmdOutput = & cmd.exe /d /s /c "`"$VcVarsAll`" $archArg >nul && set"
  if ($LASTEXITCODE -ne 0) { throw "vcvarsall failed for $archArg" }
  foreach ($line in $cmdOutput) {
    $idx = $line.IndexOf('=')
    if ($idx -gt 0) {
      [Environment]::SetEnvironmentVariable($line.Substring(0, $idx), $line.Substring($idx + 1), 'Process')
    }
  }
}

function Ensure-MsvcToolchain {
  $vcVars = Find-VcVarsAll
  if (-not $vcVars) {
    if ($NoBootstrap) { throw 'MSVC C++ build tools not found and -NoBootstrap was set.' }
    $winget = Resolve-CommandPath 'winget'
    if (-not $winget) { throw 'MSVC C++ build tools not found, and winget is unavailable.' }
    Write-Host 'MSVC C++ build tools not found; installing Visual Studio Build Tools workload ...' -ForegroundColor Yellow
    Invoke-Logged $winget @(
      'install',
      '--id', 'Microsoft.VisualStudio.2022.BuildTools',
      '-e',
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--silent',
      '--override', '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    ) (Get-Location).Path
    $vcVars = Find-VcVarsAll
    if (-not $vcVars) { throw 'Visual Studio Build Tools install completed but vcvarsall.bat is still unavailable.' }
  }
  Import-VcVarsEnvironment $vcVars
  $link = Resolve-CommandPath 'link'
  if (-not $link -or $link -like '*\Git\usr\bin\link.exe') {
    throw "MSVC link.exe not active on PATH. Current link: $link"
  }
  Write-Host "MSVC linker active: $link" -ForegroundColor DarkGray
}

function Ensure-RustToolchain {
  Update-ProcessPathForBuildTools
  $cargo = Resolve-CommandPath 'cargo' @("$env:USERPROFILE\.cargo\bin\cargo.exe")
  if ($cargo) {
    $rustup = Resolve-CommandPath 'rustup' @("$env:USERPROFILE\.cargo\bin\rustup.exe")
    if ($rustup -and $script:BuildTarget) {
      if ($script:BuildTarget -eq 'x86_64-pc-windows-msvc') {
        $null = Invoke-Logged $rustup @('toolchain', 'install', 'stable-x86_64-pc-windows-msvc', '--force-non-host') (Get-Location).Path
        $null = Invoke-Logged $rustup @('+stable-x86_64-pc-windows-msvc', 'target', 'add', $script:BuildTarget) (Get-Location).Path
      } else {
        $null = Invoke-Logged $rustup @('target', 'add', $script:BuildTarget) (Get-Location).Path
      }
    }
    return $cargo
  }
  if ($NoBootstrap) { throw 'cargo not found and -NoBootstrap was set.' }

  $winget = Resolve-CommandPath 'winget'
  if (-not $winget) {
    throw 'cargo not found, and winget is unavailable to install Rustup.'
  }

  Write-Host 'cargo not found; installing Rustup with winget ...' -ForegroundColor Yellow
  $null = Invoke-Logged $winget @(
    'install',
    '--id', 'Rustlang.Rustup',
    '-e',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--silent'
  ) (Get-Location).Path

  Update-ProcessPathForBuildTools
  $rustup = Resolve-CommandPath 'rustup' @("$env:USERPROFILE\.cargo\bin\rustup.exe")
  if ($rustup) {
    $null = Invoke-Logged $rustup @('toolchain', 'install', 'stable') (Get-Location).Path
    $null = Invoke-Logged $rustup @('default', 'stable') (Get-Location).Path
    if ($script:BuildTarget) {
      if ($script:BuildTarget -eq 'x86_64-pc-windows-msvc') {
        $null = Invoke-Logged $rustup @('toolchain', 'install', 'stable-x86_64-pc-windows-msvc', '--force-non-host') (Get-Location).Path
        $null = Invoke-Logged $rustup @('+stable-x86_64-pc-windows-msvc', 'target', 'add', $script:BuildTarget) (Get-Location).Path
      } else {
        $null = Invoke-Logged $rustup @('target', 'add', $script:BuildTarget) (Get-Location).Path
      }
    }
  }
  $cargo = Resolve-CommandPath 'cargo' @("$env:USERPROFILE\.cargo\bin\cargo.exe")
  if (-not $cargo) { throw 'Rustup install completed but cargo is still unavailable in this process.' }
  return $cargo
}

function Get-DefaultWindowsRustTarget {
  return 'x86_64-pc-windows-msvc'
}

function Test-BinaryContainsUtf8([string]$Path, [string]$Needle) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  return $text.Contains($Needle)
}

function Set-ScxBrandingOverlay([string]$Worktree) {
  $main = Join-Path $Worktree 'codex-rs\cli\src\main.rs'
  $content = Get-Content -LiteralPath $main -Raw

  $content = $content.Replace(
    "/// Codex CLI`r`n///`r`n/// If no subcommand is specified, options will be forwarded to the interactive CLI.",
    "/// Kritical.SCXCodex`r`n///`r`n/// OpenAI Codex customised for Southern Cross AI - https://scx.ai."
  )
  $content = $content.Replace(
    "/// Codex CLI`n///`n/// If no subcommand is specified, options will be forwarded to the interactive CLI.",
    "/// Kritical.SCXCodex`n///`n/// OpenAI Codex customised for Southern Cross AI - https://scx.ai."
  )
  $content = $content.Replace(
    "    version,",
    "    version,`r`n    about = `"Kritical.SCXCodex (OpenAI Codex customised for Southern Cross AI - https://scx.ai)`",`r`n    long_about = `"Kritical.SCXCodex`nOpenAI Codex customised for Southern Cross AI - https://scx.ai`","
  )
  $content = $content.Replace(
    '    // the generic `codex` command name that users run.',
    '    // the generic `Kritical.SCXCodex` command name that SCX users run.'
  )
  $content = $content.Replace('    bin_name = "codex",', '    bin_name = "Kritical.SCXCodex",')
  $content = $content.Replace(
    '    override_usage = "codex [OPTIONS] [PROMPT]\n       codex [OPTIONS] <COMMAND> [ARGS]"',
    '    override_usage = "Kritical.SCXCodex [OPTIONS] [PROMPT]\n       Kritical.SCXCodex [OPTIONS] <COMMAND> [ARGS]"'
  )
  $content = $content.Replace('Run Codex non-interactively.', 'Run Kritical.SCXCodex non-interactively.')
  $content = $content.Replace('Manage Codex plugins.', 'Manage Kritical.SCXCodex plugins.')
  $content = $content.Replace('Start Codex as an MCP server (stdio).', 'Start Kritical.SCXCodex as an MCP server (stdio).')
  $content = $content.Replace('Update Codex to the latest version.', 'Update Kritical.SCXCodex to the latest branded upstream build.')
  $content = $content.Replace('Diagnose local Codex installation, config, auth, and runtime health.', 'Diagnose local Kritical.SCXCodex installation, config, auth, and runtime health.')
  $content = $content.Replace('Run commands within a Codex-provided sandbox.', 'Run commands within a Kritical.SCXCodex-provided sandbox.')

  if ($content -notmatch 'Kritical\.SCXCodex' -or $content -notmatch 'https://scx\.ai') {
    throw 'Branding overlay failed to inject required strings.'
  }
  Set-Content -LiteralPath $main -Value $content -Encoding utf8
}

function Get-UpstreamCommit([string]$SourceClone) {
  $commit = (& git -C $SourceClone rev-parse HEAD)
  if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Unable to resolve upstream commit from $SourceClone" }
  $commit.Trim()
}

function Remove-Worktree([string]$SourceClone, [string]$Worktree) {
  if (Test-Path -LiteralPath $Worktree) {
    & git -C $SourceClone worktree remove --force $Worktree 2>$null
    if (Test-Path -LiteralPath $Worktree) { Remove-Item -LiteralPath $Worktree -Recurse -Force }
  }
}

$manifestData = Read-Manifest $Manifest
$script:BuildTarget = if ($Target) { $Target } else { Get-DefaultWindowsRustTarget }
$sourceClone = $manifestData.source_clone
$buildRoot = if ($manifestData.build_root) { $manifestData.build_root } else { 'C:\KriticalSCX\build\scxcodex' }
$worktree = Assert-UnderKriticalRoot (Join-Path $buildRoot 'source')
$targetDir = Assert-UnderKriticalRoot (Join-Path $buildRoot 'target')
$prebuiltExe = Assert-UnderKriticalRoot (Join-Path $buildRoot 'Kritical.SCXCodex.exe')
$packageDirRaw = if ($manifestData.compiled_package_dir) { $manifestData.compiled_package_dir } else { 'C:\KriticalSCX\dist\Kritical.SCXCodex' }
$packageDir = Assert-UnderKriticalRoot $packageDirRaw
$receipt = Assert-UnderKriticalRoot (Join-Path $packageDir '.kritical-scxcodex-build.receipt.json')
$entrypoint = Join-Path $packageDir 'bin\Kritical.SCXCodex.exe'

function Show-Status {
  Write-Host "`n=== Kritical.SCXCodex compiled package ===" -ForegroundColor Cyan
  Write-Host "  target         : $script:BuildTarget"
  Write-Host "  source clone   : $(if(Test-Path (Join-Path $sourceClone '.git')){'present'}else{'MISSING'}) $sourceClone"
  Write-Host "  package dir    : $(if(Test-Path $packageDir){'present'}else{'missing'}) $packageDir"
  Write-Host "  entrypoint     : $(if(Test-Path $entrypoint){'present'}else{'missing'}) $entrypoint"
  Write-Host "  receipt        : $(if(Test-Path $receipt){'present'}else{'missing'}) $receipt"
}

function Invoke-Verify {
  if (-not (Test-Path -LiteralPath $entrypoint)) { throw "Compiled entrypoint missing: $entrypoint" }
  if (-not (Test-Path -LiteralPath (Join-Path $packageDir 'codex-package.json'))) { throw "Package metadata missing." }
  $metadata = Get-Content -LiteralPath (Join-Path $packageDir 'codex-package.json') -Raw | ConvertFrom-Json
  if ($metadata.entrypoint -ne 'bin/Kritical.SCXCodex.exe') { throw "Package entrypoint is not branded: $($metadata.entrypoint)" }
  foreach ($needle in @('Kritical.SCXCodex', 'OpenAI Codex customised for Southern Cross AI', 'https://scx.ai')) {
    if (-not (Test-BinaryContainsUtf8 -Path $entrypoint -Needle $needle)) {
      throw "Compiled binary does not contain required branding string: $needle"
    }
  }
  Write-Host "Verified compiled Kritical.SCXCodex package." -ForegroundColor Green
}

switch ($Mode) {
  'Clean' {
    $buildRootResolved = Assert-UnderKriticalRoot $buildRoot
    if (Test-Path -LiteralPath $sourceClone) { Remove-Worktree -SourceClone $sourceClone -Worktree $worktree }
    if (Test-Path -LiteralPath $buildRootResolved) { Remove-Item -LiteralPath $buildRootResolved -Recurse -Force }
    Write-Host "Cleaned $buildRootResolved" -ForegroundColor Green
  }
  'Status' { Show-Status }
  'Verify' { Invoke-Verify; Show-Status }
  'Build' {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceClone '.git'))) { throw "Upstream Codex clone not found: $sourceClone" }
    $cargo = Ensure-RustToolchain
    Ensure-MsvcToolchain
    $python = Resolve-CommandPath 'python'
    if (-not $python) { throw 'python not found; required by upstream Codex package builder.' }
    New-Item -ItemType Directory -Force $buildRoot | Out-Null
    $commit = Get-UpstreamCommit $sourceClone
    Remove-Worktree -SourceClone $sourceClone -Worktree $worktree
    Invoke-Logged git @('-C', $sourceClone, 'worktree', 'add', '--detach', $worktree, $commit) $sourceClone
    Set-ScxBrandingOverlay $worktree

    $cargoEnv = @{ CARGO_TARGET_DIR = $targetDir }
    if ($script:BuildTarget -eq 'x86_64-pc-windows-msvc') {
      $cargoEnv.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
    }
    $cargoArgs = @('build', '--target', $script:BuildTarget, '--profile', $CargoProfile, '--bin', 'codex')
    if ($script:BuildTarget -eq 'x86_64-pc-windows-msvc') {
      $cargoArgs = @('+stable-x86_64-pc-windows-msvc') + $cargoArgs
    }
    Invoke-Logged $cargo $cargoArgs (Join-Path $worktree 'codex-rs') $cargoEnv
    $builtCodex = Join-Path $targetDir "$script:BuildTarget\$CargoProfile\codex.exe"
    if (-not (Test-Path -LiteralPath $builtCodex)) { throw "Cargo did not produce $builtCodex" }
    Copy-Item -LiteralPath $builtCodex -Destination $prebuiltExe -Force

    Invoke-Logged $python @(
      (Join-Path $worktree 'scripts\build_codex_package.py'),
      '--target', $script:BuildTarget,
      '--variant', 'codex',
      '--cargo-profile', $CargoProfile,
      '--entrypoint-bin', $prebuiltExe,
      '--package-dir', $packageDir,
      '--force'
    ) $worktree $cargoEnv

    $builderCodex = Join-Path $packageDir 'bin\codex.exe'
    if (-not (Test-Path -LiteralPath $builderCodex)) { throw "Package builder did not stage codex.exe" }
    Move-Item -LiteralPath $builderCodex -Destination $entrypoint -Force
    $metadataPath = Join-Path $packageDir 'codex-package.json'
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    $metadata.entrypoint = 'bin/Kritical.SCXCodex.exe'
    $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding utf8

    Invoke-Verify
    $hash = (Get-FileHash -LiteralPath $entrypoint -Algorithm SHA256).Hash
    [ordered]@{
      product = 'Kritical.SCXCodex'
      description = 'OpenAI Codex customised for Southern Cross AI - https://scx.ai'
      utc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
      upstreamCommit = $commit
      target = $script:BuildTarget
      cargoProfile = $CargoProfile
      packageDir = $packageDir
      entrypoint = $entrypoint
      sha256 = $hash
      nativeProviderSecrets = 'unread-unchanged'
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receipt -Encoding utf8
    Show-Status
  }
}
