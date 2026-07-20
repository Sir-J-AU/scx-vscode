"""
Kritical SCX — MULTI-MODEL parallel mux matrix (next evolution of the single-model mux).

The single-model mux (Invoke-KritScxSyntheticContext.py) fans N *lenses* across ONE model.
This fans ONE task across MULTIPLE models IN PARALLEL, sizing each model's injected context to
its REAL usable ceiling (proven in docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md — the advertised numbers
lie both ways), then synthesises every model's answer into one grounded cross-model answer.

  Per model  : trim retrieved corpus to THAT model's real ceiling (chars ~= tokens*4, headroom
               reserved for the question + the model's own output), call SCX concurrently.
  Report     : one comparative row per model (injected chars/est-tokens, real prompt/completion
               tokens used, latency, answer excerpt, or the failure reason).
  Synthesis  : one model reads every successful answer and produces a single grounded answer.

Per-stream error isolation: any model failing (HTTP 4xx/5xx / timeout / transport) is recorded
as failed and the run continues. HR1: SCX_API_KEY only — no other provider key, ever.

Reads corpus from the SHIPPABLE local SQLite store (%USERPROFILE%/.kritical-scx/scxcode-store.db,
`files` table: path, lang, content), SQL Server KriticalSCXCodeStore, or a --corpus directory.

    Author : Joshua Finley
    (c) 2026 Kritical Pty Ltd. All rights reserved.
"""
import argparse
import concurrent.futures
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

URL = "https://api.scx.ai/v1/chat/completions"
DEFAULT_DB = os.path.join(
    os.environ.get("USERPROFILE", os.path.expanduser("~")),
    ".kritical-scx", "scxcode-store.db",
)
DEFAULT_MSSQL_SERVER = r".\SQLEXPRESS"
DEFAULT_MSSQL_DATABASE = "KriticalSCXCodeStore"

# ---------------------------------------------------------------------------
# MODEL_CEILINGS — the REAL usable input ceilings proven by needle-recall in
# docs/SCX-MUX-STORAGE-CONTEXT-PROOF.md §1. The advertised numbers lie both ways:
# gpt-oss-120b is capped BELOW its advertised 131k; MiniMax exceeds its advertised
# 192k. We size each model's injected context to ITS real ceiling, never the ad number.
#   real_ctx_tokens : last-OK needle-recall size (total window: prompt + completion)
#   reserve_out     : tokens carved out for THIS model's own answer
#   safety_tokens   : extra headroom for chat framing / tokenizer drift
#   chars_per_token : conservative bytes->tokens factor (task says chars ~= tokens*4)
# ---------------------------------------------------------------------------
MODEL_CEILINGS = {
    "MiniMax-M2.7": {
        "real_ctx_tokens": 195000,   # advertised 192,000 — EXCEEDS; real hard ceiling ~196,608
        "reserve_out": 4096,
        "safety_tokens": 2000,
        "chars_per_token": 4,
        "features": ["tools", "reasoning", "json_mode"],
    },
    "DeepSeek-V3.1": {
        "real_ctx_tokens": 129000,   # advertised 131,072 — matches; needle recalled at every size
        "reserve_out": 2500,
        "safety_tokens": 2000,
        "chars_per_token": 4,
        "features": ["tools", "json_mode"],
    },
    "gpt-oss-120b": {
        "real_ctx_tokens": 108000,   # advertised 131,072 — BELOW; deployment caps input at ~108k
        "reserve_out": 4096,
        "safety_tokens": 2000,
        "chars_per_token": 4,
        "features": ["reasoning"],
    },
    "Qwen3-32B": {
        "real_ctx_tokens": 32000,
        "reserve_out": 2048,
        "safety_tokens": 1200,
        "chars_per_token": 4,
        "features": ["tools", "json_mode"],
    },
    "gemma-4-31B-it": {
        "real_ctx_tokens": 128000,
        "reserve_out": 2048,
        "safety_tokens": 2000,
        "chars_per_token": 4,
        "features": ["json_mode"],
    },
}

# Model that fuses the per-model answers. MiniMax is the default strong structured-output reasoner.
SYNTH_MODEL = "MiniMax-M2.7"


