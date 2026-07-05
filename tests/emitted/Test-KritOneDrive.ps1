$scriptPath = 'KritOneDrive.psm1'
$parseErrors = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
if ($parseErrors.Count -gt 0) { throw "Parse errors: $($parseErrors | % { $_.ToString() })" }

$content = Get-Content -Path $scriptPath -Raw
$exportedFunctions = @('Get-KritOneDriveState', 'Suspend-KritOneDrive', 'Resume-KritOneDrive', 'Invoke-KritOneDriveSafe')
foreach ($func in $exportedFunctions) {
    if (-not ($content -match "function $func")) { throw "Function $func not found in file" }
}