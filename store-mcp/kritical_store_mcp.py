"""
Kritical Store MCP — exposes KriticalSCXCodeStore (the mined SCX brain) as MCP tools so agents
(Codex, Claude, Cline, etc.) can query it directly. Read-only by default. Uses pyodbc + FastMCP.
Run: python kritical_store_mcp.py   (stdio JSON-RPC MCP server)
"""
import pyodbc
from mcp.server.fastmcp import FastMCP

CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
        "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")

mcp = FastMCP("kritical-store")


def _rows(sql, params=()):
    cn = pyodbc.connect(CONN, timeout=15, readonly=True)
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
    r = _rows("SELECT t.name AS [table], SUM(p.rows) AS [rows] FROM sys.tables t "
              "JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) "
              "GROUP BY t.name ORDER BY t.name")
    return "\n".join(f"{x['table']}: {x['rows']}" for x in r)


@mcp.tool()
def recent_turns(limit: int = 10) -> str:
    """The most recent human prompts + AI responses (decompressed), newest first."""
    limit = max(1, min(int(limit), 100))
    r = _rows(f"SELECT TOP {limit} id, side, model, LEFT(content,300) AS content "
              "FROM dbo.v_decision_log ORDER BY id DESC")
    return "\n---\n".join(f"[{x['id']} {x['side']} {x['model']}] {x['content']}" for x in r) or "(empty)"


@mcp.tool()
def search_store(text: str, limit: int = 20) -> str:
    """Full-text-ish search of stored prompts/responses for a substring (decompressed)."""
    limit = max(1, min(int(limit), 100))
    r = _rows(f"SELECT TOP {limit} id, side, LEFT(content,200) AS content FROM dbo.v_decision_log "
              "WHERE content LIKE ? ORDER BY id DESC", ('%' + text + '%',))
    return "\n---\n".join(f"[{x['id']} {x['side']}] {x['content']}" for x in r) or "(no matches)"


@mcp.tool()
def lens_catalog(limit: int = 25) -> str:
    """Rows from the Lens SQL-mine catalog (per-file code intelligence)."""
    limit = max(1, min(int(limit), 200))
    r = _rows(f"IF OBJECT_ID('dbo.LensSqlCatalog') IS NULL SELECT 'no catalog' AS x "
              f"ELSE SELECT TOP {limit} * FROM dbo.LensSqlCatalog")
    return "\n".join(str(x) for x in r) or "(empty)"


@mcp.tool()
def run_readonly_sql(sql: str) -> str:
    """Run a READ-ONLY SELECT against the store. Rejects anything that isn't a plain SELECT."""
    s = sql.strip().rstrip(';')
    low = s.lower()
    if not low.startswith("select") or any(k in low for k in
            (" insert ", " update ", " delete ", " drop ", " alter ", " exec", " merge ", " truncate", "xp_", "sp_")):
        return "REFUSED: read-only SELECT only."
    try:
        r = _rows(s)
        if not r:
            return "(0 rows)"
        return "\n".join(str(x) for x in r[:200])
    except Exception as e:
        return f"error: {e}"


if __name__ == "__main__":
    mcp.run()
