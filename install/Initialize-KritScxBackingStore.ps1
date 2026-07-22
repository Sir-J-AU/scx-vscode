#requires -Version 7.0
<#
.SYNOPSIS
  Initialize SQLite and optional SQL Server backing tables for SCXCode tools.

.NOTES
  Author: Joshua Finley — (c) 2026 Kritical Pty Ltd. All rights reserved.
#>
[CmdletBinding()]
param(
  [ValidateSet('Status','Install')]
  [string] $Mode = 'Status',
  [string] $SqlitePath = (Join-Path $env:USERPROFILE '.kritical-scx\scxcode-supervisor.db'),
  [switch] $Mssql,
  [string] $MssqlServer = '.\SQLEXPRESS',
  [string] $MssqlDatabase = 'KriticalSCXCodeStore'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sqliteSchema = Join-Path $repoRoot 'sql\scxcode-supervisor-schema.sql'
$mssqlSchema = Join-Path $repoRoot 'sql\scxcode-supervisor-schema.mssql.sql'

if ($Mode -eq 'Status') {
  [pscustomobject]@{
    SqlitePath = $SqlitePath
    SqliteExists = Test-Path -LiteralPath $SqlitePath
    MssqlRequested = [bool]$Mssql
    MssqlTarget = "$MssqlServer/$MssqlDatabase"
    Sqlcmd = [bool](Get-Command sqlcmd -ErrorAction SilentlyContinue)
  } | Format-List
  return
}

New-Item -ItemType Directory -Path (Split-Path $SqlitePath) -Force | Out-Null
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw 'python is required to initialize SQLite.' }
$script = @"
import sqlite3, pathlib
db = pathlib.Path(r'''$SqlitePath''')
schema = pathlib.Path(r'''$sqliteSchema''').read_text(encoding='utf-8')
con = sqlite3.connect(db)
con.executescript(schema)
con.commit()
con.close()
print(db)
"@
$script | python

if ($Mssql) {
  $sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
  if (-not $sqlcmd) { throw 'sqlcmd is required for -Mssql.' }
  sqlcmd -S $MssqlServer -d $MssqlDatabase -E -i $mssqlSchema -b
}

Write-Host "Backing store initialized. SQLite: $SqlitePath" -ForegroundColor Green
