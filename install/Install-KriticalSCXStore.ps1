<#
.SYNOPSIS
  Provision the Kritical SCX Code store in an EXISTING SQL Server/Express instance.
  Does NOT install SQL Server — detects/uses what's already there (.\SQLEXPRESS by default).
  Creates DB KriticalSCXCodeStore + an efficient schema: SHA-dedup, simhash near-dedup,
  GZIP-compressed content (COMPRESS/DECOMPRESS), JSON metadata columns, content-addressed blob store.

  HR16 modes. DRY-RUN by default (prints the T-SQL, changes nothing). HR29: nothing here touches Claude/Codex.

.PARAMETER Mode      Install | Status | Repair | Uninstall   (default Status)
.PARAMETER Server    SQL instance (default .\SQLEXPRESS).
.PARAMETER Apply     Actually execute (Install/Uninstall). Without it = dry-run.
.EXAMPLE  pwsh Install-KriticalSCXStore.ps1 -Mode Install            # dry-run: show the SQL
.EXAMPLE  pwsh Install-KriticalSCXStore.ps1 -Mode Install -Apply     # create the DB + schema
.EXAMPLE  pwsh Install-KriticalSCXStore.ps1 -Mode Status
#>
[CmdletBinding()]
param([ValidateSet('Install','Status','Repair','Uninstall')][string]$Mode='Status',
      [string]$Server='.\SQLEXPRESS', [string]$DbName='KriticalSCXCodeStore', [switch]$Apply)
$ErrorActionPreference='Continue'
function Sql($q,[string]$database='master'){ sqlcmd -S $Server -d $database -E -b -h -1 -W -Q $q 2>&1 }

