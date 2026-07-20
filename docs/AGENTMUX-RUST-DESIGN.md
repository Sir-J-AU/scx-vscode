# AgentMUX Rust Design — Kritical.SCXCodex Core

> Dated: 2026-07-06 · Design target: Rust modules applied by the Kritical.SCXCodex pack overlay on top of upstream `openai/codex`.

## Goal

Move the invariant-bearing AgentMUX pieces into the compiled `Kritical.SCXCodex.exe` while keeping the Python/PowerShell/Node mux scripts as the executable prototype. The Rust layer should glue into upstream Codex rather than fork everything:

- Keep upstream Codex agent loop, sandbox, approvals, MCP, hooks, skills, and config loading where possible.
- Add SCX-first model routing, SQL-backed shared memory, deterministic prompt manifests, context paging, and audit events as Kritical overlay modules.
- Preserve easy upstream rebases: patch a small number of explicit Rust entrypoints and keep most Kritical logic in new files.

## Mental Model

AgentMUX is a memory manager and scheduler for coding agents.

```text
8-bit machine trick                 AgentMUX equivalent
──────────────────────────────────  ──────────────────────────────────────────
Tiny RAM                            Model context window
ROM                                 Checked-in docs, AGENTS.md, stable rules
Bank-switched RAM                   Per-agent context pack
Page table                          SQL rows mapping facts/files/tasks/summaries
Dirty bit                           Summary stale flag / file hash mismatch
Overlay loader                      Prompt assembler swaps relevant context in/out
Interrupt                           Tool result, test failure, approval request, stop hook
DMA/bus                             Shared SQL event log between sister agents
Memory-mapped I/O                   MCP/tool calls exposed as typed capabilities
TLB/cache                           Hot summary cache for current task working set
Scheduler quantum                   Per-agent token/time/tool budget
Supervisor mode                     Human approval / merge arbiter
```

The design rule is simple: **context is volatile RAM; SQL is durable memory; prompts are deterministic pages loaded from SQL with provenance.**

## Agent-System Equivalents

| Old system concept | AgentMUX equivalent | Implementation point |
|---|---|---|
| Bank switching | Swap a model's active context between task-specific memory banks | `context` packs role/task banks per manifest |
| Paging | Pull only relevant repo/docs/task-history slices into prompt RAM | `context_pages`, `prompt_manifest_pages` |
| Interrupts | Events from sister agents, tools, tests, commits, and humans | `AgentInterrupt`, `agent_events` |
| DMA | Bulk retrieval/indexing/summarisation outside the main loop | `DmaWriter`, indexer, summariser |
| ROM routines | Immutable project rules, `AGENTS.md`, standards, safety policy | `RomOverlay`, prompt contracts, checked-in docs |
| RAM | Active prompt/context window | `ActiveContext` |
| Disk | SQL/object/vector store | `MemoryStore` |
| Page table | Retrieval manifest showing what was loaded and why | `prompt_manifests`, `prompt_manifest_items` |
| Bus arbitration | Scheduler assigns work, tools, tokens, budgets, leases | `BusArbiter`, `Lease` |
| Cache invalidation | Detect stale summaries after code changes | `summary_dependencies`, file hashes |
| Write-back cache | Stage findings before committing to shared memory | summariser flush from events to `memory_items` |
| Process table | Agent registry: role, task, status, context bank, model, costs, outputs | `agent_runs`, `agent_run_leases` |

### Process Table

The process table is the operating-system view of sister agents. It prevents "parallel chats" from becoming invisible state.

```sql
CREATE TABLE agent_runs (
  agent_run_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  prompt_manifest_id TEXT,
  context_bank TEXT,
  worktree_path TEXT,
  token_budget INTEGER,
  tokens_used INTEGER DEFAULT 0,
  cost_estimate REAL,
  started_at TEXT,
  stopped_at TEXT,
  exit_reason TEXT,
  output_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_run_leases (
  agent_run_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  PRIMARY KEY (agent_run_id, lease_id)
);
```

