"""Copy recoverable legacy SQLite vectors without importing ChromaDB."""
import argparse
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hts_classifier.services.local_vectors import migrate_legacy_collection

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    args = parser.parse_args()
    source = Path(args.source)
    database = source / "chroma.sqlite3" if source.is_dir() else source
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        names = [row[0] for row in db.execute("SELECT name FROM collections")]
    for name in names:
        count = migrate_legacy_collection(source, args.destination, name)
        print(f"Migrated {count} vectors in {name}")
