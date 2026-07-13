"""Evaluate direct RSS parsing via Google News RSS (a real RSS feed, distinct from
the `gnews` package) using feedparser -- the generic pattern for consuming any
outlet's RSS feed (Reuters, Business Wire, PR Newswire, etc.)."""
import feedparser
from urllib.parse import quote

QUERY = "renewable energy"
RSS_URL = f"https://news.google.com/rss/search?q={quote(QUERY)}&hl=en-US&gl=US&ceid=US:en"

feed = feedparser.parse(RSS_URL)

print(f"Feed status: {feed.get('status')}")
print(f"Feed title: {feed.feed.get('title')}")
print(f"Entries returned: {len(feed.entries)}\n")

for e in feed.entries[:10]:
    print(f"- title: {e.get('title')}")
    print(f"  published: {e.get('published')}")
    print(f"  source: {(e.get('source') or {}).get('title')}")
    print(f"  link: {e.get('link')}")
    print()
