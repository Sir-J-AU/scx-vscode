# Kritical.SCXCode Docs Index

Start here when auditing, proving, or extending the SCXCode stack.

## Current Truth

| Doc | Purpose |
|---|---|
| [COMPLETE-AUDIT.md](COMPLETE-AUDIT.md) | Full shipped-vs-gap inventory for routers, shims, mux, stores, packs, VS Code, CLI tooling, and packaging. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current runtime architecture and kill-switch map. |
| [RUNBOOK.md](RUNBOOK.md) | Operator commands for secrets, routers, packs, supervisor, stores, proof, and rollback. |
| [BUILD-PIPELINE.md](BUILD-PIPELINE.md) | Repeatable pack/docs/build/proof pipeline. |
| [FREE-AND-SCX-AGENT-PACKS-2026-07-07.md](FREE-AND-SCX-AGENT-PACKS-2026-07-07.md) | Free-router and SCX-native agent pack notes. |
| [KILO-AND-MEGA-AGENTIC-PIPELINE-2026-07-08.md](KILO-AND-MEGA-AGENTIC-PIPELINE-2026-07-08.md) | Kilo, OpenClaw/KiloClaw, Hermes, comparators, free lanes, MCP, and queue-runner design. |
| [KRITICAL-CODING-SYSTEM-USAGE.md](KRITICAL-CODING-SYSTEM-USAGE.md) | Plain-English operator guide for setup, free model failover, repo bootstrap, queue use, Node API, and proof. |

## Architecture And Design

| Doc | Purpose |
|---|---|
| [AGENTIC-CODEX.md](AGENTIC-CODEX.md) | Codex agentic bridge notes. |
| [SCX-AGENTIC-BRIDGE-SPEC.md](SCX-AGENTIC-BRIDGE-SPEC.md) | SCX bridge contract and behavior. |
| [AGENTMUX.md](AGENTMUX.md) | Multi-agent mux notes. |
| [AGENTMUX-RUST-DESIGN.md](AGENTMUX-RUST-DESIGN.md) | Rust mux design notes. |
| [MEGA-CONTEXT-ARCHITECTURE.md](MEGA-CONTEXT-ARCHITECTURE.md) | Synthetic long-context architecture. |
| [MCP-SERVERS.md](MCP-SERVERS.md) | MCP server inventory. |
| [MUX.md](MUX.md) | Mux commands and concepts. |

## SCX Reference And Evidence

| Doc | Purpose |
|---|---|
| [SCX-API-SURFACE-MATRIX-2026-07-07.md](SCX-API-SURFACE-MATRIX-2026-07-07.md) | SCX API endpoint matrix. |
| [SCX-MINED-INSTRUCTION-MANUAL-SUMMARY-2026-07-07.md](SCX-MINED-INSTRUCTION-MANUAL-SUMMARY-2026-07-07.md) | Summary of mined SCX docs. |
| [SCX-MODEL-BEHAVIOR-PROBE.md](SCX-MODEL-BEHAVIOR-PROBE.md) | Model behavior probe notes. |
| [SCX-MUX-MODEL-BENCHMARK.md](SCX-MUX-MODEL-BENCHMARK.md) | Mux benchmark notes. |
| [SCX-MUX-STORAGE-CONTEXT-PROOF.md](SCX-MUX-STORAGE-CONTEXT-PROOF.md) | Storage-backed mux proof notes. |
| [../UpstreamDocumentation/README.md](../UpstreamDocumentation/README.md) | Mined upstream SCX documentation and snapshots. |

## Operational Recovery

| Doc | Purpose |
|---|---|
| [SCX-CODEX-8M-RUN-RECOVERY-2026-07-07.md](SCX-CODEX-8M-RUN-RECOVERY-2026-07-07.md) | Auto-context burn recovery notes. |
| [restore-points/2026-07-09-scxcodex-working/RESTORE-POINT.md](restore-points/2026-07-09-scxcodex-working/RESTORE-POINT.md) | Known-working installed `Kritical.SCXCodex.exe` restore point captured while PID `8548` was running. |
| [SCX-END-TO-END-TODO-STATUS-2026-07-07.md](SCX-END-TO-END-TODO-STATUS-2026-07-07.md) | Prior todo state and gaps. |
| [SCX-KEY-ROTATION-2026-07-07.md](SCX-KEY-ROTATION-2026-07-07.md) | SCX key rotation notes. |
| [SCX-BUGHUNT-FIXES-5231.md](SCX-BUGHUNT-FIXES-5231.md) | Bug hunt and fixes. |

## Proof Artifacts

| Artifact | Purpose |
|---|---|
| `out/e2e-proof.md` | Latest E2E proof report when generated. |
| `out/supervisor-proof.md` | Supervisor dry-run/live report when generated. |
| `UpstreamDocumentation/scx-live-smoke.latest.json` | Latest SCX live smoke result. |
| `UpstreamDocumentation/scx-spec-validate.latest.json` | Latest candidate spec validation result. |

(c) 2026 Kritical Pty Ltd. All rights reserved.
