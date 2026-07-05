$scriptPath = 'Invoke-KritScxComplete.ps1'

# Test that the file parses without errors
$parseErrors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw "Parse errors found: $($parseErrors | ConvertTo-Json)"
}

# Test that the expected function exists in the file
$scriptContent = Get-Content -Path $scriptPath -Raw
if ($scriptContent -notmatch 'function\s+Invoke-KritScxComplete') {
    throw "Function Invoke-KritScxComplete not found in script"
}

Write-Host "Smoke test passed: File parses correctly and contains expected function"