# The 6502 Context Economy — Kritical SCX Grounding Cache

> **Design-only.** No code edited. Buildable against the real stack.
> Author: Joshua Finley — Kritical Pty Ltd — (c) 2026. All rights reserved.
> Wave anchor: `.5231+`. HR1 (SCX-only key), HR9b (we are Kritical), HR16 (Install/Remove/Heal/Status),
> HR21 (paired tests), HR23 (never purge — rotate), HR27 (decision log substrate),
> HR29 (additive / opt-in — everything here is OFF by default and degrades to the working baseline).

---

## 0. The metaphor, read for mechanism (HR28)

A 6502 addressed 64 KB directly and ran off a few hundred bytes of zero-page RAM, yet C64s
shipped games far larger than RAM by treating memory as a **scarce, actively-managed resource**:
ROM/asset tables (store each sprite once, reference by address), **bank switching / overlays**
(page the block you need into the window, evict what you don't), **RLE/delta packing** (never store
what you can reconstruct), and a **working set** kept inside the address budget.

An LLM context window is the same problem with different numbers. The proof doc
(`docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md`) pins the **real** ceilings — DeepSeek ~129k, MiniMax ~195k,
gpt-oss ~108k tokens — and shows a **hard HTTP 400** when you overrun, not graceful truncation. That
is exactly a 6502 address bus: overrun the bank and you fault. So the window is scarce 8-bit-style
memory, the SQLite/SQL-Server corpus is the "disk", and the mux is the MMU that pages relevant blocks
in sized to each model's real bank.

**Per HR28 the metaphor is visual, not naming.** No `Invoke-*Bank*`, no `ZeroPage.psm1`. Every
identifier below names the mechanism (`Get-KriticalGroundingWorkingSet`, `content_blob`, `chunk_ref`,
`page_in`). The "6502" lives only in this doc's prose.

**Where this sits vs. the shim merge design.** The companion `scratchpad/SCXCODEX-MEGA-MERGE-DESIGN.md`
(being written in parallel; not yet on disk at time of writing — treat as a forward dependency) owns
**prompt-level context injection** into scxcodex: how retrieved text is spliced into the request that
reaches the model. This doc owns the **storage economy underneath** that injection: how the corpus is
deduped, tiered, paged, and shared across agents so the shim always has a well-sized, pre-warmed block
to inject. Contract between them is §7's `page_in` call — the shim calls it; this layer answers.

---

## 1. Content-addressing / dedup — the ROM/asset table

**Old-school:** a C64 stored each sprite/tile **once** in an asset table and referenced it by address;
duplicate art cost nothing. **Our mechanism:** store each unique code/context **blob once by SHA-256**,
reference it by hash everywhere else. The store already computes `sha` per file
(`kritical-local-store.mjs` line 62, `createHash('sha256').update(src)`) but currently **re-stores the
full `content` inline in `files`** (line 35/66) — the SHA is descriptive, not load-bearing. We make the
SHA the primary key of a blob table and turn `files` into a thin pointer table.

### 1.1 Schema — SQLite (shippable store, Backend B)

```sql
-- NEW: content-addressed blob store. Each unique byte-sequence stored ONCE.
CREATE TABLE IF NOT EXISTS blob(
  sha           TEXT PRIMARY KEY,     -- sha256 hex of raw_bytes (canonical address)
  raw_bytes     BLOB,                 -- tier-0 payload for the winning storage tier (see §3)
  tier          INTEGER NOT NULL,     -- 0=raw utf8, 1=gzip, 2=simhash-collapsed ref, 3=SCX capsule
  byte_len      INTEGER NOT NULL,     -- decompressed length (budget math without inflating)
  gz_len        INTEGER,              -- stored length when tier=1
  simhash       TEXT,                 -- 64-bit binary string (reuses HR27 Get-KriticalContentSimHash)
  lang          TEXT,
  created_utc   TEXT NOT NULL
);

-- files becomes a POINTER table: metadata + a reference to the blob by SHA.
-- (Migration: existing files.content -> blob.raw_bytes keyed by files.sha, then drop content.)
CREATE TABLE IF NOT EXISTS file_ref(
  path          TEXT NOT NULL,
  version_utc   TEXT NOT NULL,        -- enables delta history (§4); (path,version) is the key
  sha           TEXT NOT NULL REFERENCES blob(sha),
  lang          TEXT, loc INTEGER, fn_count INTEGER,
  mined_utc     TEXT,
  PRIMARY KEY (path, version_utc)
);
CREATE INDEX IF NOT EXISTS ix_fileref_path ON file_ref(path);
CREATE INDEX IF NOT EXISTS ix_fileref_sha  ON file_ref(sha);
```