$schema = @"
IF DB_ID('$DbName') IS NULL CREATE DATABASE [$DbName];
GO
USE [$DbName];
GO
-- sessions ---------------------------------------------------------------
IF OBJECT_ID('dbo.sessions') IS NULL
CREATE TABLE dbo.sessions (
  session_id  VARCHAR(64)  NOT NULL PRIMARY KEY,
  started_utc DATETIME2(3) NOT NULL CONSTRAINT DF_sess_ts DEFAULT SYSUTCDATETIME(),
  label       NVARCHAR(200) NULL,
  meta        NVARCHAR(MAX) NULL CONSTRAINT CK_sess_json CHECK (meta IS NULL OR ISJSON(meta)=1)
);
-- decision_log (HR27: every human prompt + AI response) ------------------
IF OBJECT_ID('dbo.decision_log') IS NULL
CREATE TABLE dbo.decision_log (
  id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  ts_utc         DATETIME2(3) NOT NULL CONSTRAINT DF_dlog_ts DEFAULT SYSUTCDATETIME(),
  side           VARCHAR(8)   NOT NULL,               -- human | ai
  category       VARCHAR(32)  NOT NULL,
  wave           VARCHAR(32)  NULL,
  session_id     VARCHAR(64)  NULL,
  content_sha256 CHAR(64)     NOT NULL,               -- exact-dedup key
  simhash        BIGINT       NULL,                   -- near-dedup (Hamming)
  content_len    INT          NOT NULL,
  content_gz     VARBINARY(MAX) NULL,                 -- COMPRESS(content) GZIP
  preview_120    NVARCHAR(120) NULL,
  model          VARCHAR(64)  NULL,
  provider       VARCHAR(32)  NULL,
  source         VARCHAR(64)  NULL,
  meta           NVARCHAR(MAX) NULL CONSTRAINT CK_dlog_json CHECK (meta IS NULL OR ISJSON(meta)=1)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_dlog_sha')
  CREATE UNIQUE INDEX UX_dlog_sha        ON dbo.decision_log(content_sha256);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_dlog_simhash')
  CREATE INDEX        IX_dlog_simhash    ON dbo.decision_log(simhash);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_dlog_session_ts')
  CREATE INDEX        IX_dlog_session_ts ON dbo.decision_log(session_id, ts_utc);
-- context shards (the muxing store) --------------------------------------
IF OBJECT_ID('dbo.context_shard') IS NULL
CREATE TABLE dbo.context_shard (
  shard_id       BIGINT IDENTITY(1,1) PRIMARY KEY,
  session_id     VARCHAR(64) NULL,
  source_ref     NVARCHAR(400) NULL,                  -- file path / entity / url
  content_sha256 CHAR(64) NOT NULL,
  content_gz     VARBINARY(MAX) NULL,
  token_count    INT NULL,
  embedding      VARBINARY(MAX) NULL,
  created_utc    DATETIME2(3) NOT NULL CONSTRAINT DF_shard_ts DEFAULT SYSUTCDATETIME()
);
-- content-addressed blob store (files/json, deduped, compressed) ---------
IF OBJECT_ID('dbo.blob_store') IS NULL
CREATE TABLE dbo.blob_store (
  sha256      CHAR(64) NOT NULL PRIMARY KEY,          -- dedup by content
  mime        VARCHAR(100) NULL,
  byte_len    BIGINT NOT NULL,
  bytes_gz    VARBINARY(MAX) NULL,                    -- COMPRESS() for text/json
  created_utc DATETIME2(3) NOT NULL CONSTRAINT DF_blob_ts DEFAULT SYSUTCDATETIME()
);
-- convenience view: transparent decompression ---------------------------
IF OBJECT_ID('dbo.v_decision_log') IS NOT NULL DROP VIEW dbo.v_decision_log;
GO
CREATE VIEW dbo.v_decision_log AS
  SELECT id, ts_utc, side, category, wave, session_id, content_sha256, simhash, content_len,
         CAST(DECOMPRESS(content_gz) AS NVARCHAR(MAX)) AS content,
         preview_120, model, provider, source, meta
  FROM dbo.decision_log;
GO
"@

Write-Host "=== Kritical SCX Store  ($Mode, $(if($Apply){'APPLY'}else{'DRY RUN'})) @ $Server ===" -ForegroundColor Cyan
# reachability
$ver = Sql "SELECT LEFT(@@VERSION,40);"
if ($LASTEXITCODE -ne 0) { Write-Host "Cannot reach $Server. Is the instance running?" -ForegroundColor Red; return }
Write-Host "  instance: $($ver | Select-Object -First 1)"

switch ($Mode) {
  'Status' {
    $exists = (Sql "SELECT COUNT(*) FROM sys.databases WHERE name='$DbName';") -match '1'
    Write-Host "  DB '$DbName': $(if($exists){'present'}else{'absent'})" -ForegroundColor $(if($exists){'Green'}else{'Yellow'})
    if ($exists) { Write-Host "  tables/rows:"; Sql "SELECT t.name, SUM(p.rows) AS rows FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) GROUP BY t.name;" $DbName | ForEach-Object { "    $_" } }
  }
  { $_ -in 'Install','Repair' } {
    if (-not $Apply) { Write-Host "`n[DRY RUN] would execute against $Server :`n" -ForegroundColor Magenta; Write-Host $schema; Write-Host "`nRe-run with -Apply to create." -ForegroundColor Magenta; return }
    $tmp = Join-Path $env:TEMP "krit-scxstore-$(Get-Random).sql"
    $schema | Set-Content $tmp -Encoding utf8
    Write-Host "  applying schema..." -ForegroundColor Yellow
    sqlcmd -S $Server -E -b -i $tmp 2>&1 | Out-Host
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Write-Host "  Done. Verify: -Mode Status" -ForegroundColor Green
    Write-Host "  LiteLLM sink -> add to config general_settings:" -ForegroundColor Gray
    $sinkSrv = $Server.Replace('\','%5C')
    Write-Host ("    database_url: mssql+pyodbc://@{0}/{1}?driver=ODBC+Driver+18+for+SQL+Server&trusted_connection=yes&Encrypt=no" -f $sinkSrv, $DbName) -ForegroundColor Gray
  }
  'Uninstall' {
    if (-not $Apply) { Write-Host "[DRY RUN] would: ALTER DATABASE [$DbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$DbName];  (re-run -Apply)" -ForegroundColor Magenta; return }
    Sql "ALTER DATABASE [$DbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$DbName];" | Out-Host
    Write-Host "  Dropped $DbName. SQL Express instance itself untouched." -ForegroundColor Green
  }
}
