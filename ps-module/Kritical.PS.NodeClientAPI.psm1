# Kritical.PS.NodeClientAPI
# Small, dependency-free client for the local Kritical Node supervisor API.

Set-StrictMode -Version Latest

function Resolve-KritNodeSupervisorBaseUrl {
  [CmdletBinding()]
  param([string] $BaseUrl)
  if ($BaseUrl) { return $BaseUrl.TrimEnd('/') }
  if ($env:KRIT_NODE_SUPERVISOR_BASE_URL) { return $env:KRIT_NODE_SUPERVISOR_BASE_URL.TrimEnd('/') }
  return 'http://127.0.0.1:4321'
}

function Invoke-KritNodeSupervisorApi {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidateSet('GET','POST','DELETE')][string] $Method,
    [Parameter(Mandatory)][string] $Path,
    [object] $Body,
    [string] $BaseUrl
  )
  $root = Resolve-KritNodeSupervisorBaseUrl -BaseUrl $BaseUrl
  $uri = '{0}{1}' -f $root, $Path
  $params = @{
    Method = $Method
    Uri = $uri
    TimeoutSec = 15
    ErrorAction = 'Stop'
  }
  if ($PSBoundParameters.ContainsKey('Body')) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  Invoke-RestMethod @params
}

function Get-KritNodeSupervisorStatus {
  [CmdletBinding()]
  param([string] $BaseUrl)
  Invoke-KritNodeSupervisorApi -Method GET -Path '/api/supervisor/status' -BaseUrl $BaseUrl
}

function Get-KritNodeSupervisorQueue {
  [CmdletBinding()]
  param([string] $BaseUrl)
  Invoke-KritNodeSupervisorApi -Method GET -Path '/api/queue' -BaseUrl $BaseUrl
}

function Add-KritNodeSupervisorQueueItem {
  [CmdletBinding(SupportsShouldProcess)]
  param(
    [Parameter(Mandatory)][string] $Id,
    [Parameter(Mandatory)][string] $Prompt,
    [int] $MaxConcurrency = 1,
    [string] $BaseUrl
  )
  if ($Prompt.Length -gt 500) {
    throw 'Node supervisor /api/queue/add currently rejects prompt > 500 chars. Use Add-KritCodingQueueItem for long prompts.'
  }
  $body = @{
    id = $Id
    prompt = $Prompt
    # Legacy API field name; operator-facing param stays descriptive.
    smashItParallel = [Math]::Max(1, $MaxConcurrency)
  }
  if ($PSCmdlet.ShouldProcess($Id, 'Add Node supervisor queue item')) {
    Invoke-KritNodeSupervisorApi -Method POST -Path '/api/queue/add' -Body $body -BaseUrl $BaseUrl
  }
}

function Set-KritNodeSupervisorProviderOrder {
  [CmdletBinding(SupportsShouldProcess)]
  param(
    [Parameter(Mandatory)][string[]] $FailoverOrder,
    [string] $SelectedProvider = 'scx-native',
    [string] $SelectedModel = 'MiniMax-M2.7',
    [string] $BaseUrl
  )
  $body = @{
    selectedProvider = $SelectedProvider
    selectedModel = $SelectedModel
    noFailover = $false
    failover = @{
      enabled = $true
      order = $FailoverOrder
      triggerOn = @{
        rateLimit429 = $true
        providerTimeout = $true
        providerDown = $true
      }
      maxFailoversPerWave = 8
    }
    actor = 'kritical-nodeclientapi'
  }
  if ($PSCmdlet.ShouldProcess(($FailoverOrder -join ' -> '), 'Set Node supervisor failover order')) {
    Invoke-KritNodeSupervisorApi -Method POST -Path '/api/model-config' -Body $body -BaseUrl $BaseUrl
  }
}

function Resume-KritNodeSupervisor {
  [CmdletBinding(SupportsShouldProcess)]
  param([string] $BaseUrl)
  if ($PSCmdlet.ShouldProcess((Resolve-KritNodeSupervisorBaseUrl -BaseUrl $BaseUrl), 'Resume supervisor')) {
    Invoke-KritNodeSupervisorApi -Method POST -Path '/api/supervisor/resume' -Body @{} -BaseUrl $BaseUrl
  }
}

function Stop-KritNodeSupervisor {
  [CmdletBinding(SupportsShouldProcess)]
  param([string] $BaseUrl)
  if ($PSCmdlet.ShouldProcess((Resolve-KritNodeSupervisorBaseUrl -BaseUrl $BaseUrl), 'Stop supervisor')) {
    Invoke-KritNodeSupervisorApi -Method POST -Path '/api/supervisor/stop' -Body @{} -BaseUrl $BaseUrl
  }
}

Export-ModuleMember -Function @(
  'Resolve-KritNodeSupervisorBaseUrl',
  'Invoke-KritNodeSupervisorApi',
  'Get-KritNodeSupervisorStatus',
  'Get-KritNodeSupervisorQueue',
  'Add-KritNodeSupervisorQueueItem',
  'Set-KritNodeSupervisorProviderOrder',
  'Resume-KritNodeSupervisor',
  'Stop-KritNodeSupervisor'
)
