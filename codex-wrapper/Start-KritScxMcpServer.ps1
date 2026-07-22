#requires -Version 7.0
<#
.SYNOPSIS
  Start the Kritical SCXCode MCP server without storing secrets in Codex config.

.DESCRIPTION
  Reads SCX_API_KEY / SCX_API_KEY_2..9 from the current process or HKCU user
  environment and launches the stdio Node MCP server. This keeps ~/.codex/config.toml
  free of API key material while still making the key available to the child server.
#>
[CmdletBinding()]
param(
  [string]$Server = "$PSScriptRoot\..\mcp-server\server.mjs"
)

$ErrorActionPreference = 'Stop'

for ($i = 1; $i -le 9; $i++) {
  $name = if ($i -eq 1) { 'SCX_API_KEY' } else { "SCX_API_KEY_$i" }
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
  }
}

if (-not [Environment]::GetEnvironmentVariable('SCX_API_KEY', 'Process')) {
  [Console]::Error.WriteLine('SCX_API_KEY is not set in process or HKCU user environment.')
  exit 3
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  [Console]::Error.WriteLine('node not found on PATH; required for Kritical SCXCode MCP server.')
  exit 4
}

& $node $Server
exit $LASTEXITCODE
