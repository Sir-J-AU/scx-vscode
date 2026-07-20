"""
Kritical SCX — synthetic-context multi-stream proof.
Pulls REAL context out of KriticalSCXCodeStore (the DB), fans out N parallel SCX 'lens' streams
over it, synthesises ONE answer — then compares against a naive single-shot with no context.
"""
import argparse, os, sys, json, time, urllib.request, concurrent.futures
import pyodbc

KEY = os.environ.get("SCX_API_KEY")
URL = "https://api.scx.ai/v1/chat/completions"
DEFAULT_MODEL = "MiniMax-M2.7"
DEFAULT_MAX_OUT = 4096
DEFAULT_SERVER = r".\SQLEXPRESS"
DEFAULT_DATABASE = "KriticalSCXCodeStore"

def conn_string(server, database):
    return f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};Trusted_Connection=yes;Encrypt=no;"

def message_text(payload):
    msg = (payload.get("choices") or [{}])[0].get("message", {}) or {}
    return msg.get("content") or msg.get("reasoning_content") or ""

def decode_sql_hex_text(value):
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    text = str(value)
    try:
        return bytes.fromhex(text).decode("utf-8", errors="replace")
    except ValueError:
        return text

def scx(model, messages, max_tokens=DEFAULT_MAX_OUT, temperature=0.4):
    body = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.loads(r.read())
    txt = message_text(j)
    u = j.get("usage", {})
    return txt, (u.get("prompt_tokens", 0), u.get("completion_tokens", 0)), time.time() - t0

# ---- synthetic context: retrieve real source + symbols from the DB ----
def retrieve_context(conn, keywords, max_chars=160000):   # .5231 (bughunt) — was 11000 (~2.7k tok), far under
                                                     # gpt-oss-120b's real ~108k ceiling; silently dropped context.
    cn = pyodbc.connect(conn, timeout=15); c = cn.cursor()
    like = " OR ".join(["path LIKE ?"] * len(keywords))
    c.execute(f"SELECT path, CONVERT(VARCHAR(MAX), DECOMPRESS(content_gz), 2) FROM dbo.LensSource WHERE {like} ORDER BY byte_len",
              *[f"%{k}%" for k in keywords])
    blocks, used, files = [], 0, []
    for path, content_hex in c.fetchall():
        content = decode_sql_hex_text(content_hex)
        if not content: continue
        snippet = content[:4500]
        b = f"### FILE: {path}\n```\n{snippet}\n```\n"
        if used + len(b) > max_chars: break
        blocks.append(b); used += len(b); files.append(path)
    # structural context from the symbol graph
    c.execute("SELECT TOP 12 name FROM dbo.LensSymbol WHERE path LIKE '%scx-agentic-shim%' ORDER BY start_line")
    syms = [r[0] for r in c.fetchall()]
    return "\n".join(blocks), files, used, syms

LENSES = [
    ("direct",       "Answer the question directly and correctly, grounded ONLY in the provided source."),
    ("edge-cases",   "Focus on edge cases, failure modes, and what the code does when things go wrong."),
    ("security",     "Focus on security + isolation properties (keys, localhost, what is/ isn't touched)."),
    ("architecture", "Focus on how this fits the broader agentic-SCX architecture and why."),
    ("sql-storage",  "Focus on SQL/SQLite memory, retrieval, context packing, stale summaries, and provenance."),
]

QUESTION = ("How does the SCX agentic shim decide which codex tools to flatten, and how does it handle "
            "SCX's plan-gated server tools like web_search? Cite specific behaviour from the code.")

def build_arg_parser():
    p = argparse.ArgumentParser(description="Fan five prompt lenses across one SCX model over SQL-backed context.")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--max-out", type=int, default=DEFAULT_MAX_OUT)
    p.add_argument("--server", default=DEFAULT_SERVER)
    p.add_argument("--database", default=DEFAULT_DATABASE)
    p.add_argument("--max-context-chars", type=int, default=160000)
    p.add_argument("--keywords", nargs="+", default=["scx-agentic-shim", "SCX-AGENTIC-BRIDGE"])
    p.add_argument("--question", default=QUESTION)
    return p

