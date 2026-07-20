"""
Kritical Lens — SHOPIFY BASELINE DIFF (.5230): the one net-new mining step from the corpus layout plan.
File-by-file 4-way compare of the theme baselines so "every documented difference between Netlink,
Dawn 6, Dawn 15.4.1 and the overlay" is queryable in SQL — not just per-version history.
  B1 netlink-vanilla   B2 dawn-fork-point-v6.0.0 (Dawn 6.0.0)   B3 dawn-upstream (Dawn 15.4.1)   B4 overlay
Read-only against the working tree. Stores dbo.LensThemeBaselineDiff.
Usage: python Invoke-KritShopifyBaselineDiff.py <connectorRepoRoot>
"""
import sys, os, hashlib, pyodbc

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
BASELINES = [
    ("netlink", "theme-layers/netlink-vanilla"),
    ("dawn6",   "theme-layers/dawn-fork-point-v6.0.0"),
    ("dawn15",  "theme-layers/dawn-upstream"),
    ("overlay", "theme-layers/overlay"),
]
# .5187 — extended to cover binary theme assets (images/fonts) + config that the
# original .5230 list silently dropped. SHA256+size compare works identically on
# binary bytes (the file is already read "rb"), and image/font assets ARE part of
# the theme surface — a Dawn upgrade can add/remove/change them, and the overlay's
# custom images (Horizontal_Logo.png etc.) are load-bearing Kritical IP. Missing
# them meant 6 real live overlay files (5 images + .theme-check.yml) were absent
# from the baseline diff entirely.
THEME_EXT = (
    ".liquid", ".json", ".css", ".js", ".scss", ".svg", ".txt",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".yml", ".yaml", ".map",
)
# .5187 — the composer (Build-PaxThemeFromLayers.ps1) skips .bak.NNN / .deprecated.NNN
# sentinel files; they are HR23-preserved historical snapshots, NOT live theme surface.
# The original miner counted them, inflating the overlay surface from the real 653 to
# 778 and mis-classifying dead sentinels (assets/base.bak.1022.css,
# _attic/.../ai_gen_block_*.deprecated.988.liquid) as live "OVERLAY-ONLY net-new IP".
# Their full history already lives in the raw dbo.LensGitBlob ingest, so excluding them
# here (the LIVE-baseline-diff table) is the correct separation.
SKIP_MARKERS = (".bak.", ".deprecated.")

def scan(root):
    """relpath -> (sha256, size) for theme files under root."""
    out = {}
    base = os.path.join(REPO, root)
    if not os.path.isdir(base):
        return out
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            lf = f.lower()
            if not lf.endswith(THEME_EXT):
                continue
            if any(m in lf for m in SKIP_MARKERS):
                continue
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, base).replace("\\", "/")
            try:
                data = open(full, "rb").read()
                out[rel] = (hashlib.sha256(data).hexdigest(), len(data))
            except OSError:
                pass
    return out

maps = {}
for key, root in BASELINES:
    maps[key] = scan(root)
    print(f"[BASELINE] {key:8} {root:40} {len(maps[key])} theme files")

allpaths = set()
for m in maps.values():
    allpaths |= set(m.keys())
print(f"[BASELINE] union of relative paths: {len(allpaths)}")

def classify(present, shas):
    """present: dict key->bool ; shas: dict key->sha (or None). Returns a short class."""
    keys = [k for k, _ in BASELINES]
    got = [k for k in keys if present[k]]
    if len(got) == 1:
        return got[0].upper() + "-ONLY"
    distinct = set(shas[k] for k in got)
    if len(distinct) == 1:
        return "IDENTICAL(" + "+".join(got) + ")"
    # which pairs match
    if present["netlink"] and present["dawn6"] and shas["netlink"] == shas["dawn6"]:
        tag = "NETLINK=DAWN6"
    elif present["dawn6"] and present["dawn15"] and shas["dawn6"] == shas["dawn15"]:
        tag = "DAWN6=DAWN15"
    else:
        tag = "DIVERGED"
    return tag + "(" + "+".join(got) + ")"

cn = pyodbc.connect(CONN, timeout=60); cur = cn.cursor()
cur.execute("""IF OBJECT_ID('dbo.LensThemeBaselineDiff') IS NULL CREATE TABLE dbo.LensThemeBaselineDiff(
   id INT IDENTITY PRIMARY KEY, relpath NVARCHAR(400),
   in_netlink BIT, in_dawn6 BIT, in_dawn15 BIT, in_overlay BIT,
   sha_netlink CHAR(64), sha_dawn6 CHAR(64), sha_dawn15 CHAR(64), sha_overlay CHAR(64),
   size_netlink INT, size_dawn6 INT, size_dawn15 INT, size_overlay INT,
   classification VARCHAR(60), recorded_utc DATETIME2 DEFAULT SYSUTCDATETIME());""")
cur.execute("TRUNCATE TABLE dbo.LensThemeBaselineDiff"); cn.commit()

rows = 0
for rel in sorted(allpaths):
    present = {k: (rel in maps[k]) for k, _ in BASELINES}
    shas = {k: (maps[k][rel][0] if present[k] else None) for k, _ in BASELINES}
    sizes = {k: (maps[k][rel][1] if present[k] else None) for k, _ in BASELINES}
    cls = classify(present, shas)
    cur.execute("""INSERT dbo.LensThemeBaselineDiff(relpath,in_netlink,in_dawn6,in_dawn15,in_overlay,
        sha_netlink,sha_dawn6,sha_dawn15,sha_overlay,size_netlink,size_dawn6,size_dawn15,size_overlay,classification)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rel[:400], present["netlink"], present["dawn6"], present["dawn15"], present["overlay"],
        shas["netlink"], shas["dawn6"], shas["dawn15"], shas["overlay"],
        sizes["netlink"], sizes["dawn6"], sizes["dawn15"], sizes["overlay"], cls)
    rows += 1
cn.commit()

print(f"\n[BASELINE-DIFF] {rows} file rows -> dbo.LensThemeBaselineDiff")
print("\n===== classification summary =====")
cur.execute("SELECT classification, COUNT(*) FROM dbo.LensThemeBaselineDiff GROUP BY classification ORDER BY COUNT(*) DESC")
for c, n in cur.fetchall():
    print(f"  {n:5}  {c}")
# a couple of high-value rollups
print("\n===== rollups =====")
cur.execute("SELECT COUNT(*) FROM dbo.LensThemeBaselineDiff WHERE in_netlink=1 AND in_dawn15=0")
print(f"  Netlink files with NO Dawn-15.4.1 counterpart (pure Netlink custom to port): {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM dbo.LensThemeBaselineDiff WHERE in_dawn15=1 AND in_overlay=0")
print(f"  Dawn-15.4.1 files NOT in the overlay (native gained, not yet customised): {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM dbo.LensThemeBaselineDiff WHERE in_overlay=1 AND in_netlink=0 AND in_dawn6=0 AND in_dawn15=0")
print(f"  Overlay-only files (Kritical/Huzaifa net-new IP): {cur.fetchone()[0]}")
try:
    cur.execute("INSERT dbo.LensWave(wave,description,status,files_touched,note) VALUES('.5230','Shopify baseline 4-way diff (Netlink/Dawn6/Dawn15/overlay)','complete',?,'query dbo.LensThemeBaselineDiff for every cross-baseline difference')", rows); cn.commit()
except Exception:
    pass
cn.close()
print("\n[BASELINE-DIFF] COMPLETE. Query e.g.: SELECT relpath,classification FROM dbo.LensThemeBaselineDiff WHERE classification='NETLINK-ONLY';")
