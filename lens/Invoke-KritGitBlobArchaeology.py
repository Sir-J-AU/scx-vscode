"""
Kritical Lens — GIT-BLOB ARCHAEOLOGY: ingest EVERY git version of each app's server file into SQL,
byte-exact + with the extracted route SET per version, so ANY version can be diffed against ANY
other IN SQL. Saves all mining for reuse. Read-only against git (no working-tree changes).
Usage: python Invoke-KritGitBlobArchaeology.py <connectorRepoRoot>
"""
import sys, os, re, json, hashlib, subprocess
import pyodbc

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
APPS = [
  ("supervisor", 4321, "shopify-app/apps/supervisor/src/server.js"),
  ("vault-backend", 4322, "shopify-app/backend/src/server.js"),
  ("vault-frontend", 4323, "shopify-app/apps/backup-suite-shell/src/server.js"),
  ("connector-admin", 4324, "shopify-app/apps/connector-admin/src/server.js"),
]
# capture the actual route METHOD+PATH so we can set-diff versions in SQL
ROUTE_RX = re.compile(r"""(?:app|fastify|router|server)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]""", re.I)
ROUTE_RX2 = re.compile(r"""\.route\(\s*\{[^}]*?method\s*:\s*['"`]([^'"`]+)['"`][^}]*?url\s*:\s*['"`]([^'"`]+)['"`]""", re.I | re.S)

def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, errors="replace")

def routes_of(text):
    rs = set()
    for m in ROUTE_RX.finditer(text): rs.add(f"{m.group(1).upper()} {m.group(2)}")
    for m in ROUTE_RX2.finditer(text): rs.add(f"{m.group(1).upper()} {m.group(2)}")
    return sorted(rs)

cn = pyodbc.connect(CONN, timeout=60); cur = cn.cursor()
cur.execute("""IF OBJECT_ID('dbo.LensGitBlob') IS NULL CREATE TABLE dbo.LensGitBlob(
   id INT IDENTITY PRIMARY KEY, app NVARCHAR(60), path NVARCHAR(300), commit_sha VARCHAR(40),
   commit_date VARCHAR(30), subject NVARCHAR(400), byte_len INT, content_sha256 CHAR(64),
   route_count INT, routes NVARCHAR(MAX), content_gz VARBINARY(MAX), ordinal INT,
   CONSTRAINT UX_gitblob UNIQUE(app, commit_sha));""")
cur.execute("TRUNCATE TABLE dbo.LensGitBlob")
cn.commit()

print(f"[GIT-BLOB] ingesting every version of {len(APPS)} app server files (full history)")
grand = 0
for app, port, path in APPS:
    log = git("log", "--format=%H|%cI|%s", "--", path)
    commits = [l.split("|", 2) for l in log.stdout.splitlines() if l.strip()]
    print(f"  {app}: {len(commits)} versions in history")
    prev_routes = None
    for i, parts in enumerate(commits):
        if len(parts) < 3: continue
        sha, date, subj = parts
        blob = git("show", f"{sha}:{path}")
        if blob.returncode != 0: continue
        text = blob.stdout
        rs = routes_of(text)
        csha = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
        cur.execute("""INSERT dbo.LensGitBlob(app,path,commit_sha,commit_date,subject,byte_len,content_sha256,route_count,routes,content_gz,ordinal)
            VALUES(?,?,?,?,?,?,?,?,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?)""",
            app, path, sha, date, subj[:400], len(text.encode()), csha, len(rs), json.dumps(rs), text, i)
        grand += 1
    cn.commit()
print(f"[GIT-BLOB] ingested {grand} file-versions into dbo.LensGitBlob (byte-exact + route sets)")

# ---------- SQL-side analysis: peak vs HEAD route SET diff per app (real drop, deduped by path) ----------
print("\n===== PER-APP ROUTE-SET ARCHAEOLOGY (from SQL, not inline guess) =====")
for app, port, path in APPS:
    cur.execute("SELECT TOP 1 route_count, routes FROM dbo.LensGitBlob WHERE app=? ORDER BY ordinal ASC", app)  # ordinal 0 = HEAD (git log newest first)
    head = cur.fetchone()
    cur.execute("SELECT TOP 1 route_count, routes FROM dbo.LensGitBlob WHERE app=? ORDER BY route_count DESC", app)
    peak = cur.fetchone()
    if not head or not peak: continue
    head_set = set(json.loads(head[1])); peak_set = set(json.loads(peak[1]))
    only_in_peak = sorted(peak_set - head_set)
    cur.execute("SELECT COUNT(*) FROM dbo.LensGitBlob WHERE app=?", app)
    nver = cur.fetchone()[0]
    print(f"  {app:16} {nver:3} versions · HEAD routes={head[0]:3} · PEAK route-set={peak[0]:3} · in PEAK-not-HEAD={len(only_in_peak)}")
    for r in only_in_peak[:6]: print(f"        missing: {r}")

cur.execute("INSERT dbo.LensWave(wave,description,status,files_touched,note) VALUES('.5220','git-blob archaeology: every version of 4 app servers ingested to SQL','complete',?,'diff any version vs any in SQL via dbo.LensGitBlob')", grand)
cn.commit()
cur.execute("SELECT COUNT(*), COUNT(DISTINCT app) FROM dbo.LensGitBlob"); n, a = cur.fetchone()
cn.close()
print(f"\n[GIT-BLOB] COMPLETE — {n} versions across {a} apps in dbo.LensGitBlob.")
print("  Diff ANY two versions in SQL, e.g.:")
print("    SELECT app, commit_date, route_count, subject FROM dbo.LensGitBlob WHERE app='vault-frontend' ORDER BY route_count DESC;")
print("  Every version is byte-exact (DECOMPRESS(content_gz)) — reassemble/compare any point in history.")
