"""Offline unit tests for Invoke-KritScxMuxMatrix.py (SCX-drafted, operator-lensed .5231).

Pure-logic only — no SCX network calls. Run:  python mux/Invoke-KritScxMuxMatrix.test.py
Stdlib unittest (zero deps) so it runs anywhere. The module has an `if __name__ == "__main__"`
guard, so loading it by path does not fire main().
"""
import importlib.util
import os
import pathlib
import sqlite3
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).parent / "Invoke-KritScxMuxMatrix.py"
_spec = importlib.util.spec_from_file_location("invoke_mux", MODULE_PATH)
mux = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mux)


class TestModelCeilings(unittest.TestCase):
    def test_structure(self):
        required = {"real_ctx_tokens", "reserve_out", "safety_tokens", "chars_per_token"}
        self.assertTrue(mux.MODEL_CEILINGS)
        for model, spec in mux.MODEL_CEILINGS.items():
            self.assertIsInstance(model, str)
            self.assertTrue(required.issubset(spec.keys()), f"{model} missing keys")
            for k in required:
                self.assertIsInstance(spec[k], int)
                self.assertGreater(spec[k], 0)
            self.assertEqual(spec["chars_per_token"], 4)

    def test_default_model_set_has_at_least_five(self):
        self.assertGreaterEqual(len(mux.MODEL_CEILINGS), 5)
        self.assertIn("MiniMax-M2.7", mux.MODEL_CEILINGS)
        self.assertIn("json_mode", mux.MODEL_CEILINGS["MiniMax-M2.7"]["features"])


class TestContextCharBudget(unittest.TestCase):
    def test_minimax_gets_more_than_gptoss(self):
        for question in ("short question", "x" * 5000):
            mini = mux.context_char_budget("MiniMax-M2.7", question, 700)
            gpt = mux.context_char_budget("gpt-oss-120b", question, 700)
            self.assertIsInstance(mini, int)
            self.assertIsInstance(gpt, int)
            self.assertGreaterEqual(mini, gpt, "MiniMax has the larger real ceiling")

    def test_zero_when_question_exceeds_ceiling(self):
        ceil = mux.MODEL_CEILINGS["gpt-oss-120b"]["real_ctx_tokens"]
        huge = "x" * (ceil * 4 + 1000)  # question alone blows the ceiling
        self.assertEqual(mux.context_char_budget("gpt-oss-120b", huge, 700), 0)

    def test_never_negative(self):
        self.assertGreaterEqual(mux.context_char_budget("DeepSeek-V3.1", "hi", 700), 0)

    def test_default_max_out_preserves_minimax_headroom(self):
        budget = mux.context_char_budget("MiniMax-M2.7", "structured output please", 4096)
        self.assertGreater(budget, 700000)


class TestTrimToBudget(unittest.TestCase):
    def test_basic_packing_smallest_first(self):
        blocks = [("a.txt", "a" * 50), ("b.txt", "b" * 100), ("c.txt", "c" * 200)]
        text, used, included = mux.trim_to_budget(blocks, 120)
        self.assertEqual(used, 50)
        self.assertEqual(included, ["a.txt"])
        self.assertEqual(text, "a" * 50)

    def test_exact_fit_then_skip_larger(self):
        blocks = [("small.txt", "x" * 30), ("exact.txt", "y" * 70), ("too_big.txt", "z" * 100)]
        text, used, included = mux.trim_to_budget(blocks, 100)
        self.assertEqual(used, 100)
        self.assertEqual(set(included), {"small.txt", "exact.txt"})
        self.assertEqual(text, "x" * 30 + "\n" + "y" * 70)

    def test_zero_budget(self):
        text, used, included = mux.trim_to_budget([("any.txt", "content")], 0)
        self.assertEqual(text, "")
        self.assertEqual(used, 0)
        self.assertEqual(included, [])


class TestEmpiricalRouting(unittest.TestCase):
    def test_schema_and_score_routing(self):
        with tempfile.TemporaryDirectory() as td:
            db = os.path.join(td, "eval.db")
            mux.ensure_eval_schema_sqlite(db)
            con = sqlite3.connect(db)
            try:
                con.execute(
                    "INSERT INTO model_eval_results(eval_id, model_id, benchmark_name, task_type, score) "
                    "VALUES('e1', 'gpt-oss-120b', 'bench', 'structured_coding', 0.1)"
                )
                con.execute(
                    "INSERT INTO model_eval_results(eval_id, model_id, benchmark_name, task_type, score) "
                    "VALUES('e2', 'MiniMax-M2.7', 'bench', 'structured_coding', 0.9)"
                )
                con.commit()
            finally:
                con.close()
            ranked = mux.route_models_by_empirical_score(
                db, ["gpt-oss-120b", "MiniMax-M2.7", "DeepSeek-V3.1"], "structured_coding", "bench",
            )
            self.assertEqual(ranked[:2], ["MiniMax-M2.7", "gpt-oss-120b"])
            self.assertIn("DeepSeek-V3.1", ranked)

    def test_score_formula_penalises_latency_cost_and_failure(self):
        fast = mux.model_capability_score(0.8, latency_ms=100, cost_estimate=0.01, failure_rate=0.0)
        slow = mux.model_capability_score(0.8, latency_ms=10000, cost_estimate=0.01, failure_rate=0.2)
        self.assertGreater(fast, slow)


class TestTransportDecoding(unittest.TestCase):
    def test_reasoning_content_fallback(self):
        payload = {"choices": [{"message": {"reasoning_content": "usable reasoning answer"}}]}
        self.assertEqual(mux.message_text(payload), "usable reasoning answer")

    def test_sql_hex_decode(self):
        self.assertEqual(mux.decode_sql_hex_text("68656c6c6f"), "hello")


if __name__ == "__main__":
    unittest.main(verbosity=2)
