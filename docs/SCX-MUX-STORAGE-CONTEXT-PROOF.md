# SCX Mux + Storage + Context — Proven (`.5231`)

> Live, parallel-agent proof (4 SCX agents fanned out, DeepSeek-V3.1 + gpt-oss-120b + MiniMax-M2.7).
> Every number here is a live probe against `api.scx.ai` + the stores, 2026-07-06. Reproduce via the
> workflow `scx-prove-mux-storage-context`.

## 1. Context ceilings — advertised vs REAL usable

Tested with a needle-recall check (unique sentence at the far end of a huge filler prompt, then asked to
recall it — proves the model actually read the whole window, not just accepted the bytes).

| Model | Advertised | Real usable (last OK) | First fail | Verdict |
|---|---|---|---|---|
| **DeepSeek-V3.1** | 131,072 | 129,300 | 131,322 | **Matches** — honors the full 131,072 total; needle recalled at every size |
| **MiniMax-M2.7** | 192,000 | 195,676 | 198,552 | **Exceeds** — real hard ceiling is **196,608**, not 192k |
| **gpt-oss-120b** | 131,072 | 107,842 | ~110,000 | **Below** — deployment caps input at **~108k**, under the advertised 131k |

Failures were **hard HTTP 400s**, not silent truncation or lost-in-the-middle — every accepted size
recalled the needle cleanly. **UI/injection rule:** cap synthetic-context injection per model at the REAL
usable ceiling (DeepSeek ~129k, MiniMax ~195k, gpt-oss ~108k) — the advertised number lies both ways.

## 2. Backing storage — which to ship

| Backend | Store | Retrieve | Speed | Tradeoff |
|---|---|---|---|---|
| **(A) SQL Server** `KriticalSCXCodeStore` (pyodbc/ODBC18/SQLEXPRESS) | ✅ 198 rows / ~1.16 MB (gzip) | ✅ `DECOMPRESS` | agg 61 ms · single 234 ms | heaviest; richest SQL; **not shippable** in an extension |
| **(B) Local SQLite** `node:sqlite` (`store-mcp/kritical-local-store.mjs`) | ✅ (now 125 files/327 sym) | ✅ | ~500 ms (Node cold-start bound) | **lightest + portable**; zero native deps; single `.db`; ships in the extension host |
| **(C) HR27 JSONL** (`documentation/**/*.jsonl`) | ✅ append-only, hashed | ❌ no index (linear scan) | instant append | git-auditable **journal**, not a query store |

**Default: (B) Local SQLite via `node:sqlite`** — the only backend that gives real indexed store+retrieve
*and* ships inside a VS Code extension with zero native/server deps (Node ≥ 22 built-in `DatabaseSync`,
one portable `.db`). Keep **(A)** as the server-side source of truth for heavy/concurrent SQL where it
exists; **(C)** as the durable, git-auditable log that *feeds* the ingest into (B).

## 3. Mux — multi-stream + synthetic context vs single-shot

**Proven, grounded in real code.** Retrieved **7,357 chars of actual shim source** from the store, fanned
out **4 parallel lens streams** (DeepSeek-V3.1: direct+security · gpt-oss-120b: edge-cases+architecture) in
**3.5 s wall**, synthesised with DeepSeek-V3.1 (+2.9 s = **6.4 s total**).

- **Grounded:** synthesis cited `flattenTool()`, the `SERVER_TOOLS` set, `web_search` plan-gating,
  `dropServer` on retry, `isPlanGateError`, namespace flattening — all verbatim in the DB source.
- **Beats single-shot:** the no-context single-shot **hallucinated** a nonexistent `scx_shim.py` and never
  cited the real behaviour.
- **Real parallelism:** ~8.05 s serial stream-time vs **3.5 s wall** — genuine fan-out.

## Bottom line

**A live 4-stream mux that grounds its answers in real indexed code — beating single-shot hallucination —
across a verified 196k-token context ceiling, on a store that ships inside a VS Code extension with zero
server dependencies.** Sovereign, on SCX, no OpenAI/Anthropic.
