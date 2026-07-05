$parseErrors = [System.Management.Automation.Language.Parser]::ParseFile('KritTailscale.psm1', [ref]$null, [ref]$null)
if ($parseErrors.Count -ne 0) { throw "Parse errors: $($parseErrors | ConvertTo-Json)" }

$exportedFunctions = @('Get-KritTailscaleState', 'Suspend-KritTailscale', 'Resume-KritTailscale', 'Invoke-KritTailscaleDown')
foreach ($func in $exportedFunctions) {
    if (-not (Get-Command $func -ErrorAction SilentlyContinue)) {
        throw "Function $func not found in module"
    }
}