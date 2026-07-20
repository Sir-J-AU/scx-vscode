# SCX per-model BEHAVIORAL probe — structured-output task (.5187)

> The empirical companion to PROVIDERS.md's static catalog. Same known-answer structured-JSON task
> (an AL proc whose comment says 'product' but code sums — objectively comments_match_code=false)
> run across every chat model. This is what the catalog's 'json_mode' feature flag does NOT tell
> you: whether the model actually emits usable JSON, how much of the output budget its reasoning
> eats, and whether it gets the objectively-correct verdict. (Correctness is scored only on the
> unambiguous comments_match_code dimension — `hollow` is a subjective judgment and NOT scored.)
> Stored in `KriticalSCXCodeStore.dbo.LensScxModelProbe`; refresh via `lens/Invoke-KritScxModelBehaviorProbe.py`.

| Model | ok | latency | reasoning tok | valid JSON | correct | verdict for structured tasks |
|---|---|---:|---:|---|---|---|
| **MiniMax-M2.7** | ✓ | 1.0s | 185 | ✓ | ✓ | reliable |
| **MAGPiE** | ✓ | 0.5s | 145 | ✓ | ✓ | reliable |
| **gpt-oss-120b** | ✓ | 0.5s | 145 | ✓ | ✓ | reliable |
| **DeepSeek-V3.1** | ✓ | 0.9s | 0 | ✓ | ✓ | reliable |
| **Meta-Llama-3.3-70B-Instruct** | ✓ | 0.9s | 0 | ✓ | ✓ | reliable |
| **gemma-4-31B-it** | ✓ | 1.1s | 0 | ✓ | ✓ | reliable |
| **Qwen3-32B** | ✓ | 1.1s | 0 | ✓ | ✓ | reliable |
| **Llama-4-Maverick-17B-128E-Instruct** | ✓ | 1.1s | 0 | ✓ | ✓ | reliable |
| **coder** | ✓ | 0.7s | 58 | ✓ | ✓ | reliable |

## Load-bearing findings (fold into the mux prompting/routing rules)

**All 9 chat models emit valid JSON and get the objectively-correct verdict on this task** — so
'json_mode capable' is real. The differentiator is REASONING OVERHEAD, and it's the whole story
behind the gpt-oss silent-skip this session hit:

- **Zero-reasoning-token models** (safest for structured output under a tight `max_tokens`): `DeepSeek-V3.1`, `Meta-Llama-3.3-70B-Instruct`, `gemma-4-31B-it`, `Qwen3-32B`, `Llama-4-Maverick-17B-128E-Instruct`. These emit the JSON directly
  with no thinking budget consumed — they will NOT silently return empty even on a small output cap.
- **Reasoning models** (thinking tokens count against `max_tokens`): `MiniMax-M2.7`=185, `MAGPiE`=145, `gpt-oss-120b`=145, `coder`=58. On a tiny task the overhead is ~58-185 tokens,
  but it SCALES WITH INPUT COMPLEXITY — on a 45k-char AL file it can exceed a 500-token cap and
  return empty (exactly the gpt-oss skip this session hit before max_tokens was raised to 1400).

**Routing rule for the mux**: for bounded structured-extraction (comment-eval, classification,
JSON tagging) prefer a zero-reasoning model OR give a reasoning model output headroom of
`reasoning_overhead x input-complexity-factor + json_size`. Reserve the heavy reasoners
(MiniMax/coder/MAGPiE) for open-ended analysis where the thinking IS the deliverable.

- Refresh this probe whenever the SCX roster or key/tier changes — behavior is not guaranteed
  stable across model version bumps.