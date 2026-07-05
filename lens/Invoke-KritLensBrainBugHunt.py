"""
Kritical Lens + Brain — SCX-offloaded bug hunt & full-fidelity ingestion.

For a target source file:
  1. RAW PARSE (Lens, deterministic) — extract every function/method by brace-matching:
     name, start/end line, line count, param signature, the identifiers it literally references.
  2. SEMANTIC PARSE (Brain, offloaded to DeepSeek-V3.1 via the SCX proxy, CONCURRENT) —
     purpose, identifiers_used, bugs[], concerns[]  (strict JSON).
  3. COMPARE semantic-vs-raw with TRUE/FALSE metadata — every identifier DeepSeek claims the
     function uses is checked against the raw body (present=true/false). match_rate recorded.
  4. SQL-MINE everything into KriticalSCXCodeStore:
       lens_artifact (tool=lens.raw_parse | lens.semantic)  — GZIP, sha256-deduped
       decision_log  (side=ai, category=bug|semantic, meta=JSON with true/false comparison)
  5. Emit a report of every bug DeepSeek found + the raw/semantic match rate, for human verify.

SCX-only: routes through 127.0.0.1:4180 (proxy → SCX_API_KEY). Never touches Claude/OpenAI keys.
Usage: python Invoke-KritLensBrainBugHunt.py <file.ts> [model] [concurrency]
"""
import sys, os, re, json, gzip, hashlib, time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyodbc

PROXY = "http://127.0.0.1:4180/v1/chat/completions"
KEY   = "sk-kritical-scx-local"
CONN  = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
         "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")

target = sys.argv[1] if len(sys.argv) > 1 else "extension.ts"
model  = sys.argv[2] if len(sys.argv) > 2 else "DeepSeek-V3.1"
conc   = int(sys.argv[3]) if len(sys.argv) > 3 else 6
session = f"lens-bughunt-{os.path.basename(target)}"

src = open(target, encoding="utf-8-sig").read()
lines = src.splitlines()

# ---------- 1. RAW PARSE: brace-match every function / async function / class method ----------
IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
sig_re = re.compile(r"^\s*(?:export\s+)?(?:public\s+|private\s+|static\s+)?(?:async\s+)?"
                    r"(?:function\s+)?(?P<name>[A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?::[^={]+)?\{")
units = []
i = 0
while i < len(lines):
    m = sig_re.match(lines[i])
    # avoid matching keywords/control-flow as "functions"
    if m and m.group("name") not in ("if","for","while","switch","catch","function","return","constructor"):
        name = m.group("name"); start = i
        depth = 0; started = False; body = []
        j = i
        while j < len(lines):
            body.append(lines[j])
            depth += lines[j].count("{") - lines[j].count("}")
            if "{" in lines[j]:
                started = True
            if started and depth <= 0:
                break
            j += 1
        text = "\n".join(body)
        if 2 <= len(body) <= 400:  # skip trivial one-liners and runaway matches
            idents = sorted(set(IDENT.findall(text)))
            units.append({"name": name, "start": start+1, "end": j+1,
                          "lines": len(body), "text": text, "raw_idents": idents})
        i = j + 1
    else:
        i += 1

print(f"[RAW PARSE] {target}: {len(lines)} lines -> {len(units)} function/method units extracted")
for u in units:
    print(f"    {u['name']:28} L{u['start']}-{u['end']} ({u['lines']} lines)")

# ---------- 2. SEMANTIC PARSE via DeepSeek-V3.1 (concurrent SCX offload) ----------
SYS = ("You are a meticulous code auditor. Analyze one TypeScript function from a VS Code extension. "
       "Return STRICT JSON only, no markdown fences, with keys: "
       'purpose (string, one sentence), identifiers_used (array of the key function/variable names it references), '
       'bugs (array of {severity:"high"|"med"|"low", line_hint:string, description:string}), '
       'concerns (array of strings). If no bugs, return bugs: [].')

