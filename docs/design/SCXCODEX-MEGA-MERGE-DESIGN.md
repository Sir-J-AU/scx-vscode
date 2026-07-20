# SCXCODEX MEGA-MERGE — Cross-Pollinating Leading Coding Agents into Kritical's scxcodex Stack

> Design doc (.5231-lineage). Grounds every proposal in the **real** Kritical.SCXCode source and in
> the **live-proven** context ceilings. Design only — no code is edited by this document.
>
> Author: Joshua Finley — Kritical Pty Ltd — (c) 2026. HR1/HR9b/HR10/HR12/HR27/HR28/HR29 apply throughout.

---

## 0. Scope, grounding, and the load-bearing constraint

**What we have (verified by reading the source):**

| Component | File | What it is today |
|---|---|---|
| Flatten-proxy | `codex-wrapper/scx-agentic-shim.mjs` | Localhost `:4199` Responses proxy. `transformRequestBody()` rewrites `tools[]` → `function`; plan-gate 400 retry drops server tools; SSE byte-passthrough; JSONL telemetry per request. **No context injection today.** |
| Wrapper | `codex-wrapper/kritical-codex.ps1` | Launches real `codex` with `-c` overrides (`model_provider=scx`, `base_url`, `wire_api="responses"`); auto-starts/tears-down the shim; picks an agentic-capable model; HR27 write-through. **Never touches `~/.codex`.** |
| Local store | `store-mcp/kritical-local-store.mjs` | `node:sqlite` corpus: `mine` / `search` / `symbols` / `stats`. `search()` = `path/content LIKE` over `files` table, smallest-first, `maxChars=11000` default. |
| SQL Server store | `KriticalSCXCodeStore` (`dbo.LensSource` / `dbo.LensSymbol`) | Heavy source-of-truth; `DECOMPRESS(content_gz)`; symbol graph. Not shippable in the extension. |
| Mux (multi-model) | `mux/Invoke-KritScxMuxMatrix.py` | Fans ONE task across N models, each sized to its **real** ceiling; synthesises. Reads local SQLite. |
| Mux (multi-lens) | `mux/Invoke-KritScxSyntheticContext.py` | Fans N *lenses* across ONE model over SQL-Server context; beats no-context single-shot. |
| Proof | `docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md` | **Real usable ceilings** (needle-recall, hard 400s, no silent truncation). |

**The load-bearing number — REAL usable input ceilings (`SCX-MUX-STORAGE-CONTEXT-PROOF.md` §1):**

| Model | Advertised | **REAL usable (cap injection here)** | Failure mode |
|---|---:|---:|---|
| DeepSeek-V3.1 | 131,072 | **~129,000** | hard 400 above |
| MiniMax-M2.7 | 192,000 | **~195,000** (exceeds ad) | hard 400 at ~198k |
| gpt-oss-120b | 131,072 | **~108,000** (below ad) | hard 400 at ~110k |

> Failures are **hard HTTP 400s, not silent truncation** — so an over-budget injection *breaks the
> request outright*. Sizing to the real ceiling is not an optimisation; it is a correctness requirement.
> The wrapper's default agentic model is **`gpt-oss-120b`** (`kritical-codex.ps1:57`) — the **tightest**
> ceiling (~108k). Design the injection budget against gpt-oss unless the model is known at request time.

**HR29 is the master constraint for everything below:** every feature is an **add-on** behind a single
env flag; with the flag off the shim is byte-identical in behaviour to today (pure flatten-proxy); the
underlying `codex` + `~/.codex` are never touched; localhost-only; passthrough is the default and
augmentation is opt-in per request (HR29 §3). HR1: `SCX_API_KEY` only — never read `OPENAI_*`/`ANTHROPIC_*`.

---

## 1. CENTERPIECE — Storage-into-agent via the mux (auto-inject corpus grounding)

### 1.1 Goal

On each `POST /v1/responses`, the shim should — **when opted in** — (a) extract intent/keywords from the
request, (b) retrieve the most relevant **real** source from the corpus store(s), (c) inject it as a
grounding block sized to the target model's real ceiling, then forward to SCX. Result: agentic codex on
SCX is always grounded in the actual codebase, the way `Invoke-KritScxSyntheticContext.py` already proves
beats a no-context single-shot — but now inline, on every agentic turn, transparently.

