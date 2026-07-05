"""Ingest muxed shard summaries into KriticalSCXCodeStore.dbo.context_shard (compressed, deduped).
Usage: python mux_shards_ingest.py <shardsJson>  (JSON array of {session_id, source_ref, content, token_count})"""
import sys, json, hashlib, pyodbc

try:
    # utf-8-sig tolerates a BOM (PowerShell Set-Content -Encoding utf8 adds one on 5.1) AND plain utf-8
    shards = json.load(open(sys.argv[1], encoding="utf-8-sig"))
    if isinstance(shards, dict):
        shards = [shards]
    cn = pyodbc.connect(
        "DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
        "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;", timeout=15)
    cur = cn.cursor()
    n = 0
    for s in shards:
        c = str(s.get("content") or "")
        sha = hashlib.sha256(c.encode("utf-8", "replace")).hexdigest().upper()
        exists = cur.execute(
            "SELECT COUNT(*) FROM dbo.context_shard WHERE content_sha256=? AND session_id=?",
            sha, s.get("session_id")).fetchone()[0]
        if not exists:
            cur.execute(
                "INSERT dbo.context_shard(session_id,source_ref,content_sha256,content_gz,token_count) "
                "VALUES(?,?,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?)",
                s.get("session_id"), s.get("source_ref"), sha, c, s.get("token_count"))
            n += 1
    cn.commit()
    print(f"context_shard: inserted {n}/{len(shards)} (session {shards[0].get('session_id') if shards else '-'})")
    cn.close()
except Exception as e:
    # fail LOUD and non-zero so the mux surfaces it instead of silently swallowing (exit 0 hid this for real)
    print(f"context_shard INGEST FAILED — {e}"); sys.exit(1)
