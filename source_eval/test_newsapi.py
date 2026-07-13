"""Evaluate NewsAPI.org /v2/everything endpoint. Requires a free API key
(https://newsapi.org/register) set as the NEWSAPI_KEY environment variable."""
import os
import requests

QUERY = "renewable energy"
API_KEY = os.environ.get("NEWSAPI_KEY")

if not API_KEY:
    print("NEWSAPI_KEY not set -- skipping live call.")
    print("Sign up free at https://newsapi.org/register and export NEWSAPI_KEY to run this.")
    raise SystemExit

resp = requests.get(
    "https://newsapi.org/v2/everything",
    params={"q": QUERY, "language": "en", "sortBy": "relevancy", "pageSize": 10, "apiKey": API_KEY},
    timeout=20,
)
print(f"Status: {resp.status_code}")
data = resp.json()
print(f"totalResults: {data.get('totalResults')}")

for a in data.get("articles", [])[:10]:
    print(f"- title: {a.get('title')}")
    print(f"  source: {(a.get('source') or {}).get('name')}")
    print(f"  publishedAt: {a.get('publishedAt')}")
    print(f"  url: {a.get('url')}")
    print()