def context_char_budget(model, question, max_out):
    """How many CHARS of injected corpus THIS model can take, sized to its REAL ceiling.

    budget_tokens = real_ctx - question_tokens - reserve_out - safety
    budget_chars  = budget_tokens * chars_per_token
    Never negative; a tiny ceiling simply yields a small (or zero) budget rather than crashing.
    """
    spec = MODEL_CEILINGS[model]
    cpt = spec["chars_per_token"]
    question_tokens = (len(question) // cpt) + 1
    reserve_out = max(spec["reserve_out"], max_out)  # honour the larger of spec vs requested output
    budget_tokens = spec["real_ctx_tokens"] - question_tokens - reserve_out - spec["safety_tokens"]
    return max(0, budget_tokens * cpt)


def trim_to_budget(blocks, char_budget):
    """Pack whole file-blocks until the char budget is exhausted (smallest first = max coverage).

    Returns (packed_text, chars_used, files_included). Mirrors the single-model mux's
    'stop before you blow the ceiling' packing, but the ceiling is now PER MODEL.
    """
    packed, used, included = [], 0, []
    for path, block in blocks:
        if used + len(block) > char_budget:
            continue  # skip this (and any larger) block; keep scanning smaller ones
        packed.append(block)
        used += len(block)
        included.append(path)
    return "\n".join(packed), used, included


# ---------------------------------------------------------------------------
# Empirical model routing — measured score beats marketing metadata.
# ---------------------------------------------------------------------------
MODEL_EVAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_eval_results (
    eval_id             TEXT PRIMARY KEY,
    model_id            TEXT NOT NULL,
    benchmark_name      TEXT NOT NULL,
    task_type           TEXT NOT NULL,
    score               REAL NOT NULL,
    latency_ms          INTEGER,
    cost_estimate       REAL,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_model_eval_route
ON model_eval_results(model_id, task_type, benchmark_name, created_at);
"""


def ensure_eval_schema_sqlite(db_path):
    """Create the portable model_eval_results table in the SQLite control plane."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    con = sqlite3.connect(db_path)
    try:
        con.executescript(MODEL_EVAL_SCHEMA)
        con.commit()
    finally:
        con.close()


def model_capability_score(quality, latency_ms=None, cost_estimate=None, failure_rate=0.0,
                           quality_weight=1.0, latency_weight=0.0001,
                           cost_weight=1.0, failure_weight=1.0):
    """Score = quality_weight*quality - latency_weight*latency - cost_weight*cost - failure_weight*failure_rate."""
    return (
        quality_weight * float(quality)
        - latency_weight * float(latency_ms or 0)
        - cost_weight * float(cost_estimate or 0)
        - failure_weight * float(failure_rate or 0)
    )


def route_models_by_empirical_score(db_path, candidate_models, task_type,
                                    benchmark_name=None, limit=None):
    """Order candidate models by latest measured score for the requested task_type.

    Models without matching eval rows remain eligible and keep their configured order after
    measured models. This makes routing empirical where evidence exists, but never brittle.
    """
    if not os.path.exists(db_path):
        return list(candidate_models[:limit] if limit else candidate_models)
    con = sqlite3.connect(db_path)
    try:
        clauses = ["task_type = ?"]
        args = [task_type]
        if benchmark_name:
            clauses.append("benchmark_name = ?")
            args.append(benchmark_name)
        placeholders = ",".join("?" for _ in candidate_models)
        clauses.append(f"model_id IN ({placeholders})")
        args.extend(candidate_models)
        cur = con.execute(
            "SELECT model_id, score, created_at FROM model_eval_results "
            f"WHERE {' AND '.join(clauses)} "
            "ORDER BY score DESC, created_at DESC",
            args,
        )
        seen, ranked = set(), []
        for model_id, _score, _created_at in cur.fetchall():
            if model_id not in seen:
                seen.add(model_id)
                ranked.append(model_id)
        ranked.extend([m for m in candidate_models if m not in seen])
        return ranked[:limit] if limit else ranked
    except sqlite3.DatabaseError:
        return list(candidate_models[:limit] if limit else candidate_models)
    finally:
        con.close()


def message_text(payload):
    """Read normal content first, then reasoning_content for reasoning-heavy models."""
    msg = (payload.get("choices") or [{}])[0].get("message", {}) or {}
    return msg.get("content") or msg.get("reasoning_content") or ""


def decode_sql_hex_text(value):
    """Decode SQL Server CONVERT(VARCHAR(MAX), DECOMPRESS(varbinary), 2) hex text."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    text = str(value)
    try:
        return bytes.fromhex(text).decode("utf-8", errors="replace")
    except ValueError:
        return text


# ---------------------------------------------------------------------------
# Corpus retrieval — shippable local SQLite store, SQL Server, OR a --corpus directory.
# ---------------------------------------------------------------------------
def retrieve_from_sqlite(db_path, keywords, max_files=200):
    """Pull matching (path, lang, content) rows from the local SQLite `files` table.

    Same WHERE shape as store-mcp/kritical-local-store.mjs: path LIKE ? OR content LIKE ?.
    Smallest files first so per-model packing maximises how many distinct files fit.
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"local store not found: {db_path} (mine it first, or pass --corpus)")
    con = sqlite3.connect(db_path)
    try:
        where = " OR ".join(["path LIKE ? OR content LIKE ?"] * len(keywords))
        args = []
        for k in keywords:
            args.extend([f"%{k}%", f"%{k}%"])
        cur = con.execute(
            f"SELECT path, lang, content FROM files WHERE {where} "
            f"ORDER BY LENGTH(content) LIMIT {int(max_files)}",
            args,
        )
        return cur.fetchall()
    finally:
        con.close()


def retrieve_from_mssql(server, database, keywords, max_files=200):
    """Pull matching rows from SQL Server KriticalSCXCodeStore.dbo.LensSource."""
    try:
        import pyodbc
    except ImportError as exc:
        raise RuntimeError("pyodbc is required for --store mssql") from exc
    conn = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={server};DATABASE={database};"
        "Trusted_Connection=yes;Encrypt=no;"
    )
    cn = pyodbc.connect(conn, timeout=15)
    try:
        cur = cn.cursor()
        cur.execute(
            f"SELECT TOP {int(max_files) * 5} path, ext, "
            "CONVERT(VARCHAR(MAX), DECOMPRESS(content_gz), 2) AS content_hex "
            "FROM dbo.LensSource ORDER BY byte_len",
        )
        rows = []
        lowered_keywords = [keyword.lower() for keyword in keywords]
        for path, ext, content_hex in cur.fetchall():
            content = decode_sql_hex_text(content_hex)
            haystack = f"{path}\n{content}".lower()
            if any(keyword in haystack for keyword in lowered_keywords):
                rows.append((path, (ext or "").lstrip("."), content))
                if len(rows) >= max_files:
                    break
        return rows
    finally:
        cn.close()


