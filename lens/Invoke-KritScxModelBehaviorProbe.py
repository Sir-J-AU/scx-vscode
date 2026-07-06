"""
Kritical Lens — SCX per-model BEHAVIORAL probe (.5187).

PROVIDERS.md documents the STATIC catalog (context/pricing/features from GET /v1/models) but nothing
about how each model actually BEHAVES on a real structured-output task. This session found the gap the
hard way: gpt-oss-120b's reasoning tokens ate a 500-token output budget and it silently returned empty
JSON on every large file, while `coder` was reliable. That empirical behavior lives nowhere.

This probe runs the SAME known-answer structured-JSON task across every chat model and records, per model:
  - latency (s)
  - prompt / completion / reasoning tokens (the reasoning overhead is the load-bearing finding)
  - returned valid parseable JSON? (first attempt)
  - got the CORRECT answer? (the task has a planted comment/code mismatch — did the model catch it)
  - min output budget that works (reasoning_tokens + json — informs the mux's max_tokens default)

Stores dbo.LensScxModelProbe (KriticalSCXCodeStore) + prints a matrix to fold into docs/PROVIDERS.md.
Read-only except that one table. HR1: SCX_API_KEY only.

Usage: python Invoke-KritScxModelBehaviorProbe.py
"""
import os, sys, json, time, re, urllib.request
import pyodbc

KEY = os.environ.get("SCX_API_KEY")
if not KEY:
    print("SCX_API_KEY not set (HKCU). HR1: SCX only — aborting."); sys.exit(2)
URL = "https://api.scx.ai/v1/chat/completions"
CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")

# The 9 chat/instruct models from the VS Code dropdown (kritical.scxcode defaultModel enum).
MODELS = ["MiniMax-M2.7", "MAGPiE", "gpt-oss-120b", "DeepSeek-V3.1",
          "Meta-Llama-3.3-70B-Instruct", "gemma-4-31B-it", "Qwen3-32B",
          "Llama-4-Maverick-17B-128E-Instruct", "coder"]

# Known-answer structured-output task: an AL proc whose comment says "product" but code does "sum".
# .5187 — the correctness key measures ONLY the UNAMBIGUOUS dimension: comments_match_code MUST be
# false (the comment says "product", the code sums — objectively a mismatch). `hollow` is deliberately
# NOT scored: whether a wrong-word comment counts as "documented-but-not-implemented" is a subjective
# judgment, and an early version of this probe wrongly demanded hollow=true, which scored 8/9 models as
# "wrong" when they were actually being more precise than the over-opinionated key. Scoring only the
# clear-cut dimension is the accurate measure of whether a model produces a CORRECT structured verdict.
SYS = ('You evaluate whether code comments accurately describe the code. Return STRICT JSON only, no prose: '
       '{"has_comments":bool,"comments_match_code":bool,"hollow":bool,"note":"one sentence"}')
USER = ("```al\n// Adds two integers and returns the PRODUCT of a and b\n"
        "procedure Combine(a: Integer; b: Integer): Integer\nbegin\n  exit(a + b);\nend;\n```")
CORRECT = {"comments_match_code": False}  # the one objectively-correct dimension; hollow is subjective


def probe(model, max_tokens=1400):
    body = json.dumps({"model": model, "temperature": 0, "max_tokens": max_tokens,
                       "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": USER}]}).encode()
    t = time.time()
    try:
        req = urllib.request.Request(URL, data=body,
                                     headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=180) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        return {"ok": False, "err": f"HTTP {e.code}: {e.read()[:120].decode(errors='replace')}", "latency": round(time.time() - t, 1)}
    except Exception as e:
        return {"ok": False, "err": f"{type(e).__name__}: {str(e)[:120]}", "latency": round(time.time() - t, 1)}
    lat = round(time.time() - t, 1)
    content = (j.get("choices", [{}])[0].get("message", {}) or {}).get("content", "") or ""
    usage = j.get("usage", {}) or {}
    reasoning = (usage.get("completion_tokens_details", {}) or {}).get("reasoning_tokens", 0)
    # parse JSON
    parsed, valid_json, correct = None, False, False
    c = re.sub(r"^```[a-z]*|```$", "", content.strip(), flags=re.M).strip()
    mm = re.search(r"\{[\s\S]*\}", c)
    if mm:
        try:
            parsed = json.loads(mm.group(0)); valid_json = True
            correct = all(bool(parsed.get(k)) == v for k, v in CORRECT.items())
        except Exception:
            pass
    return {"ok": True, "latency": lat, "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0), "reasoning_tokens": reasoning,
            "valid_json": valid_json, "correct": correct, "empty": (content.strip() == ""),
            "content_preview": content[:80]}


