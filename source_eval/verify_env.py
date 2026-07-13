"""Confirm .env keys load correctly, without printing the raw secret values."""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

def mask(v):
    if not v:
        return None
    return f"{v[:4]}...{v[-4:]} (len={len(v)})"

newsapi_key = os.environ.get("NEWSAPI_KEY")
av_key = os.environ.get("ALPHA_VANTAGE_API_KEY")

print(f"NEWSAPI_KEY loaded: {mask(newsapi_key)}")
print(f"ALPHA_VANTAGE_API_KEY loaded: {mask(av_key)}")
print()

# Live sanity check: NewsAPI
if newsapi_key:
    r = requests.get(
        "https://newsapi.org/v2/top-headlines",
        params={"category": "business", "language": "en", "pageSize": 1, "apiKey": newsapi_key},
        timeout=15,
    )
    print(f"NewsAPI live check: HTTP {r.status_code} - {r.json().get('status')}")
else:
    print("NewsAPI live check: skipped (no key)")

# Live sanity check: Alpha Vantage
if av_key:
    r = requests.get(
        "https://www.alphavantage.co/query",
        params={"function": "GLOBAL_QUOTE", "symbol": "MSFT", "apikey": av_key},
        timeout=15,
    )
    body = r.json()
    ok = "Global Quote" in body and bool(body["Global Quote"])
    print(f"Alpha Vantage live check: HTTP {r.status_code} - {'OK' if ok else body}")
else:
    print("Alpha Vantage live check: skipped (no key)")