def retrieve_from_corpus_dir(corpus_dir, keywords, max_files=200):
    """Fallback source: scan a directory, keep files whose path or content matches any keyword."""
    exts = {".py", ".ps1", ".mjs", ".js", ".ts", ".tsx", ".json", ".md", ".sql", ".cs", ".al"}
    kws = [k.lower() for k in keywords]
    rows = []
    for root, _dirs, names in os.walk(corpus_dir):
        for name in names:
            if os.path.splitext(name)[1].lower() not in exts:
                continue
            full = os.path.join(root, name)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
            except OSError:
                continue
            rel = os.path.relpath(full, corpus_dir)
            hay = (rel + "\n" + content).lower()
            if any(k in hay for k in kws):
                lang = os.path.splitext(name)[1].lstrip(".").lower()
                rows.append((rel, lang, content))
    rows.sort(key=lambda r: len(r[2]))
    return rows[:max_files]


def build_blocks(rows, snippet_chars=6000):
    """Turn (path, lang, content) rows into fenced file-blocks for injection.

    Returns [(path, block_text), ...]; retains the block-per-file shape the packer needs.
    """
    blocks = []
    for path, lang, content in rows:
        if not content:
            continue
        snippet = content[:snippet_chars]
        block = f"### FILE: {path}\n```{lang or ''}\n{snippet}\n```\n"
        blocks.append((path, block))
    return blocks


# ---------------------------------------------------------------------------
# SCX transport — OpenAI shape, Bearer SCX_API_KEY (HR1: SCX key only).
# ---------------------------------------------------------------------------
def scx_call(api_key, model, messages, max_tokens=700, temperature=0.4, timeout=120):
    """One SCX chat/completions call. Returns (text, (prompt_tok, completion_tok), latency_s).

    Raises on non-2xx / timeout / transport error — callers isolate per stream.
    """
    body = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode("utf-8")
    req = urllib.request.Request(
        URL, data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read())
    latency = time.time() - t0
    text = message_text(payload)
    usage = payload.get("usage", {}) or {}
    return text, (usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)), latency


