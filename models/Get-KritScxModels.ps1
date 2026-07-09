<#
.SYNOPSIS
  Resolve the SCX model catalogue with a live-query -> cache -> hardcoded fallback chain.
  1) If SCX_API_KEY present, live-query (proxy :4180 first, else api.scx.ai) and refresh the cache.
  2) Else use the on-disk cache (populated by the first successful live query).
  3) Else use the bundled hardcoded fallback (kept current from queries; covers offline gaps).

.PARAMETER Refresh   Force a live query even if the cache is fresh.
.PARAMETER Offline   Never hit the network; cache -> fallback only.
.PARAMETER MaxAgeHrs Cache considered stale after this many hours (default 24) -> triggers live refresh.
.OUTPUTS  Array of { id, source } and writes reduced + full-fidelity caches.
.EXAMPLE  $models = .\Get-KritScxModels.ps1            # smart: live if key, else cache/fallback
.EXAMPLE  .\Get-KritScxModels.ps1 -Refresh            # force refresh
#>
[CmdletBinding()]
param([switch]$Refresh, [switch]$Offline, [switch]$IncludeMetadata, [int]$MaxAgeHrs=24,
      [int]$ProxyPort=4180, [string]$ScxBase='https://api.scx.ai/v1',
      [string]$CatalogPath='C:\KriticalSCX\config\models\scx-model-catalog.json',
      [string]$CatalogHistoryDir='C:\KriticalSCX\config\models\history',
      [string]$ServerId='scx')
$ErrorActionPreference='Continue'
$cacheDir='C:\KriticalSCX\cache'; $cacheFile=Join-Path $cacheDir 'scx-models.json'
$sharedCacheDir = Join-Path $env:USERPROFILE '.kritical-scx'
$fullCacheFile = Join-Path $sharedCacheDir 'models-catalog.full.json'
New-Item -ItemType Directory -Force $cacheDir | Out-Null
New-Item -ItemType Directory -Force $sharedCacheDir | Out-Null
New-Item -ItemType Directory -Force (Split-Path -Parent $CatalogPath) | Out-Null
New-Item -ItemType Directory -Force $CatalogHistoryDir | Out-Null

# --- Hardcoded fallback (SCX published catalogue; refreshed from live queries when online) ---
$FALLBACK = @(
  'minimax-m2.7','scx-coder','gpt-oss-120b','deepseek-v3.1','deepseek-v3.1-terminus',
  'deepseek-r1-0528','deepseek-v3-0324','magpie','llama-4-maverick','llama-3.3-70b',
  'llama-3.1-8b','qwen3-32b','qwen3-235b','e5-mistral-embeddings','whisper-large-v3'
)

