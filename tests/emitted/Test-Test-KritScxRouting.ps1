$scriptPath = 'Test-KritScxRouting.ps1'

# Test that the file parses without errors
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw "Parse errors found: $($parseErrors | ConvertTo-Json)"
}

# Test that expected functions exist in the file
$scriptContent = Get-Content $scriptPath -Raw
$expectedFunctions = @('Check', 'Canary')

foreach ($func in $expectedFunctions) {
    if ($scriptContent -notmatch "function $func") {
        throw "Function $func not found in script"
    }
}

Write-Host "Smoke test passed: File parses correctly and contains expected functions"