# ---------------------------------------------------------------------------
# Per-model stream — sized, called, isolated.
# ---------------------------------------------------------------------------
def run_model_stream(api_key, model, question, blocks, max_out, timeout):
    """Run ONE model: size context to its ceiling, call SCX, capture result OR failure.

    Never raises: a 4xx/5xx/timeout/transport error is recorded as failed and returned,
    so one model's failure cannot kill the parallel run.
    """
    result = {
        "model": model, "ok": False, "error": None,
        "injected_chars": 0, "est_injected_tokens": 0, "files": [],
        "char_budget": 0, "prompt_tokens": 0, "completion_tokens": 0,
        "latency": 0.0, "answer": "",
    }
    try:
        cpt = MODEL_CEILINGS[model]["chars_per_token"]
        budget = context_char_budget(model, question, max_out)
        ctx, used, files = trim_to_budget(blocks, budget)
        result["char_budget"] = budget
        result["injected_chars"] = used
        result["est_injected_tokens"] = used // cpt
        result["files"] = files

        system = (
            "You answer STRICTLY from the retrieved Kritical SCX source context below. "
            "If the context does not contain the answer, say so — do not invent code.\n\n"
            + ctx
        )
        text, (ptok, ctok), latency = scx_call(
            api_key, model,
            [{"role": "system", "content": system},
             {"role": "user", "content": question}],
            max_tokens=max_out, timeout=timeout,
        )
        result.update(ok=True, prompt_tokens=ptok, completion_tokens=ctok,
                      latency=latency, answer=text)
    except urllib.error.HTTPError as e:
        result["error"] = f"HTTP {e.code} {e.reason}"
    except urllib.error.URLError as e:
        result["error"] = f"transport: {e.reason}"
    except Exception as e:  # timeout / decode / anything else — isolate it
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def synthesize(api_key, question, results, max_out, timeout):
    """Fuse the successful per-model answers into ONE grounded cross-model answer."""
    ok = [r for r in results if r["ok"] and r["answer"].strip()]
    if not ok:
        return None
    merged = "\n\n".join(
        f"--- answer from {r['model']} (context {r['est_injected_tokens']} est-tok) ---\n{r['answer']}"
        for r in ok
    )
    user = (
        f"Question:\n{question}\n\n"
        f"Below are answers to the SAME question from {len(ok)} different models, each grounded in the "
        f"same Kritical SCX source. Synthesise ONE authoritative, specific answer — resolve overlaps and "
        f"contradictions, keep concrete code behaviour, drop fluff. Prefer claims multiple models agree on. "
        f"Do not mention 'models' or 'streams'.\n\n{merged}"
    )
    text, tok, latency = scx_call(
        api_key, SYNTH_MODEL,
        [{"role": "user", "content": user}],
        max_tokens=max_out, timeout=timeout,
    )
    return {"model": SYNTH_MODEL, "answer": text, "tokens": tok, "latency": latency, "n_inputs": len(ok)}


def excerpt(text, n=280):
    t = " ".join(text.split())
    return t if len(t) <= n else t[:n] + " …"


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_console(question, source_desc, n_files, results, synth, fan_wall):
    print("=" * 78)
    print("Kritical SCX — MULTI-MODEL PARALLEL MUX MATRIX")
    print("=" * 78)
    print(f"Question : {question}")
    print(f"Corpus   : {source_desc} ({n_files} candidate files)")
    print(f"Models   : {', '.join(MODEL_CEILINGS)}  |  synth: {SYNTH_MODEL}")
    print()
    print("== PER-MODEL COMPARATIVE REPORT (fanned out concurrently) ==")
    for r in results:
        if r["ok"]:
            print(f"  [OK ] {r['model']:<16} "
                  f"inj {r['injected_chars']:>7}ch (~{r['est_injected_tokens']:>6} tok, {len(r['files'])} files) "
                  f"| used {r['prompt_tokens']}->{r['completion_tokens']} tok "
                  f"| {r['latency']:.1f}s")
            print(f"        excerpt: {excerpt(r['answer'])}")
        else:
            print(f"  [FAIL] {r['model']:<16} {r['error']}  (isolated — run continued)")
    ok_n = sum(1 for r in results if r["ok"])
    serial = sum(r["latency"] for r in results if r["ok"])
    print()
    print(f"  parallel wall: {fan_wall:.1f}s   vs serial stream-time: {serial:.1f}s   "
          f"({ok_n}/{len(results)} models OK)")
    print()
    if synth:
        print(f"== CROSS-MODEL SYNTHESIS ({SYNTH_MODEL}, fused {synth['n_inputs']} answers, "
              f"{synth['latency']:.1f}s) ==")
        print("   " + synth["answer"].strip().replace("\n", "\n   "))
    else:
        print("== CROSS-MODEL SYNTHESIS ==")
        print("   skipped — no model produced a usable answer.")
    print()