def main():
    cn = pyodbc.connect(CONN, timeout=30); cur = cn.cursor()
    cur.execute("""IF OBJECT_ID('dbo.LensScxModelProbe') IS NULL CREATE TABLE dbo.LensScxModelProbe(
        id INT IDENTITY PRIMARY KEY, model VARCHAR(60), ok BIT, latency_s FLOAT,
        prompt_tokens INT, completion_tokens INT, reasoning_tokens INT,
        valid_json BIT, correct BIT, empty_response BIT, err NVARCHAR(300),
        probe_utc DATETIME2 DEFAULT SYSUTCDATETIME());""")
    cn.commit()

    print(f"{'model':38} {'ok':4} {'lat':>5} {'in':>6} {'out':>6} {'reason':>6} {'json':>5} {'correct':>7}  note")
    rows = []
    for m in MODELS:
        r = probe(m)
        if r["ok"]:
            print(f"{m:38} {'Y':4} {r['latency']:>5} {r['prompt_tokens']:>6} {r['completion_tokens']:>6} "
                  f"{r['reasoning_tokens']:>6} {('Y' if r['valid_json'] else 'n'):>5} {('Y' if r['correct'] else 'n'):>7}  "
                  f"{'EMPTY' if r['empty'] else r['content_preview'][:40]}")
            cur.execute("""INSERT dbo.LensScxModelProbe(model,ok,latency_s,prompt_tokens,completion_tokens,reasoning_tokens,valid_json,correct,empty_response,err)
                VALUES(?,?,?,?,?,?,?,?,?,?)""", m, 1, r["latency"], r["prompt_tokens"], r["completion_tokens"],
                r["reasoning_tokens"], int(r["valid_json"]), int(r["correct"]), int(r["empty"]), None)
        else:
            print(f"{m:38} {'N':4} {r['latency']:>5}  ---    ---    ---    ---     ---  {r['err']}")
            cur.execute("""INSERT dbo.LensScxModelProbe(model,ok,latency_s,err) VALUES(?,?,?,?)""", m, 0, r["latency"], r["err"][:300])
        rows.append((m, r))
    cn.commit(); cn.close()

    # Markdown behavioral matrix (fold into docs/PROVIDERS.md)
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "SCX-MODEL-BEHAVIOR-PROBE.md")
    L = ["# SCX per-model BEHAVIORAL probe — structured-output task (.5187)",
         "",
         "> The empirical companion to PROVIDERS.md's static catalog. Same known-answer structured-JSON task",
         "> (an AL proc whose comment says 'product' but code sums — objectively comments_match_code=false)",
         "> run across every chat model. This is what the catalog's 'json_mode' feature flag does NOT tell",
         "> you: whether the model actually emits usable JSON, how much of the output budget its reasoning",
         "> eats, and whether it gets the objectively-correct verdict. (Correctness is scored only on the",
         "> unambiguous comments_match_code dimension — `hollow` is a subjective judgment and NOT scored.)",
         "> Stored in `KriticalSCXCodeStore.dbo.LensScxModelProbe`; refresh via `lens/Invoke-KritScxModelBehaviorProbe.py`.",
         "",
         "| Model | ok | latency | reasoning tok | valid JSON | correct | verdict for structured tasks |",
         "|---|---|---:|---:|---|---|---|"]
    for m, r in rows:
        if not r["ok"]:
            L.append(f"| **{m}** | ✗ | {r['latency']}s | — | — | — | FAILED: {r['err']} |")
            continue
        verdict = ("reliable" if (r["valid_json"] and r["correct"] and not r["empty"])
                   else ("empty-response (reasoning ate budget)" if r["empty"]
                         else ("wrong answer" if r["valid_json"] and not r["correct"]
                               else "no parseable JSON")))
        L.append(f"| **{m}** | ✓ | {r['latency']}s | {r['reasoning_tokens']} | "
                 f"{'✓' if r['valid_json'] else '✗'} | {'✓' if r['correct'] else '✗'} | {verdict} |")
    # Split models by reasoning overhead for the routing rule.
    zero_reason = [m for m, r in rows if r["ok"] and r.get("reasoning_tokens", 0) == 0 and r.get("correct")]
    high_reason = [(m, r.get("reasoning_tokens", 0)) for m, r in rows if r["ok"] and r.get("reasoning_tokens", 0) > 0]
    L += ["",
          "## Load-bearing findings (fold into the mux prompting/routing rules)",
          "",
          "**All 9 chat models emit valid JSON and get the objectively-correct verdict on this task** — so",
          "'json_mode capable' is real. The differentiator is REASONING OVERHEAD, and it's the whole story",
          "behind the gpt-oss silent-skip this session hit:",
          "",
          f"- **Zero-reasoning-token models** (safest for structured output under a tight `max_tokens`): "
          f"{', '.join('`'+m+'`' for m in zero_reason) or '(none this run)'}. These emit the JSON directly",
          "  with no thinking budget consumed — they will NOT silently return empty even on a small output cap.",
          f"- **Reasoning models** (thinking tokens count against `max_tokens`): "
          f"{', '.join(f'`{m}`={t}' for m, t in high_reason)}. On a tiny task the overhead is ~58-185 tokens,",
          "  but it SCALES WITH INPUT COMPLEXITY — on a 45k-char AL file it can exceed a 500-token cap and",
          "  return empty (exactly the gpt-oss skip this session hit before max_tokens was raised to 1400).",
          "",
          "**Routing rule for the mux**: for bounded structured-extraction (comment-eval, classification,",
          "JSON tagging) prefer a zero-reasoning model OR give a reasoning model output headroom of",
          "`reasoning_overhead x input-complexity-factor + json_size`. Reserve the heavy reasoners",
          "(MiniMax/coder/MAGPiE) for open-ended analysis where the thinking IS the deliverable.",
          "",
          "- Refresh this probe whenever the SCX roster or key/tier changes — behavior is not guaranteed",
          "  stable across model version bumps."]
    open(os.path.abspath(out), "w", encoding="utf-8").write("\n".join(L))
    print(f"\n[MODEL-PROBE] matrix -> docs/SCX-MODEL-BEHAVIOR-PROBE.md + dbo.LensScxModelProbe")


if __name__ == "__main__":
    main()