Example live view:

```text
PID   ROLE      MODEL          STATE       BANK        MANIFEST  LEASES
A101  planner   MiniMax-M2.7   completed   planner     M501      -
A102  scout     Qwen3-32B      completed   scout-auth  M502      read:auth/*
A103  coder     DeepSeek-V3.1  running     coder-auth  M503      write:src/auth.ts
A104  reviewer  MiniMax-M2.7   waiting     reviewer    -         waits:A103
```

## Current External Research Signals

Primary-source patterns to steal deliberately:

- **Virtual context management**: MemGPT frames LLM memory as an OS-style hierarchy with data moved between limited context and external storage. AgentMUX should copy the tiered-memory idea but make SQL the authoritative page table.
- **Skill libraries and self-verification**: Voyager uses an accumulating library of executable skills plus feedback/error loops. AgentMUX should store project-specific playbooks and verified task summaries as typed memory, not hidden chat.
- **Agent-computer interface quality**: SWE-agent shows that agent performance depends heavily on the interface exposed to the model. AgentMUX should expose small, typed, deterministic tools and file views rather than dumping arbitrary shell output.
- **Native Codex surfaces**: Current Codex supports sandbox/approval controls, MCP, hooks, memories, open-source CLI/SDK/app-server components, and subagents. AgentMUX should integrate with those seams instead of replacing them.

## Pack Overlay Strategy

The current pack already applies branding inside `codex-wrapper/pack/Build-KriticalSCXCodex.ps1` by editing upstream `codex-rs/cli/src/main.rs`, compiling upstream Codex, and packaging `Kritical.SCXCodex.exe`.

Extend that overlay in three phases:

```text
Phase 0 — docs/prototype
  Keep Python mux and SQL schema as executable spec.

Phase 1 — additive Rust modules
  Copy new Rust files into upstream worktree under codex-rs/kritical-scx/.
  Patch CLI to expose `agentmux` subcommands.
  Patch model selection path only enough to prefer SCX routing when enabled.

Phase 2 — harness interception
  Add prompt manifest creation before model calls.
  Add SQL event logging around model/tool calls.
  Add context packer before agent prompts.

Phase 3 — scheduler ownership
  Add native Rust subagent scheduler/worktree manager.
  Keep upstream sandbox/approval mechanics; wrap them with stricter SCX policy.
```

Overlay must stay small and declarative:

```text
codex-wrapper/pack/overlay/
  codex-rs/kritical-scx/Cargo.toml.fragment
  codex-rs/kritical-scx/src/lib.rs
  codex-rs/kritical-scx/src/config.rs
  codex-rs/kritical-scx/src/sql.rs
  codex-rs/kritical-scx/src/router.rs
  codex-rs/kritical-scx/src/context.rs
  codex-rs/kritical-scx/src/manifest.rs
  codex-rs/kritical-scx/src/redaction.rs
  codex-rs/kritical-scx/src/audit.rs
  codex-rs/kritical-scx/src/scheduler.rs
  codex-rs/kritical-scx/src/worktree.rs
  codex-rs/kritical-scx/src/scx_client.rs
  codex-rs/kritical-scx/src/json_contract.rs
  codex-rs/kritical-scx/src/bench.rs
  patches/main-agentmux-command.patch
  patches/model-router-hook.patch
  patches/prompt-manifest-hook.patch
```

`Build-KriticalSCXCodex.ps1` should apply the overlay after branding and before `cargo build`. Verify the resulting binary contains:

- `Kritical.SCXCodex`
- `OpenAI Codex customised for Southern Cross AI`
- `AgentMUX`
- `SCX_API_KEY`
- `model_eval_results`

## Rust Module Design

### `config`

Purpose: load SCX/AgentMUX settings without touching native provider auth/settings.

Inputs:

- Project `.codex/config.toml` where trusted.
- Kritical-specific config file if present: `.kritical/scxcodex.toml`.
- Environment variables with SCX namespace only, especially `SCX_API_KEY`.

Non-goals:

- Do not read, print, modify, migrate, or validate native OpenAI/Anthropic/Claude/Codex auth files or keys.
- Do not alter upstream `~/.codex` unless an explicit Kritical command is invoked for Kritical-only settings.

Key structs:

```rust
pub struct ScxCodexConfig {
    pub enabled: bool,
    pub api_base: String,
    pub default_model: String,
    pub sqlite_path: PathBuf,
    pub mssql: Option<MssqlConfig>,
    pub max_parallel_agents: usize,
    pub max_parallel_model_calls: usize,
    pub require_prompt_manifest: bool,
    pub require_secret_redaction: bool,
}
```

### `sql`

Purpose: authoritative control plane.

Start with SQLite. Add SQL Server behind a trait once the Rust core is stable.

```rust
pub trait MemoryStore {
    fn upsert_file(&self, file: FileRecord) -> Result<()>;
    fn get_file(&self, path: &str) -> Result<Option<FileRecord>>;
    fn search_memory(&self, query: MemoryQuery) -> Result<Vec<MemoryItem>>;
    fn create_task(&self, task: TaskCard) -> Result<TaskId>;
    fn write_manifest(&self, manifest: PromptManifest) -> Result<ManifestId>;
    fn write_event(&self, event: AgentEvent) -> Result<EventId>;
    fn latest_model_scores(&self, task_type: &str, candidates: &[ModelId]) -> Result<Vec<ModelScore>>;
    fn mark_stale_by_hash(&self, path: &str, new_sha256: &str) -> Result<usize>;
}
```

Tables:

- `files`
- `symbols`
- `agents`
- `models`
- `memory_items`
- `tasks`
- `prompt_manifests`
- `prompt_manifest_items`
- `agent_events`
- `tool_events`
- `patches`
- `test_runs`
- `model_eval_results`
- `context_pages`
- `summary_dependencies`
- `agent_runs`
- `agent_run_leases`

Use SQL as source of truth. Vector search can be added later as an index table, not authority.

### Baseline SQL Control Plane

This is the first serious schema target. Keep it SQLite-portable, then mirror to SQL Server/Postgres.