def write_markdown(path, question, source_desc, n_files, results, synth, fan_wall):
    lines = []
    lines.append("# Kritical SCX — Multi-Model Parallel Mux Matrix\n")
    lines.append(f"> {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())} · "
                 f"(c) 2026 Kritical Pty Ltd. All rights reserved.\n")
    lines.append(f"**Question:** {question}\n")
    lines.append(f"**Corpus:** {source_desc} ({n_files} candidate files)\n")
    lines.append("## Per-model comparative report\n")
    lines.append("| Model | Real ceiling (tok) | Injected chars | Est. tokens | Files | "
                 "Prompt→Completion | Latency | Status |")
    lines.append("|---|---:|---:|---:|---:|---|---:|---|")
    for r in results:
        ceil = MODEL_CEILINGS[r["model"]]["real_ctx_tokens"]
        if r["ok"]:
            lines.append(f"| {r['model']} | {ceil:,} | {r['injected_chars']:,} | "
                         f"{r['est_injected_tokens']:,} | {len(r['files'])} | "
                         f"{r['prompt_tokens']}→{r['completion_tokens']} | {r['latency']:.1f}s | OK |")
        else:
            lines.append(f"| {r['model']} | {ceil:,} | — | — | — | — | — | FAIL: {r['error']} |")
    serial = sum(r["latency"] for r in results if r["ok"])
    ok_n = sum(1 for r in results if r["ok"])
    lines.append(f"\n**Parallelism:** {fan_wall:.1f}s wall vs {serial:.1f}s serial stream-time "
                 f"({ok_n}/{len(results)} models OK).\n")
    for r in results:
        if r["ok"]:
            lines.append(f"### {r['model']}\n\n{r['answer'].strip()}\n")
    lines.append("## Cross-model synthesis\n")
    if synth:
        lines.append(f"*Synthesised by {SYNTH_MODEL} from {synth['n_inputs']} answers "
                     f"in {synth['latency']:.1f}s.*\n")
        lines.append(synth["answer"].strip() + "\n")
    else:
        lines.append("_Skipped — no model produced a usable answer._\n")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
DEFAULT_QUESTION = (
    "How does the SCX agentic shim decide which codex tools to flatten, and how does it handle "
    "SCX's plan-gated server tools like web_search? Cite specific behaviour from the code."
)


def build_arg_parser():
    p = argparse.ArgumentParser(
        prog="Invoke-KritScxMuxMatrix.py",
        description="Fan a task across MULTIPLE SCX models in parallel, each sized to its REAL "
                    "usable context ceiling, then synthesise one grounded cross-model answer.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Example:\n"
               '  python mux/Invoke-KritScxMuxMatrix.py \\\n'
               '    -q "How does the SCX agentic shim flatten codex tools and gate web_search?" \\\n'
               '    -k scx-agentic-shim SCX-AGENTIC-BRIDGE --report out/matrix.md\n\n'
               "HR1: reads SCX_API_KEY from the environment only — never any other provider key.",
    )
    p.add_argument("-q", "--question", default=DEFAULT_QUESTION,
                   help="The task/question to fan across models (default: the shim demo question).")
    p.add_argument("-k", "--keywords", nargs="+",
                   default=["scx-agentic-shim", "SCX-AGENTIC-BRIDGE"],
                   help="Keyword(s) selecting corpus files (path OR content match).")
    p.add_argument("--store", choices=["sqlite", "mssql", "dir"], default="sqlite",
                   help="Corpus/control-plane backend (default: sqlite).")
    p.add_argument("--db", default=DEFAULT_DB,
                   help=f"SQLite store path (default: {DEFAULT_DB}). Also holds model_eval_results.")
    p.add_argument("--mssql-server", default=DEFAULT_MSSQL_SERVER,
                   help=f"SQL Server instance for --store mssql (default: {DEFAULT_MSSQL_SERVER}).")
    p.add_argument("--mssql-database", default=DEFAULT_MSSQL_DATABASE,
                   help=f"SQL Server database for --store mssql (default: {DEFAULT_MSSQL_DATABASE}).")
    p.add_argument("--corpus", default=None,
                   help="Directory to scan. Implies --store dir when supplied.")
    p.add_argument("--models", nargs="+", default=list(MODEL_CEILINGS),
                   choices=list(MODEL_CEILINGS),
                   help="Subset of models to fan across (default: all measured/configured models).")
    p.add_argument("--task-type", default="structured_coding",
                   help="Task type for empirical model routing (default: structured_coding).")
    p.add_argument("--benchmark-name", default=None,
                   help="Optional benchmark_name filter for model_eval_results routing.")
    p.add_argument("--top-models", type=int, default=None,
                   help="Use only the top N models after empirical routing.")
    p.add_argument("--no-empirical-routing", action="store_true",
                   help="Keep --models order instead of sorting by model_eval_results score.")
    p.add_argument("--init-eval-schema", action="store_true",
                   help="Create model_eval_results in the SQLite control plane and exit.")
    p.add_argument("--max-out", type=int, default=4096,
                   help="Max output tokens per model stream (default: 4096).")
    p.add_argument("--timeout", type=int, default=120,
                   help="Per-call timeout in seconds (default: 120).")
    p.add_argument("--snippet-chars", type=int, default=6000,
                   help="Max chars taken from each file before packing (default: 6000).")
    p.add_argument("--report", default=None,
                   help="Optional path to write a markdown report.")
    return p


