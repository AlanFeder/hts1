import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "offline-test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hts_classifier.services.vector_store import VectorStore

class IntegrationTests(unittest.TestCase):
    def test_hts_result_shape_and_score_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            store = VectorStore(path=folder)
            entry = SimpleNamespace(hts_code="test", description="Example", path=["Parent", "Example"],
                                    path_string="Parent | Example", indent=1, general_rate="Free")
            store.upsert([entry], [[2.0, 0.0]])
            self.assertEqual(["test"], store.get_all_ids())
            result = store.query([1.0, 0.0], top_k=5)
            self.assertEqual(1, store.count)
            self.assertEqual("test", result[0]["hts_code"])
            self.assertEqual(["Parent", "Example"], result[0]["path"])
            self.assertAlmostEqual(1.0, result[0]["score"])