function Save-Cache($ids,$src){
  @{ updated=(Get-Date -Format o); source=$src; models=$ids } | ConvertTo-Json -Depth 5 | Set-Content $cacheFile -Encoding utf8
}
function ConvertTo-SafeSlug {
  param([Parameter(Mandatory=$true)][string]$Value)
  $slug = ($Value -replace '[^A-Za-z0-9._-]+','-').Trim('-')
  if ($slug) { return $slug.ToLowerInvariant() }
  return 'unknown'
}
function Backup-JsonFile {
  param(
    [Parameter(Mandatory=$true)][string]$PathTarget,
    [Parameter(Mandatory=$true)][string]$ServerSlug,
    [Parameter(Mandatory=$true)][string]$Detail
  )
  if (-not (Test-Path -LiteralPath $PathTarget)) { return }
  try {
    Copy-Item -LiteralPath $PathTarget -Destination "$PathTarget.bak" -Force -ErrorAction SilentlyContinue
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $name = '{0}-{1}-{2}.previous.json' -f $ServerSlug,$Detail,$stamp
    Copy-Item -LiteralPath $PathTarget -Destination (Join-Path $CatalogHistoryDir $name) -Force -ErrorAction SilentlyContinue
  } catch {}
}
function Write-ValidatedJson {
  param(
    [Parameter(Mandatory=$true)][string]$PathTarget,
    [Parameter(Mandatory=$true)][string]$Json,
    [Parameter(Mandatory=$true)][string]$ServerSlug,
    [Parameter(Mandatory=$true)][string]$Detail
  )
  if (-not $Json) { return }
  $tmp = "$PathTarget.$PID.tmp"
  New-Item -ItemType Directory -Force (Split-Path -Parent $PathTarget) | Out-Null
  Set-Content -LiteralPath $tmp -Value $Json -Encoding utf8
  $null = Get-Content -LiteralPath $tmp -Raw | ConvertFrom-Json
  Backup-JsonFile -PathTarget $PathTarget -ServerSlug $ServerSlug -Detail $Detail
  Move-Item -LiteralPath $tmp -Destination $PathTarget -Force
}
function Save-FullCatalog {
  param(
    [Parameter(Mandatory=$true)] $Rows,
    [Parameter(Mandatory=$true)] [string] $Source,
    [Parameter(Mandatory=$true)] [string] $Uri
  )
  if (-not $rows -or @($rows).Count -eq 0) { return }
  $serverSlug = ConvertTo-SafeSlug $ServerId
  $chatRows = @($Rows | Where-Object {
    $id = if ($_ -is [string]) { $_ } else { $_.id ?? $_.model ?? $_.name }
    $id -and ($id -notmatch '(embed|e5-mistral|whisper|opir|moderation|rerank|guard)')
  })
  $payload = [ordered]@{
    captured_utc = (Get-Date).ToUniversalTime().ToString('o')
    provider = 'scx'
    server = $ServerId
    source = "Get-KritScxModels:$Source"
    url = "$Uri/models"
    count = @($Rows).Count
    chat_count = @($chatRows).Count
    canonical_path = $CatalogPath
    mirror_path = $fullCacheFile
    backup_history_dir = $CatalogHistoryDir
    models = @($Rows)
  }
  $json = $payload | ConvertTo-Json -Depth 20
  if (-not $json) { return }
  Write-ValidatedJson -PathTarget $CatalogPath -Json $json -ServerSlug $serverSlug -Detail 'models-catalog'
  Write-ValidatedJson -PathTarget $fullCacheFile -Json $json -ServerSlug $serverSlug -Detail 'models-catalog-user-mirror'
}
function Read-Cache {
  if (Test-Path $cacheFile) { try { return Get-Content $cacheFile -Raw | ConvertFrom-Json } catch {} }
  return $null
}
function Query-Endpoint($uri,$key){
  try {
    $h = @{}; if ($key) { $h['Authorization'] = "Bearer $key" }
    $r = Invoke-RestMethod -Uri "$uri/models" -Headers $h -TimeoutSec 10 -ErrorAction Stop
    $rows = if ($r.data) { @($r.data) } elseif ($r.models) { @($r.models) } else { @() }
    $ids = @($rows | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.id } } | Where-Object { $_ })
    return [pscustomobject]@{ Ids = $ids; Rows = $rows; Uri = $uri }
  } catch { return $null }
}

$scxKey = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
$cache  = Read-Cache
$cacheFresh = $cache -and ((New-TimeSpan -Start ([datetime]$cache.updated) -End (Get-Date)).TotalHours -lt $MaxAgeHrs)

$ids=$null; $source=$null
if (-not $Offline -and ($Refresh -or -not $cacheFresh)) {
  # Prefer the local proxy (aggregates aliases) when healthy; else direct SCX with the key.
  $proxyHealthy = try { (Invoke-WebRequest "http://127.0.0.1:$ProxyPort/health/liveliness" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
  if ($proxyHealthy) {
    $q = Query-Endpoint "http://127.0.0.1:$ProxyPort/v1" 'sk-kritical-scx-local'
    if ($q -and $q.Ids) { $ids = $q.Ids; $source='live:proxy'; Save-FullCatalog -Rows $q.Rows -Source $source -Uri $q.Uri }
  }
  if (-not $ids -and $scxKey) {
    $q = Query-Endpoint $ScxBase $scxKey
    if ($q -and $q.Ids) { $ids = $q.Ids; $source='live:scx'; Save-FullCatalog -Rows $q.Rows -Source $source -Uri $q.Uri }
  }
  if ($ids) { Save-Cache $ids $source }
}
if (-not $ids) {
  if ($cache) { $ids = @($cache.models); $source = "cache($($cache.source))" }
  else        { $ids = $FALLBACK;        $source = 'fallback:hardcoded'; Save-Cache $ids $source }
}

Write-Host "SCX models: $($ids.Count)  [source: $source]" -ForegroundColor Cyan
if ($IncludeMetadata -and (Test-Path $fullCacheFile)) {
  $metadataPath = if (Test-Path -LiteralPath $CatalogPath) { $CatalogPath } else { $fullCacheFile }
  (Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json).models
} else {
  $ids | ForEach-Object { [pscustomobject]@{ id=$_; source=$source } }
}