def main(argv=None):
    args = build_arg_parser().parse_args(argv)

    if args.init_eval_schema:
        ensure_eval_schema_sqlite(args.db)
        print(f"created/verified model_eval_results in {args.db}")
        return 0

    api_key = os.environ.get("SCX_API_KEY")
    if not api_key:
        print("ERROR: SCX_API_KEY is not set. HR1: SCX key only — export SCX_API_KEY and retry.",
              file=sys.stderr)
        return 2

    # ---- retrieve corpus ----
    try:
        if args.corpus:
            args.store = "dir"
        if args.store == "dir":
            if not args.corpus:
                raise ValueError("--store dir requires --corpus <directory>")
            rows = retrieve_from_corpus_dir(args.corpus, args.keywords)
            source_desc = f"dir:{args.corpus}"
        elif args.store == "mssql":
            rows = retrieve_from_mssql(args.mssql_server, args.mssql_database, args.keywords)
            source_desc = f"mssql:{args.mssql_server}/{args.mssql_database}"
        else:
            ensure_eval_schema_sqlite(args.db)
            rows = retrieve_from_sqlite(args.db, args.keywords)
            source_desc = f"sqlite:{args.db}"
    except Exception as e:
        print(f"ERROR retrieving corpus: {e}", file=sys.stderr)
        return 1

    blocks = build_blocks(rows, snippet_chars=args.snippet_chars)
    if not blocks:
        print(f"No corpus files matched keywords {args.keywords}. "
              f"Try different -k or --corpus.", file=sys.stderr)
        return 1

    # ---- fan out across models IN PARALLEL, each sized to its own ceiling ----
    models = args.models
    if not args.no_empirical_routing:
        models = route_models_by_empirical_score(
            args.db, models, args.task_type, args.benchmark_name, args.top_models,
        )
    elif args.top_models:
        models = models[:args.top_models]
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(models)) as ex:
        futures = {
            ex.submit(run_model_stream, api_key, m, args.question, blocks,
                      args.max_out, args.timeout): m
            for m in models
        }
        # gather in submission order for stable reporting
        by_model = {}
        for fut in concurrent.futures.as_completed(futures):
            r = fut.result()  # run_model_stream never raises — failures are captured inside
            by_model[r["model"]] = r
    results = [by_model[m] for m in models]
    fan_wall = time.time() - t0

    # ---- synthesise the successful answers ----
    try:
        synth = synthesize(api_key, args.question, results, args.max_out, args.timeout)
    except Exception as e:
        synth = None
        print(f"(synthesis call failed, per-model report still valid: {e})", file=sys.stderr)

    print_console(args.question, source_desc, len(rows), results, synth, fan_wall)

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
        write_markdown(args.report, args.question, source_desc, len(rows),
                       results, synth, fan_wall)
        print(f"markdown report written: {args.report}")

    return 0 if any(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
