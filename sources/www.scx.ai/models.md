# scx.ai/models — full catalogue (captured 2026-07-04)

Source: `https://scx.ai/models`
15 models — native, unquantized open-source, running onshore with sovereign data guarantees.

Filter axes on page: All / Language (13) / Embedding (1) / Audio (1).

## Language models (13)

| Model | Provider | Context | Precision | Throughput | Features | Notes |
|---|---|---|---|---|---|---|
| **MiniMax-M2.7** | MiniMax | 192k | FP8 | 399 t/s | Tools, JSON | 230B MoE (10B active, 256 experts). Software engineering + agentic. **56.2% SWE-Bench Pro** (matches GPT-5.3-Codex). |
| **scx.ai: coder** | scx.ai | 192k | FP8 | — | Tools, JSON | High-performance coding assistant with reasoning. Algorithms, debugging, code review. |
| **DeepSeek-R1-0528** | DeepSeek | 128k | BF16 | 116 t/s | Tools, Reasoning | 671B MoE reasoning (37B active). RL-trained chain-of-thought. Math, code, science. |
| **DeepSeek-V3.1** | DeepSeek | 128k | BF16 | 200 t/s | Tools, Reasoning, JSON | 671B MoE (37B active). Hybrid thinking/non-thinking. Tool use. |
| **DeepSeek-V3.1-Terminus** | DeepSeek | 128k | BF16 | 117 t/s | Tools, Reasoning, JSON | Refined V3.1 variant. Improved agent stability + language consistency + reliable tool coordination. |
| **gpt-oss-120b** | OpenAI | 128k | MXFP4 | 655 t/s | Tools, Reasoning, JSON | 117B open-weight MoE (5.1B active). Near o4-mini reasoning. |
| **scx.ai: MAGPiE** | scx.ai | 128k | FP8 | — | Tools, Reasoning, JSON | 117B MoE fine-tuned for Australian context with sovereign data handling. |
| **Llama-4-Maverick-17B-128E-Instruct** | Meta | 128k | BF16 | 642 t/s | Tools, JSON, Vision | 400B MoE (17B active, 128 experts). Native multimodal early fusion. 12 languages + images. |
| **DeepSeek-V3-0324** | DeepSeek | 128k | BF16 | 185 t/s | Tools, Reasoning, JSON | 685B MoE. Multi-head Latent Attention for fast inference. Coding + math. |
| **Qwen3-32B** | Alibaba | 32k | BF16 | 319 t/s | Tools, Reasoning, JSON | 32B dense matching Qwen2.5-72B. 119 languages. Thinking mode toggle. |
| **Qwen3-235B** | Alibaba | 32k | BF16 | 150 t/s | Tools, Reasoning, JSON | 235B MoE flagship. Seamless thinking/non-thinking mode switching. 119 languages. |
| **Meta-Llama-3.1-8B-Instruct** | Meta | 16k | BF16 | 632 t/s | Tools, JSON | Efficient 8B. Low-latency multilingual. |
| **Meta-Llama-3.3-70B-Instruct** | Meta | 128k | BF16 | 279 t/s | Tools, JSON | 70B delivering 405B-class text performance. GQA. |

## Embedding model (1)

| Model | Provider | Context | Precision | Notes |
|---|---|---|---|---|
| **E5-Mistral-7B-Instruct** | Mistral | 32k | FP16 | 7B embedding based on Mistral. **4096-dim vectors** for semantic search + retrieval. |

## Audio model (1)

| Model | Provider | Context | Precision | Notes |
|---|---|---|---|---|
| **Whisper-Large-v3** | OpenAI | 4k | FP16 | Multilingual ASR. 99+ languages. Transcription + translation. |

## SCX-native models (in-house) — Kritical positioning

These two are SCX's own — the differentiator for a sovereign-Australian pitch:

- **scx.ai: coder** — perfect model for the Kritical.SCXCode default coding surface. FP8, 192k context, tools + JSON.
- **scx.ai: MAGPiE** — Australian-context-tuned, sovereign data handling. Perfect co-branded "AU-tuned" positioning for Kritical customers.

## Programmatic model discovery

Do NOT hardcode this list. It's dynamic. Fetch from:

```bash
curl -H "Authorization: Bearer $SCX_API_KEY" https://api.scx.ai/v1/models
```

The Kritical.PS.SCXCode `Get-KritScxModels` function already does this — call it at extension / bridge startup to populate the model picker.

## Kritical.SCX.LiteLLM fallback-chain candidates (default recommendation)

Given SWE-Bench Pro scores + throughput + reasoning support:

1. **MiniMax-M2.7** (default — best code + agentic)
2. **scx.ai: coder** (equal-tier code fallback)
3. **gpt-oss-120b** (fastest reasoning fallback, 655 t/s)
4. **DeepSeek-V3.1-Terminus** (agent stability variant)
5. **MAGPiE** (Australian-context fallback for AU-scoped queries)

`SCX_API_KEY_2..9` HKCU rotation applies to each — auto-swap on 429/5xx per `Switch-KritScxKey` (existing).
