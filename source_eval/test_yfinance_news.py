import yfinance as yf
import json

print("=== Ticker-specific news: AAPL ===")
t = yf.Ticker("AAPL")
news = t.news
print(f"Articles returned: {len(news)}\n")
for a in news[:5]:
    content = a.get("content", a)  # newer yfinance nests under 'content'
    print(json.dumps(a, indent=2)[:800])
    print("---")
