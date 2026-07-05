$scriptPath = Join-Path $PSScriptRoot 'KritSsh.psm1'
$parseErrors = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
if ($parseErrors.Count -ne 0) { throw "Parse errors: $($parseErrors | Out-String)" }

$scriptContent = Get-Content -Raw $scriptPath
$expectedFunctions = @('Get-KritSshState','New-KritSshKey','Set-KritSshGitHub','Test-KritSshGitHub','Add-KritSshKeyToGitHub','Remove-KritSshKey','Enable-KritSshRemote')
foreach ($func in $expectedFunctions) {
    if (-not ($scriptContent -match "function $func")) { throw "Function $func not found in script" }
}