### 1.2 Pseudocode — dedup at mine time (extends `mine()` in `kritical-local-store.mjs`)

```js
// inside walk-loop, replacing insF.run(rel, lang, loc, sha, funcs, src, now):
const sha = createHash('sha256').update(src).digest('hex');
const existing = d.prepare('SELECT sha FROM blob WHERE sha=?').get(sha);
if (!existing) {                                  // ROM table miss -> store the asset ONCE
  const { tier, bytes, gzLen } = pickStorageTier(src);   // §3 chooses raw|gzip
  d.prepare('INSERT INTO blob(sha,raw_bytes,tier,byte_len,gz_len,simhash,lang,created_utc)\
             VALUES(?,?,?,?,?,?,?,?)')
   .run(sha, bytes, tier, Buffer.byteLength(src), gzLen, simhash64(src), lang, now);
}                                                 // hit -> reference the existing blob, store nothing
d.prepare('INSERT OR REPLACE INTO file_ref(path,version_utc,sha,lang,loc,fn_count,mined_utc)\
           VALUES(?,?,?,?,?,?,?)').run(rel, now, sha, lang, loc, funcs, now);
```

**Payoff, grounded in the proof numbers.** The proof doc reports the SQL-Server store at 198 rows /
~1.16 MB gzipped. In any real repo the same license header, the same `(c) 2026 Kritical` banner, the
same boilerplate imports recur across dozens of files; identical vendored files across sister repos
(the umbrella lists 10+ `Kritical.*` siblings) are byte-identical. Content-addressing collapses every
duplicate to a single blob + N cheap `file_ref` rows — the ROM table that lets us "ship a game bigger
than RAM": a corpus far larger than any window, addressable by 32-byte hashes.

**SQL-Server mirror (Backend A).** `dbo.LensSource` already stores `content_gz` + `byte_len`
(see `Invoke-KritScxSyntheticContext.py` line 29, `CAST(DECOMPRESS(content_gz) …)`). Add a `dbo.Blob`
table keyed on `content_sha256 CHAR(64)` with `content_gz VARBINARY(MAX)` and repoint `LensSource` at
it by SHA — the same split, on the heavy backend.

---

## 2. Memory hierarchy / paging — cold / warm / hot with LRU eviction

**Old-school:** ROM/disk = cold; the swapped-in bank = warm; zero-page = hot. Bank-switching moved the
right block under the address bus on demand and evicted the least-used.

**Our three tiers:**

| Tier | 6502 analogue | Our mechanism | Lives in |
|---|---|---|---|
| **Cold** | ROM / disk | full source blob | `blob` (tier 0/1) in SQLite / `dbo.Blob` in SQL |
| **Warm** | pre-decoded bank | model-generated SCX **summary capsule** of a blob | `blob` (tier 3) + `capsule` table (§6) |
| **Hot** | zero-page window | the chunks actually packed into THIS turn's window | ephemeral — the mux's `trim_to_budget` output |

The "hot set" already exists in code: `trim_to_budget()` in `Invoke-KritScxMuxMatrix.py` (lines 90-103)
packs whole file-blocks until each model's char budget is spent. That **IS** the page-in step. What is
missing is (a) an explicit **page table** recording what's resident + when last touched, and (b)
**LRU/LFU eviction** so the working set is chosen by recency+frequency, not just "smallest first".

