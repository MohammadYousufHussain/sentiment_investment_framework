#!/usr/bin/env python3
"""Backfill full_text for articles already in the DB that don't have it yet.
Pure scraping over stored URLs -- doesn't re-call any news provider API.

Usage:
    python3 scripts/backfill_full_text.py [--batch-size 30]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.database import Database
from src.ingestion.full_text import extract_full_text_batch

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=30)
    args = parser.parse_args()

    db = Database()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, source, url FROM articles WHERE full_text IS NULL"
        ).fetchall()
        print(f"{len(rows)} articles missing full_text")

        for start in range(0, len(rows), args.batch_size):
            batch_rows = rows[start:start + args.batch_size]
            batch = [(r["id"], r["source"], r["url"]) for r in batch_rows]
            scraped = extract_full_text_batch(batch)
            success = 0
            for article_id, (full_text, status) in scraped.items():
                db.set_full_text(conn, article_id, full_text, status)
                success += int(status == "success")
            conn.commit()
            print(f"  batch {start}-{start + len(batch_rows)}: {success}/{len(batch_rows)} succeeded")

    print("Done.")
