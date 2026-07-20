"""
Kritical Lens — CORPUS SQL-MINE (Stage A: raw pass + call graph + dependencies).
Deterministic. Mines EVERY code file into new Lens SQL tables so the whole corpus is queryable:
  LensCorpusFile   — per file: lang, loc, sha256, function_count, import list
  LensSymbol       — per symbol: file, name, kind (function/class), start_line
  LensCallGraph    — edges: from_file -> symbol -> resolved_target (cross-file call/import)
  LensSecurityFinding — populated by the tools stage (PSScriptAnalyzer/semgrep/deepseek)
Usage: python Invoke-KritScxCorpusMine.py <repoRoot>
"""
import sys, os, re, json, hashlib
import pyodbc

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
SKIP = ("node_modules", os.sep+"out"+os.sep, os.sep+"emitted"+os.sep, "receipts", os.sep+"sources"+os.sep, "package-lock")
CODE = (".ps1", ".psm1", ".py", ".ts", ".js", ".mjs", ".cjs")  # .5231 — include ES modules (shim, node-agent)

DDL = [
 """IF OBJECT_ID('dbo.LensCorpusFile') IS NULL CREATE TABLE dbo.LensCorpusFile(
      id INT IDENTITY PRIMARY KEY, path NVARCHAR(400) UNIQUE, lang VARCHAR(10), loc INT,
      sha256 CHAR(64), function_count INT, imports NVARCHAR(MAX), mined_utc DATETIME2 DEFAULT SYSUTCDATETIME());""",
 """IF OBJECT_ID('dbo.LensSymbol') IS NULL CREATE TABLE dbo.LensSymbol(
      id INT IDENTITY PRIMARY KEY, path NVARCHAR(400), name NVARCHAR(200), kind VARCHAR(20), start_line INT);""",
 """IF OBJECT_ID('dbo.LensCallGraph') IS NULL CREATE TABLE dbo.LensCallGraph(
      id INT IDENTITY PRIMARY KEY, from_path NVARCHAR(400), symbol NVARCHAR(200), edge VARCHAR(20), target_path NVARCHAR(400));""",
 """IF OBJECT_ID('dbo.LensSecurityFinding') IS NULL CREATE TABLE dbo.LensSecurityFinding(
      id INT IDENTITY PRIMARY KEY, path NVARCHAR(400), tool VARCHAR(30), severity VARCHAR(10), [rule] NVARCHAR(120),
      [line] INT, message NVARCHAR(1000), inference_tag NVARCHAR(200), found_utc DATETIME2 DEFAULT SYSUTCDATETIME());""",
]

# language-specific extractors: (function regex, import regex)
FUNC = {
 "ps1":  re.compile(r"^\s*function\s+([A-Za-z][\w\-]*)", re.M),
 "psm1": re.compile(r"^\s*function\s+([A-Za-z][\w\-]*)", re.M),
 "py":   re.compile(r"^\s*def\s+([A-Za-z_]\w*)", re.M),
 # .5231 — TS/JS: declared functions, exported functions, arrow-fn consts, and classes.
 "ts":   re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^={]+)?=>|^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_]\w*)", re.M),
 "js":   re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|^\s*(?:export\s+)?class\s+([A-Za-z_]\w*)", re.M),
}
FUNC["mjs"] = FUNC["js"]; FUNC["cjs"] = FUNC["js"]  # .5231 — ES modules use the JS extractor
IMPORT = {
 "ps1":  re.compile(r"(?:Import-Module|\.\s+)\s+['\"]?([^\s'\";]+)", re.M),
 "psm1": re.compile(r"Import-Module\s+['\"]?([^\s'\";]+)", re.M),
 "py":   re.compile(r"^\s*(?:from\s+([\w\.]+)\s+import|import\s+([\w\.]+))", re.M),
 "ts":   re.compile(r"import\s+.*?from\s+['\"]([^'\"]+)['\"]|require\(['\"]([^'\"]+)['\"]\)", re.M),
 "js":   re.compile(r"import\s+.*?from\s+['\"]([^'\"]+)['\"]|require\(['\"]([^'\"]+)['\"]\)", re.M),
}
IMPORT["mjs"] = IMPORT["js"]; IMPORT["cjs"] = IMPORT["js"]  # .5231

files = []
for dp, dn, fn in os.walk(ROOT):
    if any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(CODE) and not any(s in p for s in SKIP):
            files.append(p)
files.sort()
print(f"[CORPUS] mining {len(files)} code files under {os.path.basename(ROOT)}")