This is the "storage → agent" bridge the proof doc and HR27 both point at: the corpus and decision-log
stores stop being *offline* mux fodder and become *live* request-time grounding.

### 1.2 Where to hook (exact line areas in `scx-agentic-shim.mjs`)

The request already gets parsed and transformed at one clean choke point. Today:

```
// scx-agentic-shim.mjs, lines 116-124 (inside req 'end' handler)
let firstBody = raw;
if (isResponses && parsed) {
  T.tools_in  = (parsed.tools || []).map(t => t && t.type);
  const transformed = transformRequestBody(parsed);        // <-- tool flatten
  T.tools_out = (transformed.tools || []).map(t => t && t.type);
  T.flattened = JSON.stringify(T.tools_in) !== JSON.stringify(T.tools_out);
  firstBody   = JSON.stringify(transformed);
}
let upstream = await call(firstBody);
```

**Hook point:** insert a single `await augmentWithCorpus(...)` call between `transformRequestBody()` and
`JSON.stringify(transformed)`. It is the only new line on the hot path, and it is a **no-op unless the
env flag is set**. This keeps HR29 §3 (passthrough default) literally true: flag off ⇒ `transformed`
is returned unchanged ⇒ byte-identical to today.

```
if (isResponses && parsed) {
  T.tools_in  = (parsed.tools || []).map(t => t && t.type);
  let transformed = transformRequestBody(parsed);
  transformed = await augmentWithCorpus(transformed, T);   // <-- NEW; no-op when flag off
  T.tools_out = (transformed.tools || []).map(t => t && t.type);
  T.flattened = JSON.stringify(T.tools_in) !== JSON.stringify(T.tools_out);
  firstBody   = JSON.stringify(transformed);
}
```

Keep `augmentWithCorpus` a **pure function of the parsed body** (like `transformRequestBody`, exported at
`scx-agentic-shim.mjs:74` for tests) so it is unit-testable without a live SCX round-trip — mirrors how
`flattenTool`/`transformRequestBody`/`isPlanGateError` are already exported for the paired test (HR21).

### 1.3 The four sub-steps

#### (a) Intent / keyword extraction (no extra model call on the hot path)

Codex's Responses payload carries the conversation in `parsed.input` (array of message items) and often a
system/developer instruction block. Extract keywords **cheaply and deterministically** — do NOT spend a
model round-trip on the critical path (latency + HR29 "no surprise" budget):

