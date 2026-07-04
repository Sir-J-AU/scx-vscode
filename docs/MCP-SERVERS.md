# Kritical SCX — Useful MCP Servers (for the selector)
_What you already have + high-value additions, so MCP becomes a tick-box loadout like extensions._

## Already configured (Codex `config.toml`)
| MCP | Backend | Status | Use |
|---|---|---|---|
| shopify-dev-mcp | `npx @shopify/dev-mcp` | ✅ works | Shopify Admin/theme dev |
| falcon-mcp | `uvx falcon-mcp` | ✅ works | CrowdStrike Falcon (detections/hosts/intel) |
| pax8 | https url | ✅ works | Pax8 distributor API |
| node_repl | exe | ✅ works | Codex's JS REPL |
| **bc_al (AL)** | `altool` | ⚠️ **broken** | AL/Business Central — see fix below |

### 🔧 AL MCP fix (ready)
`altool` isn't on PATH; the win binary exists. In `~/.codex/config.toml` set:
```toml
[mcp_servers.bc_al]
command = "C:\\Users\\joshl\\.vscode-insiders\\extensions\\ms-dynamics-smb.al-18.0.2498801\\bin\\win32\\altool.exe"
args = ["launchmcpserver --transport stdio"]
```

## ALREADY CONNECTED — claude.ai connectors (server-side, NOT local config)
These are wired into Claude Code via your claude.ai connectors — you already have them; **do not "add" them locally.** Managed in claude.ai → Connectors. Includes (non-exhaustive, from this session's connected set):
**Playwright · Playroom · claude-in-chrome (Chrome control) · computer-use · Claude Preview · Shopify · Microsoft 365 · Azure MCP · Microsoft Learn/Docs · Desktop Commander · Windows-MCP · Microsoft Clarity · Pax8 · Falcon (CrowdStrike) · mcp-registry** — plus the plugin connectors (marketing/legal/finance/sales/etc.).

**Browser/automation/PDF you ALREADY own** (so no external Playwright "addition" needed): Playwright + Playroom MCP (connected), Chrome + Edge devtools extensions, claude-in-chrome, computer-use, and your own Node.js render/PDF tooling in the connector repo (a11y-per-page, bundle-render-integrity, PDF print-to-image / print-to-print audits).

## Genuinely-NOT-yet-present local additions (only if you want them AS LOCAL Codex MCP)
| MCP | Install | Why |
|---|---|---|
| **sqlite / mssql** | community mssql MCP | let agents query `KriticalSCXCodeStore` (the mined store) directly as a tool |
| **memory** | `npx @modelcontextprotocol/server-memory` | persistent knowledge graph on top of the HR27 store |
| **sequential-thinking** | `npx @modelcontextprotocol/server-sequential-thinking` | structured planner for the muxing engine |

## Selector integration (planned)
`ext-manifest.json` gains an `"mcp"` block (server → command/args/scope), and the tick-box webview lists MCP servers alongside extension stacks. Enabling an MCP loadout writes/uncomments the matching `[mcp_servers.*]` entries in `config.toml` (additive, reversible) — same pattern as extension `--disable-extension`. Claude/Codex native MCP untouched unless you tick it.

## Standout picks for the mega-context vision
- **sqlite/mssql MCP** → agents query the mined store (`decision_log`, `context_shard`, `LensSqlCatalog`) as a first-class tool = the retrieval half of "context from thin air".
- **sequential-thinking** → the planner/synthesiser in the muxing engine.
- **memory** → cross-session knowledge graph on top of the store.
