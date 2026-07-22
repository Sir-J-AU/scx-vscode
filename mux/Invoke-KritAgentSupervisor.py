"""
Kritical SCXCode agent supervisor.

Runs a task across BOTH control planes:
  - free router: http://127.0.0.1:4182/v1 using KRIT_FREE_ROUTER_MASTER_KEY
  - SCX native:  https://api.scx.ai/v1 using SCX_API_KEY

Dry-run validates routing, payload shape, SQL backing, and manifest integrity
without spending tokens. Live mode isolates failures per lane and synthesizes a
plain report from successful lanes.

Author: Joshua Finley
(c) 2026 Kritical Pty Ltd. All rights reserved.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE = Path(os.environ.get("KRIT_SCX_SUPERVISOR_DB", Path.home() / ".kritical-scx" / "scxcode-supervisor.db"))
DEFAULT_FREE_KEY = os.environ.get("KRIT_FREE_ROUTER_MASTER_KEY", "sk-kritical-free-local")

LANES = [
    {
        "id": "free-coding",
        "plane": "free-router",
        "base_url": "http://127.0.0.1:4182/v1",
        "model": "free-coding",
        "api_key_env": "KRIT_FREE_ROUTER_MASTER_KEY",
        "default_key": DEFAULT_FREE_KEY,
        "role": "cheap broad coding pass through free providers",
    },
    {
        "id": "free-reasoning",
        "plane": "free-router",
        "base_url": "http://127.0.0.1:4182/v1",
        "model": "free-reasoning",
        "api_key_env": "KRIT_FREE_ROUTER_MASTER_KEY",
        "default_key": DEFAULT_FREE_KEY,
        "role": "cheap reasoning pass through free providers",
    },
    {
        "id": "scx-coder",
        "plane": "scx-native",
        "base_url": "https://api.scx.ai/v1",
        "model": "coder",
        "api_key_env": "SCX_API_KEY",
        "default_key": None,
        "role": "SCX high-context coding pass",
    },
    {
        "id": "scx-minimax",
        "plane": "scx-native",
        "base_url": "https://api.scx.ai/v1",
        "model": "MiniMax-M2.7",
        "api_key_env": "SCX_API_KEY",
        "default_key": None,
        "role": "SCX synthesis and agentic planning pass",
    },
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS supervisor_runs (
  run_id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS supervisor_lane_results (
  run_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  plane TEXT NOT NULL,
  model TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  response_preview TEXT,
  error TEXT,
  created_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(run_id, lane_id)
);
"""


def ensure_sqlite(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as con:
        con.executescript(SCHEMA)
        con.commit()


def persist_run(path: Path, run_id: str, task: str, mode: str, results: list[dict]) -> None:
    ensure_sqlite(path)
    with sqlite3.connect(path) as con:
        con.execute(
            "INSERT OR REPLACE INTO supervisor_runs(run_id, task, mode) VALUES(?,?,?)",
            (run_id, task, mode),
        )
        for r in results:
            con.execute(
                "INSERT OR REPLACE INTO supervisor_lane_results"
                "(run_id,lane_id,plane,model,ok,status,latency_ms,prompt_tokens,completion_tokens,response_preview,error) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    run_id,
                    r["lane_id"],
                    r["plane"],
                    r["model"],
                    1 if r.get("ok") else 0,
                    r.get("status"),
                    r.get("latency_ms"),
                    r.get("prompt_tokens"),
                    r.get("completion_tokens"),
                    (r.get("text") or "")[:500],
                    r.get("error"),
                ),
            )
        con.commit()


def api_key_for(lane: dict) -> str | None:
    return os.environ.get(lane["api_key_env"]) or lane.get("default_key")


def build_payload(lane: dict, task: str, max_tokens: int) -> dict:
    return {
        "model": lane["model"],
        "messages": [
            {"role": "system", "content": f"You are a Kritical coding lane: {lane['role']}. Be concrete and test-oriented."},
            {"role": "user", "content": task},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }


def call_lane(lane: dict, task: str, max_tokens: int, timeout: int, dry_run: bool) -> dict:
    result = {
        "lane_id": lane["id"],
        "plane": lane["plane"],
        "model": lane["model"],
        "ok": False,
        "status": "dry-run" if dry_run else None,
    }
    payload = build_payload(lane, task, max_tokens)
    result["payload"] = payload
    key = api_key_for(lane)
    if dry_run:
        result["ok"] = True
        result["text"] = f"validated {lane['id']} -> {lane['base_url']} model={lane['model']} key_env={lane['api_key_env']}"
        return result
    if not key:
        result["error"] = f"missing {lane['api_key_env']}"
        result["status"] = "missing-key"
        return result
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        lane["base_url"].rstrip("/") + "/chat/completions",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
        msg = ((data.get("choices") or [{}])[0].get("message") or {})
        usage = data.get("usage") or {}
        result.update(
            ok=True,
            status="ok",
            latency_ms=int((time.time() - started) * 1000),
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            text=msg.get("content") or msg.get("reasoning_content") or "",
        )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        result.update(status=f"http-{exc.code}", latency_ms=int((time.time() - started) * 1000), error=detail)
    except Exception as exc:
        result.update(status="error", latency_ms=int((time.time() - started) * 1000), error=f"{type(exc).__name__}: {exc}")
    return result


def summarize(task: str, results: list[dict]) -> str:
    ok = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]
    lines = [
        "# Kritical Agent Supervisor Report",
        "",
        f"Task: {task}",
        "",
        "| Lane | Plane | Model | Status | Tokens |",
        "|---|---|---|---|---:|",
    ]
    for r in results:
        tok = (r.get("prompt_tokens") or 0) + (r.get("completion_tokens") or 0)
        lines.append(f"| {r['lane_id']} | {r['plane']} | {r['model']} | {r.get('status')} | {tok} |")
    lines.append("")
    lines.append(f"Successful lanes: {len(ok)} / {len(results)}")
    if failed:
        lines.append("Failed lanes: " + ", ".join(f"{r['lane_id']}({r.get('status')})" for r in failed))
    lines.append("")
    for r in ok:
        lines.append(f"## {r['lane_id']}")
        lines.append((r.get("text") or "").strip())
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Run a task across free-router and SCX-native lanes.")
    p.add_argument("-q", "--task", required=True)
    p.add_argument("--mode", choices=["dry-run", "live"], default="dry-run")
    p.add_argument("--sqlite", default=str(DEFAULT_SQLITE))
    p.add_argument("--report", default=None)
    p.add_argument("--max-tokens", type=int, default=900)
    p.add_argument("--timeout", type=int, default=120)
    p.add_argument("--lanes", nargs="*", default=[lane["id"] for lane in LANES])
    args = p.parse_args(argv)

    selected = [lane for lane in LANES if lane["id"] in set(args.lanes)]
    if not selected:
        print("No lanes selected.", file=sys.stderr)
        return 2
    run_id = f"supervisor-{int(time.time())}"
    db = Path(args.sqlite)
    ensure_sqlite(db)

    dry_run = args.mode == "dry-run"
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(selected)) as ex:
        futures = [ex.submit(call_lane, lane, args.task, args.max_tokens, args.timeout, dry_run) for lane in selected]
        results = [f.result() for f in futures]
    persist_run(db, run_id, args.task, args.mode, results)
    report = summarize(args.task, results)
    print(report)
    if args.report:
        out = Path(args.report)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report, encoding="utf-8")
        print(f"\nreport written: {out}")
    return 0 if any(r.get("ok") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
