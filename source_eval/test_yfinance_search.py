import yfinance as yf
import json

print("=== yf.Search: free-text query 'renewable energy' ===")
try:
    s = yf.Search("renewable energy", news_count=10)
    print("Attributes:", [a for a in dir(s) if not a.startswith("_")])
    news = s.news
    print(f"News items: {len(news)}\n")
    for a in news[:5]:
        print(f"- title: {a.get('title')}")
        print(f"  publisher: {a.get('publisher')}")
        print(f"  providerPublishTime: {a.get('providerPublishTime')}")
        print(f"  relatedTickers: {a.get('relatedTickers')}")
        print()
except Exception as e:
    print("ERROR:", repr(e))
