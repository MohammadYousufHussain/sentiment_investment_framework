"""GDELT DOC 2.0 API, take 2: filter to English/US sources, and separately
pull the aggregate tone timeline (GDELT's built-in sentiment proxy)."""
import time
import requests

QUERY = 'renewable energy sourcelang:english sourcecountry:US'
URL = "https://api.gdeltproject.org/api/v2/doc/doc"


def get_with_retry(params, tries=5, wait=20):
    for i in range(tries):
        resp = requests.get(URL, params=params, timeout=30)
        if resp.status_code == 200:
            return resp
        print(f"  (status {resp.status_code}, retrying in {wait}s...)")
        time.sleep(wait)
    return resp


print("--- artlist (filtered to US/English sources) ---")
params = {
    "query": QUERY,
    "mode": "artlist",
    "maxrecords": 10,
    "format": "json",
    "sort": "hybridrel",
}
resp = get_with_retry(params)
print(f"Status: {resp.status_code}")
data = resp.json()
articles = data.get("articles", [])
print(f"Articles returned: {len(articles)}\n")
for a in articles[:10]:
    print(f"- title: {a.get('title')}")
    print(f"  domain: {a.get('domain')}  lang: {a.get('language')}  country: {a.get('sourcecountry')}")
    print(f"  seendate: {a.get('seendate')}")
    print()

time.sleep(20)

print("--- timelinetone (aggregate daily tone for this query) ---")
params2 = {
    "query": QUERY,
    "mode": "timelinetone",
    "format": "json",
}
resp2 = get_with_retry(params2)
print(f"Status: {resp2.status_code}")
data2 = resp2.json()
timeline = data2.get("timeline", [])
if timeline:
    series = timeline[0].get("data", [])
    print(f"Points in series: {len(series)}")
    for p in series[-10:]:
        print(f"  {p.get('date')}: tone={p.get('value')}")
else:
    print(data2)
