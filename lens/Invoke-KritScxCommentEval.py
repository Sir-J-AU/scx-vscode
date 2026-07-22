"""
Kritical Lens — COMMENT-vs-CODE evaluation + master AUDIT DOSSIER.
For every function, DeepSeek evaluates whether the comment/docstring ACCURATELY describes the code
and whether anything is HOLLOW (documented but not implemented / stale). Stored with boolean flags
in dbo.LensCommentEval. Then documents EVERYTHING mined this wave (corpus + security + compares)
into a single dossier + Brain receipt — so nothing is ever lost between runs.
Usage: python Invoke-KritScxCommentEval.py <repoRoot>
"""
import sys, os, re, json, time, hashlib, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyodbc

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
PROXY = "http://127.0.0.1:4180/v1/chat/completions"; KEY = "sk-kritical-scx-local"
SKIP = ("node_modules", os.sep+"out"+os.sep, os.sep+"emitted"+os.sep, "package-lock", os.sep+"sources"+os.sep)
CODE = (".ps1", ".psm1", ".py", ".ts", ".js")

cn = pyodbc.connect(CONN, timeout=30); cur = cn.cursor()
cur.execute("""IF OBJECT_ID('dbo.LensCommentEval') IS NULL CREATE TABLE dbo.LensCommentEval(
   id INT IDENTITY PRIMARY KEY, path NVARCHAR(400), has_comment BIT, comment_matches_code BIT, hollow BIT,
   note NVARCHAR(1000), model VARCHAR(30), eval_utc DATETIME2 DEFAULT SYSUTCDATETIME());""")
cur.execute("IF OBJECT_ID('dbo.LensCommentEval') IS NOT NULL TRUNCATE TABLE dbo.LensCommentEval")
cn.commit()

files = []
for dp, dn, fn in os.walk(ROOT):
    if any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(CODE) and not any(s in p for s in SKIP): files.append(p)
files.sort()
print(f"[COMMENT-EVAL] evaluating comment-vs-code across {len(files)} files")

SYS = ("You evaluate whether a source file's COMMENTS/docstrings accurately describe what the CODE does. "
       "Consider: does each comment match the code beneath it? Is anything HOLLOW (documented but not "
       "implemented, or a stale/misleading comment)? Return STRICT JSON: "
       '{"has_comments":bool,"comments_match_code":bool,"hollow":bool,"note":"one sentence — name the worst mismatch or say clean"}.')