1. Concatenate the **last user turn(s)** text from `parsed.input` (the freshest intent), plus any
   `apply_patch`/`shell` tool-call file paths already present in the turn (strong signal of *which files*
   the agent is working on — this is the single best keyword source and it's free).
2. Tokenise → lowercase → drop stopwords → keep identifiers (camelCase/`snake_case`/`Verb-Noun`), file
   basenames, and quoted strings. Bias toward **symbols** (they hit `symbols` table) and **path
   fragments** (they hit the `path LIKE` arm of `search()`).
3. Cap to ~12 keywords (matches the mux's `-k` shape and the store's `LIKE`-per-term cost at
   `kritical-local-store.mjs:79-81`).

This mirrors **Codex's own instinct**: it injects *file paths and metadata* as the cheapest high-signal
context (see §2, Codex "metadata-only injection"). We reuse the codex tool-call file paths the agent
already emitted rather than guessing.

> Optional upgrade (behind a second flag, off by default): if `KRIT_SHIM_INJECT_LLM_INTENT=1`, do a
> **single fast SCX chat call** to a cheap model to expand the query into keywords. This is the mux's
> intent step, but it adds a serial round-trip — keep it opt-in and off for interactive latency.

#### (b) Retrieve from BOTH backends (attach local SQLite + SQL Server)

Reuse the **exact retrieval shape already proven** in the mux so behaviour is identical to the offline
proof. Two providers behind one interface, selected by env:

```
KRIT_SHIM_STORE = off | local | sql | both     (default: off  → HR29)
```

- **local** — `import { /* refactor search() to return rows */ } from '../store-mcp/kritical-local-store.mjs'`.
  Today `search()` prints + returns a joined string (`kritical-local-store.mjs:73-92`). Add a sibling
  **`searchRows(keywords, maxChars)`** that returns `[{path, lang, content}]` (the SELECT already exists
  at line 81) — non-breaking, additive, keeps the CLI `search` intact. Zero native deps, ships in the
  extension host (proof §2 backend **B**, the default).
- **sql** — the `KriticalSCXCodeStore` path. The shim is Node; the SQL store is pyodbc/ODBC in the proof.
  Two HR29-safe options: (i) shell out to a tiny `Invoke-KritScxCorpusQuery.py` that returns JSON rows
  (reuses `retrieve_context()` shape at `Invoke-KritScxSyntheticContext.py:25-41`, incl.
  `DECOMPRESS(content_gz)` + the symbol-graph SELECT); or (ii) an `mssql`/`tedious` node client. Prefer
  (i) first — it reuses proven, tested SQL and keeps the shim dependency-free (proof §2 backend **A**).
- **both** — query both, **dedupe by `path`**, prefer the SQL Server row when a path exists in both
  (richer: symbol graph + full `DECOMPRESS`), fall back to local. This is the "attach both storage
  backends" requirement: local is the portable default, SQL is the heavy source-of-truth, and the shim
  transparently prefers whichever is present.

Retrieval ordering must stay **smallest-content-first** (`ORDER BY LENGTH(content)` /
`ORDER BY byte_len`) — both stores already do this — because the packer (below) fits *more distinct files*
that way (max coverage), exactly as `trim_to_budget()` relies on (`Invoke-KritScxMuxMatrix.py:90-103`).

#### (c) Size the injection to the model's REAL ceiling (never blow the window)

This is where the proof doc is load-bearing. Port `context_char_budget()` +
`trim_to_budget()` verbatim in spirit from `Invoke-KritScxMuxMatrix.py:75-103`:

```
const MODEL_CEILINGS = {                     // proof §1 — REAL usable, not advertised
  'DeepSeek-V3.1':                          { real_ctx_tokens: 129000 },
  'MiniMax-M2.7':                           { real_ctx_tokens: 195000 },
  'gpt-oss-120b':                           { real_ctx_tokens: 108000 },
  'gemma-4-31B-it':                         { real_ctx_tokens:  30000 },   // conservative until probed
  'Meta-Llama-3.3-70B-Instruct':            { real_ctx_tokens:  30000 },   // conservative until probed
  'Llama-4-Maverick-17B-128E-Instruct':     { real_ctx_tokens:  30000 },   // conservative until probed
};
const RESERVE_OUT = 4000, SAFETY = 3000, CPT = 4;   // bigger reserve than the mux: codex turns are
                                                     // multi-tool and the EXISTING conversation already
                                                     // consumes the window — see the critical note below.
```

**Critical difference from the offline mux:** in the mux, the corpus is essentially the *whole* prompt.
In the shim, the corpus injection is **added on top of an already-large agentic conversation** (system
prompt + AGENTS.md + prior turns + tool results). So the budget is not `ceiling − question`; it is:

```
budget_chars = (real_ctx_tokens
                − estimate_existing_prompt_tokens(parsed)   // measure the CURRENT payload
                − RESERVE_OUT − SAFETY) * CPT
budget_chars = max(0, min(budget_chars, KRIT_SHIM_INJECT_MAX_CHARS ?? 60000))
```

- `estimate_existing_prompt_tokens(parsed)` = `JSON.stringify(parsed.input).length / 4` (+ tools). This is
  the guard the offline mux never needed. Because SCX fails **hard-400, not truncate**, a naive fixed
  budget would eventually push a busy conversation over the real ceiling and **break the agent mid-task**
  — the worst possible HR29 violation. Measuring the live payload prevents that.
- Hard ceiling `KRIT_SHIM_INJECT_MAX_CHARS` (default e.g. 60k chars ≈ 15k tokens): a sane cap so injection
  never dominates the window even on MiniMax's huge ceiling. Interactive coding wants *relevant* grounding,
  not a context dump (Codex's lesson in §2 — inject metadata, pull bodies on demand).
- If `budget_chars <= 0` (busy conversation, no room) → **inject nothing** and log
  `T.inject_skipped='no_budget'`. Degrade to pure passthrough. Never partially inject a truncated file.

Where does the model name come from at request time? `parsed.model` (already captured as `T.model` at
`scx-agentic-shim.mjs:115`). If unknown/missing → fall back to the **gpt-oss ~108k** row (tightest safe).

#### (d) Inject as grounding, then forward

Codex's Responses API takes `parsed.instructions` (top-level system-ish string) and/or `parsed.input[]`.
Inject as a **dedicated developer/system input item prepended** to `parsed.input`, not concatenated into
the user's turn (keeps provenance clean, survives codex's own history handling, and is trivially strippable):

```
const groundingText =
  "## Kritical corpus grounding (retrieved real source — treat as authoritative over memory)\n" +
  "Answer/patch STRICTLY consistent with the files below. If a needed file is absent, say so;\n" +
  "do not invent code or file paths.\n\n" + packedBlocks;   // "### FILE: path\n```lang\n…\n```"

transformed.input = [
  { role: 'developer', content: [{ type: 'input_text', text: groundingText }] },
  ...(transformed.input || []),
];
```

Block format = **identical** to `build_blocks()` (`Invoke-KritScxMuxMatrix.py:157-169`) and the local
store's snippet fences (`kritical-local-store.mjs:85`) — so grounding the agent sees is byte-for-byte the
grounding the offline proof validated. The system-preamble text is lifted from the proven `run_model_stream`
system prompt (`Invoke-KritScxMuxMatrix.py:223-227`) which already made models cite `flattenTool()`,
`SERVER_TOOLS`, `isPlanGateError` verbatim (proof §3).

### 1.4 Pseudocode against the real shim structure

```js
// ---- NEW module: codex-wrapper/scx-corpus-augment.mjs  (additive; shim imports it) ----
import { searchRows } from '../store-mcp/kritical-local-store.mjs';   // NEW additive export (§1.3b)

const STORE = process.env.KRIT_SHIM_STORE || 'off';         // off|local|sql|both   (HR29 default: off)
const MAX_CHARS = parseInt(process.env.KRIT_SHIM_INJECT_MAX_CHARS || '60000', 10);
const CEILINGS = { 'DeepSeek-V3.1':129000, 'MiniMax-M2.7':195000, 'gpt-oss-120b':108000 };
const DEFAULT_CEIL = 108000;                                 // tightest safe (proof §1)

export function extractKeywords(parsed) {
  const turns = (parsed.input || []).flatMap(m => textOf(m)).join(' ');
  const paths = (parsed.input || []).flatMap(filePathsFromToolCalls);   // free, high-signal (Codex-style)
  const toks  = tokeniseIdentifiersAndPaths(turns);
  return dedupe([...paths, ...toks]).slice(0, 12);
}

function budgetChars(model, parsed) {
  const ceil = CEILINGS[model] || DEFAULT_CEIL;
  const existing = Math.ceil(JSON.stringify(parsed.input || []).length / 4) + toolsTokens(parsed);
  const tokens = ceil - existing - 4000 /*reserve_out*/ - 3000 /*safety*/;
  return Math.max(0, Math.min(tokens * 4, MAX_CHARS));
}

async function retrieve(keywords, maxChars) {               // attach BOTH backends
  if (STORE === 'local') return searchRows(keywords, maxChars);
  if (STORE === 'sql')   return await sqlRows(keywords, maxChars);          // shells Invoke-KritScxCorpusQuery.py
  if (STORE === 'both')  return mergePreferSql(await sqlRows(keywords, maxChars),
                                               searchRows(keywords, maxChars));
  return [];
}

function pack(rows, budget) {                               // trim_to_budget() port, smallest-first
  const out = []; let used = 0;
  for (const r of rows.sort((a,b)=>a.content.length-b.content.length)) {
    const block = `### FILE: ${r.path}\n\`\`\`${r.lang||''}\n${r.content.slice(0,6000)}\n\`\`\`\n`;
    if (used + block.length > budget) continue;             // skip this + larger; keep scanning smaller
    out.push(block); used += block.length;
  }
  return { text: out.join('\n'), used, files: out.length };
}

