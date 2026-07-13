import os, json
import requests
from dotenv import load_dotenv
load_dotenv()

key = os.environ.get("BENZINGA_API_KEY")
def mask(v):
    return f"{v[:4]}...{v[-4:]} (len={len(v)})" if v else None
print("BENZINGA_API_KEY loaded:", mask(key))

BASE = "https://api.benzinga.com/api/v2/news"

# 1) baseline call, no filters, to confirm key validity + inspect schema
r = requests.get(BASE, params={"token": key, "pagesize": 3, "displayOutput": "full"}, timeout=20)
print(f"\n--- baseline call --- status={r.status_code}")
print(r.text[:1500])
