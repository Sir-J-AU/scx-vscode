"""
Kritical Lens — FULL SOURCE INGEST + REASSEMBLY PROOF + WAVE TRACKING.
Stores EVERY file byte-exact (gzip, content-addressed) so the ENTIRE corpus can be reassembled
from SQL alone — then PROVES it by regenerating every file to a temp tree and diffing byte-for-byte.
Also:
  - LensWave        : tick-off ledger of every wave (what was done, status).
  - v_LensFindings  : view that SEPARATES deterministic (parser/tool) findings from AI-inference,
                      with a confidence column — programmatic facts vs model opinions, cleanly split.
Usage: python Invoke-KritScxSourceIngest.py <repoRoot> [waveId] [waveDesc]
"""
import sys, os, hashlib, tempfile
import pyodbc

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
WAVE = sys.argv[2] if len(sys.argv) > 2 else ".5217"
DESC = sys.argv[3] if len(sys.argv) > 3 else "full source ingest + reassembly proof"
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
SKIP = ("node_modules", os.sep+"out"+os.sep, ".git"+os.sep, "package-lock", os.sep+"emitted"+os.sep+"scxcode-webview")
# ingest EVERYTHING that is text/source (so installer->scripts->config->tests all reassemble)
KEEP = (".ps1",".psm1",".py",".ts",".js",".mjs",".json",".yaml",".yml",".md",".toml",".cmd",".txt",".html",".css")

cn = pyodbc.connect(CONN, timeout=60); cur = cn.cursor()
cur.execute("""IF OBJECT_ID('dbo.LensSource') IS NULL CREATE TABLE dbo.LensSource(
   id INT IDENTITY PRIMARY KEY, repo NVARCHAR(120), path NVARCHAR(500), ext VARCHAR(12),
   content_sha256 CHAR(64), content_gz VARBINARY(MAX), byte_len INT, line_count INT,
   wave VARCHAR(20), ingested_utc DATETIME2 DEFAULT SYSUTCDATETIME(),
   CONSTRAINT UX_lenssource UNIQUE(repo, path));""")
cur.execute("""IF OBJECT_ID('dbo.LensWave') IS NULL CREATE TABLE dbo.LensWave(
   id INT IDENTITY PRIMARY KEY, wave VARCHAR(20), description NVARCHAR(500), status VARCHAR(20),
   files_touched INT, note NVARCHAR(1000), recorded_utc DATETIME2 DEFAULT SYSUTCDATETIME());""")
cur.execute("""IF OBJECT_ID('dbo.v_LensFindings','V') IS NOT NULL DROP VIEW dbo.v_LensFindings;""")
cn.commit()
# deterministic vs inference split + confidence (deterministic tools = fact/100; AI = opinion/graded)
cur.execute("""CREATE VIEW dbo.v_LensFindings AS
   SELECT path, tool, severity, [rule], [line], message, inference_tag,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 'deterministic' ELSE 'inference' END AS detection_class,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 100 ELSE CASE severity WHEN 'high' THEN 60 WHEN 'med' THEN 45 ELSE 30 END END AS confidence
   FROM dbo.LensSource_findings_placeholder WHERE 1=0
   UNION ALL
   SELECT path, tool, severity, [rule], [line], message, inference_tag,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 'deterministic' ELSE 'inference' END,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 100 ELSE CASE severity WHEN 'high' THEN 60 WHEN 'med' THEN 45 ELSE 30 END END
   FROM dbo.LensSecurityFinding;""") if False else None
# the placeholder union above is awkward — build the view cleanly:
cur.execute("IF OBJECT_ID('dbo.v_LensFindings','V') IS NOT NULL DROP VIEW dbo.v_LensFindings")
cur.execute("""CREATE VIEW dbo.v_LensFindings AS
   SELECT path, tool, severity, [rule], [line], message, inference_tag,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 'deterministic' ELSE 'inference' END AS detection_class,
     CASE WHEN tool IN ('psscriptanalyzer','semgrep','npm-audit','secret-grep','danger-grep','gitleaks','detect-secrets','osv')
          THEN 100 ELSE CASE severity WHEN 'high' THEN 60 WHEN 'med' THEN 45 ELSE 30 END END AS confidence
   FROM dbo.LensSecurityFinding;""")
cn.commit()

repo = os.path.basename(ROOT)
files = []
for dp, dn, fn in os.walk(ROOT):
    if any(s.strip(os.sep) in dp.split(os.sep) for s in (".git","node_modules")) or any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(KEEP) and not any(s in p for s in SKIP):
            files.append(p)
files.sort()
print(f"[SOURCE] ingesting {len(files)} text/source files from repo '{repo}' byte-exact")