### 2.1 Schema — the page table (resident-set bookkeeping)

```sql
CREATE TABLE IF NOT EXISTS page_state(
  namespace     TEXT NOT NULL,        -- per-agent/project scope (§7)
  sha           TEXT NOT NULL REFERENCES blob(sha),
  last_used_utc TEXT NOT NULL,        -- LRU key
  use_count     INTEGER NOT NULL DEFAULT 1,  -- LFU key
  last_score    REAL,                 -- relevance score at last page-in (§5)
  PRIMARY KEY (namespace, sha)
);
CREATE INDEX IF NOT EXISTS ix_page_lru ON page_state(namespace, last_used_utc);
```

### 2.2 Pseudocode — page-in with LRU eviction against the REAL ceiling

```python
def page_in(namespace, model, question, candidate_shas, budget_chars):
    # budget_chars comes straight from the proven ceilings — reuse the real fn verbatim:
    #   context_char_budget(model, question, max_out)  [Invoke-KritScxMuxMatrix.py:75]
    resident, used = [], 0
    for sha in rank_candidates(namespace, candidate_shas, question):   # §5 relevance order
        blk = materialize(sha, tier_that_fits(model, sha))            # §3 tier selection
        if used + len(blk) > budget_chars:
            continue                          # 6502 bank is full — skip (don't fault: no HTTP 400)
        resident.append((sha, blk)); used += len(blk)
        touch(namespace, sha)                 # UPDATE page_state SET last_used=now, use_count=use_count+1
    evict_lru(namespace, keep=set(s for s,_ in resident))  # DELETE oldest rows beyond a cap
    return "\n".join(b for _,b in resident), [s for s,_ in resident]
```

`evict_lru` deletes `page_state` rows (not blobs — HR23 never purges the corpus) beyond a configurable
resident cap, oldest `last_used_utc` first. This is bank-switching: the corpus stays whole on "disk";
only the *resident-set bookkeeping* is evicted, so the next turn re-pages the hot set cheaply.

---

## 3. Compression tiers — retrieve at the tier that fits the real ceiling

**Old-school:** raw bytes → RLE → shared tiles → procedurally-regenerated content. Pick the smallest
representation that still renders.

**Our four tiers**, each a smaller representation of the same SHA-addressed content:

| Tier | Representation | Built by | When chosen |
|---|---|---|---|
| **0 raw** | utf-8 bytes | miner | tiny files; blob < gzip breakeven |
| **1 gzip** | DEFLATE bytes | miner (`pickStorageTier`) | default at rest; matches SQL `content_gz`/`DECOMPRESS` |
| **2 simhash-collapse** | ref to a near-identical blob | HR27 SimHash (Hamming ≤ 3) | near-dup files (vendored copies, minor edits) |
| **3 SCX capsule** | model-written summary of the blob | inter-agent pipeline (§6) | when even gzip won't fit the budget |

The **retrieval-time** decision is the important one: **serve the tier that fits the remaining budget**.
The proof doc's core rule — "cap injection per model at the REAL usable ceiling" — becomes a tier
ladder: try raw/gzip full source; if a blob alone would blow the *per-file* share of the budget, drop
to its **tier-3 capsule** instead of dropping the file entirely (which is what `trim_to_budget` does
today at line 98 — `continue`, silently losing the file, the exact bug called out at
`Invoke-KritScxSyntheticContext.py:25`).

### 3.1 Pseudocode — tier ladder at materialize time

```python
def materialize(sha, remaining_budget_chars):
    b = blob_row(sha)
    full = inflate(b.raw_bytes) if b.tier == 1 else b.raw_bytes.decode()  # gzip vs raw
    if len(full) <= remaining_budget_chars:
        return full                                   # tier 0/1 — full fidelity fits
    if sha in near_dup_index:                          # tier 2 — collapse to canonical twin
        return f"# (near-identical to {near_dup_index[sha]}, Hamming<=3)\n" + head(full, 400)
    cap = capsule_for(sha)                             # tier 3 — SCX summary capsule (§6)
    if cap:
        return f"### CAPSULE {sha[:8]}\n{cap.summary}\n"
    return head(full, remaining_budget_chars)          # last resort: truncate, never fault
```