export async function augmentWithCorpus(transformed, T) {
  if (STORE === 'off') return transformed;                  // HR29: pure passthrough when flag off
  try {
    const budget = budgetChars(T.model || '', transformed);
    if (budget <= 0) { T.inject_skipped = 'no_budget'; return transformed; }
    const kws  = extractKeywords(transformed);
    if (!kws.length) { T.inject_skipped = 'no_keywords'; return transformed; }
    const rows = await retrieve(kws, budget);
    const { text, used, files } = pack(rows, budget);
    if (!files) { T.inject_skipped = 'no_match'; return transformed; }
    T.injected_chars = used; T.injected_files = files; T.inject_store = STORE;
    return {
      ...transformed,
      input: [{ role:'developer', content:[{ type:'input_text', text: GROUNDING_PREAMBLE + text }] },
              ...(transformed.input || [])],
    };
  } catch (e) {                                             // HR29 §3: never break a request we augment
    T.inject_error = e.message; return transformed;         // fail OPEN → passthrough
  }
}
```

Telemetry: the shim already writes one JSONL row per request via `telem()` (`scx-agentic-shim.mjs:79-81`).
Add `inject_store` / `injected_files` / `injected_chars` / `inject_skipped` / `inject_error` to `T` so every
augmentation is auditable ("wire the fuck out of it" — the existing telemetry ethos), and so you can prove
grounding fired without reading SCX responses.

### 1.5 HR29 / HR1 safety properties of this design

- **Opt-in, single flag.** `KRIT_SHIM_STORE=off` (default) ⇒ `augmentWithCorpus` returns its input
  unchanged ⇒ shim is byte-identical to today. Kill switch = unset the var (HR29 §2, §6).
- **Fail open, never break.** Any retrieval/DB/keyword error ⇒ passthrough (the `catch` returns
  `transformed`). Corpus stores can be missing, empty, or unmined and the agent still works (HR29 §1, §3).
- **Never blows the window.** Budget measured against the **live** payload + the **real** ceiling; on
  `budget<=0` it injects nothing. Guards the hard-400 failure mode the proof documented.
- **Additive-only edits to existing files.** New `searchRows()` export beside `search()` (CLI unchanged);
  new `scx-corpus-augment.mjs` module; one no-op-guarded call line in the shim. `~/.codex` untouched
  (the wrapper never writes it — `kritical-codex.ps1:9-12`). HR1: retrieval never needs a provider key.
- **Provenance + strippability.** Grounding is a single `developer` input item with a labelled header —
  trivially identifiable and removable; it does not mutate the user's own turns.

---

## 2. Ranked table — ~10 behaviours worth stealing

Ranked by (value × how cleanly it maps onto our existing choke points). "Effort" is relative to the shim/
wrapper/store we already have.

| # | Source agent | Technique | Maps into scxcodex as | Effort / Value |
|---|---|---|---|---|
| 1 | **Claude Code** — retrieval + context engineering | RAG grounding injected server-side, sized to a budget | **The centerpiece (§1)**: `augmentWithCorpus` in the shim. We already have the store + the proven ceilings; this is wiring the choke point at `shim:116-124`. | **Med / Very High** |
| 2 | **Claude Code** — `clear_tool_uses_20250919` | Surgically drop **old** `tool_result` bodies, keep last N, exempt some tools — mechanical, no model cost | Shim pass over `parsed.input`: replace stale codex `shell`/`apply_patch` outputs with `[cleared — re-read if needed]` when payload > threshold, keep last 4. Frees budget for §1 grounding. Fully HR29 (flag `KRIT_SHIM_CLEAR_TOOLS`). | **Med / High** |
| 3 | **Codex CLI** — `AGENTS.md` instruction chain (root→cwd concat, `project_doc_fallback_filenames`, `project_doc_max_bytes`) | Deterministic, layered project-doc discovery | Wrapper reads our `CLAUDE.md` + any `AGENTS.md` root→cwd and injects as a pinned developer preamble via `-c` or via the shim. We already auto-load `CLAUDE.md`; formalise the **merge order + byte cap** exactly like Codex. | **Low / High** |
| 4 | **Claude Code** — compaction (`compact_20260112`, trigger 150–180k) | Summarise old turns into a high-fidelity summary when near ceiling | Shim-side pre-forward compaction: when live payload nears the model's **real** ceiling, fold oldest turns into a summary (one cheap SCX call) instead of hitting the hard-400. This is the *inline* version of what `Kritical.NodeJS.SCXCodeAgent` does at session boot from HR27 JSONL. | **High / High** |
| 5 | **Codex CLI** — metadata-only injection (name/description/path; body stays on disk until needed) | Cheapest high-signal context is **paths + symbols**, not file bodies | §1's keyword extraction already reuses codex tool-call **file paths**; add a **symbol-graph preface** (from `dbo.LensSymbol` / local `symbols` table) listing relevant symbol names+paths *before* any file body — grounds cheaply, pulls bodies only within budget. | **Low / High** |
| 6 | **Claude Code** — subagents (own context window, return only a summary) | Fan-out heavy sub-tasks into isolated contexts; main context stays lean | We **already have the fan-out** (`Invoke-KritScxMuxMatrix.py`). Expose it as an MCP tool / wrapper subcommand so an interactive codex turn can delegate "analyse across the whole corpus" to the multi-model mux and get back one synthesised summary — subagents, but multi-model. | **Med / High** |
| 7 | **Kimi Code CLI** — Skills (`SKILL.md` invoked by `/skill:<name>`, injected as prompt) | Codified, reusable prompt templates for team standards | A `skills/` dir of `*.md` the wrapper can inject on `-Skill <name>` (or shim can match a `/skill:` marker). Ties into HR27 corpus so skills are *grounded*, not just boilerplate. Aligns with our existing "lens" framing. | **Low / Med** |
| 8 | **Codex CLI** — session resume / rollout (`resume --last`, `--all`, rollout files) | Durable session identity; continue multi-day work without rebuilding context | We have the raw material: **HR27 JSONL** (`documentation/{human,ai}/`) is already an append-only session journal. Add a `-Resume` wrapper mode that reconstructs prior context from the JSONL (the stated `Kritical.NodeJS.SCXCodeAgent` job) and injects it as grounding — sovereign rollout. | **Med / High** |
| 9 | **Claude Code** — memory tool (`/memories`, check-first protocol, survives sessions) | Agent persists findings to files, retrieved on demand | Expose HR27 store as a **memory tool** to the agent: a `function` tool (`memory_search`/`memory_write`) the shim intercepts and services against local SQLite + JSONL. "Check memory first" preamble. HR27 already captures writes; this adds *reads*. | **Med / Med** |
| 10 | **Claude Code / Codex** — permission / approval modes (Suggest default; PermissionRequest hooks) | Explicit, tiered command approval; auto-allow/deny hooks | Wrapper surfaces codex's own approval mode as a first-class `-Approval` flag and documents the SCX-safe default (Suggest). Optional shim-side allow/deny policy for `shell` tool calls (log-only by default — HR29 "no surprise breakage"). | **Low / Med** |

---

## 3. Internal-prompting improvements for the mux + wrapper

Drawn from what the leading agents actually do, mapped to our files.

### 3.1 System-prompt patterns (mux)

- **Strict-grounding preamble (keep + strengthen).** The mux's system prompt
  (`Invoke-KritScxMuxMatrix.py:223-227`) already says "answer STRICTLY from the retrieved context… do not
  invent code." This is exactly Claude Code's grounding discipline and it demonstrably stopped the
  hallucinated `scx_shim.py` (proof §3). **Improvement:** add Codex's *path-honesty* clause — "cite the
  `### FILE:` path for every claim; if the answer requires a file not present, name the missing path
  rather than guessing." Turns grounding into *checkable* grounding.
