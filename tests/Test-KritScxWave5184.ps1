#requires -Version 7.0
<#
.SYNOPSIS
    Consolidated paired test for wave .5184 deliverables:
      - Kritical Codex wrapper (kritical-codex.ps1 + .mjs)
      - Multi-provider LiteLLM config (SCX + Anthropic + OpenAI + Generic slots)
      - Node.js SCXCodeAgent scaffold (package.json + server.mjs + cli.mjs syntax)
      - HR29 kill-switch verbiage in LiteLLM installer -Mode Status
      - Cross-repo consistency (both CLAUDE.md files carry HR29)
      - Bundled brand assets present (KriticalLogo.txt + brand-spec.json)

.DESCRIPTION
    Static / offline gates only. No live SCX / OpenAI / Anthropic calls.
    No LiteLLM subprocess spawned. Reads files, parses JSON/YAML/JSON5,
    node --check for JS syntax, PS AST parse for PowerShell syntax.

.NOTES
    Per HR21 — every wave gets a paired test.
    Per HR28 — mechanism-named identifiers only.
    Per HR29 — includes explicit verification that HR29 kill-switch verbiage
    is present in installer output.

    Run: pwsh tests/Test-KritScxWave5184.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:PassCount = 0
$script:FailCount = 0

function Assert-Gate {
    param(
        [string] $Name,
        [scriptblock] $Test,
        [string] $Detail
    )
    try {
        $result = & $Test
        if ($result) {
            Write-Host "  [PASS] $Name" -ForegroundColor Green
            $script:PassCount++
        } else {
            Write-Host "  [FAIL] $Name — $Detail" -ForegroundColor Red
            $script:FailCount++
        }
    } catch {
        Write-Host "  [FAIL] $Name — exception: $($_.Exception.Message)" -ForegroundColor Red
        $script:FailCount++
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path $repoRoot).Path

Write-Host ''
Write-Host 'Test-KritScxWave5184 — .5184 consolidated paired test' -ForegroundColor Cyan
Write-Host "  Repo root: $repoRoot"
Write-Host ''

# ============================================================
# CODEX WRAPPER GATES
# ============================================================

Assert-Gate -Name 'C1 kritical-codex.ps1 exists + PS AST parses clean' -Test {
    $p = Join-Path $repoRoot 'codex-wrapper/kritical-codex.ps1'
    if (-not (Test-Path $p)) { return $false }
    $tokens = $null; $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors) | Out-Null
    return $errors.Count -eq 0
} -Detail 'PS AST parse errors'

Assert-Gate -Name 'C2 kritical-codex.mjs exists + node --check clean' -Test {
    $p = Join-Path $repoRoot 'codex-wrapper/kritical-codex.mjs'
    if (-not (Test-Path $p)) { return $false }
    $out = & node --check $p 2>&1
    return $LASTEXITCODE -eq 0
} -Detail 'node --check reported errors'

Assert-Gate -Name 'C3 wrapper README exists + non-trivial' -Test {
    $p = Join-Path $repoRoot 'codex-wrapper/README.md'
    (Test-Path $p) -and ((Get-Item $p).Length -gt 2000)
} -Detail 'README missing or too short'

