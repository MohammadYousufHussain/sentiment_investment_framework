import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
BASE = "https://api.benzinga.com/api/v2/news"

def call(label, extra):
    params = {"token": key, "pagesize": 5, "displayOutput": "full", "format": "json"}
    params.update(extra)
    r = requests.get(BASE, params=params, timeout=20)
    print(f"\n--- {label} --- status={r.status_code}")
    try:
        data = r.json()
        print(f"items: {len(data)}")
        for a in data[:5]:
            print(f"  - title: {a.get('title')}")
            print(f"    channels: {[c.get('name') for c in a.get('channels', [])]}")
            print(f"    tickers/stocks: {[s.get('name') for s in a.get('stocks', [])]}")
    except Exception as e:
        print("parse error:", e, r.text[:300])

# try channel-based topic query
call("channels=Green (guess for renewable/clean energy)", {"channels": "Green"})
