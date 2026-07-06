# SCXCodex Pack Session Index

Date: 2026-07-06 Australia/Sydney

## Documents

- `documentation\ai\2026-07-06\scxcodex-pack\SCXCODEX-PACK-HANDOFF-2026-07-06.md`
- `documentation\ai\2026-07-06\scxcodex-pack\SCXCODEX-DEDICATED-SUBPROJECT-PLAN-2026-07-06.md`
- `documentation\ai\2026-07-06\scxcodex-pack\SCXCODEX-FULL-ARCHITECTURE-HANDOVER-2026-07-06.md`

## Built Artifact

- `C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe`
- `C:\KriticalSCX\dist\Kritical.SCXCodex\codex-package.json`
- `C:\KriticalSCX\dist\Kritical.SCXCodex\.kritical-scxcodex-build.receipt.json`

## Build Scripts

- `codex-wrapper\pack\Build-KriticalSCXCodex.ps1`
- `codex-wrapper\pack\Apply-KriticalCodexPack.ps1`
- `codex-wrapper\pack\Update-Codex.ps1`
- `install\Install-KriticalSCXCodex.ps1`

## Verification

- `receipts\end-to-end-bughunt-20260705T144559Z.json`
- `receipts\end-to-end-bughunt-20260705T153709Z.json`
- `receipts\bughunt\20260705T144559Z-regression_self-test.log`
- `receipts\bughunt\20260705T153709Z-regression_self-test.log`

## Core Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Build
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Build-KriticalSCXCodex.ps1 -Mode Verify
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Apply-KriticalCodexPack.ps1 -Mode Status
pwsh -NoProfile -ExecutionPolicy Bypass -File .\codex-wrapper\pack\Update-Codex.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install\Invoke-KritScxEndToEndBugHunt.ps1 -Mode Smoke -SkipLive
```

## Safety Rule

SCXCodex pack work must not read, print, modify, remove, migrate, or validate native Anthropic/OpenAI/Claude/ChatGPT/Codex provider keys or auth settings.
