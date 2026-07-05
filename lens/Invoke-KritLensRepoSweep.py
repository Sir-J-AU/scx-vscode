"""
Kritical Lens + Brain — WHOLE-REPO SCX-offloaded bug sweep.
Enumerates every code file, sends each to DeepSeek-V3.1 (concurrent) for a bug/issue audit,
stores raw metrics -> lens_artifact and findings -> decision_log. Prints per-file + aggregate.
SCX-only via 127.0.0.1:4180. Usage: python Invoke-KritLensRepoSweep.py <repoRoot> [concurrency]
"""
import sys, os, re, json, hashlib, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyodbc

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
CONC = int(sys.argv[2]) if len(sys.argv) > 2 else 6
PROXY = "http://127.0.0.1:4180/v1/chat/completions"; KEY = "sk-kritical-scx-local"; MODEL = "deepseek-v3.1"
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")
EXTS = (".ts", ".js", ".py", ".ps1", ".psm1", ".yaml", ".yml")
SKIP = ("node_modules", os.sep + "out" + os.sep, "receipts", os.sep + "sources" + os.sep, "documentation", ".vsix", "package-lock", "_last-bughunt")

files = []
for dp, dn, fn in os.walk(ROOT):
    if any(s in dp for s in SKIP): continue
    for f in fn:
        p = os.path.join(dp, f)
        if p.lower().endswith(EXTS) and not any(s in p for s in SKIP):
            files.append(p)
files.sort()
print(f"[SWEEP] {ROOT}: {len(files)} code files -> {MODEL} @ concurrency {CONC}")

SYS = ("You are a meticulous code auditor. Audit ONE source file. Return STRICT JSON only, no fences: "
       '{"purpose":"one sentence","bugs":[{"severity":"high|med|low","line_hint":"str","description":"str"}],'
       '"concerns":["str"]}. Focus on real defects: crashes, wrong logic, injection, resource leaks, '
       'broken error handling, PowerShell $var: scope bugs, hardcoded secrets, SCX-only violations '
       '(OpenAI/Anthropic keys in SCX-native code). If clean, bugs:[].')

def audit(path):
    try:
        src = open(path, encoding="utf-8-sig", errors="replace").read()
    except Exception as e:
        return path, None, "", 0, f"read failed: {e}"
    lang = os.path.splitext(path)[1].lstrip(".")
    user = f"File: {os.path.basename(path)} ({lang}):\n\n```{lang}\n{src[:14000]}\n```"
    t0 = time.time(); last = None
    for attempt in range(4):  # retry; on later attempts fall back to a non-reasoning model
        # deepseek-v3.1 is a reasoning model — on the biggest files it burns max_tokens on
        # reasoning and returns empty content. Fall back to gpt-oss-120b (non-reasoning, always emits).
        use_model = MODEL if attempt < 2 else "gpt-oss-120b"
        body = json.dumps({"model": use_model, "temperature": 0, "max_tokens": 3000,
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": user}]}).encode()
        try:
            req = urllib.request.Request(PROXY, data=body, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                content = json.load(r)["choices"][0]["message"].get("content")
            if not content:  # None/empty -> retry rather than crash on .strip()
                last = "empty content"; time.sleep(1); continue
            cleaned = re.sub(r"^```[a-z]*|```$", "", content.strip(), flags=re.M).strip()
            try: parsed = json.loads(cleaned)
            except Exception:
                m = re.search(r"\{[\s\S]*\}", cleaned)
                if not m: last = "non-JSON response"; time.sleep(1); continue
                parsed = json.loads(m.group(0))
            return path, parsed, content, int((time.time()-t0)*1000), None
        except Exception as e:
            last = str(e); time.sleep(1)
    return path, None, "", int((time.time()-t0)*1000), f"{last} (after 3 attempts)"

results = []
with ThreadPoolExecutor(max_workers=CONC) as ex:
    for fut in as_completed([ex.submit(audit, p) for p in files]):
        results.append(fut.result())
results.sort(key=lambda r: r[0])

cn = pyodbc.connect(CONN, timeout=20); cur = cn.cursor()
def sha(s): return hashlib.sha256(s.encode("utf-8", "replace")).hexdigest().upper()
def store_lens(tool, root, text):
    # content_sha256 MUST equal sha(the stored content) — the store's round-trip invariant.
    # Embed tool+root INTO the content so distinct artifacts stay distinct AND fidelity holds.
    payload = json.dumps({"tool": tool, "root": root, "data": text})
    h = sha(payload)
    if cur.execute("SELECT COUNT(*) FROM dbo.lens_artifact WHERE content_sha256=?", h).fetchone()[0]: return
    cur.execute("INSERT dbo.lens_artifact(tool,root,content_sha256,content_gz,byte_len) VALUES(?,?,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?)", tool, root, h, payload, len(payload.encode()))
def store_bug(f, b):
    # embed the file INTO the content so the same bug in two files stays two rows AND hash==sha(content)
    payload = json.dumps({"file": os.path.relpath(f, ROOT), **b})
    h = sha(payload)
    if cur.execute("SELECT COUNT(*) FROM dbo.decision_log WHERE content_sha256=?", h).fetchone()[0]: return
    cur.execute("INSERT dbo.decision_log(ts_utc,side,category,wave,session_id,content_sha256,simhash,content_len,content_gz,preview_120,model,provider,source,meta) "
                "VALUES(SYSUTCDATETIME(),'ai','bug','.5213','repo-sweep',?,0,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?,?,'scx','repo-sweep',?)",
                h, len(payload), payload, payload[:120], MODEL, json.dumps({"file": os.path.relpath(f, ROOT), "severity": b.get("severity"), "verified": None}))

all_bugs = []; ok = 0; failed = 0
for path, parsed, raw, ms, err in results:
    rel = os.path.relpath(path, ROOT)
    if err or parsed is None:
        failed += 1; print(f"  ! {rel}: {err}"); continue
    ok += 1
    store_lens("lens.repo_semantic", rel, json.dumps(parsed))
    bugs = parsed.get("bugs", [])
    for b in bugs:
        all_bugs.append({"file": rel, **b}); store_bug(path, b)
    hi = sum(1 for b in bugs if b.get("severity") == "high")
    print(f"  ok {rel:48} {ms:5}ms  bugs:{len(bugs)} (high:{hi})")
cn.commit(); cn.close()

print(f"\n===== REPO SWEEP COMPLETE =====")
print(f"  files audited OK: {ok} / {len(files)}  (failed: {failed})")
print(f"  total findings: {len(all_bugs)}")
sev = {"high": 0, "med": 1, "low": 2}
highs = [b for b in all_bugs if b.get("severity") == "high"]
print(f"  HIGH-severity findings: {len(highs)} (verify these first):")
for b in sorted(all_bugs, key=lambda x: sev.get(x.get("severity"), 3))[:40]:
    print(f"    [{b.get('severity','?').upper():4}] {b['file']} @ {b.get('line_hint','?')}: {b.get('description','')[:120]}")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_repo-sweep-findings.json"), "w", encoding="utf-8").write(json.dumps(all_bugs, indent=2))
print(f"  findings -> lens/_repo-sweep-findings.json")
