import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
BASE = "https://api.benzinga.com/api/v2/news"
HEADERS = {"Accept": "application/json"}

r = requests.get(BASE, params={"token": key, "pagesize": 5, "tickers": "AAPL"}, headers=HEADERS, timeout=20)
print("status:", r.status_code)
print("headers:", dict(r.headers))
print("body sample:", r.text[:500])
