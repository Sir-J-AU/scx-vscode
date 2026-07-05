"""
Kritical Lens — VERSION x COMPONENT MINE (.5233): runs the visual-atom extractor across EVERY
file version stored in dbo.LensGitBlob in one pass -> dbo.LensVersionComponent. SQL then answers
component-lifecycle questions across the whole history at once: when did atom X appear/vanish,
which version lost a keyframe, where are the cliff events.
Baseline .5233: 640 css/theme.liquid versions -> 3212 (version,component) rows; card-zoom rule
traced across 36 versions; base.css hover-count stable at 29 (one 27-dip 2026-06-08, healed).
Usage: python Invoke-KritVersionComponentMine.py
"""
import re, pyodbc
cn = pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\SQLEXPRESS;DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;', timeout=60)
cur = cn.cursor()
KEY_RX = re.compile(r'@keyframes\s+([A-Za-z0-9_-]+)')
RULE_RX = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
def atoms(txt):
    out = set()
    for name in KEY_RX.findall(txt): out.add(('keyframes', name))
    for sel, body in RULE_RX.findall(txt):
        sel = ' '.join(sel.split())[-120:]
        if ':hover' in sel and any(p in body for p in ('transform','transition','opacity','box-shadow','background','color','scale')):
            out.add(('hover', sel))
    return out
cur.execute("SELECT id, app, commit_sha, LEFT(commit_date,10), ordinal, CAST(DECOMPRESS(content_gz) AS NVARCHAR(MAX)) FROM dbo.LensGitBlob WHERE app LIKE 'theme:%' AND (app LIKE '%.css' OR app LIKE '%theme.liquid')")
rows = cur.fetchall()
cur.execute("IF OBJECT_ID('dbo.LensVersionComponent') IS NULL CREATE TABLE dbo.LensVersionComponent(id INT IDENTITY PRIMARY KEY, blob_id INT, app NVARCHAR(80), commit_sha VARCHAR(40), commit_date VARCHAR(12), ordinal INT, kind VARCHAR(20), atom NVARCHAR(300))")
cur.execute("TRUNCATE TABLE dbo.LensVersionComponent")
ins, total = [], 0
for bid, app, sha, date, ordi, txt in rows:
    if not txt: continue
    for kind, atom in atoms(txt):
        ins.append((bid, app[:80], sha, date, ordi, kind, atom[:300])); total += 1
        if len(ins) >= 2000:
            cur.executemany("INSERT dbo.LensVersionComponent(blob_id,app,commit_sha,commit_date,ordinal,kind,atom) VALUES(?,?,?,?,?,?,?)", ins); ins = []
if ins: cur.executemany("INSERT dbo.LensVersionComponent(blob_id,app,commit_sha,commit_date,ordinal,kind,atom) VALUES(?,?,?,?,?,?,?)", ins)
cn.commit(); cn.close()
print(f"mined {len(rows)} versions -> {total} component rows in dbo.LensVersionComponent")
