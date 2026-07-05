"""Offline test for Invoke-KritScxCorpusMine.py (SCX-drafted, operator-rewritten .5231).

The miner is a monolithic script (no importable functions) that talks to SQL Server via pyodbc.
We inject a mock pyodbc into sys.modules and set argv to a temp repo, then import the module — which
runs the full mine against the mock cursor — and assert on the RECORDED INSERT parameters (the symbol
names + call-graph edges are in the ? params, not the SQL text). No network, no SQL Server.

Run:  python lens/Invoke-KritScxCorpusMine.test.py
"""
import sys
import os
import importlib.util
import tempfile
import unittest
from types import SimpleNamespace


class MockCursor:
    def __init__(self):
        self.executed = []  # (sql, params)

    def execute(self, sql, *params):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        # 1st summary SELECT -> (files, loc, funcs); 2nd -> (edge_count,); rest -> None
        self._n = getattr(self, "_n", 0) + 1
        return (0, 0, 0) if self._n == 1 else (0,) if self._n == 2 else None

    def fetchall(self):
        return []

    def close(self):
        pass


class MockConn:
    def __init__(self):
        self.cur = MockCursor()

    def cursor(self):
        return self.cur

    def commit(self):
        pass

    def close(self):
        pass


class TestCorpusMine(unittest.TestCase):
    def test_mines_symbols_and_resolves_callgraph_edge(self):
        with tempfile.TemporaryDirectory() as repo:
            with open(os.path.join(repo, "a.py"), "w", encoding="utf-8") as f:
                f.write("def foo():\n    pass\n")
            with open(os.path.join(repo, "b.py"), "w", encoding="utf-8") as f:
                f.write("def bar():\n    foo()\n")

            conn = MockConn()
            saved_argv, saved_pyodbc = sys.argv, sys.modules.get("pyodbc")
            sys.modules["pyodbc"] = SimpleNamespace(connect=lambda *a, **k: conn)
            sys.argv = ["Invoke-KritScxCorpusMine.py", repo]
            try:
                script = os.path.join(os.path.dirname(__file__), "Invoke-KritScxCorpusMine.py")
                spec = importlib.util.spec_from_file_location("corpus_mine_under_test", script)
                spec.loader.exec_module(importlib.util.module_from_spec(spec))
            finally:
                sys.argv = saved_argv
                if saved_pyodbc is not None:
                    sys.modules["pyodbc"] = saved_pyodbc
                else:
                    sys.modules.pop("pyodbc", None)

            ex = conn.cur.executed
            # Two corpus-file inserts (a.py, b.py)
            corpus = [p for sql, p in ex if "LensCorpusFile" in sql and sql.strip().upper().startswith("INSERT")]
            self.assertEqual(len(corpus), 2)

            # Two symbol inserts — names live in the ? params: (rel, name, kind, start_line)
            symbols = [p for sql, p in ex if "LensSymbol" in sql and sql.strip().upper().startswith("INSERT")]
            self.assertEqual({p[1] for p in symbols}, {"foo", "bar"})

            # Exactly one call-graph edge: b.py calls foo() (defined in a.py). params: (from, symbol, edge, target)
            edges = [p for sql, p in ex if "LensCallGraph" in sql and sql.strip().upper().startswith("INSERT")]
            self.assertEqual(len(edges), 1)
            frm, sym, edge, tgt = edges[0]
            self.assertEqual(sym, "foo")
            self.assertEqual(edge, "call")
            self.assertTrue(frm.endswith("b.py"))
            self.assertTrue(tgt.endswith("a.py"))

    def test_comment_and_string_calls_do_not_create_false_edges(self):
        # .5231 fix: a symbol name only appearing in a comment or string must NOT create an edge.
        with tempfile.TemporaryDirectory() as repo:
            with open(os.path.join(repo, "a.py"), "w", encoding="utf-8") as f:
                f.write("def foo():\n    pass\n")
            with open(os.path.join(repo, "b.py"), "w", encoding="utf-8") as f:
                f.write("def bar():\n    # foo() in a comment\n    x = 'foo() in a string'\n    pass\n")

            conn = MockConn()
            saved_argv, saved_pyodbc = sys.argv, sys.modules.get("pyodbc")
            sys.modules["pyodbc"] = SimpleNamespace(connect=lambda *a, **k: conn)
            sys.argv = ["Invoke-KritScxCorpusMine.py", repo]
            try:
                script = os.path.join(os.path.dirname(__file__), "Invoke-KritScxCorpusMine.py")
                spec = importlib.util.spec_from_file_location("corpus_mine_under_test2", script)
                spec.loader.exec_module(importlib.util.module_from_spec(spec))
            finally:
                sys.argv = saved_argv
                if saved_pyodbc is not None:
                    sys.modules["pyodbc"] = saved_pyodbc
                else:
                    sys.modules.pop("pyodbc", None)

            edges = [p for sql, p in conn.cur.executed if "LensCallGraph" in sql and sql.strip().upper().startswith("INSERT")]
            self.assertEqual(len(edges), 0, "foo() only in comment/string must not be an edge")


if __name__ == "__main__":
    unittest.main(verbosity=2)