- **Symbol-graph preface (Codex metadata-first).** Prepend the retrieved **symbol list** (already fetched
  at `Invoke-KritScxSyntheticContext.py:39-41`, `dbo.LensSymbol`) *above* the file bodies, as a
  table-of-contents. Models orient faster and spend budget on the right files. Cheap; high signal.
- **Lens prompts as explicit roles (keep).** The 4 lenses (`Invoke-KritScxSyntheticContext.py:43-48`) are a
  good subagent-style decomposition. **Improvement:** make the synthesis prompt *adjudicate* rather than
  merge — "where lenses disagree, prefer the claim with a cited `### FILE:` path" (mirrors Claude Code's
  "prefer claims multiple models agree on" at `Invoke-KritScxMuxMatrix.py:258`, but adds evidence-weighting).

### 3.2 Intent extraction (retrieval-augmentation)

- **Reuse the agent's own signals first (Codex).** Best keyword source = the **file paths the codex turn is
  already touching** (apply_patch/shell targets). Deterministic, zero-latency, higher precision than NL
  keyword guessing. §1.3(a) builds on this.
- **Two-tier extraction.** Tier 1 (default, hot path): deterministic identifier/path tokeniser. Tier 2
  (opt-in `KRIT_SHIM_INJECT_LLM_INTENT=1`): one cheap SCX call to expand the query — the mux's implicit
  intent step, made explicit and *off by default* for interactive latency.
