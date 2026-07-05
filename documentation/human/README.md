# documentation/human/ — canonical human-conversation store

Per HARD RULE 27 in [../../CLAUDE.md](../../CLAUDE.md) (Kritical.SCXCode-scoped). Every prompt / decision / context / direction from the operator lands here as JSONL, append-only, SHA+SimHash deduped.

## Layout

```
documentation/human/
├── README.md                              # this file
├── <yyyy-mm-dd>/
│   ├── prompt.jsonl                       # raw operator prompts (verbatim)
│   ├── decision.jsonl                     # explicit decisions ("do X, not Y")
│   ├── context.jsonl                      # background / explanation the operator provided
│   └── direction.jsonl                    # forward direction / strategic asks
└── _ARCHIVED-<utc>/                       # rows ≥ 90 days rotated here (NEVER deleted per HR23)
```

Categories are hints, not walls — the same message can flow into `prompt` + `direction` when it mixes both. The logger dedups by content, not category.

## Schema

Every row is one JSON object per line (JSONL):

```json
{
  "id": "h-8fa3c2e1",
  "ts_utc": "2026-07-04T12:34:56.789Z",
  "side": "human",
  "category": "prompt",
  "wave": ".5182",
  "session_id": "sess-2026-07-04-scxcode-review",
  "content_sha256": "9c56...ff02",
  "simhash": "1010110101...",
  "content_len": 4210,
  "content_preview_120": "make sure we document any and all information, add to top of claude.md to ensure that project documentation always has hu",
  "content": "<full raw text — verbatim including profanity per HR27 §7>",
  "source": "backfill",
  "dup_of": null,
  "occurrence_count": 1
}
```

Fields:

| Field | Meaning |
|---|---|
| `id` | Short 8-char prefix of `content_sha256`, prefixed `h-` for human / `a-` for ai. |
| `ts_utc` | ISO-8601 UTC. When the human sent it (or when backfilled if unknown). |
| `side` | Always `"human"` in this folder. |
| `category` | `prompt` / `decision` / `context` / `direction`. |
| `wave` | Kritical wave tag (`.5182` etc). Blank if unknown. |
| `session_id` | Short slug for the conversation/session. |
| `content_sha256` | Exact-dupe key. First 4 hex chars appear in `id`. |
| `simhash` | 64-bit binary string for near-dupe (Hamming distance). |
| `content_len` | Character count of full content. |
| `content_preview_120` | First 120 chars for quick scan without loading full row. |
| `content` | Full raw text. Verbatim including profanity — this store is internal-only per HR27 §7. |
| `source` | `vscode-extension` / `manual` / `backfill` / `scx-code-agent`. |
| `dup_of` | If SimHash flagged this row as a near-dupe, the `id` of the earlier row it duplicates. |
| `occurrence_count` | Incremented on exact-dupe hit (row is NOT rewritten; the existing row's counter increments in a sidecar `.counters.json`). |

## Writing rows

**Simple (default JSONL only)**:

```powershell
Import-Module scripts/lib/KriticalDecisionLogger.psm1 -Force
Add-KriticalHumanPrompt -Content "the operator's raw text" -Category prompt -Wave .5182
```

**Emit to both JSONL + SQL Express `KriticalBrain.dbo.decision_log`**:

```powershell
Add-KriticalHumanPrompt -Content "..." -Category decision -EmitToDb
# OR set globally:
$env:KRITICAL_LOGGER_TARGET = 'both'
Add-KriticalHumanPrompt -Content "..." -Category decision
```

**Backfill an existing conversation transcript**:

```powershell
Import-KriticalConversationBackfill -TranscriptPath ./somewhere/session-log.txt -SessionId sess-name -Wave .5182
```

## Reading rows

```powershell
# Every row for today
Get-KriticalDecisionLog -Date 2026-07-04 -Side human

# Search
Get-KriticalDecisionLog -ContainsText "scxcode" -DaysBack 30

# Find by content hash
Find-KriticalDecisionByHash -Sha256 9c56ff02...
```

## Dedup behaviour

1. On write, module computes `content_sha256` + `simhash`.
2. If exact `content_sha256` already exists in today's JSONL OR the last 7 days of JSONL, the module SKIPS the write and increments `occurrence_count` in the sidecar `.counters.json`.
3. If a near-dupe (SimHash Hamming distance ≤ 3) is found, the module APPENDS the new row anyway (near-dupes preserve intent) but sets `dup_of` to the earlier row's `id`.
4. Nothing is ever deleted or overwritten.

## Rotation (HR23-compliant — NEVER delete)

Rows with `ts_utc` older than 90 days are moved to `_ARCHIVED-<utc>/<yyyy-mm-dd>/*.jsonl` on the next `Sync-KriticalDecisionLogToKriticalBrain` call. The archived tree is still queryable via `Get-KriticalDecisionLog -IncludeArchived`.

## SQL Express ingest

Schema: [scripts/db/decision_log_schema.sql](../../src-db/decision_log_schema.sql).

Sync JSONL → SQL:

```powershell
Sync-KriticalDecisionLogToKriticalBrain -Since '2026-07-01'
```

Upserts by `content_sha256`. Idempotent. Re-syncing the same JSONL is a no-op.

## Cross-links

- Companion AI-side store: [documentation/ai/README.md](../ai/README.md)
- Module: [scripts/lib/KriticalDecisionLogger.psm1](../../ps-module/KriticalDecisionLogger.psm1)
- Paired test: [scripts/audits/Test-KriticalDecisionLogger.ps1](../../tests/Test-KriticalDecisionLogger.ps1)
- SQL schema: [scripts/db/decision_log_schema.sql](../../src-db/decision_log_schema.sql)
- Rule: HARD RULE 27 in [CLAUDE.md](../../CLAUDE.md).
