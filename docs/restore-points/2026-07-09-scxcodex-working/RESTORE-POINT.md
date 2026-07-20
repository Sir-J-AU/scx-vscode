# Kritical SCX Codex Restore Point - 2026-07-09 Working Runtime

This restore point records the `Kritical.SCXCodex.exe` runtime that was already running and behaving well on 2026-07-09.

The live process was not stopped, restarted, patched, or attached to during capture.

## Working Runtime

| Field | Value |
|---|---|
| Restore point ID | `2026-07-09-scxcodex-working` |
| Runtime path | `C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe` |
| Process ID at capture | `8548` |
| Process creation time | `2026-07-09 10:28:13` local |
| Command line | `"C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe"` |
| File size | `373,131,776` bytes |
| File last write time | `2026-07-07 17:45:50` local |
| SHA256 | `C934C0E5E391EC348BC08E75039A3E3303D5605D46C7D51BDF83B88868CB4A1E` |

## Binary Backup

The executable is intentionally not committed to normal Git history because it is a 373 MB generated binary.

Local backup path:

```text
C:\KriticalSCX\restore-points\2026-07-09-scxcodex-working\Kritical.SCXCodex.exe
```

Local manifest path:

```text
C:\KriticalSCX\restore-points\2026-07-09-scxcodex-working\restore-point.manifest.json
```

If this restore point needs to become portable outside Joshua's workstation, publish the binary as a private GitHub Release artifact or move it into a private artifact store. Do not add the executable to normal Git history.

## Restore Procedure

1. Stop any non-working `Kritical.SCXCodex.exe` process.
2. Copy the backed-up executable over the installed runtime:

   ```powershell
   Copy-Item `
     -LiteralPath 'C:\KriticalSCX\restore-points\2026-07-09-scxcodex-working\Kritical.SCXCodex.exe' `
     -Destination 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe' `
     -Force
   ```

3. Re-check the hash:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\KriticalSCX\dist\Kritical.SCXCodex\bin\Kritical.SCXCodex.exe'
   ```

4. Confirm the hash equals:

   ```text
   C934C0E5E391EC348BC08E75039A3E3303D5605D46C7D51BDF83B88868CB4A1E
   ```

5. Start the runtime normally.

## Companion AgenticDevelopment State

This SCX Codex runtime is now paired with the separate `Kritical.AgenticDevelopment` lane. That sister repo owns:

- provider selection wrappers for OpenRouter, NVIDIA, and Mistral
- localhost-only Responses shims for providers that do not natively match Codex Responses semantics
- provider API/model mining via OpenAPI/model catalogs
- per-process Codex model metadata overrides
- overlay-pack installation into other repos
- proof scripts that test provider access and tool-call flow without touching native Claude, Claude Code, ChatGPT, Codex, OpenAI, or Anthropic config

The SCX lane and AgenticDevelopment lane are intentionally additive. Either can be disabled without breaking the other or the native tools.

## Current Working Claims

At the time this restore point was recorded:

- `Kritical.SCXCodex.exe` was running from the installed `C:\KriticalSCX\dist` path.
- NVIDIA Codex tool flow had been proven through a localhost Responses shim.
- OpenRouter Codex provider launch had been proven with explicit model metadata.
- Mistral direct and Codex shims existed, but the currently loaded Mistral key returned `401 Unauthorized`; treat Mistral as wired but key-blocked until replaced.
- Native Claude, Claude Code, ChatGPT, Codex, OpenAI, and Anthropic keys/config were not modified.

(c) 2026 Kritical Pty Ltd. All rights reserved.