def evalf(p):
    try: src = open(p, encoding="utf-8-sig", errors="replace").read()
    except Exception as e: return p, None
    lang = os.path.splitext(p)[1].lstrip(".")
    for attempt in range(2):
        use = "deepseek-v3.1" if attempt == 0 else "gpt-oss-120b"
        body = json.dumps({"model":use,"temperature":0,"max_tokens":900,"messages":[
            {"role":"system","content":SYS},{"role":"user","content":f"```{lang}\n{src[:12000]}\n```"}]}).encode()
        try:
            req = urllib.request.Request(PROXY, data=body, headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"})
            with urllib.request.urlopen(req, timeout=120) as r: c = json.load(r)["choices"][0]["message"].get("content")
            if not c: continue
            c = re.sub(r"^```[a-z]*|```$","",c.strip(),flags=re.M).strip()
            mm = re.search(r"\{[\s\S]*\}", c); return p, (json.loads(mm.group(0)) if mm else None)
        except Exception: time.sleep(1)
    return p, None

evald = 0; hollow = 0; mismatch = 0
with ThreadPoolExecutor(max_workers=6) as ex:
    for fut in as_completed([ex.submit(evalf, p) for p in files]):
        p, r = fut.result()
        rel = os.path.relpath(p, ROOT).replace("\\","/")
        if not r: continue
        hc = 1 if r.get("has_comments") else 0
        mc = 1 if r.get("comments_match_code") else 0
        ho = 1 if r.get("hollow") else 0
        cur.execute("INSERT dbo.LensCommentEval(path,has_comment,comment_matches_code,hollow,note,model) VALUES(?,?,?,?,?,?)",
                    rel, hc, mc, ho, str(r.get("note",""))[:1000], "deepseek-v3.1")
        evald += 1; hollow += ho; mismatch += (1 if (hc and not mc) else 0)
cn.commit()
print(f"[COMMENT-EVAL] {evald} files evaluated · {mismatch} with comment/code mismatch · {hollow} with hollow docs")

# ---------- MASTER AUDIT DOSSIER (documents everything mined this wave) ----------
def q1(sql, *a):
    cur.execute(sql, *a); r = cur.fetchone(); return r[0] if r else 0
def qall(sql):
    cur.execute(sql); return cur.fetchall()

dossier = os.path.join(ROOT, "lens", "LENS-AUDIT-DOSSIER.md")
lines = ["# Kritical Lens — Full-Corpus Audit Dossier",
         f"_Generated from SQL (KriticalSCXCodeStore). Re-run the lens scripts to refresh — nothing lives only in chat._\n",
         "## 1. Corpus ingested (raw pass + call graph)"]
lines.append(f"- Files: **{q1('SELECT COUNT(*) FROM dbo.LensCorpusFile')}** · LOC: **{q1('SELECT SUM(loc) FROM dbo.LensCorpusFile')}** · "
             f"functions: **{q1('SELECT SUM(function_count) FROM dbo.LensCorpusFile')}** · call-graph edges: **{q1('SELECT COUNT(*) FROM dbo.LensCallGraph')}**")
lines.append("- Most-depended-on files (call-graph hubs):")
for path, c in qall("SELECT TOP 6 target_path, COUNT(*) c FROM dbo.LensCallGraph GROUP BY target_path ORDER BY c DESC"):
    lines.append(f"  - `{path}` — {c} inbound refs")
lines.append("\n## 2. Security mine (all tools)")
lines.append("| tool | findings |\n|---|---|")
for t, c in qall("SELECT tool, COUNT(*) FROM dbo.LensSecurityFinding GROUP BY tool ORDER BY 2 DESC"):
    lines.append(f"| {t} | {c} |")
lines.append("\nBy severity: " + ", ".join(f"**{s}**={c}" for s, c in qall("SELECT severity, COUNT(*) FROM dbo.LensSecurityFinding GROUP BY severity ORDER BY 2 DESC")))
lines.append("\nTop HIGH security findings (verify-first):")
for path, tool, msg in qall("SELECT TOP 12 path, tool, message FROM dbo.LensSecurityFinding WHERE severity='high' ORDER BY path"):
    lines.append(f"- `{path}` [{tool}] — {str(msg)[:110]}")
lines.append("\n## 3. Comment-vs-code evaluation")
lines.append(f"- Files evaluated: **{q1('SELECT COUNT(*) FROM dbo.LensCommentEval')}** · "
             f"comment/code MISMATCH: **{q1('SELECT COUNT(*) FROM dbo.LensCommentEval WHERE has_comment=1 AND comment_matches_code=0')}** · "
             f"HOLLOW docs: **{q1('SELECT COUNT(*) FROM dbo.LensCommentEval WHERE hollow=1')}**")
lines.append("Files with mismatched or hollow comments (review these):")
for path, note in qall("SELECT TOP 15 path, note FROM dbo.LensCommentEval WHERE hollow=1 OR (has_comment=1 AND comment_matches_code=0) ORDER BY path"):
    lines.append(f"- `{path}` — {str(note)[:120]}")
lines.append("\n## 4. Bug sweep (semantic pass + verdicts)")
_bugs = q1("SELECT COUNT(*) FROM dbo.decision_log WHERE session_id='repo-sweep'")
_verd = q1("SELECT COUNT(*) FROM dbo.decision_log WHERE category='bug-verdict'")
_lens = q1("SELECT COUNT(*) FROM dbo.lens_artifact")
lines.append(f"- Bug findings: **{_bugs}** · human verdicts: **{_verd}** · lens artifacts: **{_lens}**")
lines.append("\n## 5. SQL tables (the whole corpus is queryable — never blind again)")
for name, in qall("SELECT name FROM sys.tables ORDER BY name"):
    n = q1(f"SELECT COUNT(*) FROM dbo.[{name}]")
    lines.append(f"- `dbo.{name}` — {n} rows")
lines.append("\n_Refresh: `python lens/Invoke-KritScxCorpusMine.py .` → `Invoke-KritScxSecurityMine.py .` → `Invoke-KritScxCommentEval.py .`_")
open(dossier, "w", encoding="utf-8").write("\n".join(lines))

# brain receipt
txt = "\n".join(lines)
h = hashlib.sha256(txt.encode("utf-8", "replace")).hexdigest().upper()
if cur.execute("SELECT COUNT(*) FROM dbo.decision_log WHERE content_sha256=?", h).fetchone()[0] == 0:
    cur.execute("INSERT dbo.decision_log(ts_utc,side,category,wave,session_id,content_sha256,simhash,content_len,content_gz,preview_120,model,provider,source,meta) "
                "VALUES(SYSUTCDATETIME(),'ai','audit-dossier','.5216','corpus-audit',?,0,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?,'lens','scx','corpus-audit',?)",
                h, len(txt), txt, txt[:120], json.dumps({"files": q1('SELECT COUNT(*) FROM dbo.LensCorpusFile'), "sec_findings": q1('SELECT COUNT(*) FROM dbo.LensSecurityFinding')}))
cn.commit(); cn.close()
print(f"[DOSSIER] written -> lens/LENS-AUDIT-DOSSIER.md + Brain receipt (category=audit-dossier)")
