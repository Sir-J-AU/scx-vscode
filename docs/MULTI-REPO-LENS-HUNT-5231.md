<!-- Multi-repo Lens+bug-hunt sweep (.5231), workflow wiidgobwt: 30 repos, 281 agents, adversarially verified. -->

# .5231 — Multi-Repo Lens + Bug-Hunt Sweep

**175 confirmed** across **30 repos** · high=71 med=88 low=16 · deterministic=101 inference=74

## Confirmed per repo

| Confirmed | Repo | Purpose | Coverage |
|---:|---|---|---|
| 10 | Kritical.PS.GitHub | Kritical-branded PowerShell module for bulk GitHub multi-repo operations: status | Sampled ~25 of 25 public functions (100% of Public source) + module manifest + root script |
| 9 | Kritical.AISupervisor.PS | PowerShell supervisor loop for autonomous Pax8↔BC↔Shopify connector work via rep | Sampled ~20 PowerShell files from root and v3/ directories. Focused on: supervisor loops ( |
| 9 | Kritical.AISupervisor.NodeJS | Kritical AI Supervisor Node.js orchestrator: manages autonomous wave queue via F | Sampled all 5 real source files (server.js, loop.js, queue-dropbox-watcher.js, hourly-summ |
| 9 | Kritical.PS.Pax8Mcp | PowerShell module to install, validate, rotate and remove the Pax8 hosted MCP se | Analyzed 11 core source files: all .ps1 files in src/Private/ and src/Public/, plus the ma |
| 9 | Krit.ALToolkit | Shared AL utility library (SMB/NTFS permission reporters, Yara rule tools, diagn | Analyzed all 10 real source .ps1 files. README claims 67 .psm1 files and 54 .ps1 files (12 |
| 8 | CrowdStrikeAPIConnectorForD365BC | CrowdStrike Falcon MSSP connector for Microsoft Dynamics 365 Business Central —  | Analyzed 105 AL source files across codeunits, tables, pages, and enums. Focused on 11 cri |
| 8 | Kritical-OmniFramework | Centralised PowerShell framework-config loader for Pax8+ALBrain toolkit with rep | Sampled all real source files (7 PowerShell modules/scripts, 1 JSON config, supporting doc |
| 7 | Kritical-KAOSBlueprints | Kritical-KAOSBlueprints: Reference-only archive of 2025-era KAOS M365DSC tenant  | Sampled 12 core files across canonical/2025-06, 2025-08, 2026-05 versions (entrypoints: In |
| 7 | Krit.OpenApi | Kritical OpenAPI toolkit — canonical OpenAPI 3.x to PowerShell module generator  | Sampled ~15 primary source files: all 6 Public functions, root module/manifest, Node gener |
| 7 | KriticalCONTROL-KAOS | Kritical operational control plane repo with legacy DSC scripts and audit tools  | Sampled 8 PowerShell files (all .ps1 in repo), 1 audit script, and key markdown files. Ski |
| 7 | ShopifyBrain | Shopify theme evidence collection toolkit for static analysis, runtime Playwrigh | Analyzed 12 core source files (100% of /src): cli/shopifybrain.mjs, collectors/{static,run |
| 6 | Kritical.SCXCode | VS Code extension + PowerShell module + MCP server + Python lens tools for SCX A | Analyzed ~15 key source files including main extension (156K lines `src/extension.ts`), Po |
| 6 | Kritical.PS.Toolkit | PowerShell utility library for Kritical projects with Pax8/Shopify rate-limiting | Sampled ~6 hand-written .psm1 modules from scripts/lib/ (Pax8ApiResumer, Pax8RateLimiter,  |
| 6 | Kritical-CloudImplementation | Azure and M365 cloud implementation scripts with user onboarding, MFA policy man | Sampled ~12 hand-written source files across merge-canonical (2025-06 onboarding scripts)  |
| 6 | Kritical.Lens.ALDependencyMatrix | PowerShell 7 module that walks AL project files and produces a dependency matrix | Examined all 6 .ps1 source files (2 public, 4 private functions), manifest, test suite, an |
| 6 | Kritical-ShopifyVault | Full-coverage Shopify backup/restore/clone engine with PowerShell core (Track A) | Analyzed ~15 critical files: all 6 lib modules (Vault.Core, Bulk, Snapshot, Backup, Restor |
| 6 | Kritical.PS.Hardening | PowerShell hardening audit toolkit that orchestrates HotCakeX, HardeningKitty, a | Analyzed 100% of real source files: 8 .ps1 files in src/Public, 1 in src/Private, 2 tool/t |
| 6 | Kritical-DedupeEngine | Text deduplication engine using fuzzy matching algorithms with PowerShell orches | Covered all 6 Python/PowerShell source files in repository (100%): DedupeEngineKRITICAL-v0 |
| 5 | Kritical-PSCrazyTelAPI | PowerShell wrapper module for CrazyTel VoIP/SMS API with spec-generated commands | Sampled 141 PS1 files across src/Private, src/Public, scripts, and tools directories. Focu |
| 5 | AbbysLittleTurtle | PowerShell WinForms math turtle game for educational gameplay with GUI animation | Sampled 5 of 46 versions (primarily 2025-11 production releases v303, v305-more, v4008 and |
| 4 | Kritical.PS.UTCM | PowerShell toolkit wrapping Microsoft Graph Unified Tenant Configuration Managem | Scanned 12 hand-written source files (~2% of total PS files in repo) including module entr |
| 4 | Kritical.Lens.SchemaCompleteness | PowerShell 7 module that audits Microsoft365DSC module schema completeness again | Analyzed 11 source files: 1 manifest (psd1), 1 root module (psm1), 3 private functions (_* |
| 4 | Kritical-M365DSC | Kritical-M365DSC: A PowerShell 7 orchestration framework for Microsoft 365 DSC o | Analyzed root-level source: 3 main PowerShell modules (Invoke-KriticalM365DSC.ps1, Kritica |
| 4 | Krit.ModernVCheck | PowerShell 7 vCheck-compatible execution engine with Krit.OmniFramework-backed r | Analyzed ~65% of codebase by file count. Focused on all 11 Public functions, 6 critical Pr |
| 4 | Kritical-Pax8API | PowerShell client library for Pax8 partner API with spec-generated operations an | Sampled ~20 key source files from src/Pax8API/Public and Private directories (Connect, Dis |
| 3 | Kritical.PS.OmniFramework | Kritical.PS.OmniFramework is a multi-OS PowerShell foundation module providing s | Examined ~18 critical PowerShell source files (~2200 lines) covering all public API functi |
| 3 | Kritical.Lens | Kritical.Lens umbrella: orchestrator + registry + child soft-loader for semantic | Sampled ~25 key files across src/ and brains/: Kritical.Lens.psm1 (213 lines), Install.ps1 |
| 3 | Kritical.VSCode.PluginControlPanel | VS Code extension and CLI for branded multi-stack loadout selection, enabling la | Sampled 100% of source: 1 .js (extension.js, 250 lines), 1 .mjs CLI (kritical-plugins.mjs, |
| 2 | Kritical-ManagementScripts | Repository of Kritical operational and management scripts, primarily PowerShell, | Sampled 5 active source files from three key directories (Clients, imports, merge-canonica |
| 2 | Kritical.PS.ModuleDevelopment | Kritical PowerShell module-development toolkit providing quality gates, scaffold | Analyzed all 15 source PowerShell files (7 public functions, 7 private helpers, 1 manifest |

## HIGH-severity confirmed

1. **[Kritical.PS.GitHub]** `src/Public/Invoke-KritGitHubSafeMove.ps1:56` (inference)
   - HR16 idempotency violation: Invoke-KritGitHubSafeMove lacks idempotency checks. If run twice on the same source files, the second invocation will fail silently (files already moved) but the operator expects success-or-error. No check for 'f
2. **[Kritical.AISupervisor.PS]** `Bootstrap-PaxLensStandalone-1507.ps1:379` (deterministic)
   - Hardcoded operator-specific Windows username 'joshl' in absolute path
3. **[Kritical.AISupervisor.PS]** `Invoke-PaxOvernightPreflight.ps1:67` (deterministic)
   - Hardcoded operator-specific path to external repo dependency
4. **[Kritical.AISupervisor.PS]** `v3/pretty-windows/w-cross-dev-FIXED.ps1:8` (deterministic)
   - Hardcoded operator-specific absolute repo path in portable loop script
5. **[Kritical.AISupervisor.PS]** `Restart-PaxSupervisor.ps1:272` (inference)
   - ConvertFrom-Json on external lock file without error handling
6. **[Kritical.AISupervisor.PS]** `Run-PaxOvernightLoop.ps1:331` (inference)
   - JSON written to lock file without validation; no idempotency gate on reparse
7. **[Kritical.AISupervisor.NodeJS]** `src/loop.js:1360` (inference)
   - Race condition in thinking-block retry loop: process.env._RETRY_NO_CONTINUE mutates global state without proper isolation, causing concurrent waves (if parallel spawns resume) to interfere with each other's retry logic.
8. **[Kritical.AISupervisor.NodeJS]** `src/loop.js:1708` (inference)
   - Unsafe parent process detection via PowerShell spawn in async context: getParentImageOf() spawns pwsh without proper error handling on the secondary spawn (line 1718), leaking the second child process if the first completes but the second h
9. **[Kritical.AISupervisor.NodeJS]** `src/server.js:598` (inference)
   - HR1 violation gate only at config-set, not spawn time: HARD RULE 1 check at line 597-598 verifies env var is set at configuration time, but does not re-check at wave-spawn time, allowing a provider to be activated later via env mutation.
10. **[Kritical.PS.Pax8Mcp]** `src/Public/Clear-KriticalPax8IngestedLogs.ps1:107` (deterministic)
   - Test-Path with -LiteralPath and wildcard pattern never matches; wildcard-glob in literal mode always returns false
11. **[Kritical.PS.Pax8Mcp]** `src/Private/_Agents.ps1:86` (deterministic)
   - File path $Path directly interpolated into Python code string via @" "@ (double-quoted here-string), allowing code injection if $Path contains backslashes or quotes
12. **[Kritical.PS.Pax8Mcp]** `src/Private/_Agents.ps1:103` (deterministic)
   - $McpEndpoint interpolated into JSON string without escaping; allows injection of malicious URLs or JSON syntax
13. **[Krit.ALToolkit]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Krit.ALToolkit/scripts/al/34605624___SMB-NTFS-ReportPermissions-v1.1.1-FINAL-TESTEDWORKING-SMBAtTop.ps1:106` (deterministic)
   - CimSession resource leak: New-CimSession created without assignment in pipeline, not disposed
14. **[Krit.ALToolkit]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Krit.ALToolkit/scripts/al/34605624___SMB-NTFS-ReportPermissions-v1.1.1-FINAL-TESTEDWORKING-SMBAtTop.ps1:108` (deterministic)
   - CimSession resource leak: New-CimSession created without assignment in pipeline, not disposed
15. **[Krit.ALToolkit]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Krit.ALToolkit/scripts/al/6391ab8f___SMB-NTFS-ReportPermissions-v1.1.0-FINAL-TESTEDWORKING-moveSMBtoTopSometime.ps1:138` (deterministic)
   - CimSession resource leak: New-CimSession created without assignment in pipeline, not disposed
16. **[Krit.ALToolkit]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Krit.ALToolkit/scripts/al/6391ab8f___SMB-NTFS-ReportPermissions-v1.1.0-FINAL-TESTEDWORKING-moveSMBtoTopSometime.ps1:140` (deterministic)
   - CimSession resource leak: New-CimSession created without assignment in pipeline, not disposed
17. **[Krit.ALToolkit]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Krit.ALToolkit/scripts/al/6391ab8f___SMB-NTFS-ReportPermissions-v1.1.0-FINAL-TESTEDWORKING-moveSMBtoTopSometime.ps1:231` (deterministic)
   - Code duplication: entire main logic (lines 206-229) is duplicated 3 times verbatim
18. **[CrowdStrikeAPIConnectorForD365BC]** `src/Codeunits/61005-CSAPIRuntime.Codeunit.al:43` (deterministic)
   - Hardcoded HTTP status code 200 logged regardless of actual response: Log.Finish(200, ...) always records success even when the actual HTTP status varies
19. **[CrowdStrikeAPIConnectorForD365BC]** `src/Codeunits/61001-CSHttpClient.Codeunit.al:86` (deterministic)
   - Query parameters not URL-encoded: Direct string concatenation with Name + '=' + Value without URI encoding
20. **[CrowdStrikeAPIConnectorForD365BC]** `src/Codeunits/61000-CSAuth.Codeunit.al:59` (deterministic)
   - OAuth token request body not properly URL-encoded: client_id and client_secret concatenated without escaping special characters
21. **[Kritical-OmniFramework]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-OmniFramework/ADAudit-v3-PGSQL/PostgreSQL ODBC Driver Installation-v004-WORKING.ps1:48` (deterministic)
   - Hardcoded database credential in production script violates HR1 (no sensitive keys in source)
22. **[Kritical-OmniFramework]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-OmniFramework/ADAudit-v3-PGSQL/PostgreSQL ODBC Driver Installation-v004-WORKING.ps1:185` (deterministic)
   - Undefined property reference: code uses $Dsn.DriverFriendlyName but $Global:DsnConfig hashtable (lines 42-49) never defines this key
23. **[Kritical-OmniFramework]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-OmniFramework/tests/Audit-PaxFrameworkConfigModuleContract.ps1:46` (deterministic)
   - Missing function definition: dot-sourcing Assert-PaxRepoRoot from Assert-PaxRepoRoot.ps1 but file does not exist in repo
24. **[Kritical-OmniFramework]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-OmniFramework/tests/Audit-PaxFrameworkConfigModuleContract.ps1:78` (deterministic)
   - Undefined function: code calls Read-PaxFileLinesSafe() but this helper function is not defined anywhere in the codebase
25. **[Kritical-OmniFramework]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-OmniFramework/scripts/from-discovery/Audit-PaxFrameworkConfigModuleContract.ps1:46` (deterministic)
   - Missing function definition: dot-sourcing Assert-PaxRepoRoot fails — script cannot bootstrap
26. **[Kritical-KAOSBlueprints]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-KAOSBlueprints/canonical/2025-08/3757630b___ParallelKAOSv15.0.0.0-ToTry.ps1:49` (deterministic)
   - Invalid PowerShell syntax: [System.ConsoleColor]::$foregroundDrawingColor.Name attempts to use $ variable syntax in type access, which is illegal. Should be direct property access or string value, not [Type]::$var.Property.
27. **[Kritical-KAOSBlueprints]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-KAOSBlueprints/canonical/2025-08/3757630b___ParallelKAOSv15.0.0.0-ToTry.ps1:53` (deterministic)
   - Potential resource leak: Write-KriticalLog calls $script:KriticalLogMutex.WaitOne() without timeout. If a thread deadlocks or crashes while holding the mutex, all subsequent logging calls block forever. No timeout parameter; no error handli
28. **[Kritical-KAOSBlueprints]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-KAOSBlueprints/canonical/2026-05/742c27b___KriticalULTRAKAOS-Microsoft365DSC-PowerPlatformWorks.ps1:1560` (deterministic)
   - Credential handling vulnerability: Read-Host -AsSecureString → ConvertFrom-SecureString -AsPlainText decrypts secure string back to plaintext in memory and stores in variable. Payment API key/secret exposed in plaintext in $paymentApiKey va
29. **[Kritical-KAOSBlueprints]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-KAOSBlueprints/canonical/2025-08/1b110d72___Invoke-KriticalM365DSC.ps1:187` (deterministic)
   - Syntax error: Typo '#endregionn' (double 'n') instead of '#endregion'. PowerShell region folding and nesting logic will malfunction; region not properly closed. Code after this line may be silently skipped or incorrectly scoped.
30. **[Krit.OpenApi]** `tools/Lens-OpenApiToPsModule-1507.mjs:55` (deterministic)
   - Unhandled JSON parse error — JSON.parse() can throw on malformed specs with no try/catch wrapper
31. **[Krit.OpenApi]** `src/Public/New-KritOpenApiAgenticSidecar.ps1:124` (inference)
   - Regex injection vulnerability in generated sidecar template — user input $TaskHint fed directly into -match pattern via -replace
32. **[KriticalCONTROL-KAOS]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/KriticalCONTROL-KAOS/canonical/2023-07/6d7eb04e___Alt.Step4-UpdateLibrary.ps1:67` (deterministic)
   - Invoke-WebRequest called without -ErrorAction or try-catch; silently continues if URI download fails.
33. **[ShopifyBrain]** `src/collectors/runtime.mjs:130` (inference)
   - Swallowed error in hover interaction: await target.hover() has .catch(() => {}) with empty handler, silencing all hover failures without logging or recording evidence
34. **[Kritical.SCXCode]** `lens/Invoke-KritScxCorpusMine.py:60` (deterministic)
   - SQL connection opened at module level without try/finally; any exception in processing loop (lines 74-130) leaves connection unclosed forever
35. **[Kritical.SCXCode]** `lens/Invoke-KritScxSecurityMine.py:17` (deterministic)
   - SQL connection opened at module level without try/finally; exceptions in PSScriptAnalyzer (line 43), semgrep (line 60), npm audit (line 74), or DeepSeek lens (line 128) leave connection unclosed
36. **[Kritical.PS.Toolkit]** `scripts/lib/Pax8StateStore.psm1:110` (deterministic)
   - Silent JSON parse failure: ConvertFrom-Json errors are caught and ignored in Get-PaxStateJsonTable, resulting in partial/empty data without signaling the caller
37. **[Kritical.PS.Toolkit]** `scripts/lib/Pax8StateStore.psm1:117` (inference)
   - Race condition in concurrent UPSERT: Set-PaxStateJsonTable uses plain WriteAllText without atomic file-swap, allowing interleaved reads/writes to corrupt JSON or lose concurrent updates
38. **[Kritical-CloudImplementation]** `merge-canonical/2025-01/58af40b4___Unprotect-SecureString.ps1:1` (deterministic)
   - Script that converts SecureString to plaintext stored in repo, enabling credential exposure if ever used with sensitive data.
39. **[Kritical-CloudImplementation]** `merge-canonical/2025-06/fce1d3f___aaa-Onboard-Kritical-User.ps1:52` (inference)
   - User passwords loaded from CSV file and passed directly to Update-MgUser without validation; plaintext passwords read from disk and sent to API.
40. **[Kritical-CloudImplementation]** `merge-canonical/2025-06/4b964fa8___1-StartOnboard-KriticalUsers-v001.ps1:75` (inference)
   - Script deletes conditional access policy without audit trail or backup; hard-delete violates HR23 policy (never hard-delete history).
41. **[Kritical.Lens.ALDependencyMatrix]** `src/Private/_ALWalker.ps1:14` (deterministic)
   - Get-Content returns a single string when file has one line, causing character-level indexing in the for loop instead of line-level iteration
42. **[Kritical.Lens.ALDependencyMatrix]** `src/Private/_ALPatterns.ps1:9` (deterministic)
   - RecordType regex pattern only matches quoted names or numeric IDs, not bare names like 'Record Customer'
43. **[Kritical.Lens.ALDependencyMatrix]** `src/Public/Invoke-KriticalLensALDependencyMatrix.ps1:86` (deterministic)
   - ConvertFrom-Json called without error handling; malformed JSON in mapping file causes uncaught exception and command failure
44. **[Kritical-ShopifyVault]** `engine/lib/Vault.Restore.psm1:101` (inference)
   - No-op ItemIds filter: Line 101 contains `if ($step.ItemIds) { }` — empty statement does nothing. The filter is applied at plan time (line 55), but this code path never executes because $step does not have ItemIds property (it's only on $pla
45. **[Kritical-ShopifyVault]** `engine/lib/Vault.Restore.psm1:106` (deterministic)
   - Unchecked array access: $payload.extractResult.Invoke($d)[0] assumes extractResult returns an array/collection with [0] index. If extractResult returns a scalar or null, subscripting fails with 'Cannot index into null array' or yields unexp
46. **[Kritical-DedupeEngine]** `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical-DedupeEngine\Parallel\DedupeEngineKRITICAL-v001.py:7` (deterministic)
   - Misuse of exec() without subprocess module - incorrect exception handling for pip installation
47. **[Kritical-DedupeEngine]** `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical-DedupeEngine\Parallel\dedupe-big-text.ps1:379` (deterministic)
   - Missing -ErrorAction parameter on ConvertFrom-Json in runspace - unhandled JSON parse errors in parallel job
48. **[Kritical-DedupeEngine]** `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical-DedupeEngine\Parallel\dedupe-big-text.ps1:220` (inference)
   - Error detection after Receive-Job uses $LASTEXITCODE which may not reflect Python script failure properly in Start-Job context
49. **[Kritical-PSCrazyTelAPI]** `src/CrazyTelAPI/CrazyTelAPI.psm1:75` (inference)
   - Hardcoded email addresses and PBX destination in argument completers violate secrets management and Kritical HR1 (no non-native API keys in plain code)
50. **[Kritical-PSCrazyTelAPI]** `scripts/Set-KriticalCrazyTelSmsRoutes.ps1:5` (inference)
   - Hardcoded SecretsRoot path C:\Users\joshl\... in script parameter default violates portability and Kritical HR2 (no user-specific paths in code)
51. **[Kritical-PSCrazyTelAPI]** `scripts/Set-KriticalCrazyTelSmsRoutes.ps1:10` (inference)
   - Hardcoded internal email addresses (joshua.finley@kritical.net, ben.szypowski@kritical.net, huzaifa.khalid@kritical.net, nicholas.bazalicki@kritical.net) in parameter defaults violate Kritical HR1 (no hardcoded deployment artifacts)
52. **[AbbysLittleTurtle]** `versions/2025-11/Abby-LittleTurtle-v4008.ps1:1282` (deterministic)
   - Event handler subscriptions are never unsubscribed before control/timer disposal, causing resource leaks and potential memory corruption.
53. **[AbbysLittleTurtle]** `versions/2025-11/ABBY-littleTurtle-WinForms-v305-more.ps1:1140` (deterministic)
   - Event handler subscriptions are never unsubscribed before control/timer disposal, causing resource leaks and potential memory corruption.
54. **[AbbysLittleTurtle]** `versions/2026-06/load-turtle.ps1:2` (deterministic)
   - Hardcoded repo path does not match actual repository location, causing script failure.
55. **[Kritical.PS.UTCM]** `Rename-KriticalTcmToUtcm.ps1:99` (deterministic)
   - File write operation does not preserve original encoding — [System.IO.File]::WriteAllText always uses UTF-8 without BOM, but script explicitly preserves line endings (line 106) without preserving original encoding, causing silent data corru
56. **[Kritical.PS.UTCM]** `Get-KriticalUtcmSnapshot.ps1:29` (deterministic)
   - Graph API error not caught — Invoke-MgGraphRequest on line 29 has no explicit error handling (no -ErrorAction Stop), causing silent null return that will crash on line 31/34 when trying to access $r.id or $r.value
57. **[Kritical.Lens.SchemaCompleteness]** `src/Private/_GateEval.ps1:22` (deterministic)
   - Mandatory parameter detection fails for shorthand [Parameter(Mandatory)] syntax
58. **[Kritical-M365DSC]** `Kritical-CoreEngine.psm1:178` (deterministic)
   - Undefined variable $prefix used in Write-Host unparenthesized concatenation
59. **[Kritical-M365DSC]** `Kritical-M365DSC-Workflows.psm1:444` (deterministic)
   - Unencrypted ApplicationSecret passed in splatted parameter dict
60. **[Krit.ModernVCheck]** `src/Krit.ModernVCheck/Public/Invoke-ModernVCheck.ps1:102` (inference)
   - Parallel plugin context changes are discarded, breaking state propagation to finish plugins in HybridParallel mode
61. **[Kritical-Pax8API]** `src/Pax8API/Private/ConvertFrom-Pax8SecureString.ps1:9` (deterministic)
   - Credential password exposed to plaintext via GetNetworkCredential().Password without cleanup, enabling memory inspection attacks
62. **[Kritical-Pax8API]** `src/Pax8API/Public/Connect-Pax8.ps1:33` (deterministic)
   - Client secret converted via ConvertTo-SecureString -AsPlainText then immediately decrypted back to plaintext, defeating SecureString purpose
63. **[Kritical-Pax8API]** `src/Pax8API/Public/Disconnect-Pax8.ps1:9` (deterministic)
   - Session disconnect leaves BaseUri and TokenUri in script scope; incomplete session cleanup
64. **[Kritical.PS.OmniFramework]** `src/Public/Set-KriticalOneDriveShareLinkPermission.ps1:123` (deterministic)
   - Direct property access on Graph response object violates strict-mode pattern. Code accesses $resp.id, $resp.roles, $resp.expirationDateTime, $resp.hasPassword without using Get-KriticalGraphProp helper, while Set-StrictMode -Version Latest 
65. **[Kritical.PS.OmniFramework]** `src/Public/Remove-KriticalOneDriveShareLinkPermission.ps1:79` (inference)
   - Idempotency violation per HR16: Invoke-MgGraphRequest with -ErrorAction Stop throws 404 error if permission is already deleted or does not exist. Function always returns Removed=$true on line 83 regardless of actual result. Calling twice wi
66. **[Kritical.PS.OmniFramework]** `src/Public/Resolve-KriticalConfig.ps1:48` (deterministic)
   - Unhandled error on malformed JSON: ConvertFrom-Json on line 48 has no -ErrorAction flag and will throw terminating error if config file contains invalid JSON. Unlike Get-KriticalBrandSpec (line 109-113 with try-catch), this has no error bou
67. **[Kritical.Lens]** `brains/Pax8API/Build-Pax8APIBrain.ps1:14` (deterministic)
   - Hardcoded user-specific path to secrets directory bakes in absolute path with user name, preventing cross-user/cross-machine portability and leaking local folder structure.
68. **[Kritical.VSCode.PluginControlPanel]** `extension.js:227` (deterministic)
   - Hardcoded absolute user path in applyMcp() breaks portability; path only valid on Joshua Finley's machine, violates HR29.
69. **[Kritical-ManagementScripts]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-ManagementScripts/merge-canonical/2020-08/1f276ca___Uninstall-CertificationAuthority.ps1:18` (deterministic)
   - Undefined variable $OSVersion used: script assigns to $OS but references $OSVersion.Major, causing variable is null error at runtime.
70. **[Kritical-ManagementScripts]** `C:/Users/joshl/OneDrive - Kritical Pty Ltd/Github/Kritical-ManagementScripts/Clients/Kitchenworx/KITCHENWORX-M365-EMAIL-ExportEmail-SalesAtKitchenworx-EmergencyAttachmentFind.ps1:5` (deterministic)
   - Hardcoded fallback admin credential in plain text: 'c1.joshua.finley@kitchenworx.com.au' embedded in script violates HR1 (no credential leaks) and general secret management policy.
71. **[Kritical.PS.ModuleDevelopment]** `src/Public/Invoke-KritModuleQualityGate.ps1:34` (inference)
   - Function only writes warning on quality gate failures without throwing error or setting exit code
