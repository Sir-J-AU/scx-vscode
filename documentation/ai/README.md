# documentation/ai/ — canonical AI-response store

Per HARD RULE 27 in [../../CLAUDE.md](../../CLAUDE.md) (Kritical.SCXCode-scoped). Every AI response (Claude / SCX / Codex / Gemini / any provider) lands here as JSONL, append-only, SHA+SimHash deduped.

## Layout

```
documentation/ai/
├── README.md                              # this file
├── <yyyy-mm-dd>/
│   ├── response.jsonl                     # full text AI responses
│   ├── action.jsonl                       # tool calls / file edits / bash runs
│   └── commit.jsonl                       # git commit messages authored by AI
└── _ARCHIVED-<utc>/                       # rows ≥ 90 days rotated here (NEVER deleted per HR23)
```

## Schema

Same shape as `documentation/human/README.md` §Schema, with these additional fields:

| Field | Meaning |
|---|---|
| `model` | e.g. `claude-opus-4-7[1m]` / `scx-minimax-m27` / `gpt-5-codex` / `gemini-2.5-pro`. |
| `provider` | `claude-code` / `scx` / `openai` / `google` / `ollama` / etc. |
| `tokens_in` | Approx. input token count (per model's tokenizer). |
| `tokens_out` | Approx. output token count. |
| `tool_calls` | Array of `{name, arg_hash}` when the response invoked tools. |

## Writing rows

```powershell
Import-Module ./ps-module/KriticalDecisionLogger.psm1 -Force
Add-KriticalAIResponse -Content "the AI's response text" -Category response `
    -Model 'claude-opus-4-7[1m]' -Provider 'claude-code' -Wave .5182
```

## Reading + dedup + rotation

Same behaviour as human-side. See [documentation/human/README.md](../human/README.md) for the full lifecycle.

## Feeds SCXCode

`Kritical.NodeJS.SCXCodeAgent` (queued sister) will read both `documentation/human/*.jsonl` + `documentation/ai/*.jsonl` at session boot to reconstruct prior conversation context — the primary mechanism for the synthetic mega-context-window that motivated HR27.

## Cross-links

- Companion human-side store: [documentation/human/README.md](../human/README.md)
- Module: [ps-module/KriticalDecisionLogger.psm1](../../ps-module/KriticalDecisionLogger.psm1)
- Rule: HARD RULE 27 in [../../CLAUDE.md](../../CLAUDE.md).
