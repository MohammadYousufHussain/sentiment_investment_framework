#!/usr/bin/env python3
"""Inspect what's in the news database.

Usage:
    python3 scripts/view_articles.py summary
    python3 scripts/view_articles.py list [--query "renewable energy"] [--source newsapi] [--limit 20]
    python3 scripts/view_articles.py show <article_id>
    python3 scripts/view_articles.py runs [--limit 20]
"""
import argparse
import json
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.database import Database


def cmd_summary(conn):
    total = conn.execute("SELECT COUNT(*) c FROM articles").fetchone()["c"]
    print(f"Total articles: {total}\n")

    print("By source:")
    for row in conn.execute("SELECT source, COUNT(*) c FROM articles GROUP BY source ORDER BY c DESC"):
        print(f"  {row['source']:20s} {row['c']}")

    print("\nBy query:")
    for row in conn.execute("SELECT query_context, COUNT(*) c FROM articles GROUP BY query_context ORDER BY c DESC"):
        print(f"  {row['query_context']:30s} {row['c']}")

    print("\nMost recent ingestion runs:")
    for row in conn.execute("SELECT source, stage, query, status, articles_fetched, articles_new, started_at "
                             "FROM ingestion_runs ORDER BY id DESC LIMIT 8"):
        print(f"  {row['started_at']}  {row['source']:16s} q={row['query']!r:25s} "
              f"status={row['status']:8s} fetched={row['articles_fetched']:>3} new={row['articles_new']:>3}")


def cmd_list(conn, query=None, source=None, limit=20):
    sql = "SELECT id, source, query_context, title, author, published_at, provider_sentiment_label FROM articles WHERE 1=1"
    params = []
    if query:
        sql += " AND query_context = ?"
        params.append(query)
    if source:
        sql += " AND source = ?"
        params.append(source)
    sql += " ORDER BY published_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    for row in rows:
        sentiment = f" [{row['provider_sentiment_label']}]" if row["provider_sentiment_label"] else ""
        print(f"#{row['id']:<5} {row['published_at'] or '':25s} {row['source']:16s}{sentiment}")
        print(f"       {row['title']}")
        print(f"       source_author: {row['author']}")
        print()
    print(f"({len(rows)} shown)")


def cmd_show(conn, article_id):
    row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not row:
        print(f"No article with id {article_id}")
        return
    d = dict(row)
    raw = d.pop("raw_payload", None)
    for k, v in d.items():
        print(f"{k}: {v}")
    if raw:
        print("\nraw_payload:")
        try:
            print(textwrap.indent(json.dumps(json.loads(raw), indent=2), "  "))
        except (json.JSONDecodeError, TypeError):
            print(textwrap.indent(str(raw), "  "))


def cmd_runs(conn, limit=20):
    rows = conn.execute("SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    for row in rows:
        print(f"#{row['id']:<5} {row['started_at']}  {row['source']:16s} stage={row['stage']} "
              f"q={row['query']!r:25s} status={row['status']:8s} "
              f"fetched={row['articles_fetched']} new={row['articles_new']}"
              + (f"  ERROR: {row['error_message']}" if row["error_message"] else ""))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("summary")

    p_list = sub.add_parser("list")
    p_list.add_argument("--query", default=None)
    p_list.add_argument("--source", default=None)
    p_list.add_argument("--limit", type=int, default=20)

    p_show = sub.add_parser("show")
    p_show.add_argument("article_id", type=int)

    p_runs = sub.add_parser("runs")
    p_runs.add_argument("--limit", type=int, default=20)

    args = parser.parse_args()
    db = Database()
    with db.connect() as conn:
        if args.command == "summary":
            cmd_summary(conn)
        elif args.command == "list":
            cmd_list(conn, query=args.query, source=args.source, limit=args.limit)
        elif args.command == "show":
            cmd_show(conn, args.article_id)
        elif args.command == "runs":
            cmd_runs(conn, limit=args.limit)
