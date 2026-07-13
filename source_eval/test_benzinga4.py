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
    data = r.json()
    print(f"\n--- {label} --- status={r.status_code} items={len(data)}")
    for a in data:
        chans = [c.get('name') for c in a.get('channels', [])]
        print(f"  id={a.get('id')} title={a.get('title')[:60]!r} channels={chans}")

call("no filter", {})
call("channels=Energy", {"channels": "Energy"})
call("channels=Renewable Energy (bogus guess)", {"channels": "Renewable Energy"})
call("channels=ThisChannelDoesNotExist", {"channels": "ThisChannelDoesNotExist"})
