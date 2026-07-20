# SCX Mux + Model Benchmark — Under-the-Bonnet Reference (.5231)

Empirically measured via `mux/Invoke-KritScxModelBench.mjs` (runnable: it hits SCX live, computes TRUE cost
from the per-token pricing in `sources/api.scx.ai/v1/models.json`, and compares outputs head-to-head).
HR1: reads SCX_API_KEY only.

## 1. SCX surface (3 wire shapes, one key)
- `POST /v1/chat/completions` (OpenAI shape) — default for the mux + this bench.
- `POST /v1/messages` (Anthropic shape).
- `POST /v1/responses` (OpenAI Responses).
Same SCX_API_KEY for all. Over-budget = HARD HTTP 400 (never silent truncation) — size payloads to the LIVE ceiling.

## 2. Live pricing + projected agentic-turn cost (prompt-heavy 20k prompt / 1k completion)
| Model | ctx | prompt $/M | compl $/M | ~cost/agentic-turn (20k+1k) |
|---|---|---|---|---|
| E5-Mistral-7B-Instruct | 32k | 0.20 | 0.00 | $0.0040 |
| gpt-oss-120b | 131k | 0.30 | 0.98 | $0.0070 |
| gemma-4-31B-it | 131k | 0.54 | 1.63 | $0.0124 |
| Qwen3-32B | 32k | 0.65 | 1.55 | $0.0146 |
| MAGPiE | 131k | 0.75 | 1.75 | $0.0168 |
| MiniMax-M2.7 | 192k | 0.68 | 3.20 | $0.0168 |
| coder | 196k | 0.85 | 3.75 | $0.0208 |
| Meta-Llama-3.3-70B-Instruct | 131k | 0.95 | 1.95 | $0.0209 |
| Llama-4-Maverick-17B-128E-Instruct | 131k | 0.95 | 2.90 | $0.0219 |
| DeepSeek-V3.1 | 131k | 4.50 | 7.25 | $0.0973 |

> The single biggest mux lever: **DeepSeek-V3.1 is ~8x the cost of gemma-4 and ~14x gpt-oss for a prompt-heavy
> agentic turn** — its per-token price dwarfs its low token count. Do NOT route big-context agentic coding to DeepSeek.
> (E5-Mistral is an embedding model; opir = moderation; Whisper = audio — not for code generation.)

## 3. Benchmark run — code-gen micro-task (slugify), max_tokens=700, functionally tested
| Model | latency | cost | correctness | content? |
|---|---|---|---|---|
| gemma-4-31B-it | 1103ms | $0.000121 | 4/4 PERFECT | yes |
| DeepSeek-V3.1 | 984ms | $0.000594 | 4/4 PERFECT | yes (fastest) |
| MiniMax-M2.7 | 1600ms | $0.001695 | 4/4 PERFECT | yes (reasoned needlessly) |
| gpt-oss-120b | 1155ms | $0.000726 | UNUSABLE | REASONING-ONLY (emitted no content at 700 tok) |

**Winner for small direct code-gen: gemma-4-31B-it** — correct, cheapest by ~5x, reliably emits content.

## 4. Per-model behaviour (the gotchas that bite)
- **Reasoning models (gpt-oss-120b, MiniMax-M2.7)** put the answer in `reasoning_content` and burn tokens there first. gpt-oss at max_tokens=700 produced **empty `content`** (finish=length) — it needs **>=~2000 max_tokens** or you get nothing. Always read `content`, fall back to `reasoning_content`.
- **Direct models (DeepSeek-V3.1, gemma-4, Qwen3, Llama)** emit straight to `content`, reasoning_tokens=0 — predictable, no fallback needed.
- **Proven real ceilings** (usable, not advertised): DeepSeek ~129k, MiniMax ~195k (beats advertised 192k), gpt-oss ~107,842 (below advertised 131k). coder advertises 196k.

## 5. Routing recommendation matrix (what / when / why)
| Task | Use | Why |
|---|---|---|
| Small direct code-gen / edits | **gemma-4-31B-it** | cheapest correct, direct content, fast |
| Bulk structured extraction (script audit, field mining) | **gpt-oss-120b** (max_tokens>=2500) OR gemma-4 | cheapest prompt $/M; gpt-oss needs big max_tokens or it returns reasoning-only |
| Reasoning-heavy synthesis / adversarial cross-check | **MiniMax-M2.7** | 195k ceiling + genuine reasoning; reserve for where reasoning earns its cost |
| Huge-context (single massive file/corpus) | **coder (197k)** or **MiniMax (195k)** | largest real ceilings |
| Anything prompt-heavy + high-volume | **NOT DeepSeek** | 8-14x cost for prompt-heavy turns |
| Embeddings | E5-Mistral-7B | dedicated embedding model |
| Ensemble consensus | gemma/gpt-oss first pass -> MiniMax re-checks only flagged items | cheapest path to a verified answer |

## 6. Run it (both directions / head-to-head)
```bash
SCX_API_KEY=... node mux/Invoke-KritScxModelBench.mjs   --models gemma-4-31B-it,gpt-oss-120b,MiniMax-M2.7,DeepSeek-V3.1 --maxTokens 700 --out bench.json
# custom task: --task ./mux/bench-tasks/<file>.txt
```
Pass any N models to compare in one run; outputs + cost + latency are emitted side-by-side and the raw JSON is written for diffing. Pricing auto-loads from models.json so the cost column stays live.

_Measured 2026-07-06. Regenerate any time by re-running the harness. Kritical Pty Ltd (c) 2026._

## 7. gpt-oss-120b tuning (measured 2026-07-06)
gpt-oss's reasoning burn is VARIABLE (~400-700 tokens) and non-deterministic. At `max_tokens=700` it
sometimes exceeds the cap and returns `finish=length` with **empty `content`** (reasoning-only, unusable);
other runs it squeaks in ~60 tokens of content. At **`max_tokens >= 2500`** it reliably leaves headroom and
emits content every run (reasoning ~410-420 + answer). Cost can even DROP at the higher cap because it
happens to reason less. **Rule: never run gpt-oss below ~2500 max_tokens** — the margin over its variable
reasoning is what guarantees output, not a tight budget. Always read `content`, fall back to
`reasoning_content` if empty.

| max_tokens | completion | reasoning | content? | cost |
|---|---|---|---|---|
| 700 | 612 | 549 | borderline (0 in an earlier run) | $0.000640 |
| 2500 | 470 | 411 | yes (reliable) | $0.000501 |
| 4000 | 477 | 422 | yes (reliable) | $0.000508 |

## 8. Parallel gemma wave — proven pattern (Opus-gated)
gemma-4-31B-it fired at 4 pure helpers CONCURRENTLY -> 13 [Test] procs for **$0.0022 total**. Opus lensed each
assertion vs the real body: gemma nailed deterministic string logic but got **3/13 BC-Format assertions wrong**
(misread `Precision,2:5` = max-5-decimals and `Precision,0:0` = integer). Corrected + compile-gated (683-file
exit 0). Pattern: cheap model floods drafts in parallel; Opus verifies every line + fixes fines; only
compile-gated output lands. Cost of the whole verified wave: ~1/5 of a cent.