This is the "regenerate procedurally" move: when the raw asset won't fit the bank, load the compact
capsule that reconstructs the *meaning* at a fraction of the tokens — the difference between shipping
one file of source and shipping a two-line "what this file does + its key symbols" that the model can
act on. `simhash64()` and Hamming distance are **already implemented** in HR27
(`Get-KriticalContentSimHash`, `Get-KriticalSimHashHammingDistance`) — tier 2 reuses them verbatim.

---

## 4. Delta encoding — store diffs, reconstruct on demand

**Old-school:** store keyframe + deltas; reconstruct the frame by replaying deltas. **Our mechanism:**
the corpus is re-mined every wave; most files change a few lines. `file_ref` is already versioned by
`(path, version_utc)` (§1.1). Instead of a fresh full blob per version, store a **base blob + a chain
of deltas**; reconstruct the requested version on read.

### 4.1 Schema — delta chain

```sql
CREATE TABLE IF NOT EXISTS blob_delta(
  path          TEXT NOT NULL,
  version_utc   TEXT NOT NULL,
  base_sha      TEXT NOT NULL REFERENCES blob(sha),   -- the keyframe this delta rebuilds from
  patch         BLOB NOT NULL,                        -- unified-diff / bsdiff bytes
  result_sha    TEXT NOT NULL,                        -- sha of the reconstructed content (verify)
  PRIMARY KEY (path, version_utc)
);
```

### 4.2 Pseudocode — store-delta on re-mine, reconstruct on read

```python
def store_version(path, new_src):
    prev = latest_ref(path)                            # most recent file_ref for this path
    new_sha = sha256(new_src)
    if prev and prev.sha != new_sha:
        patch = make_patch(inflate(blob(prev.sha)), new_src)   # e.g. bsdiff / difflib unified
        if len(patch) < len(new_src) * DELTA_BREAKEVEN:        # only if the delta actually wins
            insert blob_delta(path, now, base_sha=prev.sha, patch, result_sha=new_sha)
            insert file_ref(path, now, sha=new_sha)            # ref points at a virtual (delta) blob
            return
    store_full_blob(new_sha, new_src)                          # keyframe (dedup via §1)
    insert file_ref(path, now, sha=new_sha)

def reconstruct(path, version):
    r = ref(path, version)
    if is_keyframe(r.sha): return blob_content(r.sha)
    d = delta_row(path, version)
    out = apply_patch(reconstruct(path, prev_version_of(d.base_sha)), d.patch)
    assert sha256(out) == d.result_sha                 # HR21: verify reconstruction, never trust blind
    return out
```

The `result_sha` check makes reconstruction self-verifying (HR21). **HR23 alignment:** deltas are
*additive history* — every version stays reconstructable, nothing is purged; rotation moves cold delta
chains to an archive sibling exactly as HR27 rotates JSONL. This turns "N full copies of a file across
N waves" into "one keyframe + N small patches" — the frame-delta trick, so wave history costs almost
nothing.

---

## 5. Working-set / relevance eviction — keep the hot set within budget

**Old-school:** the working set is whatever the current routine touches; keep it in the bank, evict the
rest. **Our mechanism:** score each candidate chunk for relevance to the *current task*, page in
highest-scored first until the budget is spent, and let `page_state` carry LRU/LFU so cross-turn
recency counts too.

Today ranking is **purely `ORDER BY LENGTH(content)`** — smallest first (store `search()` line 81;
matrix `retrieve_from_sqlite` line 126). That maximises file *count*, not *relevance*. We add a
composite score.

### 5.1 Relevance score (buildable with what's in the DB — no embeddings required for v1)

