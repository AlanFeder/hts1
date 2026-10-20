"""Local cosine retrieval using SQLite and NumPy; no remote code or vector server."""
import json
from pathlib import Path
import sqlite3

import numpy as np


class PersistentClient:
    def __init__(self, path):
        folder = Path(path)
        folder.mkdir(parents=True, exist_ok=True)
        self.path = str(folder / "vectors.sqlite3")
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY)")
            db.execute("""CREATE TABLE IF NOT EXISTS vectors (
                collection TEXT NOT NULL, id TEXT NOT NULL, embedding BLOB NOT NULL,
                dimensions INTEGER NOT NULL, metadata TEXT NOT NULL, document TEXT NOT NULL,
                PRIMARY KEY (collection, id))""")

    def get_or_create_collection(self, name, metadata=None, embedding_function=None):
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR IGNORE INTO collections VALUES (?)", (name,))
        return Collection(self.path, name, embedding_function)

    def create_collection(self, name, metadata=None, embedding_function=None):
        return self.get_or_create_collection(name, metadata, embedding_function)

    def get_collection(self, name, embedding_function=None):
        with sqlite3.connect(self.path) as db:
            found = db.execute("SELECT 1 FROM collections WHERE name = ?", (name,)).fetchone()
        if not found:
            raise ValueError(f"Collection {name!r} is missing. Run the ingestion script to build the local index.")
        return Collection(self.path, name, embedding_function)


class Collection:
    def __init__(self, path, name, embedding_function=None):
        self.path, self.name, self.embedding_function = path, name, embedding_function

    def count(self):
        with sqlite3.connect(self.path) as db:
            return db.execute("SELECT COUNT(*) FROM vectors WHERE collection = ?", (self.name,)).fetchone()[0]

    def _rows(self):
        with sqlite3.connect(self.path) as db:
            return db.execute(
                "SELECT id, embedding, dimensions, metadata, document FROM vectors WHERE collection = ? ORDER BY id",
                (self.name,),
            ).fetchall()

    def get(self, include=None):
        rows = self._rows()
        result = {"ids": [r[0] for r in rows]}
        for key in (include if include is not None else ["metadatas", "documents"]):
            if key == "metadatas":
                result[key] = [json.loads(r[3]) for r in rows]
            elif key == "documents":
                result[key] = [r[4] for r in rows]
            elif key == "embeddings":
                result[key] = [np.frombuffer(r[1], dtype="<f4").tolist() for r in rows]
        return result

    def upsert(self, ids, embeddings, documents, metadatas):
        if isinstance(ids, str):
            ids, embeddings, documents, metadatas = [ids], [embeddings], [documents], [metadatas]
        if not (len(ids) == len(embeddings) == len(documents) == len(metadatas)):
            raise ValueError("Each document needs one id, embedding, and metadata record")
        records = []
        dimensions = set()
        for identifier, embedding, document, metadata in zip(ids, embeddings, documents, metadatas):
            vector = np.asarray(embedding, dtype="<f4")
            if vector.ndim != 1 or not vector.size or not np.isfinite(vector).all():
                raise ValueError("Embeddings must be nonempty finite one-dimensional vectors")
            dimensions.add(vector.size)
            records.append((self.name, str(identifier), vector.tobytes(), vector.size, json.dumps(metadata), document))
        with sqlite3.connect(self.path) as db:
            existing = db.execute("SELECT dimensions FROM vectors WHERE collection = ? LIMIT 1", (self.name,)).fetchone()
            if existing:
                dimensions.add(existing[0])
            if len(dimensions) > 1:
                raise ValueError("All embeddings in a collection must have the same dimensions")
            db.executemany("INSERT OR REPLACE INTO vectors VALUES (?, ?, ?, ?, ?, ?)", records)

    add = upsert

    def query(self, query_embeddings=None, query_texts=None, n_results=5, include=None):
        if n_results < 0:
            raise ValueError("n_results cannot be negative")
        if query_embeddings is None:
            if self.embedding_function is None or query_texts is None:
                raise ValueError("Provide embeddings or an embedding function and query text")
            query_embeddings = self.embedding_function([query_texts] if isinstance(query_texts, str) else query_texts)
        queries = np.atleast_2d(np.asarray(query_embeddings, dtype=np.float32))
        if not np.isfinite(queries).all():
            raise ValueError("Query embeddings must be finite")
        keys = ["ids"] + (list(include) if include is not None else ["metadatas", "documents", "distances"])
        result = {key: [] for key in keys}
        rows = self._rows()
        if not rows:
            return {key: [[] for _ in queries] for key in keys}
        matrix = np.stack([np.frombuffer(r[1], dtype="<f4") for r in rows])
        if queries.shape[1] != matrix.shape[1]:
            raise ValueError("Query dimensions do not match the stored embeddings")
        matrix = matrix / np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
        for query in queries:
            similarities = matrix @ (query / max(float(np.linalg.norm(query)), 1e-12))
            indices = np.argsort(-similarities, kind="stable")[:n_results]
            for key in keys:
                if key == "ids":
                    value = [rows[i][0] for i in indices]
                elif key == "metadatas":
                    value = [json.loads(rows[i][3]) for i in indices]
                elif key == "documents":
                    value = [rows[i][4] for i in indices]
                elif key == "distances":
                    value = [float(1.0 - similarities[i]) for i in indices]
                else:
                    raise ValueError(f"Unsupported query field: {key}")
                result[key].append(value)
        return result