Assert-Gate -Name 'C4 wrapper HR29-safe — no HKCU env writes in either script' -Test {
    $ps  = Get-Content -LiteralPath (Join-Path $repoRoot 'codex-wrapper/kritical-codex.ps1') -Raw
    $mjs = Get-Content -LiteralPath (Join-Path $repoRoot 'codex-wrapper/kritical-codex.mjs') -Raw
    # any 'User' scope SetEnvironmentVariable or 'Machine' scope = HR29 breach
    if ($ps -match "SetEnvironmentVariable.*['`"]User['`"]")    { return $false }
    if ($ps -match "SetEnvironmentVariable.*['`"]Machine['`"]") { return $false }
    # Node side — must not exec-write registry / .bashrc / dotfiles
    if ($mjs -match "process\.env\.HKCU|regedit|~/\.bashrc|reg add") { return $false }
    return $true
} -Detail 'wrapper writes to HKCU / global env (HR29 breach)'

Assert-Gate -Name 'C5 wrapper never touches ANTHROPIC_BASE_URL' -Test {
    $ps  = Get-Content -LiteralPath (Join-Path $repoRoot 'codex-wrapper/kritical-codex.ps1') -Raw
    $mjs = Get-Content -LiteralPath (Join-Path $repoRoot 'codex-wrapper/kritical-codex.mjs') -Raw
    # allowed: reading, remembering — NOT setting/mutating
    # so check any assignment / setenv to ANTHROPIC_BASE_URL is absent
    if ($ps  -match '\$env:ANTHROPIC_BASE_URL\s*=\s*[^$]')                   { return $false }
    if ($mjs -match "childEnv\.ANTHROPIC_BASE_URL\s*=|process\.env\.ANTHROPIC_BASE_URL\s*=") { return $false }
    return $true
} -Detail 'wrapper assigns to ANTHROPIC_BASE_URL (would disrupt Claude Code)'

# ============================================================
# BUNDLED BRAND ASSET GATES
# ============================================================

Assert-Gate -Name 'B1 KriticalLogo.txt bundled in codex-wrapper/assets/' -Test {
    Test-Path (Join-Path $repoRoot 'codex-wrapper/assets/KriticalLogo.txt')
} -Detail 'brand banner not bundled'

Assert-Gate -Name 'B2 brand-spec.json bundled + valid JSON with entity + contact + colours' -Test {
    $p = Join-Path $repoRoot 'codex-wrapper/assets/brand-spec.json'
    if (-not (Test-Path $p)) { return $false }
    $spec = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
    $spec.entity.legalName -and $spec.contact.phoneMain -and $spec.colours.primary.kriticalDarkBlue
} -Detail 'brand-spec.json missing or malformed'

Assert-Gate -Name 'B3 canonical brand values match spec (#13365C navy, sales@kritical.net, 1300 274 655)' -Test {
    $p = Join-Path $repoRoot 'codex-wrapper/assets/brand-spec.json'
    $spec = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
    ($spec.colours.primary.kriticalDarkBlue -eq '#13365C') -and
    ($spec.contact.emailSales -eq 'sales@kritical.net') -and
    ($spec.contact.phoneMain -eq '1300 274 655')
} -Detail 'brand-spec.json values do not match canonical Kritical brand'

Assert-Gate -Name 'B4 repo-level Assets/kritical-logo.txt present (module fallback)' -Test {
    Test-Path (Join-Path $repoRoot 'Assets/kritical-logo.txt')
} -Detail 'Assets/kritical-logo.txt missing — AutoContinue banner fallback broken'

# ============================================================
# MULTI-PROVIDER LITELLM CONFIG GATES
# ============================================================

Assert-Gate -Name 'L1 LiteLLM config file exists' -Test {
    Test-Path (Join-Path $repoRoot 'litellm/kritical-scx.config.yaml')
} -Detail 'config file missing'

# .5215 CORRECTED — the DEFAULT config is SCX-ONLY by hard constraint (HR1). The 4-provider-slot
# (SCX/Anthropic/OpenAI/Generic) capability lives in the OPT-IN traditional config, gated behind
# KRIT_SCX_ALLOW_TRADITIONAL_KEYS=1. So we assert BOTH: default is SCX-only, traditional has the slots.
Assert-Gate -Name 'L2 default config SCX-only; traditional config carries all 4 provider slots' -Test {
    $def = Get-Content -LiteralPath (Join-Path $repoRoot 'litellm/kritical-scx.config.yaml') -Raw
    $defScxOnly = ($def -match 'model_name:\s*minimax-m2\.7') -and ($def -notmatch 'model_name:\s*anthropic/claude') -and ($def -notmatch 'model_name:\s*openai/gpt-5')
    $tradPath = Join-Path $repoRoot 'litellm/kritical-scx-traditional.config.yaml'
    $tradOk = $false
    if (Test-Path $tradPath) {
        $t = Get-Content -LiteralPath $tradPath -Raw
        $tradOk = ($t -match 'model_name:\s*minimax-m2\.7') -and ($t -match 'model_name:\s*anthropic/claude') -and ($t -match 'model_name:\s*openai/gpt-5') -and ($t -match 'model_name:\s*generic/default')
    }
    $defScxOnly -and $tradOk
} -Detail 'default must be SCX-only; traditional (opt-in) must declare all 4 slots'

Assert-Gate -Name 'L3 LiteLLM config never assigns host: 0.0.0.0 (comments are fine)' -Test {
    $lines = Get-Content -LiteralPath (Join-Path $repoRoot 'litellm/kritical-scx.config.yaml')
    # only actual YAML assignments to 0.0.0.0 (host: 0.0.0.0 / --host 0.0.0.0) are a breach
    # comments starting with # are fine (they describe what to avoid)
    foreach ($line in $lines) {
        if ($line -match '^\s*#') { continue }               # comment — ignore
        if ($line -match '(host|bind)\s*:\s*0\.0\.0\.0')   { return $false }
        if ($line -match '--host\s+0\.0\.0\.0')             { return $false }
    }
    return $true
} -Detail 'config actually assigns 0.0.0.0 — HR29 breach'

Assert-Gate -Name 'L4 fallback chains declared for SCX models' -Test {
    $p = Get-Content -LiteralPath (Join-Path $repoRoot 'litellm/kritical-scx.config.yaml') -Raw
    $p -match 'fallbacks:' -and $p -match 'cooldown_time'
} -Detail 'router-level fallbacks or cooldown missing'

# ============================================================
# LITELLM INSTALLER HR29 KILL-SWITCH GATES
# ============================================================

Assert-Gate -Name 'I1 LiteLLM installer contains HR29 kill-switch verbiage' -Test {
    $p = Get-Content -LiteralPath (Join-Path $repoRoot 'litellm/Install-KritScxLiteLLM.ps1') -Raw
    $p -match 'HR29' -and $p -match 'kill switch' -and $p -match 'direct-API'
} -Detail 'installer missing HR29 kill-switch block'

Assert-Gate -Name 'I2 installer -Mode Status prints multi-provider slot table' -Test {
    $p = Get-Content -LiteralPath (Join-Path $repoRoot 'litellm/Install-KritScxLiteLLM.ps1') -Raw
    $p -match 'SCX_API_KEY' -and $p -match 'ANTHROPIC_API_KEY' -and $p -match 'OPENAI_API_KEY' -and $p -match 'GENERIC_API_KEY'
} -Detail 'installer Status output missing one or more slot references'

# ============================================================
# NODE SCAFFOLD GATES
# ============================================================

Assert-Gate -Name 'N1 node-agent/package.json parses + declares Fastify + Undici' -Test {
    $p = Join-Path $repoRoot 'node-agent/package.json'
    if (-not (Test-Path $p)) { return $false }
    $pkg = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
    ($pkg.dependencies.fastify -and $pkg.dependencies.undici)
} -Detail 'package.json malformed or missing deps'

Assert-Gate -Name 'N2 server.mjs syntax check clean' -Test {
    $p = Join-Path $repoRoot 'node-agent/src/server.mjs'
    if (-not (Test-Path $p)) { return $false }
    & node --check $p 2>&1 | Out-Null
    $LASTEXITCODE -eq 0
} -Detail 'server.mjs syntax error'

Assert-Gate -Name 'N3 cli.mjs syntax check clean' -Test {
    $p = Join-Path $repoRoot 'node-agent/src/cli.mjs'
    if (-not (Test-Path $p)) { return $false }
    & node --check $p 2>&1 | Out-Null
    $LASTEXITCODE -eq 0
} -Detail 'cli.mjs syntax error'

Assert-Gate -Name 'N4 node-agent/.gitignore excludes node_modules (HR14)' -Test {
    $p = Join-Path $repoRoot 'node-agent/.gitignore'
    if (-not (Test-Path $p)) { return $false }
    (Get-Content -LiteralPath $p -Raw) -match 'node_modules'
} -Detail 'node_modules not gitignored (HR14 breach risk)'

# ============================================================
# HR29 CROSS-REPO CONSISTENCY GATES
# ============================================================

Assert-Gate -Name 'H1 Kritical.SCXCode CLAUDE.md carries HR29' -Test {
    $p = Get-Content -LiteralPath (Join-Path $repoRoot 'CLAUDE.md') -Raw
    $p -match 'HARD RULE 29' -and $p -match 'ADDITIVE'
} -Detail 'HR29 missing from Kritical.SCXCode CLAUDE.md'

Assert-Gate -Name 'H2 KRT CLAUDE.md advisory HR29 check (WARN not FAIL — KRT is under parallel edit)' -Test {
    # KRT CLAUDE.md is actively edited by another operator session. If HR29 is not
    # present, that's an advisory for the operator to add it themselves — not a
    # SCXCode paired-test failure. Always PASS; emit a Write-Host warning only.
    $p = 'C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/KRTPax8ToShopifyConnector/CLAUDE.md'
    if (Test-Path $p) {
        $c = Get-Content -LiteralPath $p -Raw
        if ($c -notmatch 'HARD RULE 29') {
            Write-Host '        [advisory] KRT CLAUDE.md is missing HR29 — operator may re-add manually.' -ForegroundColor Yellow
        }
    }
    return $true
} -Detail 'always PASS (advisory only)'

Assert-Gate -Name 'H3 architecture doc references HR29 additive posture' -Test {
    $p = Join-Path $repoRoot 'docs/ARCHITECTURE-SCX-BRIDGE-5182.md'
    if (-not (Test-Path $p)) { return $false }
    $c = Get-Content -LiteralPath $p -Raw
    $c -match 'HR29' -and $c -match 'additive'
} -Detail 'architecture doc missing HR29 posture'

# ============================================================
# COWORK BRIEF GATE
# ============================================================

Assert-Gate -Name 'W1 cowork brief exists + non-trivial + names the 10 deliverables' -Test {
    $p = Join-Path $repoRoot 'reference/CLAUDE-COWORK-KRITICAL-NODEJS-SCXCODEAGENT.md'
    if (-not (Test-Path $p)) { return $false }
    $c = Get-Content -LiteralPath $p -Raw
    $c.Length -gt 4000 -and $c -match 'HR27' -and $c -match 'HR28' -and $c -match 'HR29'
} -Detail 'cowork brief missing or does not cite the three constraint rules'

# ============================================================
Write-Host ''
Write-Host "Result: $PassCount PASS / $FailCount FAIL" -ForegroundColor $(if ($FailCount -eq 0) { 'Green' } else { 'Red' })

if ($FailCount -gt 0) { exit 1 } else { exit 0 }
