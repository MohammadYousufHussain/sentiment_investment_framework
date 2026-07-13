import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
BASE = "https://api.benzinga.com/api/v2/news"
HEADERS = {"Accept": "application/json"}

def call(label, extra):
    params = {"token": key, "pagesize": 5, "displayOutput": "full"}
    params.update(extra)
    r = requests.get(BASE, params=params, headers=HEADERS, timeout=20)
    try:
        data = r.json()
        ids = [a.get('id') for a in data] if isinstance(data, list) else data
        print(f"--- {label} --- status={r.status_code} ids={ids}")
    except Exception:
        print(f"--- {label} --- status={r.status_code} raw={r.text[:300]}")

call("channel=Energy (singular)", {"channel": "Energy"})
call("tickers=TSLA (sanity check ticker filter works at all)", {"tickers": "TSLA"})
call("search=renewable energy", {"search": "renewable energy"})
call("q=renewable energy", {"q": "renewable energy"})
