$scriptPath = 'Manage-KritScxProxy.ps1'
$parseErrors = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
if ($parseErrors.Count -gt 0) {
    throw "Parse errors found: $($parseErrors | ConvertTo-Json)"
}

$scriptContent = Get-Content -Path $scriptPath -Raw
$expectedFunctions = @('Test-Health', 'Get-ListenerPid', 'Write-Registry', 'Show-Status')
foreach ($func in $expectedFunctions) {
    if (-not ($scriptContent -match "function $func")) {
        throw "Function $func not found in script"
    }
}