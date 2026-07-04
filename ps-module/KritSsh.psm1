<#
  KritSsh.psm1 — generate / configure / test / remove SSH for GitHub. Idempotent, healable.
  Complements the openssl/HTTPS push fix: SSH is the alternate path that bypasses TLS-stack issues.

  Functions:
    Get-KritSshState                      -> @{ KeyExists; PubKey; AgentRunning; GitHubConfigured }
    New-KritSshKey [-Force]               -> generate ed25519 if missing (idempotent). Returns pub key.
    Set-KritSshGitHub                     -> ensure github.com in known_hosts + ~/.ssh/config Host entry
    Test-KritSshGitHub                    -> ssh -T git@github.com (auth check)
    Add-KritSshKeyToGitHub [-Title]       -> register pub key via gh (needs 'admin:public_key' scope)
    Remove-KritSshKey [-FromGitHub]       -> delete local key (+ optionally from GitHub via gh)
    Enable-KritSshRemote -Repo <path>     -> switch a repo's origin to git@github.com (SSH)

  Examples:
    New-KritSshKey; Set-KritSshGitHub; Add-KritSshKeyToGitHub -Title kritical-dev; Test-KritSshGitHub
    Enable-KritSshRemote -Repo "C:\...\Kritical.SCXCode"
#>
$SshDir = Join-Path $env:USERPROFILE '.ssh'
$Key    = Join-Path $SshDir 'id_ed25519'
$Pub    = "$Key.pub"

function Get-KritSshState {
  $ghConfigured = $false
  try { $ghConfigured = ((ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -T git@github.com 2>&1) -match 'successfully authenticated') } catch {}
  [pscustomobject]@{
    KeyExists = (Test-Path $Key); PubKey = $(if(Test-Path $Pub){Get-Content $Pub -Raw});
    AgentRunning = [bool](Get-Service ssh-agent -EA SilentlyContinue | Where-Object Status -eq 'Running');
    GitHubConfigured = $ghConfigured
  }
}
function New-KritSshKey {
  [CmdletBinding()] param([switch]$Force,[string]$Comment="kritical-$env:COMPUTERNAME")
  New-Item -ItemType Directory -Force $SshDir | Out-Null
  if ((Test-Path $Key) -and -not $Force) { Write-Verbose 'key exists'; return (Get-Content $Pub -Raw) }
  ssh-keygen -t ed25519 -f $Key -N '""' -C $Comment -q 2>&1 | Out-Null
  Write-Host "Generated $Key" -ForegroundColor Green
  return (Get-Content $Pub -Raw)
}
function Set-KritSshGitHub {
  [CmdletBinding()] param()
  New-Item -ItemType Directory -Force $SshDir | Out-Null
  $kh = Join-Path $SshDir 'known_hosts'
  if (-not (Test-Path $kh) -or -not (Select-String -Path $kh -Pattern 'github.com' -Quiet -EA SilentlyContinue)) {
    ssh-keyscan github.com 2>$null | Add-Content $kh
  }
  $cfg = Join-Path $SshDir 'config'
  if (-not (Test-Path $cfg) -or -not (Select-String -Path $cfg -Pattern 'Host github.com' -Quiet -EA SilentlyContinue)) {
    "`nHost github.com`n  HostName github.com`n  User git`n  IdentityFile $Key`n  IdentitiesOnly yes" | Add-Content $cfg
  }
  Write-Host "known_hosts + ssh/config set for github.com" -ForegroundColor Green
}
function Test-KritSshGitHub { ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -T git@github.com 2>&1 | Select-Object -First 1 }
function Add-KritSshKeyToGitHub {
  [CmdletBinding()] param([string]$Title="kritical-$env:COMPUTERNAME")
  if (-not (Test-Path $Pub)) { throw "No public key. Run New-KritSshKey first." }
  gh ssh-key add $Pub --title $Title 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host "  If this failed on scope: gh auth refresh -h github.com -s admin:public_key" -ForegroundColor Yellow }
}
function Remove-KritSshKey {
  [CmdletBinding()] param([switch]$FromGitHub)
  if ($FromGitHub -and (Test-Path $Pub)) {
    $fp = (ssh-keygen -lf $Pub 2>$null) -split ' ' | Where-Object { $_ -like 'SHA256:*' }
    if ($fp) { $id = (gh api user/keys 2>$null | ConvertFrom-Json | Where-Object { $_.key -eq ((Get-Content $Pub -Raw).Trim() -replace ' .*$','') }).id; if($id){ gh api -X DELETE "user/keys/$id" 2>&1 | Out-Null } }
  }
  Remove-Item $Key,$Pub -Force -EA SilentlyContinue
  Write-Host "Local SSH key removed." -ForegroundColor Yellow
}
function Enable-KritSshRemote {
  [CmdletBinding()] param([Parameter(Mandatory)][string]$Repo)
  $url = git -C $Repo remote get-url origin
  if ($url -match 'github.com[:/](.+?)(\.git)?$') { $slug = $Matches[1]; git -C $Repo remote set-url origin "git@github.com:$slug.git"; Write-Host "origin -> git@github.com:$slug.git" -ForegroundColor Green }
  else { Write-Warning "not a github origin: $url" }
}
Export-ModuleMember -Function Get-KritSshState,New-KritSshKey,Set-KritSshGitHub,Test-KritSshGitHub,Add-KritSshKeyToGitHub,Remove-KritSshKey,Enable-KritSshRemote
