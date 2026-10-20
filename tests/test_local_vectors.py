"""Offline persistence, collection isolation, and cosine-ranking regression tests."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tested_vectors", ROOT / "hts_classifier/services/local_vectors.py")
vectors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vectors)


class VectorStoreTests(unittest.TestCase):
    def test_cosine_ranking_and_metadata_survive_reopening(self):
        with tempfile.TemporaryDirectory() as folder:
            client = vectors.PersistentClient(folder)
            collection = client.get_or_create_collection("example")
            collection.upsert(ids=["a", "b", "c"], embeddings=[[4, 0], [0, 2], [-1, 0]],
                              documents=["first", "second", "third"], metadatas=[{"n": 1}, {"n": 2}, {"n": 3}])
            reopened = vectors.PersistentClient(folder).get_collection("example")
            result = reopened.query(query_embeddings=[[1, 0]], n_results=10)
            self.assertEqual([["a", "b", "c"]], result["ids"])
            np.testing.assert_allclose(result["distances"], [[0, 1, 2]])
            self.assertEqual("first", result["documents"][0][0])
            self.assertEqual({"n": 1}, result["metadatas"][0][0])

    def test_upsert_updates_ids_and_isolates_collections(self):
        with tempfile.TemporaryDirectory() as folder:
            client = vectors.PersistentClient(folder)
            a = client.get_or_create_collection("a")
            b = client.get_or_create_collection("b' OR 1=1 --")
            a.upsert(ids="id", embeddings=[1, 0], documents="old", metadatas={})
            a.upsert(ids="id", embeddings=[0, 1], documents="new", metadatas={"revision": 2})
            self.assertEqual(1, a.count())
            self.assertEqual(0, b.count())
            self.assertEqual({"ids": ["id"]}, a.get(include=[]))
            self.assertEqual(["new"], a.get()["documents"])

    def test_empty_queries_and_embedding_function(self):
        with tempfile.TemporaryDirectory() as folder:
            client = vectors.PersistentClient(folder)
            collection = client.get_or_create_collection("empty", embedding_function=lambda texts: [[1, 0] for _ in texts])
            self.assertEqual([[]], collection.query(query_texts="question")["ids"])
            collection.add(ids="a", embeddings=[1, 0], documents="answer", metadatas={})
            self.assertEqual([["a"]], collection.query(query_texts="question", n_results=1)["ids"])
            self.assertEqual([[]], collection.query(query_embeddings=[[1, 0]], n_results=0)["ids"])

    def test_invalid_vectors_fail_without_corrupting_the_index(self):
        with tempfile.TemporaryDirectory() as folder:
            collection = vectors.PersistentClient(folder).create_collection("test")
            for embedding in ([float("nan"), 0], [], [[1, 0]]):
                with self.assertRaises(ValueError):
                    collection.upsert(ids="a", embeddings=embedding, documents="value", metadatas={})
            collection.upsert(ids="a", embeddings=[1, 0], documents="value", metadatas={})
            with self.assertRaises(ValueError):
                collection.upsert(ids="b", embeddings=[1, 0, 0], documents="value", metadatas={})
            with self.assertRaises(ValueError):
                collection.query(query_embeddings=[[1, 0, 0]])
            self.assertEqual(1, collection.count())


    def test_legacy_migration_is_complete_and_read_only(self):
        import hashlib
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "chroma.sqlite3"
            destination = Path(folder) / "new"
            with sqlite3.connect(source) as db:
                db.executescript("""
                    CREATE TABLE collections(id TEXT, name TEXT, topic TEXT);
                    CREATE TABLE segments(id TEXT, collection TEXT);
                    CREATE TABLE embeddings(id INTEGER, embedding_id TEXT, segment_id TEXT);
                    CREATE TABLE embeddings_queue(seq_id INTEGER, topic TEXT, id TEXT, vector BLOB, encoding TEXT);
                    CREATE TABLE embedding_metadata(id INTEGER, key TEXT, string_value TEXT, int_value INTEGER, float_value REAL, bool_value INTEGER);
                    INSERT INTO collections VALUES ('c','example','topic');
                    INSERT INTO segments VALUES ('s','c');
                    INSERT INTO embeddings VALUES (1,'a','s');
                    INSERT INTO embedding_metadata VALUES (1,'chroma:document','original text',NULL,NULL,NULL);
                    INSERT INTO embedding_metadata VALUES (1,'flag',NULL,NULL,NULL,1);
                """)
                db.execute("INSERT INTO embeddings_queue VALUES (1,'topic','a',?,'FLOAT32')", (np.array([1,0],dtype='<f4').tobytes(),))
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(1, vectors.migrate_legacy_collection(source, destination, 'example'))
            self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())
            collection = vectors.PersistentClient(destination).get_collection('example')
            self.assertEqual(['original text'], collection.get()['documents'])
            self.assertEqual([{'flag': True}], collection.get()['metadatas'])
            self.assertEqual([['a']], collection.query(query_embeddings=[[1,0]])['ids'])
            with sqlite3.connect(source) as db:
                db.execute('DELETE FROM embeddings_queue')
            with self.assertRaisesRegex(ValueError, 'Cannot recover'):
                vectors.migrate_legacy_collection(source, Path(folder)/'incomplete', 'example')
            self.assertFalse((Path(folder)/'incomplete').exists())


if __name__ == "__main__":
    unittest.main()
