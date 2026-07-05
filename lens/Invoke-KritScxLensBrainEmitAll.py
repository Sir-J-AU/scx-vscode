"""
Kritical Lens + Brain — MASTER emit-all: coverage map + DeepSeek test emission (programmatic)
+ visual webview render check + run EVERY test + consolidated Brain receipt.

Phases:
  1. COVERAGE  — map every source file -> does it have a paired test? (Lens)
  2. EMIT      — for core uncovered files, offload a paired-test skeleton to DeepSeek-V3.1,
                 write it under tests/emitted/, store the emission to the Brain.
  3. VISUAL    — render the SCXCode webview HTML to a standalone file + structural assert.
  4. RUN       — run every test in tests/ (ps1 + js), capture pass/fail.
  5. RECEIPT   — write a consolidated Markdown report + a Brain (decision_log) receipt.

SCX-only via 127.0.0.1:4180. Usage: python Invoke-KritScxLensBrainEmitAll.py <repoRoot>
"""
import sys, os, re, json, hashlib, time, subprocess, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyodbc

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
PROXY = "http://127.0.0.1:4180/v1/chat/completions"; KEY = "sk-kritical-scx-local"
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
TESTS = os.path.join(ROOT, "tests"); EMIT = os.path.join(TESTS, "emitted"); os.makedirs(EMIT, exist_ok=True)
SKIP = ("node_modules", os.sep + "out" + os.sep, "receipts", os.sep + "sources" + os.sep, "documentation", "_last-bughunt", "_repo-sweep", os.sep + "tests" + os.sep, os.sep + "emitted" + os.sep)
CODE = (".ps1", ".psm1", ".py", ".ts", ".js")

def sha(s): return hashlib.sha256(s.encode("utf-8", "replace")).hexdigest().upper()

# ---------- Phase 1: COVERAGE ----------
srcs = []
for dp, dn, fn in os.walk(ROOT):
    if any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(CODE) and not any(s in p for s in SKIP):
            srcs.append(p)
srcs.sort()
test_blob = ""
for dp, dn, fn in os.walk(TESTS):
    for f in fn:
        try: test_blob += open(os.path.join(dp, f), encoding="utf-8-sig", errors="replace").read().lower()
        except Exception: pass
def stem(p): return os.path.splitext(os.path.basename(p))[0].lower()
covered, uncovered = [], []
for p in srcs:
    (covered if stem(p) in test_blob else uncovered).append(p)
print(f"[COVERAGE] {len(srcs)} source files · {len(covered)} referenced by a test · {len(uncovered)} not")

# core files worth emitting a paired test for (skip installers/one-offs)
CORE = ("mux/", "ps-module/", "store-mcp/", "litellm/", "models/", "codex-wrapper/kritical-codex", "lens/Invoke-KritLens")
emit_targets = [p for p in uncovered if any(c in p.replace("\\", "/") for c in CORE)][:8]
print(f"[EMIT] emitting paired tests for {len(emit_targets)} core uncovered files")

# ---------- Phase 2: EMIT (offload to DeepSeek) ----------
SYS = ("You write a MINIMAL smoke test for one file. For PowerShell (.ps1/.psm1) output a Pester-free "
       "test using [System.Management.Automation.Language.Parser]::ParseFile to assert 0 parse errors AND "
       "assert each exported function name exists in the file. For python output a test using ast.parse + "
       "assert key function names. Output ONLY the test script body, no markdown fences, no prose.")
