import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ["ALPHA_VANTAGE_API_KEY"]
BASE = "https://www.alphavantage.co/query"

def call(label, extra):
    params = {"function": "NEWS_SENTIMENT", "apikey": key}
    params.update(extra)
    r = requests.get(BASE, params=params, timeout=20)
    data = r.json()
    feed = data.get("feed", [])
    print(f"\n--- {label} --- status={r.status_code} items={len(feed)} top_keys={list(data.keys())}")
    for a in feed[:5]:
        tickers = [(t.get('ticker'), t.get('ticker_sentiment_label'), t.get('relevance_score')) for t in a.get('ticker_sentiment', [])]
        print(f"  {a.get('time_published')} | {a.get('title')[:60]!r}")
        print(f"    ticker_sentiment: {tickers}")

call("tickers=AAPL", {"tickers": "AAPL", "limit": 5})
call("tickers=AAPL,MSFT (multi-ticker)", {"tickers": "AAPL,MSFT", "limit": 5})
call("tickers=AAPL with time_from", {"tickers": "AAPL", "time_from": "20260701T0000", "limit": 5, "sort": "EARLIEST"})

r = requests.get(BASE, params={"function":"NEWS_SENTIMENT","tickers":"AAPL","time_from":"20260701T0000","limit":5,"sort":"EARLIEST","apikey":key}, timeout=20)
print("\nInformation message:", r.json().get("Information"))