```
score(chunk, task) =
      w_lex * lexical_overlap(task_terms, chunk)         -- term hits: reuses the LIKE-term list
    + w_sym * symbol_hit(task_terms, symbols[chunk])     -- JOIN symbols table (already mined)
    + w_rec * recency(page_state.last_used_utc)          -- LRU signal
    + w_freq* log(page_state.use_count)                  -- LFU signal
    + w_dec * decision_link(chunk, recent HR27 rows)     -- was this file cited in a recent capsule?
    - w_dup * is_near_dup(simhash)                        -- demote near-dups (SimHash)
```

v1 needs **zero new infra**: lexical overlap = the existing keyword LIKE terms; `symbol_hit` JOINs the
already-mined `symbols` table (`kritical-local-store.mjs` line 36); recency/frequency read `page_state`;
`decision_link` queries the HR27 log. v2 optionally swaps `w_lex` for E5-Mistral cosine (the embeddings
model is already in the fallback roster per CLAUDE.md) — but that's an upgrade, not a prerequisite.

### 5.2 Pseudocode — ranked, budgeted working set

```python
def rank_candidates(namespace, shas, task):
    terms = tokenize(task)
    scored = []
    for sha in shas:
        f = file_ref_for(sha); syms = symbols_for(f.path)
        s = (W_LEX*lex(terms, sha) + W_SYM*sym(terms, syms)
             + W_REC*recency(namespace, sha) + W_FREQ*freq(namespace, sha)
             + W_DEC*decision_link(sha) - W_DUP*near_dup(sha))
        scored.append((s, sha))
    return [sha for _, sha in sorted(scored, reverse=True)]   # feed §2.2 page_in in this order
```

`page_in` (§2.2) already stops at the budget, so eviction is implicit: unranked/low-score chunks never
become resident, and `evict_lru` drops stale `page_state`. The hot set is thus **always ≤ the model's
real ceiling AND ordered by task relevance** — the working set, kept in the bank.

---

## 6. Inter-agent summarization pipeline — write capsules back so the NEXT turn starts pre-warmed

**Old-school:** a routine leaves a compact result in a shared page for the next routine — no
recomputation. **Our mechanism (the "synthetic mega-context" idea):** after any mux run, the agent
writes an **SCX-summarized capsule** back to the store, keyed to the SHAs it grounded on and linked to
the HR27 decision log. The next agent/turn pages in the *capsule* (tier 3, tiny) instead of re-reading
and re-summarizing the full source — so effective grounding compounds across turns while token cost
stays flat. This is precisely what CLAUDE.md's HR27 headline promises: *"FEEDS SCXCODE MEGA-CONTEXT …
the primary mechanism for the synthetic mega-context-window."*

### 6.1 Schema — capsule table (bridges the corpus store and the HR27 decision log)

```sql
CREATE TABLE IF NOT EXISTS capsule(
  capsule_id      TEXT PRIMARY KEY,     -- 'cap-' + sha256(summary)[:12]
  namespace       TEXT NOT NULL,
  task_sha        TEXT NOT NULL,        -- sha256 of the question/task this capsule answers
  grounded_shas   TEXT NOT NULL,        -- JSON array of blob SHAs it was built from (provenance)
  summary         TEXT NOT NULL,        -- the SCX-written capsule (tier-3 payload)
  summary_sha     TEXT NOT NULL,        -- content-address the capsule itself (dedup capsules too)
  simhash         TEXT NOT NULL,        -- HR27 SimHash for near-dup capsule collapse
  model           TEXT, wave TEXT, session_id TEXT,
  decision_log_id TEXT,                 -- FK-by-value to HR27 decision_log.id (the substrate)
  created_utc     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_capsule_ns_task ON capsule(namespace, task_sha);
```

### 6.2 Pseudocode — capsule write-back, wired to the real synthesis step

The mux **already produces** the perfect capsule payload: `synthesize()` in
`Invoke-KritScxMuxMatrix.py` (lines 245-266) fuses the per-model answers into ONE grounded answer. We
tap that output on the way out:

