import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
BASE = "https://api.benzinga.com/api/v2/news"

def call(label, extra, headers=None):
    params = {"token": key, "pagesize": 5, "displayOutput": "full"}
    params.update(extra)
    r = requests.get(BASE, params=params, headers=headers or {}, timeout=20)
    print(f"\n--- {label} --- status={r.status_code} content-type={r.headers.get('content-type')}")
    print(r.text[:400])

call("Accept: application/json header", {}, headers={"Accept": "application/json"})
call("channels=Energy", {"channels": "Energy"}, headers={"Accept": "application/json"})
