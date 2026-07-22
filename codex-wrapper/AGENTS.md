
## SCX platform API docs (authoritative)
- **https://platform.scx.ai/docs** — the full SCX API reference. When building/using
  any SCX call (chat/completions, responses, models, embeddings, audio, moderation),
  consult this. SCX is reached with **SCX_API_KEY only** (Bearer) at
  `https://api.scx.ai/v1` — NEVER OPENAI_/ANTHROPIC_ creds. Agentic path = kcodex
  (`kritical-codex.ps1` -> `scx-agentic-shim.mjs` :4199, provider=scx).
- **https://platform.scx.ai/docs/guides/batches** — SCX Batch API. Use for BULK/async
  offload (cheaper, higher throughput than per-request) — mass mining, codegen,
  doc-extraction over many files. Prefer batches for large fan-outs on SCX.