```python
def write_capsule(namespace, question, synth_result, grounded_shas, model, wave, session_id):
    summary   = synth_result["answer"]                 # <-- the existing synthesize() output
    summary_sha = sha256(summary)
    simh      = simhash64(summary)                      # HR27 primitive
    if near_dup_capsule(namespace, simh, hamming<=3):   # HR27 dedup discipline, do NOT collapse — link
        dup_of = that_capsule.id
    # 1) content-address + store the capsule as a tier-3 blob (dedup via §1)
    upsert blob(sha=summary_sha, tier=3, raw_bytes=summary, simhash=simh, ...)
    # 2) index it for retrieval, with provenance back to the source SHAs
    insert capsule(capsule_id, namespace, task_sha=sha256(question),
                   grounded_shas=json(grounded_shas), summary, summary_sha, simhash=simh,
                   model, wave, session_id, decision_log_id=dlog_id, created_utc=now)
    # 3) mirror to HR27 decision log — the audited substrate (reuse the module verbatim)
    #    Add-KriticalAIResponse -Content $summary -Category response -Model $model \
    #        -Provider scx-mux -Wave $wave -SessionId $session_id  [-EmitToDb]
    return capsule_id
```

Step 3 is a **verbatim call to the shipped HR27 module** — `Add-KriticalAIResponse`
(`KriticalDecisionLogger.psm1` line 483), which already does SHA exact-dupe skip + SimHash near-dup
link + optional SQL emit. The capsule pipeline therefore inherits HR27's dedup, its append-only
guarantee (HR23), and its SQL-Express `decision_log` mirror **for free** — the decision log *is* the
capsule substrate, exactly as the rule intends. On the next turn, `rank_candidates` (§5) sees these
capsules via `decision_link`, and `page_in` serves the tiny tier-3 capsule ahead of the fat source: the
next agent starts pre-warmed.

**Retrieval preference (the mega-context compounding rule):** when a capsule's `grounded_shas` cover the
candidate set for a task with `task_sha` match, page in the **capsule first**, then only the source
SHAs the capsule *didn't* cover. Effective grounding = (capsules of everything ever learned) + (raw
source of the delta) — which is how the effective context exceeds any single raw window.

---

## 7. Cross-agent secure storage + universal prompt-extension layer

The goal: one **namespaced, access-controlled, SQL-backed grounding cache** that any coding agent —
scxcodex today; Claude Code / Codex / etc. later — can (a) **pull** grounded context sized to its
window and (b) **push** summaries/decisions. Delivered as a **localhost-only MCP server** (matches the
existing shipped `kritical-scxcode` MCP surface, Path E) with an equivalent **localhost HTTP/JSON**
contract for non-MCP agents.

### 7.1 The protocol — two verbs, tokened, namespaced

```
POST /v1/page_in    {agent, namespace, model, question, keywords[], max_out}
   -> {resident_shas[], context_text, injected_chars, est_tokens, budget_chars, capsules[]}
      # server runs §5 rank -> §2 page_in -> §3 tier ladder, sized to MODEL_CEILINGS[model].
      # context_text is ready to splice; SCXCODEX-MEGA-MERGE-DESIGN.md owns the splice point.

POST /v1/push_capsule {agent, namespace, question, summary, grounded_shas[], model, wave, session_id}
   -> {capsule_id}
      # server runs §6 write_capsule + the verbatim HR27 Add-KriticalAIResponse mirror.

GET  /v1/stats {agent, namespace} -> corpus/capsule counts (mirrors store `stats`, per-namespace)
```

MCP tool equivalents on the existing `mcp-server/server.mjs` stdio surface:
`kritical_grounding_page_in`, `kritical_grounding_push_capsule`, `kritical_grounding_stats`. Same three
verbs; MCP for agents that speak it, HTTP for those that don't. Both are thin front-ends over the **same
SQLite functions** already in `kritical-local-store.mjs` — `page_in` is `search()` (line 73) upgraded
with §5 ranking + §3 tiering; `push_capsule` is the §6 write-back.

### 7.2 Security model (HR1 + HR29 + localhost-only)

