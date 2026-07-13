import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ["ALPHA_VANTAGE_API_KEY"]

# Pure topic query, no tickers param at all
r = requests.get("https://www.alphavantage.co/query", params={
    "function": "NEWS_SENTIMENT",
    "topics": "energy_transportation",
    "limit": 10,
    "apikey": key,
}, timeout=20)
print(f"Status: {r.status_code}")
data = r.json()
print("Top-level keys:", list(data.keys()))
feed = data.get("feed", [])
print(f"Articles returned: {len(feed)}\n")
for a in feed[:5]:
    print(f"- title: {a.get('title')}")
    print(f"  source: {a.get('source')}  time: {a.get('time_published')}")
    print(f"  overall_sentiment: {a.get('overall_sentiment_label')} ({a.get('overall_sentiment_score')})")
    tickers = [t.get('ticker') for t in a.get('ticker_sentiment', [])]
    print(f"  tickers tagged: {tickers}")
    print()
