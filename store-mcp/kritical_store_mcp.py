"""
Kritical Store MCP — exposes KriticalSCXCodeStore (the mined SCX brain) as MCP tools so agents
(Codex, Claude, Cline, etc.) can query it directly. Read-only by default. Uses pyodbc + FastMCP.
Run: python kritical_store_mcp.py   (stdio JSON-RPC MCP server)
"""
import os
import pyodbc
from mcp.server.fastmcp import FastMCP

CONN = os.environ.get(
    "KRIT_SCX_STORE_MSSQL",
    "DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
    "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;",
)
CONNECT_TIMEOUT = max(1, min(int(os.environ.get("KRIT_SCX_STORE_CONNECT_TIMEOUT", "5")), 30))

mcp = FastMCP("kritical-store")


def _rows(sql, params=()):
    cn = pyodbc.connect(CONN, timeout=CONNECT_TIMEOUT, readonly=True)
    try:
        cur = cn.cursor()
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description] if cur.description else []
        out = [dict(zip(cols, r)) for r in cur.fetchall()]
        return out
    finally:
        cn.close()


@mcp.tool()
def store_stats() -> str:
    """Row counts for every table in KriticalSCXCodeStore."""
    try:
        r = _rows("SELECT t.name AS [table], SUM(p.rows) AS [rows] FROM sys.tables t "
                  "JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) "
                  "GROUP BY t.name ORDER BY t.name")
        return "\n".join(f"{x['table']}: {x['rows']}" for x in r)
    except Exception as e:
        return f"store_stats unavailable: {e}"


def _lim(v, cap, dflt=10):
    # .5213 (DeepSeek-flagged, verified) — non-numeric limit used to raise an uncaught
    # ValueError and crash the tool; clamp safely and fall back to a default instead.
    try:
        return max(1, min(int(v), cap))
    except (ValueError, TypeError):
        return dflt


@mcp.tool()
def recent_turns(limit: int = 10) -> str:
    """The most recent human prompts + AI responses (decompressed), newest first."""
    limit = _lim(limit, 100)
    r = _rows(f"SELECT TOP {limit} id, side, model, LEFT(content,300) AS content "
              "FROM dbo.v_decision_log ORDER BY id DESC")
    return "\n---\n".join(f"[{x['id']} {x['side']} {x['model']}] {x['content']}" for x in r) or "(empty)"


@mcp.tool()
def search_store(text: str, limit: int = 20) -> str:
    """Full-text-ish search of stored prompts/responses for a substring (decompressed)."""
    limit = _lim(limit, 100)
    r = _rows(f"SELECT TOP {limit} id, side, LEFT(content,200) AS content FROM dbo.v_decision_log "
              "WHERE content LIKE ? ORDER BY id DESC", ('%' + text + '%',))
    return "\n---\n".join(f"[{x['id']} {x['side']}] {x['content']}" for x in r) or "(no matches)"


@mcp.tool()
def lens_catalog(limit: int = 25) -> str:
    """Rows from the Lens SQL-mine catalog (per-file code intelligence)."""
    limit = _lim(limit, 200)
    r = _rows(f"IF OBJECT_ID('dbo.LensSqlCatalog') IS NULL SELECT 'no catalog' AS x "
              f"ELSE SELECT TOP {limit} * FROM dbo.LensSqlCatalog")
    return "\n".join(str(x) for x in r) or "(empty)"


import re as _re
def _strip_sql_comments(sql: str) -> str:
    # .5216 (DeepSeek-flagged, verified) — strip -- line comments and /* */ block comments so
    # keyword-obfuscation like "se/**/lect ... ; drop" can't slip past the read-only guard.
    sql = _re.sub(r"/\*.*?\*/", " ", sql, flags=_re.S)
    sql = _re.sub(r"--[^\n]*", " ", sql)
    return _re.sub(r"\s+", " ", sql).strip()

@mcp.tool()
def run_readonly_sql(sql: str) -> str:
    """Run a READ-ONLY SELECT against the store. Rejects anything that isn't a single plain SELECT."""
    s = _strip_sql_comments(sql).rstrip(';')
    low = s.lower()
    # single statement only (no stacked queries), must START with select/with, and contain no write verbs
    if ';' in s:
        return "REFUSED: single statement only (no ';')."
    if not (low.startswith("select") or low.startswith("with")):
        return "REFUSED: read-only SELECT (or WITH...SELECT) only."
    if _re.search(r"\b(insert|update|delete|drop|alter|create|exec|execute|merge|truncate|grant|revoke)\b", low) \
            or "xp_" in low or "sp_" in low or "into " in low:
        return "REFUSED: write/DDL/exec keyword detected."
    try:
        r = _rows(s)
        if not r:
            return "(0 rows)"
        return "\n".join(str(x) for x in r[:200])
    except Exception as e:
        return f"error: {e}"


if __name__ == "__main__":
    mcp.run()
