#!/usr/bin/env python3
"""Run Stage A news ingestion for a user-supplied keyword/topic.

Usage:
    python3 scripts/run_stage_a.py "renewable energy"
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ingestion.pipeline import run_stage_a

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Keyword or topic to search for, e.g. 'renewable energy'")
    parser.add_argument("--max-results", type=int, default=20)
    args = parser.parse_args()

    summary = run_stage_a(args.query, max_results=args.max_results)

    print(f"\nStage A results for query: {args.query!r}")
    total_new = 0
    for source, result in summary.items():
        total_new += result.get("new", 0)
        if result["status"] == "success":
            print(f"  {source:20s} fetched={result['fetched']:4d}  new={result['new']:4d}")
        else:
            print(f"  {source:20s} ERROR: {result['error']}")
    print(f"\nTotal new articles stored: {total_new}")