| Concern | Mechanism |
|---|---|
| **Localhost only** | bind `127.0.0.1` **only** (HR29 refusal: never `0.0.0.0`). MCP path is stdio — no socket at all. |
| **Per-agent namespace** | every row (`page_state`, `capsule`) carries `namespace`. A token maps to exactly one namespace prefix; cross-namespace read/write is rejected server-side. Default namespaces: `scxcodex`, `claude-code`, `codex`, plus a shared read-only `corpus:<repo>` for the mined source. |
| **Token** | per-agent bearer token in **HKCU** (same store as `SCX_API_KEY_2..9` per CLAUDE.md), env `KRIT_GROUNDING_TOKEN`. Never on disk in the repo, never logged. Missing/space token -> 401, server still boots (HR29: layer degraded, not fatal). |
| **HR1 — no inference key leaks** | the grounding server **never** performs inference and **never** stores or forwards `SCX_API_KEY`. It serves *text*; the calling agent (mux) holds the SCX key and makes the SCX call. Capsule write-back stores model *output*, never keys. |
| **No secret leakage** | mine-time filter: skip blobs whose path matches a secrets denylist (`.env`, `*.key`, HKCU dumps); redact `Bearer [A-Za-z0-9]+` before a blob is stored. Capsules are model summaries of code, not of secrets. |
| **HR29 — additive/opt-in** | server OFF by default. OFF = port unbound / MCP tool absent. With it off, scxcodex + the mux fall straight back to `retrieve_from_sqlite` (direct DB) or `--corpus` dir — the working baseline. `-Mode Status` (HR16) prints the kill-switch line. |
| **Audit** | every `push_capsule` mirrors to HR27 `decision_log` (append-only, SHA+SimHash) — a tamper-evident trail of what each agent contributed. |

### 7.3 How scxcodex consumes it FIRST, via the shim

scxcodex is the primary surface (CLAUDE.md Path C/E; HR29 clause 5). Consumption order, composed with
the companion shim design:

1. **Boot / pre-warm.** On session start the shim calls `GET /v1/stats` then a broad `page_in` for the
   open files' keywords — pulling **capsules first** (§6 retrieval preference). This reconstructs prior
   context cheaply: the HR27-fed "synthetic mega-context-window" the rulebook describes.
2. **Per-turn injection.** Before each model call, the shim calls `POST /v1/page_in` with the live
   `model` id so the server sizes the block to that model's **real** ceiling
   (`MODEL_CEILINGS`/`context_char_budget`, proven in the proof doc). It receives `context_text` ready
   to splice. **The splice itself is owned by `SCXCODEX-MEGA-MERGE-DESIGN.md`** — this layer guarantees
   the block never overruns the bank (no HTTP 400) and is relevance-ranked.
3. **Write-back.** After the mux synthesises, the shim calls `POST /v1/push_capsule` with the synthesis
   answer + `grounded_shas`. Next turn/agent starts pre-warmed.
4. **Degrade (HR29).** If the server is off/401, the shim uses the mux's existing direct
   `retrieve_from_sqlite`/`--corpus` path. scxcodex still works — layer is additive.

**Composition contract with the shim doc:** this doc owns *what* text comes back and *that it fits*;
the shim doc owns *where* it goes in the prompt. The seam is the `page_in` response's `context_text` +
`budget_chars`. Neither doc duplicates the other; if the shim doc later lands, cross-link §7.1's verbs
to its splice section.

---

## 8. Phased build plan — SCX bulk-write vs. careful hand-work

Per HR10 (code over docs, bulk-programmatic first) and HR21 (paired test for every step). Tagged
**[SCX-BULK]** (fan out to SCX to draft/generate; mechanical, high-volume) vs **[HAND]** (load-bearing,
security- or correctness-critical — human/careful review).

