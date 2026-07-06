# SCX providers — full catalog (verified live 2026-07-03)

Probed via `GET https://api.scx.ai/v1/models` with Ben SCX key. All prices in AUD.

> **This is the STATIC catalog** (context/pricing/features as the API reports them). For the
> **empirical BEHAVIORAL companion** — how each model actually performs on a real structured-output
> task (reasoning-token overhead, JSON reliability, correctness, and the routing rule for which model
> to use when) — see [SCX-MODEL-BEHAVIOR-PROBE.md](SCX-MODEL-BEHAVIOR-PROBE.md) (`.5187`, refresh via
> `lens/Invoke-KritScxModelBehaviorProbe.py`). Key finding: the 'json_mode' flag below does not tell
> you that reasoning-mode models (MiniMax/coder/MAGPiE/gpt-oss) consume output budget on thinking that
> scales with input size — under a tight `max_tokens` they can silently return empty on large inputs,
> while the zero-reasoning models (DeepSeek/Llama/gemma/Qwen) are the safe pick for bounded extraction.

## Chat / instruct models

| Model | Context | Max out | AUD/1M in | AUD/1M out | HF ID | Datacenters | Features | Notes |
|---|---:|---:|---:|---:|---|---|---|---|
| **MiniMax-M2.7** | 192,000 | 4,096 | 0.68 | 3.20 | MiniMaxAI/MiniMax-M2.7 | US, AU | tools · reasoning · json_mode | 230B sparse MoE (10B active, 256 experts). **Default for agentic workflows**. Live-verified 200 OK on Ben key. |
| **MAGPiE** | 131,072 | 131,072 | 0.75 | 1.75 | (scx.ai native) | AU | tools · reasoning · json_mode | 117B MoE from scx.ai. Near o4-mini reasoning. Full context both in AND out. |
| **gpt-oss-120b** | 131,072 | 131,072 | 0.30 | 0.98 | openai/gpt-oss-120b | AU | tools · reasoning · json_mode | 117B open-weight MoE (5.1B active). Cheapest reasoner. **Value pick**. |
| **DeepSeek-V3.1** | 131,072 | 7,168 | 4.50 | 7.25 | deepseek-ai/DeepSeek-V3.1 | US | tools · reasoning · json_mode | 671B MoE (37B active). Hybrid thinking mode. **Reserve for hardest problems** — most expensive. |
| **Meta-Llama-3.3-70B-Instruct** | 131,072 | 3,072 | 0.95 | 1.95 | meta-llama/Llama-3.3-70B-Instruct | US | tools · json_mode | 70B → 405B-class performance. |
| **gemma-4-31B-it** | 131,072 | 8,192 | 0.54 | 1.63 | google/gemma-4-31B-it | US, AU | tools · reasoning · json_mode | Multimodal (text + image in), 140+ languages, thinking-mode toggle. |
| **Qwen3-32B** | 32,768 | 4,096 | 0.65 | 1.55 | Qwen/Qwen3-32B | AU | tools · reasoning · json_mode | 32B dense, 119 languages, matches Qwen2.5-72B. |
| **Llama-4-Maverick-17B-128E** | 131,072 | 4,096 | 0.95 | 2.90 | meta-llama/Llama-4-Maverick-17B-128E-Instruct | AU | tools · json_mode | 400B MoE (17B active, 128 experts). **Multimodal (text + image)**. |
| **coder** | 196,608 | 4,096 | 0.85 | 3.75 | (scx.ai native) | AU | tools · reasoning · json_mode | **Highest context** (192K in). Optimized for algorithms / debugging / code review. Good autocomplete pick. |

## Non-chat models

| Model | Purpose | Modalities | AUD | Notes |
|---|---|---|---|---|
| **E5-Mistral-7B-Instruct** | Embeddings | text → 4096-dim vector | 0.20 / 1M in (output free) | Mistral-7B fine-tune for semantic search. `output_modalities: ['embeddings']`. |
| **Whisper-Large-v3** | ASR (speech → text) | audio → text | 0.20 / minute | OpenAI multilingual, 99+ languages. |
| **opir-large** | Content moderation | text → moderation | 0.002 / request | Encoder guardrail classifier. Kritical safety layer. |

## Anthropic-shape compatibility

SCX accepts the Anthropic Messages API shape at `POST /v1/messages` with header
`anthropic-version: 2023-06-01`. Any client that speaks Anthropic can point at
`https://api.scx.ai` with `x-api-key: <SCX_API_KEY>` — no code changes.

**Verified live** (2026-07-03):

```bash
curl -X POST https://api.scx.ai/v1/messages \
  -H "x-api-key: $SCX_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"MiniMax-M2.7","max_tokens":50,"messages":[{"role":"user","content":"reply just OK"}]}'
```

Response (HTTP 200):

```json
{"id":"msg_...","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],"model":"MiniMax-M2.7","stop_reason":"end_turn","usage":{"input_tokens":41,"output_tokens":2}}
```

## Rate limits observed

Ben tier (verified 2026-07-03):
- **MiniMax-M2.7 / MAGPiE / gpt-oss-120b / coder** — reliable, 429s on daily-token-cap breach
- **DeepSeek-V3.1 / Meta-Llama-3.3-70B / Qwen3 / gemma-4 / Llama-4-Maverick** — occasional 429 tier-msg
- SCX daily token pool is SHARED across models. Watch aggregate usage.

## OpenAI-shape endpoint

SCX also exposes `/v1/chat/completions` (OpenAI shape). Continue can use this
via `provider: openai` with `apiBase: https://api.scx.ai/v1`. The Kritical
default config uses `provider: anthropic` for chat + `provider: openai` for
embeddings (E5-Mistral output modality is embeddings which fits OpenAI's
`/v1/embeddings` shape better).

## Model selection cheatsheet

| Need | Model |
|---|---|
| Default agentic / most tasks | MiniMax-M2.7 |
| Cheapest reasoning | gpt-oss-120b |
| Longest context (dev sessions) | coder (196K) OR MiniMax-M2.7 (192K) |
| Hardest problems (reserve) | DeepSeek-V3.1 |
| Multimodal (screenshot review) | Llama-4-Maverick-17B OR gemma-4-31B |
| Embeddings for RAG | E5-Mistral-7B-Instruct |
| Speech transcription | Whisper-Large-v3 |
| Content moderation | opir-large |
