# AgentMUX — SQL-Backed Context Operating System

> Dated: 2026-07-06 · Kritical SCXCode / SCXCodex handover note.

## North Star

AgentMUX is a SQL-backed context-switching and memory-management harness for coding agents. It treats model context windows as scarce volatile RAM, stores durable knowledge in structured shared memory, routes bounded tasks across specialised agents and models, records every prompt's provenance, and continuously benchmarks cost, latency, quality, and concurrency so agentic coding work can scale without losing correctness, auditability, or human control.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AgentMUX CLI/API                                │
│ init · index · ask · plan · run · status · review · merge · bench · memory   │
└───────────────┬───────────────────────────────┬──────────────────────────────┘
                │                               │
                v                               v
┌──────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Repo Indexer / Symbol Extract │   │ Benchmark Runner / Empirical Model Router │
│ files · hashes · symbols      │   │ model_eval_results · score formula        │
└───────────────┬──────────────┘   └─────────────────┬─────────────────────────┘
                │                                    │
                v                                    v
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SQL Control Plane / Memory Store                     │
│ files · symbols · memory_items · tasks · prompt_manifests · events · evals   │
│ SQL is authoritative; vector search is only a candidate index.               │
└───────────────┬───────────────────────────────┬──────────────────────────────┘
                │                               │
                v                               v
┌──────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Deterministic Prompt Assembler│   │ Scheduler / Worktree Manager              │
│ redaction · manifests · packs │   │ per-agent scopes · isolated git worktrees  │
└───────────────┬──────────────┘   └─────────────────┬─────────────────────────┘
                │                                    │
                v                                    v
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Agent Pool                                      │
│ Planner · Repo Scout · Coder · Reviewer · Test Writer · Summariser · Arbiter │
│ Agents communicate through SQL events/memory, not hidden private chat.       │
└───────────────┬───────────────────────────────┬──────────────────────────────┘
                │                               │
                v                               v