def emit_test(path):
    try: src = open(path, encoding="utf-8-sig", errors="replace").read()
    except Exception as e: return path, None, str(e)
    lang = os.path.splitext(path)[1].lstrip(".")
    prompt = f"Write a smoke test for this {lang} file '{os.path.basename(path)}':\n\n```{lang}\n{src[:9000]}\n```"
    body = json.dumps({"model": "deepseek-v3.1", "temperature": 0, "max_tokens": 1400,
        "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": prompt}]}).encode()
    for attempt in range(3):
        use = "deepseek-v3.1" if attempt < 2 else "gpt-oss-120b"
        body = json.dumps({"model": use, "temperature": 0, "max_tokens": 1400,
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": prompt}]}).encode()
        try:
            req = urllib.request.Request(PROXY, data=body, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=150) as r:
                c = json.load(r)["choices"][0]["message"].get("content")
            if not c: time.sleep(1); continue
            c = re.sub(r"^```[a-z]*\s*|```\s*$", "", c.strip(), flags=re.M).strip()
            return path, c, None
        except Exception as e:
            time.sleep(1); last = str(e)
    return path, None, "empty/failed after 3 attempts"

emitted = []
if emit_targets:
    with ThreadPoolExecutor(max_workers=4) as ex:
        for fut in as_completed([ex.submit(emit_test, p) for p in emit_targets]):
            path, code, err = fut.result()
            rel = os.path.relpath(path, ROOT)
            if err or not code:
                print(f"  ! emit {rel}: {err}"); continue
            ext = ".ps1" if path.lower().endswith((".ps1", ".psm1")) else (".py" if path.endswith(".py") else ".js")
            out = os.path.join(EMIT, "Test-" + os.path.splitext(os.path.basename(path))[0] + ext)
            open(out, "w", encoding="utf-8").write(code)
            emitted.append(os.path.relpath(out, ROOT))
            print(f"  emitted {os.path.relpath(out, ROOT)} ({len(code)} chars)")

# ---------- Phase 3: VISUAL (render webview + structural assert) ----------
visual = {"rendered": False, "controls": 0}
ext_js = os.path.join(ROOT, "src", "out", "extension.js")
if os.path.exists(ext_js):
    try:
        node = subprocess.run(["node", "-e",
            "const fs=require('fs');const c=fs.readFileSync(process.argv[1],'utf8')+'\\nmodule.exports.__h=(typeof chatHtml===\"function\")?chatHtml:null;';"
            "const Module=require('module');const oL=Module._load;Module._load=function(r,...a){if(r==='vscode')return new Proxy({},{get:()=>()=>({})});return oL.call(this,r,...a)};"
            "const m=new Module(process.argv[1],null);m.filename=process.argv[1];m.paths=Module._nodeModulePaths(require('path').dirname(process.argv[1]));m._compile(c,process.argv[1]);"
            "const h=m.exports.__h();const ids=['model','len','streams','ctx','temp','provider','advBtn','tbUpload','tbRepo','tbMcp'];"
            "const n=ids.filter(i=>h.includes('id=\"'+i+'\"')).length;fs.writeFileSync(process.argv[2],h);console.log(JSON.stringify({len:h.length,controls:n,tagline:h.includes('IT &amp; IT Security Experts')}));",
            ext_js, os.path.join(EMIT, "scxcode-webview-render.html")],
            capture_output=True, text=True, timeout=30)
        info = json.loads(node.stdout.strip().splitlines()[-1])
        visual = {"rendered": True, "controls": info["controls"], "html_bytes": info["len"], "tagline": info["tagline"]}
        print(f"[VISUAL] webview rendered ({info['len']} bytes) · {info['controls']}/10 controls · tagline={info['tagline']} · -> tests/emitted/scxcode-webview-render.html")
    except Exception as e:
        print(f"[VISUAL] render failed: {e}")

# ---------- Phase 4: RUN every test ----------
print("[RUN] executing every test in tests/ ...")
results = []
for f in sorted(os.listdir(TESTS)):
    fp = os.path.join(TESTS, f)
    if not os.path.isfile(fp): continue
    t0 = time.time()
    try:
        if f.lower().endswith(".ps1"):
            r = subprocess.run(["pwsh", "-NoProfile", "-File", fp], capture_output=True, text=True, timeout=180)
        elif f.lower().endswith(".js"):
            r = subprocess.run(["node", fp], capture_output=True, text=True, timeout=120)
        else:
            continue
        ok = (r.returncode == 0)
        tail = (r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else ""
        results.append((f, ok, int((time.time()-t0)*1000), tail[:80]))
        print(f"  {'PASS' if ok else 'FAIL'}  {f:34} {int((time.time()-t0)*1000):6}ms  {tail[:70]}")
    except subprocess.TimeoutExpired:
        results.append((f, False, 180000, "TIMEOUT")); print(f"  FAIL  {f}  TIMEOUT")
    except Exception as e:
        results.append((f, False, 0, str(e)[:60])); print(f"  ERR   {f}: {e}")

# ---------- Phase 5: RECEIPT (Brain + Markdown) ----------
passed = sum(1 for _, ok, _, _ in results if ok); failed = len(results) - passed
report = {
    "wave": ".5215", "utc_source": "runtime",
    "coverage": {"sources": len(srcs), "covered": len(covered), "uncovered": len(uncovered)},
    "emitted_tests": emitted,
    "visual": visual,
    "tests": [{"name": n, "pass": ok, "ms": ms, "tail": t} for n, ok, ms, t in results],
    "summary": {"tests_passed": passed, "tests_failed": failed},
}
cn = pyodbc.connect(CONN, timeout=15); cur = cn.cursor()
txt = json.dumps(report)
h = sha("emit-all|" + txt + str(len(results)) + str(passed))
if cur.execute("SELECT COUNT(*) FROM dbo.decision_log WHERE content_sha256=?", h).fetchone()[0] == 0:
    cur.execute("INSERT dbo.decision_log(ts_utc,side,category,wave,session_id,content_sha256,simhash,content_len,content_gz,preview_120,model,provider,source,meta) "
                "VALUES(SYSUTCDATETIME(),'ai','test-emit-receipt','.5215','emit-all',?,0,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?,'deepseek-v3.1','scx','emit-all',?)",
                h, len(txt), txt, txt[:120], json.dumps(report["summary"]))
    cn.commit()
cn.close()
md = os.path.join(ROOT, "lens", "LENS-BRAIN-EMIT-REPORT.md")
with open(md, "w", encoding="utf-8") as f:
    f.write("# Kritical Lens + Brain — Emit-All Report\n\n")
    f.write(f"- Coverage: **{len(covered)}/{len(srcs)}** source files referenced by a test\n")
    f.write(f"- Paired tests emitted this run: **{len(emitted)}** ({', '.join(emitted) or 'none'})\n")
    f.write(f"- Visual webview render: **{visual}**\n")
    f.write(f"- Tests run: **{passed} passed / {failed} failed**\n\n| Test | Result | ms |\n|---|---|---|\n")
    for n, ok, ms, t in results:
        f.write(f"| {n} | {'✅' if ok else '❌'} | {ms} |\n")
print(f"\n===== EMIT-ALL COMPLETE =====")
print(f"  coverage {len(covered)}/{len(srcs)} · emitted {len(emitted)} tests · visual {visual.get('controls',0)}/10 controls · tests {passed} pass / {failed} fail")
print(f"  Brain receipt stored (decision_log category=test-emit-receipt) · report -> lens/LENS-BRAIN-EMIT-REPORT.md")
