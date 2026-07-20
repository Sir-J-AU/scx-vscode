"""
Kritical Lens — SECURITY SQL-MINE (Stage B): real tools + DeepSeek security lens.
Runs PSScriptAnalyzer (PS), semgrep (multi-lang), npm audit (deps), deterministic secret/injection
greps, and a concurrent DeepSeek security review — all into dbo.LensSecurityFinding (inference-tagged).
Usage: python Invoke-KritScxSecurityMine.py <repoRoot>
"""
import sys, os, re, json, subprocess, hashlib, time, urllib.request, atexit
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyodbc

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
PROXY = "http://127.0.0.1:4180/v1/chat/completions"; KEY = "sk-kritical-scx-local"
SKIP = ("node_modules", os.sep+"out"+os.sep, os.sep+"emitted"+os.sep, "package-lock", os.sep+"sources"+os.sep)
CODE = (".ps1", ".psm1", ".py", ".ts", ".js")

cn = pyodbc.connect(CONN, timeout=30); cur = cn.cursor()
# .5231b (re-hunt) — this mine runs external tools (PSScriptAnalyzer/semgrep/npm audit) and a
# concurrent DeepSeek lens; an exception OUTSIDE the individual tool try/excepts (e.g. a cur.execute
# in add(), the deepseek-stage commit, or a summary query) used to skip the lone cn.close() at the
# bottom, leaking the pyodbc handle + locking KriticalSCXCodeStore until the process died. Register the
# close via atexit so the connection is ALWAYS released on any exit path (HR16 idempotency + HR29
# fail-open). The explicit cn.close() at the end still runs on the happy path; atexit is a no-op after
# an already-closed connection.
def _close_cn():
    try: cn.close()
    except Exception: pass  # already closed on the happy path (double-close is a no-op)
atexit.register(_close_cn)
cur.execute("IF OBJECT_ID('dbo.LensSecurityFinding') IS NOT NULL TRUNCATE TABLE dbo.LensSecurityFinding")
cn.commit()
def add(path, tool, sev, rule, line, msg, tag):
    cur.execute("INSERT dbo.LensSecurityFinding(path,tool,severity,[rule],[line],message,inference_tag) VALUES(?,?,?,?,?,?,?)",
                str(path)[:400], tool, sev[:10], str(rule)[:120], int(line or 0), str(msg)[:1000], tag[:200])

counts = {}
def bump(t, n=1): counts[t] = counts.get(t, 0) + n

# ---------- 1. PSScriptAnalyzer ----------
print("[SEC] PSScriptAnalyzer ...")
try:
    ps = subprocess.run(["pwsh","-NoProfile","-Command",
        f"Invoke-ScriptAnalyzer -Path '{ROOT}' -Recurse -ExcludeRule PSAvoidUsingWriteHost,PSUseShouldProcessForStateChangingFunctions "
        "-Severity Error,Warning 2>$null | Where-Object { $_.ScriptPath -notmatch 'node_modules|\\\\out\\\\|emitted' } | "
        "Select-Object RuleName,Severity,Line,Message,ScriptPath | ConvertTo-Json -Depth 4"],
        capture_output=True, text=True, timeout=180)
    data = json.loads(ps.stdout) if ps.stdout.strip() else []
    if isinstance(data, dict): data = [data]
    for d in data:
        rel = os.path.relpath(d.get("ScriptPath",""), ROOT).replace("\\","/")
        sev = {"Error":"high","Warning":"med","Information":"low"}.get(d.get("Severity",""), "low")
        add(rel, "psscriptanalyzer", sev, d.get("RuleName",""), d.get("Line",0), d.get("Message",""), "static-lint")
        bump("psscriptanalyzer")
    print(f"  PSScriptAnalyzer: {counts.get('psscriptanalyzer',0)} findings")
except Exception as e:
    print(f"  PSScriptAnalyzer skipped: {str(e)[:80]}")

# ---------- 2. semgrep ----------
print("[SEC] semgrep (this can take a minute) ...")
try:
    sg = subprocess.run(["semgrep","--config","auto","--json","--quiet","--timeout","20",
        "--exclude","node_modules","--exclude","out","--exclude","emitted", ROOT],
        capture_output=True, text=True, timeout=300)
    res = json.loads(sg.stdout) if sg.stdout.strip() else {"results":[]}
    for r in res.get("results", []):
        rel = os.path.relpath(r.get("path",""), ROOT).replace("\\","/")
        sev = {"ERROR":"high","WARNING":"med","INFO":"low"}.get(r.get("extra",{}).get("severity","INFO"), "low")
        add(rel, "semgrep", sev, r.get("check_id","")[:120], r.get("start",{}).get("line",0),
            r.get("extra",{}).get("message",""), "sast")
        bump("semgrep")
    print(f"  semgrep: {counts.get('semgrep',0)} findings")
except Exception as e:
    print(f"  semgrep skipped: {str(e)[:80]}")

# ---------- 3. npm audit (extension deps) ----------
print("[SEC] npm audit (src) ...")
try:
    na = subprocess.run(["npm","audit","--json"], cwd=os.path.join(ROOT,"src"),
        capture_output=True, text=True, timeout=120, shell=True)
    res = json.loads(na.stdout) if na.stdout.strip() else {}
    for name, v in (res.get("vulnerabilities") or {}).items():
        add("src/package.json", "npm-audit", v.get("severity","low"), name, 0,
            f"{v.get('severity')} vuln via {v.get('via')}", "dependency")
        bump("npm-audit")
    print(f"  npm audit: {counts.get('npm-audit',0)} vulnerable packages")
