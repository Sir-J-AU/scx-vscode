# Kritical Lens — Full-Corpus Audit Dossier
_Generated from SQL (KriticalSCXCodeStore). Re-run the lens scripts to refresh — nothing lives only in chat._

## 1. Corpus ingested (raw pass + call graph)
- Files: **45** · LOC: **7194** · functions: **146** · call-graph edges: **50**
- Most-depended-on files (call-graph hubs):
  - `ps-module/KriticalDecisionLogger.psm1` — 18 inbound refs
  - `tests/Test-KritScxCodeMux.js` — 9 inbound refs
  - `ps-module/Kritical.PS.SCXCode.AutoContinue.psm1` — 9 inbound refs
  - `ps-module/Kritical.PS.SCXCode.psm1` — 6 inbound refs
  - `src/extension.ts` — 4 inbound refs
  - `litellm/Test-KritScxRouting.ps1` — 4 inbound refs

## 2. Security mine (all tools)
| tool | findings |
|---|---|
| deepseek-sec | 88 |
| psscriptanalyzer | 76 |
| semgrep | 25 |
| danger-grep | 10 |
| npm-audit | 1 |

By severity: **low**=93, **med**=54, **high**=46, **medium**=6, **moderate**=1

Top HIGH security findings (verify-first):
- `codex-wrapper/kritical-codex.mjs` [semgrep] — Unencrypted request over HTTP detected.
- `codex-wrapper/pack/Apply-KriticalCodexPack.ps1` [deepseek-sec] — Unsafe deserialization of JSON content from external file without validation, could lead to code execution if 
- `codex-wrapper/pack/Update-Codex.ps1` [deepseek-sec] — Unsafe deserialization: ConvertFrom-Json deserializes untrusted JSON input from $Manifest parameter without va
- `d365/Publish-KritD365SalesApp.ps1` [deepseek-sec] — Potential SSRF vulnerability - $apiGatewayUrl is constructed from untrusted environment data and used directly
- `install/Export-KritScxStore.ps1` [deepseek-sec] — Unsafe command execution via python -c with interpolated SQL query parameters, allowing potential code injecti
- `install/Export-KritScxStore.ps1` [deepseek-sec] — SQL injection vulnerability in table and column names via $t.tbl, $t.key, and $t.content parameters that are d
- `install/Install-KritAiCLIs.ps1` [deepseek-sec] — Unsafe command execution via RemoveCmd scriptblock. The script executes arbitrary uninstall commands defined i
- `install/Install-KritAiCLIs.ps1` [deepseek-sec] — Unsafe command execution via InstallCmd scriptblock. The script executes arbitrary package manager commands de
- `install/Install-KritAiCLIs.ps1` [deepseek-sec] — Unsafe command execution via TestCmd scriptblock with user-controlled binary path. An attacker could manipulat
- `install/Install-KriticalSCX.ps1` [deepseek-sec] — Potential SSRF vulnerability - web request to localhost could be manipulated if attacker controls URL paramete
- `install/Install-KritScxVsCode.ps1` [deepseek-sec] — API key is read from a hardcoded user-specific path (C:\Users\joshl\...) which may not exist for other users, 
- `install/Invoke-KritScxLensFull.ps1` [deepseek-sec] — SQL injection vulnerability - $schema variable contains raw SQL that is executed without parameterization, all

## 3. Comment-vs-code evaluation
- Files evaluated: **46** · comment/code MISMATCH: **8** · HOLLOW docs: **5**
Files with mismatched or hollow comments (review these):
- `install/Save-KritScxSourcesRecursively.ps1` — Documentation mentions Playwright fallback logic but code only implements Invoke-WebRequest without Playwright integrati
- `ps-module/Kritical.PS.SCXCode.AutoContinue.psm1` — The auto‑continue wrapper is documented but the implementation is incomplete, ending abruptly at "$co"
- `ps-module/Kritical.PS.SCXCode.psm1` — Get-KritScxModels is truncated and never returns a full list, making the comment misleading and the function incomplete
- `ps-module/KriticalDecisionLogger.psm1` — Update-KriticalDupeCounter is declared but its implementation is missing
- `ps-module/KritOneDrive.psm1` — Suspend-KritOneDrive's comment says -Force kills, otherwise graceful, but code force‑kills in both branches
- `src/extension.ts` — Top comment promises failover handling via fallbackChain, but the shown code never implements that logic.
- `tests/Invoke-KritScxSelfTest.ps1` — Header says script never mutates state, yet it inserts and deletes rows in the decision_log DB during a test
- `tests/Test-KritScxAutoContinue.ps1` — G4 comment says "near‑ceiling" but the test builds a far‑over‑ceiling chunk

## 4. Bug sweep (semantic pass + verdicts)
- Bug findings: **298** · human verdicts: **12** · lens artifacts: **128**

## 5. SQL tables (the whole corpus is queryable — never blind again)
- `dbo.blob_store` — 0 rows
- `dbo.context_shard` — 3 rows
- `dbo.decision_log` — 449 rows
- `dbo.lens_artifact` — 128 rows
- `dbo.LensCallGraph` — 50 rows
- `dbo.LensCommentEval` — 46 rows
- `dbo.LensCorpusFile` — 45 rows
- `dbo.LensSecurityFinding` — 200 rows
- `dbo.LensSqlCatalog` — 102 rows
- `dbo.LensSymbol` — 146 rows
- `dbo.sessions` — 0 rows

_Refresh: `python lens/Invoke-KritScxCorpusMine.py .` → `Invoke-KritScxSecurityMine.py .` → `Invoke-KritScxCommentEval.py .`_