import calendar
import time
from datetime import datetime, timezone
from typing import Optional


def struct_time_to_iso(struct: Optional[time.struct_time]) -> Optional[str]:
    """Convert a feedparser *_parsed struct_time (already UTC) to ISO 8601 UTC."""
    if struct is None:
        return None
    return datetime.fromtimestamp(calendar.timegm(struct), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