- **Symbol-aware term routing.** Route identifier-shaped terms at the `symbols` table and path-shaped terms
  at the `path LIKE` arm — both stores already index symbols (`kritical-local-store.mjs:36-37`,
  `dbo.LensSymbol`). Currently `search()` only does `path/content LIKE`; adding a symbol join lifts recall
  for "where is `flattenTool` defined"-type intents.

### 3.3 Wrapper (`kritical-codex.ps1`) prompting improvements

- **Formalise the AGENTS.md/CLAUDE.md chain (Codex).** Today the wrapper relies on codex/agents auto-loading
  `CLAUDE.md`. Make it explicit and layered: read root→cwd `AGENTS.md`/`CLAUDE.md`, cap at
  `project_doc_max_bytes`-equivalent, concat with blank lines, inject as a pinned developer preamble via a
  new `-c experimental_instructions_file` override (still an *override*, never writing `~/.codex` — HR29).
- **Pin the real ceiling per model.** The wrapper knows `$Model` (`kritical-codex.ps1:76-91`). Pass the
  model's **real** ceiling to the shim (env `KRIT_SHIM_MODEL_CEILING`) so §1's budget uses the exact number
  the wrapper selected, not a lookup default — removes the "unknown model ⇒ tightest fallback" penalty.
- **Grounding banner line.** The banner already prints model+endpoint (`kritical-codex.ps1:135`). Add one
  line: `corpus grounding: <store> (<n> files mined)` when `KRIT_SHIM_STORE!=off`, and the HR29 kill-switch
  reminder ("unset KRIT_SHIM_STORE for pure passthrough") — satisfies HR29 §6 (kill switch always visible).