┌──────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Tool Runner / Safety Gates    │   │ Patch/Test/Merge Review                   │
│ allowlists · audit · redaction│   │ tests · diff review · provenance · merge   │
└──────────────────────────────┘   └───────────────────────────────────────────┘
```

## Integration Strategy

Use the hybrid path:

1. **Outside Codex first**: build AgentMUX as a wrapper around Codex CLI/app and OpenAI-compatible SCX APIs. This is fastest, safest, and avoids maintaining a fork before the shape is proven.
2. **Instrument everything**: persist tasks, prompts, responses, tool calls, patches, tests, benchmark results, and stale-summary state.
3. **Fork only proven harness pieces**: once the wrapper shows which context-assembly or scheduling seams need deeper ownership, move those specific pieces into the Kritical.SCXCodex fork.

## Rust Ownership Path

A lot of AgentMUX belongs in Rust once the control-plane shape is proven. The wrapper is the fast proof path; Rust is the durable product path for anything that must be deterministic, secure, high-throughput, or tightly integrated with the Codex harness.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Kritical.SCXCodex Rust Core                          │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │ Context Packer    │  │ Prompt Manifest  │  │ Secret Redaction / Policy │  │
│  │ token budgets     │  │ hashes/provenance│  │ no raw secret prompts     │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────────┬──────────────┘  │
│           │                     │                         │                 │
│           v                     v                         v                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │ SQL Memory Client │  │ Model Router     │  │ Agent Scheduler           │  │
│  │ sqlite/sqlserver  │  │ empirical score  │  │ scoped worktrees/tools    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────────┬──────────────┘  │
│           │                     │                         │                 │
│           v                     v                         v                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │ SCX API Client    │  │ Audit Event Log  │  │ Merge/Test Arbiter        │  │
│  │ OpenAI-compatible │  │ append-only      │  │ explicit gates            │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Recommended split:

| Keep outside first | Move into Rust when proven |
|---|---|
| Benchmark task definitions | Context packing and model budget enforcement |
| Exploratory prompt templates | Prompt manifest hashing/signing |
| One-off corpus importers | Secret redaction and prompt safety gates |
| Experimental multi-agent policies | Agent scheduler and worktree lifecycle |
| Report generation | Audit event writer and merge/test arbiter |
| Provider/model experiments | SCX-first API client and empirical router |

Rust should own the invariant-bearing path:

1. Read task card and durable memory from SQL.
2. Recompute file hashes and stale-summary state.
3. Assemble deterministic context from source IDs.
4. Redact secrets before prompt assembly.
5. Write a prompt manifest before any model call.
6. Route models from `model_eval_results`.
7. Run each agent with filesystem/tool/network scope.
8. Persist every response, tool call, patch, test, and summary.
9. Refuse merge without tests or explicit override.

Do not move the whole experiment into Rust at once. First stabilise the Python/PowerShell/Node wrapper as the executable spec, then port the invariant-bearing pieces into `Kritical.SCXCodex.exe` module-by-module so upstream Codex updates remain mergeable.

## Empirical Model Routing

Model capability is measured, not marketing-defined. The control plane stores benchmark outputs in `model_eval_results`:

```sql
CREATE TABLE model_eval_results (
    eval_id             TEXT PRIMARY KEY,
    model_id            TEXT NOT NULL,
    benchmark_name      TEXT NOT NULL,
    task_type           TEXT NOT NULL,
    score               REAL NOT NULL,
    latency_ms          INTEGER,
    cost_estimate       REAL,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Routing score:

```text
score = quality_weight * quality
      - latency_weight * latency
      - cost_weight * cost
      - failure_weight * failure_rate
```

Current mux defaults include at least five models and keep `MiniMax-M2.7` first because local notes identify it as strong for structured output:

```text
MiniMax-M2.7                 ctx=195000 maxOut=4096 feats=[tools,reasoning,json_mode]
DeepSeek-V3.1                ctx=129000 maxOut=4096 feats=[tools,json_mode]
gpt-oss-120b                 ctx=108000 maxOut=4096 feats=[reasoning]
Qwen3-32B                    ctx=32000  maxOut=2048 feats=[tools,json_mode]
gemma-4-31B-it               ctx=128000 maxOut=2048 feats=[json_mode]
```

## MVP Flow

```text
1. User submits objective.
2. Planner creates parent task.
3. Repo retriever loads relevant file/symbol summaries.
4. Planner decomposes into child tasks.
5. Scheduler assigns tasks to agents/models using empirical score.
6. Prompt assembler creates signed, inspectable prompt manifests.
7. Agents run in isolated git worktrees.
8. Results are stored as events.
9. Summariser writes typed durable memory.
10. Reviewer checks patches.
11. Tests run.
12. Merge arbiter chooses patch.
13. Memory invalidator marks stale summaries by file hash.
14. Consolidator writes final project memory.
```

## Required Tables

Minimum SQLite-first control plane:

- `files`: repo-relative path, language, content hash, loc, mined timestamp.
- `symbols`: extracted symbols linked to `files`.
- `memory_items`: typed summaries, facts, decisions, patterns, and provenance.
- `tasks`: parent/child task cards, status, assigned agent/model, worktree path.
- `prompt_manifests`: deterministic context packs, source IDs, redaction hash, prompt hash.
- `agent_events`: model calls, tool calls, responses, failures, patches, tests, summaries.
- `model_eval_results`: empirical benchmark score records.

Keep the schema portable to Postgres/SQL Server. SQL is the source of truth; vector search may exist only as an acceleration index.

## CLI Shape

```bash
agentmux init ./repo
agentmux index
agentmux ask "map the auth system"
agentmux plan "add SQL-backed shared memory"
agentmux run --parallel 8
agentmux status
agentmux review T007
agentmux merge T007
agentmux bench --models scx-coder,minimax,deepseek,gpt-oss --parallel 1,2,4,8,16
agentmux memory search "<query>"
agentmux memory show <id>
agentmux memory stale
agentmux memory rebuild
```

## Safety Baseline

- Per-agent filesystem scopes.
- Per-agent tool scopes.
- Per-agent shell allowlists.
- Git worktree isolation for implementation tasks.
- No raw secret exposure in prompts.
- Secret scanning before prompt assembly.
- Redaction before every model call.
- Signed prompt manifests.
- Approval gates for destructive commands.
- Network egress control.
- Patch review before merge.
- Audit log for every model call, tool call, test run, and merge decision.

## Implemented Slice In This Repo

- `mux/Invoke-KritScxMuxMatrix.py`: multi-model fan-out, per-model real context ceilings, SCX-only transport, empirical routing from `model_eval_results`, SQLite/MSSQL/dir corpus input, `reasoning_content` fallback.
- `mux/Invoke-KritScxSyntheticContext.py`: single-model multi-lens proof, defaults to `MiniMax-M2.7`, five lenses, SQL Server context retrieval, `reasoning_content` fallback.
- `sql/chunk-store-schema.sql`: portable `model_eval_results` table plus SQL Server equivalent notes.
- `mux/Invoke-KritScxMuxMatrix.test.py`: offline tests for model count, MiniMax headroom, scoring, empirical routing, SQL hex decoding, and reasoning fallback.