ingested = 0
for p in files:
    with open(p, "rb") as fh: raw = fh.read()
    sha = hashlib.sha256(raw).hexdigest()
    rel = os.path.relpath(p, ROOT).replace("\\","/")
    lc = raw.count(b"\n") + 1
    # .5231 (bughunt-confirmed) — store the RAW BYTES losslessly via COMPRESS() on a VARBINARY param.
    # The old code decoded utf-8/replace into NVARCHAR, which mangled any non-UTF-8 byte (U+FFFD) and
    # made the "byte-exact" claim false. COMPRESS(<varbinary>) -> DECOMPRESS() is an exact byte round-trip.
    blob = pyodbc.Binary(raw)
    cur.execute("""MERGE dbo.LensSource AS t USING (SELECT ? repo, ? path) s ON (t.repo=s.repo AND t.path=s.path)
        WHEN MATCHED THEN UPDATE SET content_sha256=?, content_gz=COMPRESS(CONVERT(VARBINARY(MAX), ?)), byte_len=?, line_count=?, wave=?, ingested_utc=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(repo,path,ext,content_sha256,content_gz,byte_len,line_count,wave)
             VALUES(?,?,?,?,COMPRESS(CONVERT(VARBINARY(MAX), ?)),?,?,?);""",
        repo, rel, sha, blob, len(raw), lc, WAVE,
        repo, rel, os.path.splitext(p)[1], sha, blob, len(raw), lc, WAVE)
    ingested += 1
cn.commit()
print(f"[SOURCE] ingested {ingested} files into dbo.LensSource")

# ---------- REASSEMBLY PROOF: regenerate every file from SQL, diff vs original ----------
print("[REASSEMBLE] regenerating the corpus from SQL and diffing byte-for-byte ...")
tmp = tempfile.mkdtemp(prefix="lens-reassemble-")
# .5231 (bughunt-confirmed) — DECOMPRESS back to RAW BYTES (no NVARCHAR cast) and prove at the BYTE level:
# regenerated bytes must equal the original file bytes AND re-hash to the stored sha256. The old proof
# compared utf-8/replace-decoded text on BOTH sides, so identical U+FFFD damage always matched — rigged.
cur.execute("SELECT path, DECOMPRESS(content_gz), content_sha256 FROM dbo.LensSource WHERE repo=?", repo)
rows = cur.fetchall()
match = 0; mismatch = 0; mism_list = []
for rel, regen, stored_sha in rows:
    regen_bytes = bytes(regen) if regen is not None else b""
    regen_sha = hashlib.sha256(regen_bytes).hexdigest()
    orig_path = os.path.join(ROOT, rel.replace("/", os.sep))
    try:
        with open(orig_path, "rb") as fh: orig = fh.read()
    except Exception:
        mismatch += 1; mism_list.append(rel + " (orig unreadable)"); continue
    if regen_bytes == orig and regen_sha == stored_sha:
        match += 1
    else:
        mismatch += 1; mism_list.append(rel)
pct = round(100*match/len(rows), 1) if rows else 0
print(f"[REASSEMBLE] {match}/{len(rows)} files regenerate IDENTICALLY from SQL ({pct}%)")
if mism_list: print("  mismatches:", ", ".join(mism_list[:8]))

# ---------- record the wave (tick-off) ----------
cur.execute("INSERT dbo.LensWave(wave,description,status,files_touched,note) VALUES(?,?,?,?,?)",
    WAVE, DESC, "complete" if mismatch == 0 else "partial", ingested,
    f"reassembly {match}/{len(rows)} identical ({pct}%)")
cn.commit()

# ---------- summary: can we reassemble the whole project from SQL? ----------
cur.execute("SELECT COUNT(*), SUM(byte_len) FROM dbo.LensSource WHERE repo=?", repo)
nf, nbytes = cur.fetchone()
cur.execute("SELECT detection_class, COUNT(*) FROM dbo.v_LensFindings GROUP BY detection_class")
split = cur.fetchall()
cn.close()
print(f"\n===== SOURCE INGEST COMPLETE =====")
print(f"  repo '{repo}': {nf} files / {nbytes} bytes stored byte-exact in dbo.LensSource")
print(f"  REASSEMBLE FROM SQL: {pct}% identical  -> {'YES, the corpus is reconstructable from SQL alone' if mismatch==0 else 'PARTIAL — '+str(mismatch)+' need attention'}")
print(f"  findings split (v_LensFindings): " + ", ".join(f"{c}={n}" for c,n in split) + "  (deterministic=fact/conf100, inference=AI-graded)")
print(f"  wave {WAVE} recorded in dbo.LensWave (tick-off ledger)")