---

## 4. HR1 / HR29 cautions (build checklist)

**These are refusal conditions, not suggestions.**

- **SCX-only (HR1).** Retrieval, intent expansion, compaction, and any new SCX call use `SCX_API_KEY` only.
  Never read `OPENAI_*`/`ANTHROPIC_*` (the shim already scopes to `SCX_API_KEY` at `scx-agentic-shim.mjs:22`;
  keep it that way). No embeddings/RAG service that needs a third-party key — local SQLite `LIKE` + symbol
  join is sovereign and sufficient for the proven use-cases.
- **Additive, never disruptive (HR29 §1).** Every feature above is a new module + one guarded call site.
  Removing the env flags returns the shim to today's pure flatten-proxy. Underlying `codex` must run
  identically with our layer off — verify with a flag-off byte-diff of the forwarded body.
- **Never touch `~/.codex` (HR29 §5, wrapper doc `kritical-codex.ps1:9-12`).** All grounding/instructions
  are per-invocation `-c` overrides or shim-side request edits. No new files written under `~/.codex`, no
  edits to the user's real `config.toml`/`AGENTS.md`. If we read the operator's `AGENTS.md`, we read it —
  we do not modify it.
- **Passthrough default; augmentation opt-in per endpoint (HR29 §3).** Default `KRIT_SHIM_STORE=off`. Only
  `/v1/responses` is augmented; `/health` and every other path pass through untouched (already true —
  augmentation is gated on `isResponses`).
