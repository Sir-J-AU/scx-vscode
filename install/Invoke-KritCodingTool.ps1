#requires -Version 7.0
<#
.SYNOPSIS
  Probe or invoke local coding tool executables through the Kritical runtime registry.

.DESCRIPTION
  DryRun proves the executable is present and callable through version/help.
  Execute calls only tools with an explicit supported prompt contract in
  free-router/config/coding-tool-runtime-registry.json.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('DryRun','Execute')]
  [string] $Mode = 'DryRun',

  [ValidateSet('codex','claude','opencode','kilo','aider','hermes','auto')]
  [string] $Tool = 'auto',

  [string] $Prompt,
  [string] $PromptPath,
  [string] $RepoPath = (Get-Location).Path,
  [string] $RegistryPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'free-router\config\coding-tool-runtime-registry.json'),
  [string] $ReportPath
)

$ErrorActionPreference = 'Stop'
$registry = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
$toolNames = if ($Tool -eq 'auto') { @('codex','claude','aider','opencode','kilo','hermes') } else { @($Tool) }

function Invoke-ToolProcess {
  param(
    [string] $Command,
    [string[]] $Arguments,
    [string] $WorkingDirectory,
    [int] $TimeoutSec
  )
  $cmd = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return [pscustomobject]@{ ok = $false; command = $Command; present = $false; error = 'not found on PATH' }
  }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  if ($cmd.Source -like '*.ps1') {
    $psi.FileName = 'pwsh'
    [void]$psi.ArgumentList.Add('-NoProfile')
    [void]$psi.ArgumentList.Add('-File')
    [void]$psi.ArgumentList.Add($cmd.Source)
  } else {
    $psi.FileName = $cmd.Source
  }
  foreach ($arg in $Arguments) { [void]$psi.ArgumentList.Add([string]$arg) }
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $finished = $p.WaitForExit($TimeoutSec * 1000)
  if (-not $finished) {
    try { $p.Kill($true) } catch {}
    return [pscustomobject]@{ ok = $false; command = $Command; present = $true; path = $cmd.Source; timeout = $true; error = "timeout after $TimeoutSec sec" }
  }
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  [pscustomobject]@{
    ok = ($p.ExitCode -eq 0)
    command = $Command
    present = $true
    path = $cmd.Source
    exit_code = $p.ExitCode
    stdout_preview = $stdout.Substring(0, [Math]::Min(1000, $stdout.Length))
    stderr_preview = $stderr.Substring(0, [Math]::Min(1000, $stderr.Length))
  }
}

function Get-PromptText {
  if ($PromptPath) { return (Get-Content -LiteralPath $PromptPath -Raw) }
  if ($Prompt) { return $Prompt }
  throw 'Prompt or PromptPath is required for Execute.'
}

$results = [System.Collections.Generic.List[object]]::new()

foreach ($name in $toolNames) {
  $cfg = $registry.tools.$name
  if (-not $cfg) { continue }
  $version = Invoke-ToolProcess -Command $cfg.command -Arguments @($cfg.version_args) -WorkingDirectory $RepoPath -TimeoutSec ([int]$registry.defaults.dry_run_timeout_sec)
  $help = $null
  if ($version.present) {
    $help = Invoke-ToolProcess -Command $cfg.command -Arguments @($cfg.help_args) -WorkingDirectory $RepoPath -TimeoutSec ([int]$registry.defaults.dry_run_timeout_sec)
  }
  $entry = [ordered]@{
    tool = $name
    display_name = $cfg.display_name
    command = $cfg.command
    present = [bool]$version.present
    version_ok = [bool]$version.ok
    help_ok = [bool]($help -and $help.ok)
    version = $version
    help = $help
  }

  if ($Mode -eq 'Execute') {
    if (-not $cfg.execute.enabled -or $cfg.execute.prompt_mode -eq 'unsupported') {
      $entry.execute = @{ ok = $false; skipped = $true; reason = $cfg.execute.notes }
    } else {
      $promptText = Get-PromptText
      $args = @($cfg.execute.args)
      if ($cfg.execute.prompt_mode -eq 'append_arg') { $args += $promptText }
      if ($PSCmdlet.ShouldProcess($name, "Invoke coding tool in $RepoPath")) {
        $entry.execute = Invoke-ToolProcess -Command $cfg.command -Arguments $args -WorkingDirectory $RepoPath -TimeoutSec ([int]$registry.defaults.execute_timeout_sec)
      }
    }
  }
  $results.Add([pscustomobject]$entry) | Out-Null
}

if ($ReportPath) {
  New-Item -ItemType Directory -Path (Split-Path $ReportPath) -Force | Out-Null
  $results | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}

$results
