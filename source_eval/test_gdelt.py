"""Evaluate GDELT DOC 2.0 API for a topic query. No API key required."""
import json
import requests

QUERY = "renewable energy"
URL = "https://api.gdeltproject.org/api/v2/doc/doc"

params = {
    "query": QUERY,
    "mode": "artlist",
    "maxrecords": 10,
    "format": "json",
    "sort": "hybridrel",
}

resp = requests.get(URL, params=params, timeout=20)
print(f"Status: {resp.status_code}")
print(f"URL: {resp.url}")

try:
    data = resp.json()
except json.JSONDecodeError:
    print("Non-JSON response (first 500 chars):")
    print(resp.text[:500])
    raise SystemExit

articles = data.get("articles", [])
print(f"Articles returned: {len(articles)}\n")

for a in articles[:10]:
    print(f"- title: {a.get('title')}")
    print(f"  domain: {a.get('domain')}")
    print(f"  seendate: {a.get('seendate')}")
    print(f"  tone: {a.get('tone')}")
    print(f"  url: {a.get('url')}")
    print()