| Phase | Work | Class | Depends on |
|---|---|---|---|
| **P0** Schema + migration | `blob` / `file_ref` / `page_state` / `blob_delta` / `capsule` DDL (SQLite + SQL mirror); one-shot migration of existing `files.content` -> `blob` keyed by existing `sha`. | **[HAND]** DDL + migration (data-lossy if wrong); **[SCX-BULK]** the repetitive SQL-Server mirror DDL. | §1-6 |
| **P1** Dedup miner | Extend `mine()`: content-address blobs, write `file_ref` pointers, populate `simhash`. Prove dedup ratio on the real repo. | **[SCX-BULK]** the extractor edits; **[HAND]** the transaction/consistency boundary. | P0 |
| **P2** Tier ladder | `pickStorageTier` (raw/gzip breakeven) + `materialize` tier-3 fallback so `trim_to_budget` stops silently dropping files. | **[HAND]** — this is the correctness core (the `.5231` bug lives here). | P1 |
| **P3** Page table + LRU | `page_state` bookkeeping, `touch`, `evict_lru`, `page_in`. | **[SCX-BULK]** boilerplate CRUD; **[HAND]** eviction policy. | P1 |
| **P4** Relevance rank | §5 composite score v1 (lexical+symbol+recency+freq+decision_link), JOIN `symbols`. | **[SCX-BULK]** the scoring fns; **[HAND]** weight tuning + a golden-set test. | P3 |
| **P5** Delta encoding | `blob_delta` store-on-remine + self-verifying `reconstruct`. | **[HAND]** — reconstruction correctness (HR21 `result_sha` assert). | P1 |
| **P6** Capsule pipeline | Tap `synthesize()` output -> `write_capsule` -> verbatim `Add-KriticalAIResponse`. | **[SCX-BULK]** the write path; **[HAND]** the HR27 wiring (must not break the shipped module). | P2, P4, HR27 |
| **P7** Grounding server | localhost MCP tools + HTTP `/v1/page_in|push_capsule|stats`; token + namespace enforcement. | **[HAND]** — security surface (HR1/HR29), no bulk. | P3-P6 |
| **P8** scxcodex shim consume | Boot pre-warm, per-turn `page_in`, write-back, degrade path. Cross-link to `SCXCODEX-MEGA-MERGE-DESIGN.md`. | **[HAND]** — the integration seam. | P7 + shim doc |

**Tests (HR21, paired per phase):** `Test-KriticalGroundingDedup` (P1 ratio + round-trip),
`Test-KriticalGroundingTierLadder` (P2 no-silent-drop, capsule fallback fits budget),
`Test-KriticalGroundingPaging` (P3 LRU eviction order), `Test-KriticalGroundingRank` (P4 golden set),
`Test-KriticalGroundingDelta` (P5 reconstruct == original), `Test-KriticalGroundingCapsule` (P6 HR27
mirror + dedup), `Test-KriticalGroundingServer` (P7 namespace isolation + 401 + degrade-to-baseline).
Every server test must include the **HR29 "layer OFF still works"** assertion.

---

## 9. How it composes — one page

```
                 mine (dedup, §1)        re-mine (delta, §4)
   repo source ───────────────► blob (SHA-addressed, tiered §3) ◄──── capsule write-back (§6)
                                   ▲            │                              ▲
                        file_ref   │            │ materialize (tier ladder §3) │ synthesize()
                        (pointers) │            ▼                              │  [real mux code]
                                   │      rank_candidates (§5) ── page_in (§2, LRU) ── hot set
                                   │            │                              │
   HR27 decision_log ◄─────────────┘            ▼                              │
   (substrate, audit)              grounding server (§7, localhost, tokened, per-namespace)
                                                │  page_in / push_capsule / stats
                                                ▼
                    scxcodex shim  ──►  splice (owned by SCXCODEX-MEGA-MERGE-DESIGN.md)  ──► SCX model
                                        sized to MODEL_CEILINGS real ceiling (proof doc)
```

**Bottom line.** The corpus becomes a content-addressed ROM the size of the whole codebase-plus-history;
the mux is an MMU paging relevance-ranked, real-ceiling-sized banks into each model's window; capsules
are pre-computed banks that compound across turns; and a localhost, tokened, per-namespace server lets
every agent share that economy — all additive (HR29), SCX-only (HR1), audited through the HR27 log, and
buildable on the exact SQLite/SQL-Server/mux/logger code that already ships.
```
