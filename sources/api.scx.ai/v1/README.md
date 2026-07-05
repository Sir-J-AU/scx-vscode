# api.scx.ai/v1 — authoritative API captures

Source of truth **wins over marketing** any time the two disagree.

## What's captured here

| File | Endpoint | Notes |
|---|---|---|
| [models.json](models.json) | `GET /v1/models` | Live API response, ben key, captured 2026-07-04 |

## Model-list authoritative answer (`.5182`)

**12 models** returned. **NOT paginated** — envelope has no `has_more`, no `next_page`, no cursor. `?limit=100` returns the same 12. This is the full list Ben's key can hit.

```
MiniMax-M2.7         ← default coding model (matches GPT-5.3-Codex, 56.2% SWE-Bench Pro)
gpt-oss-120b         ← 655 t/s fastest reasoning
DeepSeek-V3.1        ← 671B hybrid thinking/non-thinking
Meta-Llama-3.3-70B-Instruct
gemma-4-31B-it       ← Google Gemma-4, NOT on marketing /models page
Qwen3-32B
Llama-4-Maverick-17B-128E-Instruct   ← multimodal
MAGPiE               ← SCX's Australian-context tune
coder                ← SCX's dedicated code model
E5-Mistral-7B-Instruct   ← embeddings
Whisper-Large-v3          ← speech/transcription
opir-large                ← moderation
```

## Discrepancies vs the marketing /models page

Marketing shows 15, API returns 12. The 5 extra marketing models are either restricted to a higher tier, deprecated, or "coming soon":

| Marketing shows | API? |
|---|---|
| DeepSeek-R1-0528 | not on ben key |
| DeepSeek-V3.1-Terminus | not on ben key |
| DeepSeek-V3-0324 | not on ben key |
| Qwen3-235B | not on ben key |
| Meta-Llama-3.1-8B-Instruct | not on ben key |

And 1 missing from marketing but present in API:

| API has | Marketing? |
|---|---|
| gemma-4-31B-it | not listed |

## MiniMax-M2.5 — stale marketing copy

The homepage code sample references `model="MiniMax-M2.5"` but this ID does **NOT** exist in the API. Only **M2.7** is current. This is outdated marketing text on scx.ai/. Do not use M2.5 as a model ID in code or config.

## Rate limits

Ben's key headers report `x-ratelimit-*: unlimited` across all axes (RPM, TPM, TPD). Partner-tier badge.

## Programmatic access from any Kritical surface

```powershell
# PS
Get-KritScxModels -Refresh    # already in Kritical.PS.SCXCode.psm1
```

```javascript
// Node/TS
const models = await fetch("https://api.scx.ai/v1/models", {
  headers: { Authorization: `Bearer ${process.env.SCX_API_KEY}` }
}).then(r => r.json());
```

```bash
# curl
curl -H "Authorization: Bearer $SCX_API_KEY" https://api.scx.ai/v1/models | jq '.data[].id'
```

## Do not hardcode

Model IDs, fallback chains, capability flags — always fetched dynamically. If the API adds a new model tomorrow, Kritical.SCXCode / Kritical.SCX.LiteLLM / Kritical.NodeJS.SCXCodeAgent should pick it up on next refresh without a code change.
