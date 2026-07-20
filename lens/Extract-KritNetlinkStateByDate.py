"""
Kritical.SCX.Lens — NETLINK STATE-BY-DATE EXTRACTOR (.5246)
===========================================================
The operator's "query the fuck out of the history" as ONE re-runnable SQL-backed
report + rehydrator over dbo.LensGitBlob (KriticalSCXCodeStore).

Two lanes exist in the corpus:
  theme:    523 files, 2026-05-16 -> 2026-06-29  (pre-overlay Netlink/ShopifyTheme era)
  overlay:  616 files, 2026-06-07 -> 2026-07-05  (theme-layers/overlay era)

MODES
-----
timeline   Per-version SBOM tags for the key indicator files across BOTH lanes,
           sorted by commit date: hasJqueryLoad / secondJqueryLoad / hasAxiosLoad /
           hasAOS / jqueryCallSites / sbomScore. Emits the transition table +
           JSON report, and names the GOLDEN CHECKPOINTS (peak-vanilla, last
           version before a jQuery/axios reintroduction).
             py Extract-KritNetlinkStateByDate.py timeline [--out report.json]

rehydrate  Write the ENTIRE theme as it existed at a moment: for every distinct
           file in a lane, take the latest version with commit_date <= --as-of
           and write the full tree (pushable to a dev store for visual checks —
           e.g. spin up early-Huzaifa to answer "was the white box original?").
             py Extract-KritNetlinkStateByDate.py rehydrate --lane theme \
                --as-of 2026-05-20T00:00:00 --out C:\\KriticalSCX\\rehydrated\\theme-0520

Content is stored COMPRESS'd NVARCHAR — decompressed server-side via
CAST(DECOMPRESS(content_gz) AS NVARCHAR(MAX)). Binary assets (png/woff) were
mined as text-with-replacement and are skipped on rehydrate (list emitted) —
pull those from the nearest theme archive/backup zip instead.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys

import pyodbc

CONN = ("DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
        "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;")

# key indicator files (relative path within either lane)
KEY_FILES = [
    "layout/theme.liquid",
    "assets/number-counter.js",
    "assets/dt-mega-menu.js",
    "assets/dt-theme.js",
    "assets/global.js",
]
TEXT_EXT = re.compile(r"\.(liquid|json|css|js|svg|txt|md)$", re.I)


def tag_content(path: str, text: str) -> dict:
    """SBOM indicator tags for one file version."""
    t = text or ""
    tags = {}
    if path.endswith("theme.liquid"):
        # count real script loads (not comments)
        loads = re.findall(r"<script[^>]+src=[\"']([^\"']+)[\"']", t)
        jq = [u for u in loads if "jquery" in u.lower() and "cookie" not in u.lower()]
        tags["hasJqueryLoad"] = len(jq) > 0
        tags["jqueryLoadCount"] = len(jq)
        tags["hasAxiosLoad"] = any("axios" in u.lower() for u in loads)
        tags["hasAOS"] = any("aos" in u.lower() for u in loads) or "unpkg.com/aos" in t
        tags["hasSwiperLoad"] = any("swiper" in u.lower() for u in loads)
        score = 100
        score -= 20 * min(len(jq), 1) + 10 * max(len(jq) - 1, 0)   # first jq -20, extra loads -10
        score -= 15 if tags["hasAxiosLoad"] else 0
        score -= 10 if tags["hasAOS"] else 0
        tags["sbomScore"] = score
    else:
        # JS files: jQuery call-site density + vanilla markers
        sites = len(re.findall(r"[^\w$]\$\(|jQuery\(", t))
        tags["jqueryCallSites"] = sites
        tags["vanillaMarkers"] = sum(m in t for m in
                                     ("IntersectionObserver", "classList", "addEventListener", "querySelectorAll"))
        tags["sbomScore"] = max(0, 100 - 2 * sites) if sites else 100
    return tags


def mode_timeline(out_path: str | None):
    cn = pyodbc.connect(CONN, timeout=15)
    c = cn.cursor()
    rows = []
    for rel in KEY_FILES:
        for lane in ("theme", "overlay"):
            q = ("SELECT commit_date, commit_sha, subject, "
                 "CAST(DECOMPRESS(content_gz) AS NVARCHAR(MAX)) "
                 "FROM dbo.LensGitBlob WHERE app=? ORDER BY commit_date")
            for d, sha, subj, text in c.execute(q, f"{lane}:{rel}").fetchall():
                rows.append({"date": str(d), "sha": (sha or "")[:9], "lane": lane, "file": rel,
                             "subject": (subj or "")[:60], **tag_content(rel, text or "")})
    rows.sort(key=lambda r: r["date"])

    # print transitions per file (state-change rows only)
    print(f"{'date':20} {'lane':8} {'file':28} {'sha':9}  state")
    golden = []
    for rel in KEY_FILES:
        prev_state = None
        prev_row = None
        for r in [x for x in rows if x["file"] == rel]:
            state = {k: v for k, v in r.items() if k not in ("date", "sha", "lane", "subject", "file")}
            if state != prev_state:
                skey = " ".join(f"{k}={v}" for k, v in state.items())
                print(f"{r['date'][:19]:20} {r['lane']:8} {rel:28} {r['sha']:9}  {skey}")
                # golden checkpoint: a REGRESSION (score drops) => the PREVIOUS version is golden
                if prev_state and state.get("sbomScore", 100) < prev_state.get("sbomScore", 100):
                    golden.append({"file": rel, "goldenSha": prev_row["sha"], "goldenDate": prev_row["date"],
                                   "regressedBy": r["sha"], "regressedDate": r["date"],
                                   "drop": prev_state.get("sbomScore", 0) - state.get("sbomScore", 0)})
                prev_state, prev_row = state, r
    print(f"\n=== GOLDEN CHECKPOINTS (last version BEFORE each SBOM regression) ===")
    for g in golden:
        print(f"  {g['file']:28} golden {g['goldenSha']} @ {g['goldenDate'][:19]}  "
              f"(regressed by {g['regressedBy']} @ {g['regressedDate'][:19]}, score -{g['drop']})")
    if not golden:
        print("  none found in corpus window (no in-corpus SBOM regressions)")

    if out_path:
        json.dump({"rows": rows, "golden": golden}, open(out_path, "w", encoding="utf-8"), indent=1)
        print(f"\n[report] {out_path}  ({len(rows)} version rows)")
    cn.close()


def mode_rehydrate(lane: str, as_of: str, out_dir: str):
    cn = pyodbc.connect(CONN, timeout=15)
    c = cn.cursor()
    q = """
    SELECT app, path, commit_sha, commit_date, txt FROM (
      SELECT app, path, commit_sha, commit_date,
             CAST(DECOMPRESS(content_gz) AS NVARCHAR(MAX)) txt,
             ROW_NUMBER() OVER (PARTITION BY app ORDER BY commit_date DESC) rn
      FROM dbo.LensGitBlob
      WHERE app LIKE ? AND commit_date <= ?
    ) x WHERE rn = 1"""
    written, skipped_binary = 0, []
    os.makedirs(out_dir, exist_ok=True)
    for app, path, sha, d, txt in c.execute(q, f"{lane}:%", as_of).fetchall():
        rel = app.split(":", 1)[1]
        if not TEXT_EXT.search(rel):
            skipped_binary.append(rel)
            continue
        target = os.path.join(out_dir, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8", newline="") as f:
            f.write(txt or "")
        written += 1
    manifest = {"lane": lane, "asOf": as_of, "filesWritten": written,
                "skippedBinary": skipped_binary}
    json.dump(manifest, open(os.path.join(out_dir, "_rehydrate-manifest.json"), "w", encoding="utf-8"), indent=1)
    print(f"[rehydrate] {lane} lane as of {as_of}: {written} text files -> {out_dir}")
    if skipped_binary:
        print(f"[rehydrate] {len(skipped_binary)} binary assets skipped (pull from theme archive): "
              f"{', '.join(skipped_binary[:6])}{'...' if len(skipped_binary) > 6 else ''}")
    cn.close()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    t = sub.add_parser("timeline"); t.add_argument("--out")
    r = sub.add_parser("rehydrate")
    r.add_argument("--lane", choices=("theme", "overlay"), required=True)
    r.add_argument("--as-of", required=True)
    r.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.mode == "timeline":
        mode_timeline(a.out)
    else:
        mode_rehydrate(a.lane, a.as_of, a.out)


if __name__ == "__main__":
    main()
