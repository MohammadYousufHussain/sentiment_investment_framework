import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
BASE = "https://api.benzinga.com/api/v2/news"
HEADERS = {"Accept": "application/json"}

def call(label, extra):
    params = {"token": key, "pagesize": 10}
    params.update(extra)
    r = requests.get(BASE, params=params, headers=HEADERS, timeout=20)
    try:
        data = r.json()
        print(f"\n--- {label} --- status={r.status_code} items={len(data)}")
        for a in data[:10]:
            stocks = [s.get('name') for s in a.get('stocks', [])]
            print(f"  id={a.get('id')} stocks={stocks} title={a.get('title')[:60]!r}")
    except Exception as e:
        print(f"--- {label} --- status={r.status_code} error={e} raw={r.text[:300]}")

call("tickers=AAPL", {"tickers": "AAPL"})
call("tickers=MSFT", {"tickers": "MSFT"})
call("tickers=AAPL with date range", {"tickers": "AAPL", "dateFrom": "2026-07-01", "dateTo": "2026-07-11"})