# .5231b (re-hunt) — the SQL connection was opened here with no try/finally: any exception in the
# mining loop below (symbol extraction, call-graph inserts, a transient SQL error) left the pyodbc
# connection open, holding a handle/lock on KriticalSCXCodeStore until the process died. Wrap the
# whole mining body so cn is ALWAYS closed (HR16 idempotency + HR29 fail-open).
cn = pyodbc.connect(CONN, timeout=30); cur = cn.cursor()
try:
  for d in DDL: cur.execute(d)
  cn.commit()
  # reset the corpus tables (fresh mine each run)
  for t in ("LensCorpusFile", "LensSymbol", "LensCallGraph"):
    cur.execute(f"TRUNCATE TABLE dbo.{t}")
  cn.commit()

  all_symbols = {}   # name -> path (last def wins; good enough for edge resolution)
  per_file = []      # (rel, lang, loc, sha, funcs[], imports[])
  for p in files:
    try: src = open(p, encoding="utf-8-sig", errors="replace").read()
    except Exception: continue
    rel = os.path.relpath(p, ROOT).replace("\\", "/")
    lang = os.path.splitext(p)[1].lstrip(".")
    loc = src.count("\n") + 1
    sha = hashlib.sha256(src.encode("utf-8", "replace")).hexdigest()
    funcs = []
    for m in FUNC.get(lang, re.compile(r"$^")).finditer(src):
        name = next((g for g in m.groups() if g), None)
        if name and name not in ("if", "for", "while", "switch", "catch", "function", "constructor", "return"):
            funcs.append((name, src[:m.start()].count("\n") + 1))
    imps = sorted(set(next((g for g in m.groups() if g), "") for m in IMPORT.get(lang, re.compile(r"$^")).finditer(src) if any(m.groups())))
    per_file.append((rel, lang, loc, sha, funcs, imps))
    for name, ln in funcs:
        all_symbols[name] = rel

  # write files + symbols
  for rel, lang, loc, sha, funcs, imps in per_file:
    cur.execute("INSERT dbo.LensCorpusFile(path,lang,loc,sha256,function_count,imports) VALUES(?,?,?,?,?,?)",
                rel, lang, loc, sha, len(funcs), json.dumps(imps))
    for name, ln in funcs:
        cur.execute("INSERT dbo.LensSymbol(path,name,kind,start_line) VALUES(?,?,?,?)", rel, name, "function", ln)
  cn.commit()

  # .5231 (bughunt) — strip comments and string/char literals so edge resolution can't match a symbol
  # name that only appears inside a comment or a quoted string (a major false-positive source). This is
  # a pragmatic lexical scrub (not a full parser): blank out line comments, block comments, and quoted
  # spans, preserving newlines/length so later heuristics stay stable. Covers the corpus's languages
  # (# for ps1/py, // and /* */ for ts/js/mjs/cjs, plus ' " ` string/char quotes).
  _STRIP = re.compile(
      r"""(?P<block>/\*.*?\*/)          # C-style block comment
        | (?P<line>(?://|\#)[^\n]*)     # // or # line comment
        | (?P<dq>"(?:\\.|[^"\\\n])*")   # double-quoted string
        | (?P<sq>'(?:\\.|[^'\\\n])*')   # single-quoted string / char
        | (?P<bt>`(?:\\.|[^`\\])*`)     # backtick template literal
      """,
      re.S | re.X,
  )
  def _strip_noncode(text):
      # Replace each comment/string span with same-length whitespace (newlines kept) so word boundaries
      # and offsets are preserved but the contents can no longer produce spurious symbol matches.
      return _STRIP.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)

  # call graph: for each file, which OTHER known symbols does it reference?
  edges = 0
  for p, (rel, lang, loc, sha, funcs, imps) in zip(files, per_file):
    try: src = open(p, encoding="utf-8-sig", errors="replace").read()
    except Exception: continue
    code = _strip_noncode(src)   # .5231 — match only against code, not comments/strings
    own = set(n for n, _ in funcs)
    called = set()
    for name, tgt in all_symbols.items():
        if name in own or tgt == rel: continue
        # .5231 (bughunt) — require a CALL-LIKE context (`name(`), optionally qualified (`.name(`),
        # instead of the old "bare word anywhere" fallback whose loose `or ... and len>4` precedence
        # let any 5+ char name match anywhere. Calls are the edges we actually want in a call graph.
        if re.search(r"(?<![\w.])" + re.escape(name) + r"\s*\(", code):
            called.add((name, tgt))
    for name, tgt in called:
        cur.execute("INSERT dbo.LensCallGraph(from_path,symbol,edge,target_path) VALUES(?,?,?,?)", rel, name, "call", tgt); edges += 1
  cn.commit()

  # summary
  cur.execute("SELECT COUNT(*), SUM(loc), SUM(function_count) FROM dbo.LensCorpusFile"); nf, nloc, nfn = cur.fetchone()
  cur.execute("SELECT COUNT(*) FROM dbo.LensCallGraph"); ne = cur.fetchone()[0]
  cur.execute("SELECT TOP 8 target_path, COUNT(*) c FROM dbo.LensCallGraph GROUP BY target_path ORDER BY c DESC")
  hubs = cur.fetchall()
finally:
  cn.close()   # .5231b (re-hunt) — always release the SQL handle, even on a mid-mine exception
print(f"[CORPUS] mined: {nf} files · {nloc} LOC · {nfn} functions · {ne} call-graph edges")
print(f"[CORPUS] most-depended-on files (call-graph hubs):")
for h, c in hubs: print(f"    {h}: {c} inbound refs")
print(f"[CORPUS] tables: LensCorpusFile, LensSymbol, LensCallGraph, LensSecurityFinding — query the whole corpus in SQL.")
