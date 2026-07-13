#!/usr/bin/env python3
"""Run Stage B ticker-scoped deep ingestion for one company.

Usage:
    python3 scripts/run_stage_b.py AAPL "Apple Inc."
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ingestion.pipeline import run_stage_b

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ticker", help="Ticker symbol, e.g. AAPL")
    parser.add_argument("company_name", help="Company name for the free-text sources, e.g. 'Apple Inc.'")
    parser.add_argument("--max-results", type=int, default=20)
    args = parser.parse_args()

    summary = run_stage_b(args.ticker, args.company_name, max_results=args.max_results)

    print(f"\nStage B results for {args.ticker!r} ({args.company_name!r})")
    total_new = 0
    for source, result in summary.items():
        total_new += result.get("new", 0)
        if result["status"] == "success":
            print(f"  {source:20s} fetched={result['fetched']:4d}  new={result['new']:4d}")
        else:
            print(f"  {source:20s} ERROR: {result['error']}")
    print(f"\nTotal new articles stored: {total_new}")