def analyze(u):
    prompt = f"Function `{u['name']}` (lines {u['start']}-{u['end']}):\n\n```typescript\n{u['text']}\n```"
    body = json.dumps({"model": model, "temperature": 0, "max_tokens": 1200,
                       "messages": [{"role":"system","content":SYS},{"role":"user","content":prompt}]}).encode()
    req = urllib.request.Request(PROXY, data=body,
          headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.load(r)
        content = resp["choices"][0]["message"]["content"]
        ms = int((time.time()-t0)*1000)
        # strip any stray fences and parse JSON
        cleaned = re.sub(r"^```[a-z]*|```$", "", content.strip(), flags=re.M).strip()
        try:
            parsed = json.loads(cleaned)
        except Exception:
            mjson = re.search(r"\{[\s\S]*\}", cleaned)
            parsed = json.loads(mjson.group(0)) if mjson else {"purpose":"(unparseable)","identifiers_used":[],"bugs":[],"concerns":["model returned non-JSON"]}
        return u, parsed, content, ms, None
    except Exception as e:
        return u, None, "", int((time.time()-t0)*1000), str(e)

print(f"\n[SEMANTIC] offloading {len(units)} units to {model} via SCX proxy @ concurrency {conc} ...")
results = []
with ThreadPoolExecutor(max_workers=conc) as ex:
    for fut in as_completed([ex.submit(analyze, u) for u in units]):
        results.append(fut.result())
results.sort(key=lambda r: r[0]["start"])

# ---------- 3+4. COMPARE (true/false) + SQL-MINE to Lens + Brain ----------
cn = pyodbc.connect(CONN, timeout=15); cur = cn.cursor()
def sha(s): return hashlib.sha256(s.encode("utf-8","replace")).hexdigest().upper()
def store_lens(tool, root, text):
    h = sha(text)
    if cur.execute("SELECT COUNT(*) FROM dbo.lens_artifact WHERE content_sha256=? AND tool=?", h, tool).fetchone()[0]:
        return False
    cur.execute("INSERT dbo.lens_artifact(tool,root,content_sha256,content_gz,byte_len) VALUES(?,?,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?)",
                tool, root, h, text, len(text.encode())); return True
def store_brain(category, text, meta):
    # decision_log has a UNIQUE sha index — dedup is a store feature. Make the hashed content
    # unique per (function, category) so distinct findings don't false-collide, then skip true dupes.
    tagged = f"{meta.get('function','')}|{category}|{text}"
    h = sha(tagged)
    if cur.execute("SELECT COUNT(*) FROM dbo.decision_log WHERE content_sha256=?", h).fetchone()[0]:
        return False
    cur.execute("INSERT dbo.decision_log(ts_utc,side,category,wave,session_id,content_sha256,simhash,content_len,content_gz,preview_120,model,provider,source,meta) "
                "VALUES(SYSUTCDATETIME(),'ai',?,?,?,?,0,?,COMPRESS(CAST(? AS NVARCHAR(MAX))),?,?,?,?,?)",
                category, ".5211", session, h, len(text), text, text[:120], model, "scx", "lens-bughunt", json.dumps(meta)); return True

all_bugs = []; total_claims = 0; total_true = 0; lens_rows = 0
for u, parsed, raw_content, ms, err in results:
    store_lens("lens.raw_parse", target, json.dumps({"name":u["name"],"start":u["start"],"end":u["end"],"lines":u["lines"],"raw_idents":u["raw_idents"]}))
    lens_rows += 1
    if err or parsed is None:
        print(f"    ! {u['name']}: SCX call failed — {err}")
        continue
    store_lens("lens.semantic", target, json.dumps(parsed))
    lens_rows += 1
    # COMPARE: every identifier DeepSeek claims -> present in raw body? true/false
    body_ident_set = set(u["raw_idents"])
    checks = []
    for ident in parsed.get("identifiers_used", []):
        base = re.split(r"[.\(\[]", str(ident))[0].strip()
        present = base in body_ident_set
        checks.append({"claim": ident, "present_in_raw": present})
        total_claims += 1; total_true += 1 if present else 0
    match_rate = round(sum(c["present_in_raw"] for c in checks)/len(checks), 3) if checks else None
    meta = {"function": u["name"], "lines": f"{u['start']}-{u['end']}", "latency_ms": ms,
            "semantic_vs_raw": checks, "match_rate": match_rate,
            "bug_count": len(parsed.get("bugs", []))}
    store_brain("semantic", json.dumps(parsed), meta)
    for b in parsed.get("bugs", []):
        all_bugs.append({"function": u["name"], "loc": f"{u['start']}-{u['end']}", **b})
        store_brain("bug", json.dumps(b), {"function":u["name"],"loc":f"{u['start']}-{u['end']}","severity":b.get("severity"),"verified":None})
    print(f"    ok {u['name']:26} {ms:5}ms  idents:{len(checks)} match_rate:{match_rate}  bugs:{len(parsed.get('bugs',[]))}")
cn.commit(); cn.close()

# ---------- 5. REPORT ----------
print(f"\n===== LENS+BRAIN INGESTION COMPLETE =====")
print(f"  lens_artifact rows written : {lens_rows} (raw + semantic)")
print(f"  semantic->raw identifier checks : {total_true}/{total_claims} present in raw "
      f"({round(100*total_true/total_claims,1) if total_claims else 0}% — a true/false grounding score for DeepSeek)")
print(f"  bugs surfaced by {model}: {len(all_bugs)}")
sev_order = {"high":0,"med":1,"low":2}
for b in sorted(all_bugs, key=lambda x: sev_order.get(x.get("severity","low"),3)):
    print(f"    [{b.get('severity','?').upper():4}] {b['function']} ({b['loc']}) @ {b.get('line_hint','?')}: {b.get('description','')[:140]}")
# dump bugs to a file for the human-verify pass (next to this script, in the lens/ dir)
_outdir = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(_outdir, "_last-bughunt-findings.json"), "w", encoding="utf-8").write(json.dumps(all_bugs, indent=2))
print(f"  findings written: {os.path.join(_outdir, '_last-bughunt-findings.json')}")