- **No `0.0.0.0` (HR29).** Shim stays bound to `127.0.0.1` (`scx-agentic-shim.mjs:19`). Any SQL-Server
  helper is localhost/`SQLEXPRESS` only.
- **Fail open (HR29 §3 "no surprise breakage").** A store that is missing/empty/unmined, a DB timeout, a
  keyword miss, or an over-budget conversation must **degrade to passthrough**, never to a broken request.
  The `catch → return transformed` in §1.4 is mandatory, not optional.
- **Never blow the real ceiling.** Because SCX fails **hard-400, not silent truncation** (proof §1), the
  budget MUST be computed against the live payload; on `budget<=0` inject nothing. A fixed injection size
  is a latent HR29 violation.
- **Naming (HR28).** New identifiers name the **mechanism**: `augmentWithCorpus`, `searchRows`,
  `extractKeywords`, `budgetChars`, `KRIT_SHIM_STORE`, `KRIT_SHIM_INJECT_MAX_CHARS`. No metaphor-derived
  names ("mega", "rocket", "smash").
- **Logging (HR27) + tests (HR21).** Every augmentation emits telemetry (§1.4). Every new pure function
  (`augmentWithCorpus`, `extractKeywords`, `budgetChars`, `pack`, `searchRows`) ships with a paired test
  that runs **without a live SCX call** — the existing export pattern at `scx-agentic-shim.mjs:74` makes
  this free.
- **Public-artifact hygiene (HR12/HR9b).** Grounding blocks may contain verbatim source; that's internal
  and fine. Any *customer-facing* surface stays Kritical-branded; supplier names (OpenAI/Codex) stay in
  source only.

---

## 5. Build order (concrete, smallest-first)

1. **`searchRows()`** additive export in `kritical-local-store.mjs` (rows, not printed string) + paired test.
   *(Unblocks everything; zero risk; CLI unchanged.)*
2. **`scx-corpus-augment.mjs`** with `extractKeywords`/`budgetChars`/`pack`/`augmentWithCorpus` (local store
   only, `KRIT_SHIM_STORE=local`) + one guarded call line at `shim:118`. Ceilings from proof §1. Paired test.
3. **Wire real ceiling from wrapper** (`KRIT_SHIM_MODEL_CEILING`) so the budget uses the selected model's
   exact proven number.
4. **SQL Server backend** (`STORE=sql`/`both`) via `Invoke-KritScxCorpusQuery.py` JSON bridge (reuse
   `retrieve_context()` shape) — attaches the heavy store; dedupe-prefer-SQL merge.
5. **Symbol-graph preface** + path-honesty preamble (mux §3.1 improvements; cheap, high recall).
6. **Tool-result clearing** (#2) then **inline compaction** (#4) to free budget on long agentic sessions.
7. **AGENTS.md/CLAUDE.md chain** formalisation in the wrapper (#3), **resume from HR27 JSONL** (#8).

Each step is independently shippable, flag-gated off by default, and leaves `codex` + `~/.codex` untouched.

---

## Sources

- OpenAI Codex CLI — <https://github.com/openai/codex> · CLI docs <https://developers.openai.com/codex/cli> · config reference <https://developers.openai.com/codex/config-reference>
- Codex AGENTS.md instruction chain — <https://developers.openai.com/codex/guides/agents-md>
- Claude Code context engineering (compaction / tool-clearing / memory tool + thresholds) — <https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools>
- Claude Code architecture (context, subagents, hooks, permissions, memory) — <https://code.claude.com/docs/en/how-claude-code-works>
- Kimi Code CLI (skills, agents/subagents, session continuation) — <https://github.com/MoonshotAI/kimi-code> · <https://moonshotai.github.io/kimi-cli/en/customization/agents.html>
- Kritical stack (read-only, this repo): `codex-wrapper/scx-agentic-shim.mjs`, `codex-wrapper/kritical-codex.ps1`, `store-mcp/kritical-local-store.mjs`, `mux/Invoke-KritScxMuxMatrix.py`, `mux/Invoke-KritScxSyntheticContext.py`, `docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md`, `CLAUDE.md`
