"""Evaluate the `gnews` pypi package (unofficial Google News wrapper, no key required)."""
from gnews import GNews

QUERY = "renewable energy"

google_news = GNews(language="en", country="US", period="7d", max_results=10)
news = google_news.get_news(QUERY)

print(f"Articles returned: {len(news)}\n")

for a in news[:10]:
    print(f"- title: {a.get('title')}")
    print(f"  publisher: {(a.get('publisher') or {}).get('title')}")
    print(f"  published date: {a.get('published date')}")
    print(f"  url: {a.get('url')}")
    print(f"  description: {a.get('description')}")
    print()