class SentenceTransformerEmbeddingFunction:
    def __init__(self, model_name, normalize_embeddings=True):
        self.model_name, self.normalize_embeddings = model_name, normalize_embeddings
        self._model = None

    def __call__(self, texts):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name, trust_remote_code=False)
        return self._model.encode(texts, normalize_embeddings=self.normalize_embeddings)


def migrate_legacy_collection(source, destination, collection_name):
    """Read a legacy SQLite index without importing or executing ChromaDB.

    Queue vectors are copied only when every live record can be recovered.
    Compacted indexes with missing queue vectors require export/re-ingestion.
    The source database is opened read-only and is never modified.
    """
    source_file = Path(source)
    if source_file.is_dir():
        source_file = source_file / "chroma.sqlite3"
    with sqlite3.connect(source_file.resolve().as_uri() + "?mode=ro", uri=True) as db:
        collections = db.execute("SELECT id, topic FROM collections WHERE name = ?", (collection_name,)).fetchall()
        if len(collections) != 1:
            raise ValueError(f"Expected one legacy collection named {collection_name!r}")
        collection_id, topic = collections[0]
        records = db.execute("""SELECT e.id, e.embedding_id FROM embeddings AS e
            JOIN segments AS s ON e.segment_id = s.id WHERE s.collection = ?""", (collection_id,)).fetchall()
        queued = {}
        for identifier, blob, encoding in db.execute(
            "SELECT id, vector, encoding FROM embeddings_queue WHERE topic = ? AND vector IS NOT NULL ORDER BY seq_id", (topic,)
        ):
            if encoding != "FLOAT32":
                raise ValueError("Only legacy FLOAT32 embeddings can be migrated")
            queued[identifier] = np.frombuffer(blob, dtype="<f4").tolist()
        missing = [identifier for _, identifier in records if identifier not in queued]
        if missing:
            raise ValueError(f"Cannot recover {len(missing)} vectors from the legacy queue; export or re-ingest this collection")
        ids, embeddings, documents, metadatas = [], [], [], []
        for row_id, identifier in records:
            metadata = {}
            for key, string, integer, floating, boolean in db.execute(
                "SELECT key, string_value, int_value, float_value, bool_value FROM embedding_metadata WHERE id = ?", (row_id,)
            ):
                metadata[key] = next((v for v in [string, integer, floating, None if boolean is None else bool(boolean)] if v is not None), None)
            documents.append(metadata.pop("chroma:document", ""))
            ids.append(identifier)
            embeddings.append(queued[identifier])
            metadatas.append(metadata)
    collection = PersistentClient(destination).get_or_create_collection(collection_name)
    collection.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
    return collection.count()