```sql
CREATE TABLE agents (
    agent_id            TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL,
    default_model       TEXT NOT NULL,
    max_context_tokens  INTEGER NOT NULL,
    max_parallel_tasks  INTEGER NOT NULL,
    trust_level         TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE models (
    model_id            TEXT PRIMARY KEY,
    provider            TEXT NOT NULL,
    model_name          TEXT NOT NULL,
    context_tokens      INTEGER,
    supports_tools      INTEGER NOT NULL DEFAULT 0,
    supports_json       INTEGER NOT NULL DEFAULT 0,
    supports_reasoning  INTEGER NOT NULL DEFAULT 0,
    cost_input_per_m    REAL,
    cost_output_per_m   REAL,
    latency_class       TEXT,
    coding_score_note   TEXT,
    active              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tasks (
    task_id             TEXT PRIMARY KEY,
    parent_task_id      TEXT REFERENCES tasks(task_id),
    title               TEXT NOT NULL,
    objective           TEXT NOT NULL,
    status              TEXT NOT NULL,
    priority            INTEGER NOT NULL DEFAULT 100,
    assigned_agent_id   TEXT REFERENCES agents(agent_id),
    model_id            TEXT REFERENCES models(model_id),
    repo_id             TEXT,
    branch_name         TEXT,
    worktree_path       TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memory_items (
    memory_id           TEXT PRIMARY KEY,
    memory_type         TEXT NOT NULL,
    scope               TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT NOT NULL,
    source_type         TEXT NOT NULL,
    source_ref          TEXT NOT NULL,
    confidence          REAL NOT NULL DEFAULT 0.5,
    freshness           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stale               INTEGER NOT NULL DEFAULT 0,
    created_by_agent_id TEXT REFERENCES agents(agent_id),
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repo_files (
    file_id             TEXT PRIMARY KEY,
    repo_id             TEXT NOT NULL,
    path                TEXT NOT NULL,
    content_hash        TEXT NOT NULL,
    language            TEXT,
    size_bytes          INTEGER,
    last_seen_commit    TEXT,
    last_indexed_at     TEXT,
    UNIQUE(repo_id, path)
);

CREATE TABLE code_symbols (
    symbol_id           TEXT PRIMARY KEY,
    repo_id             TEXT NOT NULL,
    file_id             TEXT REFERENCES repo_files(file_id),
    symbol_type         TEXT NOT NULL,
    name                TEXT NOT NULL,
    qualified_name      TEXT,
    start_line          INTEGER,
    end_line            INTEGER,
    signature           TEXT,
    content_hash        TEXT
);

CREATE TABLE prompt_manifests (
    manifest_id         TEXT PRIMARY KEY,
    task_id             TEXT REFERENCES tasks(task_id),
    agent_id            TEXT REFERENCES agents(agent_id),
    model_id            TEXT REFERENCES models(model_id),
    prompt_hash         TEXT NOT NULL,
    estimated_tokens    INTEGER,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prompt_manifest_items (
    manifest_id         TEXT REFERENCES prompt_manifests(manifest_id),
    item_type           TEXT NOT NULL,
    item_ref            TEXT NOT NULL,
    reason_loaded       TEXT NOT NULL,
    token_estimate      INTEGER,
    rank_score          REAL,
    PRIMARY KEY (manifest_id, item_type, item_ref)
);

CREATE TABLE agent_events (
    event_id            TEXT PRIMARY KEY,
    task_id             TEXT REFERENCES tasks(task_id),
    agent_id            TEXT REFERENCES agents(agent_id),
    event_type          TEXT NOT NULL,
    event_body          TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE test_runs (
    test_run_id         TEXT PRIMARY KEY,
    task_id             TEXT REFERENCES tasks(task_id),
    command             TEXT NOT NULL,
    exit_code           INTEGER,
    stdout              TEXT,
    stderr              TEXT,
    duration_ms         INTEGER,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patches (
    patch_id            TEXT PRIMARY KEY,
    task_id             TEXT REFERENCES tasks(task_id),
    agent_id            TEXT REFERENCES agents(agent_id),
    base_commit         TEXT NOT NULL,
    diff_text           TEXT NOT NULL,
    status              TEXT NOT NULL,
    reviewer_agent_id   TEXT REFERENCES agents(agent_id),
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Memory Layers

| Layer | Purpose | Stored as |
|---|---|---|
| Immutable instruction memory | Product goals, repo rules, `AGENTS.md`, safety policy, definition of done | ROM overlays, checked-in docs, prompt contract hashes |
| Repo semantic memory | Files, symbols, functions, routes, tables, tests, call/dependency graph, churn | `repo_files`, `code_symbols`, `context_pages` |
| Task memory | Objective, status, scope, files touched, risks, next tasks | `tasks`, `agent_runs` |
| Episodic agent memory | What happened during a run: attempts, failures, corrections, tool outputs | append-only `agent_events` |
| Distilled project memory | Stable patterns, decisions, pitfalls, verified facts | typed `memory_items` |
| Working context | Actual prompt payload for one call | `prompt_manifests` + loaded pages |

### `context`

Purpose: bank-switch/page context into each model call.

Algorithm:

```text
1. Resolve task card.
2. Resolve model real ceiling from measured capability table.
3. Reserve output and safety headroom.
4. Build working set:
   a. hard rules and safety policy
   b. task card
   c. directly relevant file chunks
   d. typed summaries with valid dependency hashes
   e. recent sibling-agent events
   f. benchmark/model-routing notes