except Exception as e:
    print(f"  npm audit skipped: {str(e)[:80]}")

# ---------- 4. deterministic secret / injection greps ----------
print("[SEC] deterministic secret/injection scan ...")
SECRET = [(re.compile(r"sk-[a-zA-Z0-9]{20,}"), "possible API key literal"),
          (re.compile(r"(?i)password\s*=\s*['\"][^'\"]{6,}"), "hardcoded password"),
          (re.compile(r"(?i)(ghp_|github_pat_)[A-Za-z0-9]{20,}"), "GitHub token literal")]
DANGER = [(re.compile(r"Invoke-Expression|iex\s"), "Invoke-Expression (code exec)"),
          (re.compile(r"\|\s*iex\b"), "pipe to iex (remote exec)"),
          (re.compile(r"eval\("), "eval() (code exec)"),
          (re.compile(r"Remove-Item.*-Recurse.*-Force"), "recursive force delete")]
files = []
for dp, dn, fn in os.walk(ROOT):
    if any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(CODE) and not any(s in p for s in SKIP): files.append(p)
for p in files:
    try: src = open(p, encoding="utf-8-sig", errors="replace").read()
    except Exception: continue
    rel = os.path.relpath(p, ROOT).replace("\\","/")
    for rx, lbl in SECRET:
        for m in rx.finditer(src):
            # sk-kritical-scx-local is the KNOWN local proxy dummy — tag as benign
            benign = "sk-kritical-scx-local" in m.group(0)
            add(rel, "secret-grep", "low" if benign else "high", lbl, src[:m.start()].count("\n")+1,
                m.group(0)[:60], "benign-local-proxy-key" if benign else "SECRET-REVIEW"); bump("secret-grep")
    for rx, lbl in DANGER:
        for m in rx.finditer(src):
            add(rel, "danger-grep", "med", lbl, src[:m.start()].count("\n")+1, m.group(0)[:60], "dangerous-pattern"); bump("danger-grep")
print(f"  greps: {counts.get('secret-grep',0)} secret-ish, {counts.get('danger-grep',0)} dangerous-pattern")
cn.commit()

# ---------- 5. DeepSeek security lens (concurrent) ----------
print("[SEC] DeepSeek security lens (concurrent) ...")
SYS = ("You are a security auditor. Review ONE file for SECURITY issues ONLY (injection, command exec, "
       "path traversal, unsafe deserialization, secrets, SSRF, auth bypass, unsafe eval, TOCTOU). "
       'Return STRICT JSON: {"findings":[{"severity":"high|med|low","line_hint":"str","issue":"str"}]}. Empty if none.')
def seclens(p):
    try: src = open(p, encoding="utf-8-sig", errors="replace").read()
    except Exception: return p, []
    lang = os.path.splitext(p)[1].lstrip(".")
    for attempt in range(2):
        use = "deepseek-v3.1" if attempt == 0 else "gpt-oss-120b"
        body = json.dumps({"model":use,"temperature":0,"max_tokens":1400,"messages":[
            {"role":"system","content":SYS},{"role":"user","content":f"```{lang}\n{src[:12000]}\n```"}]}).encode()
        try:
            req = urllib.request.Request(PROXY, data=body, headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"})
            with urllib.request.urlopen(req, timeout=120) as r: c = json.load(r)["choices"][0]["message"].get("content")
            if not c: continue
            c = re.sub(r"^```[a-z]*|```$","",c.strip(),flags=re.M).strip()
            mm = re.search(r"\{[\s\S]*\}", c); parsed = json.loads(mm.group(0)) if mm else {"findings":[]}
            return p, parsed.get("findings", [])
        except Exception: time.sleep(1)
    return p, []
sec_findings = 0
with ThreadPoolExecutor(max_workers=6) as ex:
    for fut in as_completed([ex.submit(seclens, p) for p in files]):
        p, fs = fut.result()
        rel = os.path.relpath(p, ROOT).replace("\\","/")
        for f in fs:
            add(rel, "deepseek-sec", f.get("severity","low"), "sec-review", 0, f.get("issue","")[:1000], "ai-security-lens")
            sec_findings += 1
cn.commit(); bump("deepseek-sec", sec_findings)
print(f"  DeepSeek security lens: {sec_findings} findings")

# ---------- summary ----------
cur.execute("SELECT severity, COUNT(*) FROM dbo.LensSecurityFinding GROUP BY severity ORDER BY 2 DESC")
bysev = cur.fetchall()
cur.execute("SELECT tool, COUNT(*) FROM dbo.LensSecurityFinding GROUP BY tool ORDER BY 2 DESC")
bytool = cur.fetchall()
cur.execute("SELECT TOP 8 path, severity, tool, [rule], message FROM dbo.LensSecurityFinding WHERE severity='high' ORDER BY path")
highs = cur.fetchall()
cn.close()
print("\n===== SECURITY MINE COMPLETE (dbo.LensSecurityFinding) =====")
print("  by severity: " + ", ".join(f"{s}={n}" for s,n in bysev))
print("  by tool:     " + ", ".join(f"{t}={n}" for t,n in bytool))
print("  HIGH findings (verify):")
for pth, sv, tl, rl, msg in highs:
    print(f"    [{tl}] {pth}: {str(msg)[:90]}")
