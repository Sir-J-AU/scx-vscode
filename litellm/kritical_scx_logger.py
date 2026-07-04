"""
Kritical SCX — LiteLLM custom callback: HR27 write-through to KriticalSCXCodeStore.
Every routed exchange (human prompt + AI response) is persisted, SHA-deduped, GZIP-compressed
(via SQL COMPRESS), with token/model/provider telemetry. Fully fail-open: any logging error is
swallowed so the proxy NEVER breaks a request (HR29).
"""
import hashlib
import json
import os

try:
    import pyodbc
except Exception:  # pragma: no cover
    pyodbc = None

from litellm.integrations.custom_logger import CustomLogger

_DBG = r"C:\KriticalSCX\callback-debug.log"
def _dbg(msg):
    try:
        with open(_DBG, "a", encoding="utf-8") as f:
            f.write(str(msg) + "\n")
    except Exception:
        pass

_CONN = os.environ.get(
    "KRIT_SCXCODE_STORE_CONN",
    "DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\SQLEXPRESS;"
    "DATABASE=KriticalSCXCodeStore;Trusted_Connection=yes;Encrypt=no;",
)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest().upper()


def _simhash(text: str) -> int:
    # cheap 64-bit simhash over whitespace tokens (near-dup signal; not crypto)
    v = [0] * 64
    for tok in text.split():
        h = int(hashlib.md5(tok.encode("utf-8", "replace")).hexdigest()[:16], 16)
        for i in range(64):
            v[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(64):
        if v[i] > 0:
            out |= (1 << i)
    return out - (1 << 64) if out >= (1 << 63) else out  # to signed BIGINT range


def _write(rows):
    if not pyodbc:
        return
    cn = pyodbc.connect(_CONN, timeout=5)
    try:
        cur = cn.cursor()
        for r in rows:
            sha = _sha(r["content"])
            cur.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.decision_log WHERE content_sha256=?) "
                "INSERT dbo.decision_log(side,category,session_id,content_sha256,simhash,"
                "content_len,content_gz,preview_120,model,provider,source,meta) "
                "VALUES (?,?,?,?,?,?,COMPRESS(?),?,?,?,?,?)",
                sha, r["side"], r["category"], r.get("session_id"), sha, _simhash(r["content"]),
                len(r["content"]), r["content"], r["content"][:120], r.get("model"),
                r.get("provider"), "litellm-callback", json.dumps(r.get("meta") or {}, default=str),
            )
        cn.commit()
    finally:
        cn.close()


class KriticalLogger(CustomLogger):
    def _capture(self, kwargs, response_obj):
        try:
            model = kwargs.get("model")
            provider = (kwargs.get("litellm_params") or {}).get("custom_llm_provider")
            messages = kwargs.get("messages") or []
            rows = []
            # last human turn
            for m in reversed(messages):
                if m.get("role") == "user":
                    c = m.get("content")
                    if isinstance(c, list):
                        c = " ".join(str(p.get("text", "")) for p in c if isinstance(p, dict))
                    rows.append({"side": "human", "category": "prompt", "content": str(c),
                                 "model": model, "provider": provider})
                    break
            # AI response
            try:
                content = response_obj["choices"][0]["message"]["content"]
            except Exception:
                content = None
            if content:
                usage = None
                try:
                    usage = dict(response_obj.get("usage") or {})
                except Exception:
                    pass
                rows.append({"side": "ai", "category": "response", "content": str(content),
                             "model": getattr(response_obj, "model", model), "provider": provider,
                             "meta": {"usage": usage}})
            if rows:
                _write(rows)
        except Exception as e:
            _dbg("capture error: %r" % e)  # fail-open: never break the proxy; errors logged only

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._capture(kwargs, response_obj)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._capture(kwargs, response_obj)


kritical_logger = KriticalLogger()