5. Score pages by relevance, freshness, provenance confidence, and task role.
6. Pack pages until token budget is full.
7. Emit deterministic manifest before model call.
```

Page metadata:

```rust
pub struct ContextPage {
    pub page_id: String,
    pub source_kind: SourceKind,
    pub source_id: String,
    pub hash: String,
    pub token_estimate: u32,
    pub priority: f32,
    pub stale: bool,
    pub provenance: Vec<SourceRef>,
}
```

Old-machine tricks to implement:

- **Working-set window**: keep only pages touched by the current task and nearest dependencies.
- **Dirty/stale bit**: invalidate summaries when file hashes change.
- **Overlay pages**: load role-specific prompts only for planner/scout/coder/reviewer.
- **Bank switching**: each sister agent gets a different prompt bank but shared SQL memory.
- **Page faults**: if an agent requests missing context, fetch the page and write an event.
- **Compaction**: summarize completed event spans into typed memory, then drop raw chatter from the next prompt.

### `manifest`

Purpose: make every prompt inspectable and replayable.

Manifest fields:

```rust
pub struct PromptManifest {
    pub manifest_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub model_id: String,
    pub context_pages: Vec<ContextPageRef>,
    pub prompt_sha256: String,
    pub redaction_sha256: String,
    pub policy_version: String,
    pub created_at: DateTime<Utc>,
}
```

Rules:

- No model call without a manifest unless explicitly running in diagnostic bypass mode.
- Manifest records source IDs and hashes, not raw secrets.
- Manifest should be stable enough for record/replay.

### `redaction`

Purpose: prevent raw secret exposure before prompt assembly.

Layers:

1. Static regex scanning for common secrets/tokens.
2. Entropy scanning for unknown credential-like strings.
3. Path/source denylist for native provider auth files.
4. Replacement with typed placeholders: `{{REDACTED_SECRET:sha256_prefix}}`.
5. Audit event with counts and redaction hash, not secret values.

Hard boundary:

```text
Never inspect native OpenAI/Anthropic/Claude/ChatGPT/Codex auth settings or keys.
SCX routing uses SCX_API_KEY only.
```

### `router`

Purpose: measured model routing.

Inputs:

- Candidate models.
- `model_eval_results`.
- Task type.
- Required features: `tools`, `reasoning`, `json_mode`, large context, low latency.
- Concurrency budget.

Formula:

```text
score = quality_weight * quality
      - latency_weight * latency
      - cost_weight * cost
      - failure_weight * failure_rate
