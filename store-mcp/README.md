# Kritical Store MCP

Exposes **KriticalSCXCodeStore** (the mined SCX brain) to any MCP client (Codex, Claude Code, Cline)
as query tools. Read-only. Built on `pyodbc` + the official `mcp` FastMCP SDK.

## Tools
| Tool | Does |
|---|---|
| `store_stats` | row counts for every table |
| `recent_turns(limit)` | most recent human/AI turns (decompressed) |
| `search_store(text, limit)` | substring search over stored prompts/responses |
| `lens_catalog(limit)` | rows from the Lens per-file code-intelligence catalog |
| `run_readonly_sql(sql)` | run a **SELECT** (rejects insert/update/delete/drop/exec) |

## Register (Codex `~/.codex/config.toml`)
```toml
[mcp_servers.kritical-store]
command = "C:\\KriticalSCX\\venv-litellm-test\\Scripts\\python.exe"
args = ["…\\Kritical.SCXCode\\store-mcp\\kritical_store_mcp.py"]
enabled = true
```
Or toggle it in the Kritical Plugin Control Panel (MCP tickboxes).

## Proven
`ClientSession.initialize → list_tools (5) → call_tool("store_stats")` returns live row counts.
Read-only + guarded (`run_readonly_sql` refuses anything but SELECT).

_© 2026 Kritical Pty Ltd · Joshua Finley._
