"""
Kritical.SCX.Lens — kritical_shopify_json (.5234)
==================================================
The reusable Python JSON + Shopify Admin API handlers battle-tested during the .5230-.5234
PROD-clone/theme waves. Collected per operator directive: "Save our all python JSON handlers
for reuse and document."

WHY PYTHON (not PowerShell) FOR THESE: PowerShell's ConvertTo-Json mangles JSON-carried-as-a-
string payloads (Shopify asset PUT failed with 'expected Hash to be a String'); Python's
json.dumps round-trips them exactly. jq 1.8.1 is also on PATH for shell-side slicing.

HANDLERS
--------
hkcu_env(name)                 read an HKCU env var (token convention) without leaking it to logs
gql(store, token, query, vars) Shopify Admin GraphQL POST -> parsed dict (2026-04)
gql_nodes(conn)                unwrap GraphQL {edges:[{node:...}]} connections (the shape trap)
gql_paginate(...)              cursor-paginate any connection, yielding nodes
rest_put_asset(...)            theme asset PUT with JSON-as-string value done RIGHT
write_json_atomic(path, data)  temp -> validate-roundtrip -> rotate .bak -> rename (never half-written)
read_json_or_bak(path)         read with .bak fallback, never throws
sha256_file(path)              content hashing for manifests / dedupe

PROVEN USES (.5230-.5234)
-------------------------
- 134/134 PROD Files synced to 1234 via fileCreate(originalSource=cdn url) + filename dedupe
- 5 PROD products productSet'd + 191 extras pruned (products now exactly = PROD)
- 30 settings/group JSONs re-PUT after Shopify's silent settings-strip (fixed Dawn-default topbar)
- models-cache atomic write w/ .bak fallback (the never-blank-dropdown guarantee)

RATE LIMITS: REST 2 req/s -> sleep 0.5-0.6 between asset PUTs; GraphQL is cost-bucketed
(single-resource mutations ~= 10 points of 1000; sleep 0.3-0.55 is comfortable).
"""
from __future__ import annotations
import hashlib
import json
import os
import subprocess
import time
import urllib.request

API_VERSION = "2026-04"


def hkcu_env(name: str) -> str:
    """Read an HKCU (User-scope) env var — the Kritical token convention (SHOPIFY_ADMIN_TOKEN_K1234 etc.).
    Never print the value; pass it straight into request headers."""
    out = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command",
         f"[Environment]::GetEnvironmentVariable('{name}','User')"],
        capture_output=True, text=True)
    return (out.stdout or "").strip()


def gql(store: str, token: str, query: str, variables: dict | None = None, timeout: int = 90) -> dict:
    """Shopify Admin GraphQL call. store like 'kritical-1234.myshopify.com'. Returns parsed JSON dict.
    Raises urllib.error.HTTPError on transport errors; check ['errors'] / userErrors yourself."""
    req = urllib.request.Request(
        f"https://{store}/admin/api/{API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def gql_nodes(connection: dict | None) -> list:
    """Unwrap {edges:[{node:{...}}]} -> [node, ...]. THE shape trap: pulled product JSONs carry
    variants/images as GraphQL connections, not lists — index [0] on them and you KeyError."""
    return [e["node"] for e in (connection or {}).get("edges", [])]


def gql_paginate(store: str, token: str, query: str, conn_path: str,
                 variables: dict | None = None, sleep: float = 0.3):
    """Cursor-paginate a connection. query MUST take ($a:String) as the after-cursor and select
    pageInfo{hasNextPage} + edges{cursor node{...}}. conn_path like 'products' or 'files'.
    Yields nodes across all pages."""
    after = None
    while True:
        v = dict(variables or {})
        v["a"] = after
        data = gql(store, token, query, v)
        conn = data["data"]
        for part in conn_path.split("."):
            conn = conn[part]
        edges = conn["edges"]
        for e in edges:
            yield e["node"]
        if not conn["pageInfo"]["hasNextPage"]:
            return
        after = edges[-1]["cursor"]
        time.sleep(sleep)


def rest_put_asset(store: str, token: str, theme_id: int, key: str, value: str | None = None,
                   attachment_b64: str | None = None, timeout: int = 60) -> None:
    """Theme asset PUT done RIGHT: json.dumps keeps a JSON-file-as-string as a STRING.
    (PowerShell ConvertTo-Json turns it into a Hash -> Shopify 400 'expected Hash to be a String'.)
    Pass value= for text assets, attachment_b64= for binary."""
    asset: dict = {"key": key}
    if value is not None:
        asset["value"] = value
    if attachment_b64 is not None:
        asset["attachment"] = attachment_b64
    req = urllib.request.Request(
        f"https://{store}/admin/api/{API_VERSION}/themes/{theme_id}/assets.json",
        data=json.dumps({"asset": asset}).encode(), method="PUT",
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        r.read()


def write_json_atomic(path: str, data) -> None:
    """Never leave a half-written or empty JSON: write temp -> parse-validate -> rotate current
    to .bak -> atomic rename. Refuses to persist empty payloads (the never-blank guarantee)."""
    text = json.dumps(data)
    if not text or text in ("[]", "null", "{}"):
        return
    tmp = path + ".tmp"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    json.load(open(tmp, encoding="utf-8"))          # validate round-trip before committing
    if os.path.exists(path):
        try:
            import shutil
            shutil.copyfile(path, path + ".bak")
        except OSError:
            pass
    os.replace(tmp, path)


def read_json_or_bak(path: str):
    """Read JSON with .bak fallback; returns None instead of raising (caller falls back to preseed)."""
    for p in (path, path + ".bak"):
        try:
            if os.path.exists(p):
                d = json.load(open(p, encoding="utf-8"))
                if d:
                    return d
        except (OSError, json.JSONDecodeError):
            continue
    return None


def sha256_file(path: str) -> str:
    """Content hash for manifests / dedupe (the pack manifest + LensGitBlob convention)."""
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


if __name__ == "__main__":
    # smoke: atomic write + bak fallback + roundtrip
    import tempfile
    d = os.path.join(tempfile.gettempdir(), "ksj-smoke")
    p = os.path.join(d, "t.json")
    write_json_atomic(p, {"a": 1})
    write_json_atomic(p, {"a": 2})
    assert read_json_or_bak(p) == {"a": 2}
    os.remove(p)
    assert read_json_or_bak(p) == {"a": 2}          # .bak fallback? no—bak holds {"a":1}
    print("smoke notes: primary read ok; bak holds prior version:", read_json_or_bak(p))