```

Default cold-start candidates:

```text
MiniMax-M2.7     ctx=195000 maxOut=4096 feats=[tools,reasoning,json_mode]
DeepSeek-V3.1    ctx=129000 maxOut=4096 feats=[tools,json_mode]
gpt-oss-120b     ctx=108000 maxOut=4096 feats=[reasoning]
Qwen3-32B        ctx=32000  maxOut=2048 feats=[tools,json_mode]
gemma-4-31B-it   ctx=128000 maxOut=2048 feats=[json_mode]
```

Routing must treat these as starting priors only. Once benchmark rows exist, scores win.

### `scx_client`

Purpose: OpenAI-compatible SCX transport.

Requirements:

- Uses `SCX_API_KEY`.
- Supports streaming and non-streaming.
- Reads `message.content`, fallback to `message.reasoning_content`.
- Supports JSON schema/structured-output validation when model supports it.
- Writes usage/latency/failure events.
- Never falls back to native provider keys.

### `json_contract`

Purpose: force sister agents to communicate through typed outputs, not mush.

Core output contracts:

```text
PlannerOutput
ScoutOutput
CoderOutput
ReviewerOutput
TestWriterOutput
SummariserOutput
MergeArbiterOutput
BenchmarkOutput
```

Each contract should include:

- `task_id`
- `confidence`
- `claims`
- `evidence`
- `files_touched`
- `followups`
- `memory_writes`
- `risk_flags`

Validate responses before storing them as trusted memory. Invalid JSON becomes an event, not memory.

### `scheduler`

Purpose: run sister agents safely and cheaply.

Scheduling model:

```text
Planner creates task DAG.
Repo Scout agents read only.
Coder agents get isolated worktrees.
Reviewer/Test agents inspect patches.
Summariser writes typed memory.
Merge Arbiter chooses a patch and requires tests or explicit override.
```

Concurrency controls:

- Global max model calls.
- Per-model max model calls.
- Per-repo worktree limit.
- Per-agent token budget.
- Per-agent wall-clock budget.
- Backoff on HTTP failures/rate limits.
- Stop spawning when marginal benchmark score drops.

Scheduler responsibilities:

- Decide which tasks can run in parallel.
- Decide which model should handle each task.
- Decide which context bank to load.
- Decide whether a result needs review.
- Decide whether summaries need regeneration.
- Decide whether a task should be split further.
- Decide whether a patch can be merged.
- Decide whether the human must be interrupted.

Initial routing baseline:

| Task type | Default role | Preferred features | Cold-start model order | Notes |
|---|---|---|---|---|
| Planning / decomposition | Planner | reasoning, JSON | `MiniMax-M2.7`, `DeepSeek-V3.1` | Must output bounded task cards, not prose. |
| Repo exploration | Repo Scout | large context, low cost | `gemma-4-31B-it`, `Qwen3-32B`, `DeepSeek-V3.1` | Read-only; many can run in parallel. |
| Code patching | Coder | coding quality, tools | `DeepSeek-V3.1`, `MiniMax-M2.7`, `gpt-oss-120b` | Isolated worktree and file leases required. |
| Structured extraction | Scout/Summariser | strict JSON | `MiniMax-M2.7`, `Qwen3-32B` | Reject invalid JSON; do not trust partial prose. |
| Security review | Reviewer | reasoning, long context | `MiniMax-M2.7`, `gpt-oss-120b`, `DeepSeek-V3.1` | Higher priority than coder continuation. |
| Test failure repair | Coder | local context, tools | `DeepSeek-V3.1`, `MiniMax-M2.7` | Load failing logs via interrupt/page fault. |
| Memory summarisation | Summariser | JSON, compression | `MiniMax-M2.7`, `Qwen3-32B`, `gemma-4-31B-it` | Writes typed memory only after validation. |
| Merge arbitration | Merge Arbiter | reasoning, policy | `MiniMax-M2.7` | Requires tests or explicit override. |
| Benchmarking | Bench Runner | deterministic output | all candidates | Writes `model_eval_results`; no code mutation. |

Routing is empirical after cold-start:

```text
1. Filter by required features and safety policy.
2. Rank by latest `model_eval_results` for task_type/benchmark_name.
3. Apply concurrency/rate-limit budget.
4. Prefer cheaper model only when quality score is within configured tolerance.
5. Record latency/cost/failure back into the control plane.
```

### `worktree`

Purpose: isolate code-writing agents.

Rules:

- One git worktree per implementation task.
- Read-only scouts do not get write permission.
- Coder worktrees are named by task ID.
- Patch is linked to task, manifest, model call, and test run.
- Merge requires reviewer/test event or explicit override.

### `audit`

Purpose: append-only observability.

Events:

- `TaskCreated`
- `PromptManifestWritten`
- `ModelCallStarted`
- `ModelCallFinished`
- `ModelCallFailed`
- `ToolCallStarted`
- `ToolCallFinished`
- `PatchCreated`
- `TestRunFinished`
- `MemoryWritten`
- `SummaryInvalidated`
- `MergeApproved`
- `MergeRejected`

Audit rows should be enough to reconstruct what the agent saw and why it acted, without storing secrets.

### `bench`

Purpose: generate empirical model-routing data.

Bench dimensions:

- Task type: coding, review, summarisation, SQL reasoning, JSON extraction, planning.
- Concurrency: 1, 2, 4, 8, 16 streams.
- Context size: small, medium, large, near-ceiling.
- Output contract strictness: freeform, JSON, schema-validated JSON.
- Failure mode: timeout, malformed JSON, reasoning-only answer, hallucinated file, bad patch.

Writes to `model_eval_results`.

## Command Design

Expose these under the compiled binary:

```powershell
Kritical.SCXCodex agentmux init <repo>
Kritical.SCXCodex agentmux index
Kritical.SCXCodex agentmux ask "<question>"
Kritical.SCXCodex agentmux plan "<objective>"
Kritical.SCXCodex agentmux run --parallel 8
Kritical.SCXCodex agentmux status
Kritical.SCXCodex agentmux review <task>
Kritical.SCXCodex agentmux merge <task>
Kritical.SCXCodex agentmux bench --models MiniMax-M2.7,DeepSeek-V3.1,gpt-oss-120b --parallel 1,2,4,8,16
Kritical.SCXCodex agentmux memory search "<query>"
Kritical.SCXCodex agentmux memory show <id>
Kritical.SCXCodex agentmux memory stale
Kritical.SCXCodex agentmux memory rebuild
```

Keep the existing `codex` command behavior intact. `agentmux` is additive.

## Prompt Contracts

### Planner

```text
You are the planner. Output JSON only.
Break the objective into bounded tasks that can be independently verified.
Each task must include scope, files likely relevant, dependencies, acceptance criteria,
risk flags, and recommended agent role/model features.
Do not write code.
```

### Repo Scout

```text
You are a read-only repo scout. Output JSON only.
Find facts with file/line evidence. Prefer exact source references over inference.
If evidence is missing, say missing. Do not propose patches.
```

### Coder

```text
You are a coder in an isolated worktree. Output JSON plus patch metadata only.
Make the smallest correct change for the task card. Do not modify unrelated files.
Record tests run and residual risks.
```

### Reviewer

```text
You are a reviewer. Output JSON only.
Check correctness, safety, security, tests, and scope control.
Reject patches that lack evidence or mutate unrelated state.
```

### Summariser

```text
You are a memory summariser. Output JSON only.
Write durable typed memory only for stable facts, verified decisions, reusable patterns,
and known pitfalls. Include provenance and dependency hashes.
```

## Implementation Order

1. Add overlay copy support in `Build-KriticalSCXCodex.ps1`.
2. Add `kritical-scx` Rust module skeleton.
3. Add SQLite schema and `MemoryStore` trait.
4. Add `model_eval_results` reader and router.
5. Add `SCX_API_KEY`-only client.
6. Add `agentmux bench` writing eval rows.
7. Add deterministic context packer and prompt manifest writer.
8. Add read-only `agentmux ask`.
9. Add planner/scout/coder/reviewer JSON contracts.
10. Add worktree manager.
11. Add scheduler.
12. Add merge arbiter.
13. Add SQL Server backend.
14. Add hook integration for redaction/audit/compaction.

## Upstream Merge Discipline

- Keep all new Rust under `codex-rs/kritical-scx/` where possible.
- Patch upstream files only at stable seams: CLI command registration, model-call boundary, prompt assembly boundary, and event/hook boundary.
- Store every patch as an overlay artifact so failures are visible during pack build.
- Verify upstream merge with:
  - compile
  - branding string scan
  - AgentMUX string scan
  - offline schema/router tests
  - no native provider auth/key path access

## References

- OpenAI Codex manual fetched 2026-07-06: sandbox/approvals, MCP, hooks, memories, subagents, open-source components.
- `openai/codex`: https://github.com/openai/codex
- MemGPT: https://arxiv.org/abs/2310.08560
- Voyager: https://arxiv.org/abs/2305.16291
- SWE-agent: https://arxiv.org/abs/2405.15793
- AgentMUX executable prototype: `mux/Invoke-KritScxMuxMatrix.py`
- SCXCodex pack builder: `codex-wrapper/pack/Build-KriticalSCXCodex.ps1`
