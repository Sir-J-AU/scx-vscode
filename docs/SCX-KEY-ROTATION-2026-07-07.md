# SCX Key Rotation - 2026-07-07

Snapshot time: `2026-07-07T19:25:00+10:00`

This record intentionally contains no API key values.

## Result

- Primary User-scope environment variable `SCX_API_KEY` now matches the new Joshua Finley / Kritical key file.
- User-scope `SCX_API_KEY_2` was cleared so the stale secondary key is no longer used by rotation-aware tooling.
- New key fingerprint for verification only: SHA256 prefix `eb71cb12ef63c8fd`, length `39`.

## Secret Files

| Purpose | Path |
|---|---|
| New raw key file | `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\scx.ai-apikey-Joshua Finley - Kritical - 07-07-2026.txt` |
| Pre-rotation copy of new raw key file | `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\scx.ai-apikey-Joshua Finley - Kritical - 07-07-2026.txt.bak-before-env-rotate-20260707-191510` |
| Labelled old-key backup JSON | `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\scx.ai-apikey-rotation-backup-20260707-191510.json` |

The labelled backup JSON contains the old key values and stays outside git. Labels used:

- `SCX_API_KEY`: `ben szypowski-preJuly2026-working`
- `SCX_API_KEY_2`: `JoshOldKey-Unknown state`

## Loader / DR Updates

| Item | Status |
|---|---|
| `Load-KriticalSecrets.ps1` | Updated to map `SCX_API_KEY` from `scx.ai-apikey-Joshua Finley - Kritical - *.txt` |
| Josh-only loader copy | `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos-JoshONLY\Load-KriticalSecrets.ps1` |
| DR loader copy | `C:\Users\joshl\OneDrive - Kritical Pty Ltd\disaster recovery\Kritical-Secrets-Loader\Load-KriticalSecrets.ps1` |
| Board stale helper | Moved from active `BOARD` root to `C:\Users\joshl\OneDrive - Kritical Pty Ltd\BOARD\_ARCHIVED-20260707-192250-secret-helper\Update-PaxSecretsFromTemplate.ps1` |

Loader smoke from the Josh-only folder returned:

- `SCX_API_KEY`: `set`
- `KRITICAL_SECRETS_ROOT`: set to the Josh-only secrets folder
- `SCX_ANTHROPIC_COMPATIBLE_API_KEY`: `missing` in Josh-only folder, expected because that legacy file lives in the shared outside-git secrets folder

## Hardcoded-Key Scan

Exact-value scan across these repos found no hardcoded copies of the new or backed-up SCX keys:

- `Kritical.SCXCode`
- `Kritical.AISupervisor.NodeJS`
- `Kritical.AISupervisor.PS`
- `Kritical.PS.OmniFramework`
- `Kritical.PS.Toolkit`
- `Kritical-ManagementScripts`

Variable-name scan found one sister reference:

- `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github\Kritical.AISupervisor.NodeJS\src\server.js`: UI text says SCX native mode uses HKCU `SCX_API_KEY`; this is correct and should remain.

Known outside-git secret-vault copies found:

| File | Fingerprint | Meaning |
|---|---|---|
| `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos\scx-benApiKey-07022026-v001.txt` | `5f972268eb8d6e9e` | Matches backed-up `ben szypowski-preJuly2026-working` |
| `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos\scx-previousApiKeyPreBenSwitch-07022026-v001.txt` | `6a2a332a89f6cb7a` | Matches backed-up `JoshOldKey-Unknown state` |
| `C:\Users\joshl\OneDrive - Kritical Pty Ltd\Github-SecretsOutsideOfGitRepos\scx-anthropicCompatible-apiKey-06162026-v001.txt` | `0d4d42c17f602e22` | Legacy anthropic-compatible SCX material; not installed into `SCX_API_KEY` |

These are expected secret-store files, not committed repo content.

## Live Proof After Rotation

With `SCX_API_KEY` set from the rotated User-scope value:

- `/models`: 12 live models returned.
- `/batches`: 200 with empty list.
- `/vector-stores`: 200 with empty list.
- `/chat/completions`, `/responses`, `/embeddings`: still return `429 Daily token limit exceeded`.

Conclusion: the new key is accepted for authenticated reads, but generation is still gated by account/project/day quota or budget state.
