# Kritical SCX — Multi-Model Mux + Local Corpus Store

> (c) 2026 Kritical Pty Ltd. All rights reserved.
> Author: Joshua Finley

---

## Table of Contents

1. [Overview](#1-overview)
2. [Local SQLite Store (`kritical-local-store.mjs`)](#2-local-sqlite-store-kritical-local-storemjs)
3. [Single-Model Synthetic-Context Mux (`Invoke-KritScxSyntheticContext.py`)](#3-single-model-synthetic-context-mux-invoke-kritscxsyntheticcontextpy)
4. [Multi-Model Mux Matrix (`Invoke-KritScxMuxMatrix.py`)](#4-multi-model-mux-matrix-invoke-kritscxmuxtrixpy)
5. [Proven Real Ceilings — Why Advertised Numbers Lie](#5-proven-real-ceilings--why-advertised-numbers-lie)
6. [Exact Run Commands](#6-exact-run-commands)
7. [SCX Bulk-Write Loop (`Invoke-KritScxBulkWrite.mjs`)](#7-scx-bulk-write-loop-invoke-kritscxbulkwritemjs)

---

## 1. Overview

The Kritical SCX mux system answers questions about the SCX codebase by grounding each answer in real, retrieved source code rather than hallucinated generics. It operates in three layers:

| Layer | File | What it does |
|---|---|---|
| **Corpus store** | `store-mcp/kritical-local-store.mjs` | Ships inside the VS Code extension. Zero native deps. `node:sqlite` (Node ≥ 22 built-in). Holds the indexed SCX source corpus. |
| **Single-model mux** | `mux/Invoke-KritScxSyntheticContext.py` | Fans N *lenses* (direct / edge-cases / security / architecture) across ONE model, then synthesises one grounded answer. |
| **Multi-model mux** | `mux/Invoke-KritScxMuxMatrix.py` | Fans ONE task across DeepSeek-V3.1, MiniMax-M2.7, and gpt-oss-120b **in parallel**, sizes each to its **real proven ceiling**, isolates per-stream errors, then synthesises one cross-model answer. |

HR1: every call in this stack uses `SCX_API_KEY` only — no OpenAI key, no Anthropic key, no other provider key.

---

## 2. Local SQLite Store (`kritical-local-store.mjs`)

### 2.1 What it is

The portable alternative to the server-side `KriticalSCXCodeStore` (SQL Express / pyodbc). A single `.db` file under `%USERPROFILE%/.kritical-scx/` that the VS Code extension carries — no SQL Server install, no ODBC driver, no native deps.

- **Runtime:** Node ≥ 22 (uses the built-in `node:sqlite` `DatabaseSync`)
- **DB path:** `~/.kritical-scx/scxcode-store.db` (override with `KRIT_LOCAL_STORE` env var)
- **Journal mode:** WAL (write-ahead logging — safe for concurrent reads)
- **Tables:** `files`, `symbols`

### 2.2 Schema

```sql
CREATE TABLE files(
  path        TEXT PRIMARY KEY,   -- repo-relative path, forward-slash
  lang        TEXT,               -- extension without dot (ps1, py, ts, mjs …)
  loc         INT,                -- line count
  sha         TEXT,               -- SHA-256 of raw content
  fn_count    INT,                -- function definitions extracted
  content     TEXT,               -- full file text
  mined_utc   TEXT                -- ISO-8601 timestamp of last mine
);

CREATE TABLE symbols(
  path  TEXT,
  name  TEXT,
  kind  TEXT,   -- always 'function' today
  line  INT
);
CREATE INDEX ix_sym_name ON symbols(name);
```

### 2.3 Commands

```
node kritical-local-store.mjs mine <repoRoot>      build / refresh the corpus
node kritical-local-store.mjs search "<keywords>"  retrieve matching files (synthetic context)
node kritical-local-store.mjs symbols <name>       find a symbol across the corpus
node kritical-local-store.mjs stats                corpus summary
```

#### `mine <repoRoot>`

Walks the repo tree, skips `node_modules / .git / out / dist / receipts / sources / emitted / __pycache__`, ingests every file with extension in the code set:

```
.ps1 .psm1 .py .ts .js .mjs .cjs .md .json .toml .sql
```

Per file it records: path, language, LOC, SHA-256, function count, full content, and a timestamp. Function names are extracted via per-language regex (PowerShell `function`, Python `def`, TypeScript `function` / arrow-const / `class` / `export`). Symbols go into the `symbols` table.

Example output:
```
[local-store] mined 125 files · 327 symbols -> ~/.kritical-scx/scxcode-store.db
```

#### `search "<keywords>"`

Splits the keyword string on whitespace, builds a `WHERE` clause from `path LIKE ? OR content LIKE ?` terms, orders results by `LENGTH(content)` (smallest first — maximises distinct file coverage when packing into a context budget), and packs file-blocks until a `maxChars` budget (default 11,000) is exhausted.

Each block is emitted as a fenced code block:

````
### FILE: mux/Invoke-KritScxMuxMatrix.py
```py
...first 4500 chars of the file...
```
````

#### `symbols <name>`

Case-insensitive `LIKE` search on the `symbols` table. Returns name, path, and line number for every match, up to 40 rows.

#### `stats`

```
DB: ~/.kritical-scx/scxcode-store.db
  py       42 files · 8,234 loc · 312 fns
  ts       31 files · 5,102 loc · 198 fns
  ps1      28 files · 3,891 loc · 156 fns
  …
  total symbols: 327
```

### 2.4 How it ships in the extension

The extension host process (Node.js) can call `kritical-local-store.mjs` directly — it is bundled into the extension. The `mine` step is a pre-requisite: the store must be populated before any mux run can retrieve context from it. The `search` output feeds directly into the mux pipeline as the injected corpus.

---

## 3. Single-Model Synthetic-Context Mux (`Invoke-KritScxSyntheticContext.py`)

### 3.1 Design

The single-model mux fans **N parallel "lens" streams** across **one model** (default: `gpt-oss-120b`). Each lens is a short directive that biases the model toward a different perspective on the same retrieved corpus:

| Lens | Focus |
|---|---|
| `direct` | Answer correctly, grounded only in the provided source |
| `edge-cases` | Failure modes and what the code does when things go wrong |
| `security` | Keys, localhost, isolation properties |
| `architecture` | How this fits the broader agentic-SCX architecture |

### 3.2 Pipeline

```
1. retrieve_context()  →  pulls (path, content) rows from KriticalSCXCodeStore (SQL Express)
                          via pyodbc / ODBC Driver 18, decompresses content_gz, packs
                          into file-blocks up to max_chars (default 90,000).
                          Also pulls TOP 12 symbols from LensSymbol.

2. BASELINE            →  single-shot SCX call with NO context, NO mux.
                          Demonstrates hallucination risk.

3. fan-out N lenses    →  ThreadPoolExecutor, one scx() call per lens, each
                          isolated in try/except (HTTPError / timeout / transport
                          cannot kill other streams).

4. synthesize()        →  merges the text of every successful lens stream,
                          sends to SCX with a synthesis prompt, returns one
                          grounded cross-lens answer.
```

### 3.3 Per-stream error isolation

Each lens runs in `one(lens)` which wraps `scx()` in a `try/except`. A 4xx/5xx / timeout / transport error is captured as `err` and returned as a tuple — it does **not** raise. The `ThreadPoolExecutor.map` call therefore never re-raises across streams, and all successful streams complete even if one fails.

### 3.4 Scorecard

The script prints a scorecard at the end:

```
== SCORECARD ==
  synthetic context injected : 7,357 chars of REAL code from 7 DB files
  parallel reasoning streams : 4 (fanned out concurrently, 3.5s wall)
  total tokens (streams+synth): NNN
  grounded 'flattenTool'/'web_search' cited: YES
  baseline mentioned the real code?         : NO (hallucinated / generic)
```

The key proof: the synthesis cites `flattenTool()`, `SERVER_TOOLS`, `web_search` plan-gating, `dropServer` on retry, `isPlanGateError`, and namespace flattening — all verbatim from the retrieved DB source. The no-context baseline hallucinated a nonexistent `scx_shim.py`.

---

## 4. Multi-Model Mux Matrix (`Invoke-KritScxMuxMatrix.py`)

### 4.1 Design

The multi-model mux is the next evolution: it fans **ONE task across MULTIPLE models IN PARALLEL**, each sized to its **real proven ceiling** (not the advertised number), then synthesises every model's answer into one grounded cross-model answer.

```
1. retrieve corpus   → from the local SQLite store (or --corpus dir), rows smallest-first
2. build_blocks()    → fenced file-blocks (### FILE: <path> ``` <lang> <content[:6000]> ```)
3. fan out per model → ThreadPoolExecutor, one run_model_stream() per model, each:
     a. computes its char budget via context_char_budget(model, question, max_out)
     b. packs blocks via trim_to_budget(blocks, budget)  (whole blocks, smallest-first)
     c. calls SCX; NEVER raises — a 4xx/5xx/timeout is caught and returned as a FAIL record
4. synthesize()      → DeepSeek-V3.1 fuses every successful model answer into one grounded answer
```

### 4.2 Per-model sizing (the point)

`MODEL_CEILINGS` carries each model's **real usable** input ceiling. `context_char_budget()` computes:

```
budget_tokens = real_ctx_tokens - question_tokens - max(reserve_out, max_out) - safety_tokens
budget_chars  = max(0, budget_tokens * 4)
```

So MiniMax (195k) is fed more grounding than gpt-oss (108k) for the same task — each filled to *its own* ceiling, never the advertised number. `trim_to_budget()` packs whole file-blocks smallest-first until the per-model budget is hit, so the model with more headroom simply sees more code. Both are unit-tested offline (`mux/Invoke-KritScxMuxMatrix.test.py`, 7/7).

### 4.3 Error isolation + synthesis

One model failing (rate-limit, timeout, plan-gate) becomes a `FAIL` record and never aborts the run; the synthesis fuses whichever models succeeded. Parallel wall-time vs summed serial stream-time is reported to prove genuine fan-out.

---

## 5. Proven Real Ceilings — Why Advertised Numbers Lie

Needle-recall tested against `api.scx.ai` (`docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md`). Failures were hard HTTP 400s, not silent truncation.

| Model | Advertised | **Real usable** | Verdict |
|---|---|---|---|
| DeepSeek-V3.1 | 131,072 | **~129,300** | Matches — honours the full window |
| MiniMax-M2.7 | 192,000 | **~195,676** (hard ~196,608) | **Exceeds** its advertised number |
| gpt-oss-120b | 131,072 | **~107,842** | **Below** — deployment caps input ~108k |

**Rule:** cap injected context per model at the real ceiling — the advertised number lies both ways.

---

## 6. Exact Run Commands

```bash
# 0. Populate the local store first (one-time / on change)
node store-mcp/kritical-local-store.mjs mine <repoRoot>

# Single-model synthetic-context mux (SQL Express store)
python mux/Invoke-KritScxSyntheticContext.py

# Multi-model mux-matrix — fan one task across all three, sized per ceiling
python mux/Invoke-KritScxMuxMatrix.py -q "<question>" -k <keyword...> --report out/matrix.md
python mux/Invoke-KritScxMuxMatrix.py -q "..." --models MiniMax-M2.7 DeepSeek-V3.1
python mux/Invoke-KritScxMuxMatrix.py -q "..." --corpus <dir>   # read a dir instead of SQLite
```

`SCX_API_KEY` must be set (HKCU). HR1: SCX only.

---

## 7. SCX Bulk-Write Loop (`Invoke-KritScxBulkWrite.mjs`)

The same corpus-grounding, model-sizing machinery drives file GENERATION:

```bash
node mux/Invoke-KritScxBulkWrite.mjs [batch.json]     # KRIT_BULK_REPO to ground on a sister repo
```

For each task in the batch it reads the ctx files (sized to half the model's ceiling), calls SCX, and **stages a `.draft`** — nothing overwrites the repo. The operator then lenses each draft against the real source, patches defects, verifies (runs the tests it wrote, builds), and commits only what passes. SCX writes the bulk cheaply in parallel; the operator is the quality gate.

---

> **Kritical Pty Ltd** — (c) 2026. Grounded answers on sovereign SCX — retrieve real code, size to the real ceiling, never hallucinate.