def run(argv=None):
    args = build_arg_parser().parse_args(argv)
    if not KEY:
        print("ERROR: SCX_API_KEY is not set. HR1: SCX key only — export SCX_API_KEY and retry.", file=sys.stderr)
        return 2
    conn = conn_string(args.server, args.database)
    print("== retrieving synthetic context from KriticalSCXCodeStore ==")
    ctx, files, ctx_chars, syms = retrieve_context(conn, args.keywords, args.max_context_chars)
    print(f"   pulled {len(files)} files / {ctx_chars} chars from the DB: {', '.join(os.path.basename(f) for f in files)}")
    print(f"   symbol graph: {', '.join(syms[:8])} …")

    # ---- BASELINE: naive single-shot, NO context, NO mux ----
    print("\n== BASELINE (single-shot, no context, no mux) ==")
    try:
        base_txt, base_tok, base_t = scx(args.model, [{"role": "user", "content": args.question}], max_tokens=500)
        print(f"   {base_t:.1f}s · {base_tok[0]}→{base_tok[1]} tok")
        print("   " + base_txt.strip().replace("\n", "\n   ")[:600])
    except Exception as e:  # .5231 (bughunt) — a baseline failure must not abort the mux demonstration
        base_txt, base_tok = "", (0, 0)
        print(f"   baseline call failed: {e}")

    # ---- SYNTHETIC-CONTEXT MULTI-STREAM: N parallel lenses over the DB context ----
    print(f"\n== SYNTHETIC-CONTEXT MULTI-STREAM ({len(LENSES)} parallel lenses over DB context) ==")
    sys_ctx = f"You are answering strictly from this retrieved Kritical SCX source context:\n\n{ctx}"
    def one(lens):
        name, focus = lens
        # .5231 (bughunt) — isolate each stream: a non-2xx / timeout raises HTTPError inside urlopen,
        # and list(ex.map(...)) would re-raise it and discard EVERY other successful stream. Catch here.
        try:
            txt, tok, t = scx([
                {"role": "system", "content": sys_ctx},
                {"role": "user", "content": f"{args.question}\n\n[Lens for THIS stream: {focus}]"},
            ], max_tokens=args.max_out)
            return name, txt, tok, t, None
        except Exception as e:
            return name, "", (0, 0), 0.0, str(e)
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(LENSES)) as ex:
        streams = list(ex.map(one, LENSES))
    fan_t = time.time() - t0
    fan_tok = sum(s[2][0] + s[2][1] for s in streams)
    for name, txt, tok, t, err in streams:
        print(f"   ✓ stream '{name}' — {t:.1f}s · {tok[1]} out tok" if not err else f"   ✗ stream '{name}' FAILED: {err}")

    # ---- SYNTHESIZE (only the streams that succeeded) ----
    ok_streams = [s for s in streams if not s[4] and s[1].strip()]
    merged = "\n\n".join(f"--- stream: {n} ---\n{txt}" for n, txt, _, _, _ in ok_streams)
    if not ok_streams:
        print("\n== all lens streams failed — cannot synthesise ==")
        return
    synth_txt, synth_tok, synth_t = scx(args.model, [
        {"role": "system", "content": sys_ctx},
        {"role": "user", "content": f"Question:\n{args.question}\n\nBelow are {len(LENSES)} parallel analyses of the SAME retrieved code. "
                                     f"Synthesise ONE authoritative, specific answer — resolve overlaps, keep concrete code behaviour, drop fluff. "
                                     f"Do not mention 'streams'.\n\n{merged}"}],
        max_tokens=args.max_out)
    print(f"\n== SYNTHESISED ANSWER (fan-out {fan_t:.1f}s + synth {synth_t:.1f}s = {fan_t+synth_t:.1f}s wall) ==")
    print("   " + synth_txt.strip().replace("\n", "\n   "))

    print("\n== SCORECARD ==")
    print(f"   synthetic context injected : {ctx_chars} chars of REAL code from {len(files)} DB files")
    print(f"   parallel reasoning streams : {len(LENSES)} (fanned out concurrently, {fan_t:.1f}s wall)")
    print(f"   total tokens (streams+synth): {fan_tok + synth_tok[0] + synth_tok[1]}")
    print(f"   grounded 'flattenTool'/'web_search' cited: {'YES' if ('flatten' in synth_txt.lower() or 'web_search' in synth_txt.lower()) else 'no'}")
    print(f"   baseline mentioned the real code?         : {'YES' if ('flatten' in base_txt.lower() or 'plan-gate' in base_txt.lower()) else 'NO (hallucinated / generic)'}")
    return 0

if __name__ == "__main__":
    sys.exit(run())
