import time

import requests


def get_with_retry(url: str, *, params: dict = None, headers: dict = None,
                    timeout: int = 20, tries: int = 3, backoff_seconds: float = 5.0) -> requests.Response:
    """GET with simple retry/backoff. Raises the last exception if all tries fail,
    so a single flaky source can't silently produce empty results."""
    last_exc = None
    for attempt in range(1, tries + 1):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code == 429 and attempt < tries:
                time.sleep(backoff_seconds)
                continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < tries:
                time.sleep(backoff_seconds)
    raise last_exc
