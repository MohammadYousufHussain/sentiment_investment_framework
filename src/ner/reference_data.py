from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz, process

DEFAULT_PATH = Path(__file__).parent.parent.parent / "config" / "sec_company_tickers.json"

_SUFFIX_RE = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|llc|holdings?|group|the)\b\.?",
    re.IGNORECASE,
)
_PUNCT_RE = re.compile(r"[^\w\s]")


def normalize_company_name(name: str) -> str:
    """Strip corporate suffixes/punctuation so 'Apple Inc.' and a NER span of
    'Apple' resolve against comparable text -- and so news references written
    without the formal suffix don't get penalized for it."""
    name = _PUNCT_RE.sub(" ", name)
    name = _SUFFIX_RE.sub(" ", name)
    return " ".join(name.lower().split())


@dataclass
class CompanyEntry:
    ticker: str
    company_name: str  # original, canonical title from SEC EDGAR
    normalized_name: str


class CompanyReference:
    """Fuzzy-matchable index over the SEC EDGAR company/ticker list."""

    def __init__(self, path: Path = DEFAULT_PATH):
        raw = json.loads(Path(path).read_text())

        # SEC EDGAR lists the same company multiple times when it has more than
        # one listed security (e.g. Duke Energy: DUK common, DUKB and DUK-PA
        # preferred). Keeping all of them as separate fuzzy-match choices makes
        # a *correct, unambiguous* match look ambiguous (ties with itself) and
        # risks resolving to a preferred/debt ticker instead of the common
        # stock. Dedupe by normalized name, keeping one canonical entry per
        # company -- the ticker without a hyphen/suffix, shortest as tiebreak.
        by_name: dict[str, list[CompanyEntry]] = {}
        for row in raw.values():
            title = row["title"]
            normalized = normalize_company_name(title)
            if not normalized:
                continue
            entry = CompanyEntry(ticker=row["ticker"], company_name=title, normalized_name=normalized)
            by_name.setdefault(normalized, []).append(entry)

        def canonical(entries: list[CompanyEntry]) -> CompanyEntry:
            return min(entries, key=lambda e: ("-" in e.ticker, len(e.ticker)))

        self.entries: list[CompanyEntry] = [canonical(group) for group in by_name.values()]
        self._choices = [e.normalized_name for e in self.entries]

    def resolve(self, span_text: str, score_floor: float = 85.0, confirm_floor: float = 60.0):
        """Fuzzy-match a NER span against the reference list. Returns
        (best_entry, best_score_0_1, margin_0_1) or None if below score_floor.
        margin reflects how much better the top match is than the runner-up --
        used to discount ambiguous resolutions.

        WRatio alone is unsafe here: its partial-ratio component gives short
        spans like "NATO" a 90 against "Stevanato Group" purely because it's a
        substring, not a real match. token_sort_ratio -- a strict full-string
        comparison -- stays low (~35) for those coincidences and high for
        genuine matches, since corporate-suffix differences are already
        eliminated by normalize_company_name on both sides. Requiring it to
        also clear confirm_floor filters out that failure mode without
        rejecting legitimate matches.
        """
        query = normalize_company_name(span_text)
        if not query:
            return None

        matches = process.extract(query, self._choices, scorer=fuzz.WRatio, limit=2)
        if not matches:
            return None

        top_choice, top_score, top_idx = matches[0]
        if top_score < score_floor:
            return None
        if fuzz.token_sort_ratio(query, top_choice) < confirm_floor:
            return None

        second_score = matches[1][1] if len(matches) > 1 else 0.0
        margin = (top_score - second_score) / top_score if top_score > 0 else 0.0

        return self.entries[top_idx], top_score / 100.0, margin

    def search(self, query: str, limit: int = 8) -> list[CompanyEntry]:
        """Live-search over ticker + company name for an "add a company" UI --
        unlike resolve(), this returns several ranked candidates for a human to
        pick from rather than a single automated decision, so there's no score
        floor: a two-character query is expected to return loose matches."""
        query = query.strip()
        if not query:
            return []

        query_upper = query.upper()
        ticker_matches = [e for e in self.entries if e.ticker.upper().startswith(query_upper)]

        # A prefix match on the company name itself (e.g. "appl" -> "apple")
        # ranks ahead of fuzzy matches -- WRatio's partial-ratio component
        # otherwise buries "Apple Inc." below unrelated "Applied ..." /
        # "...pineapple..." companies, since it rewards any substring hit on a
        # longer string over a short, exact prefix hit (see resolve()'s
        # docstring for the same failure mode).
        normalized_query = normalize_company_name(query)
        prefix_matches = [e for e in self.entries if e.normalized_name.startswith(normalized_query)] if normalized_query else []

        fuzzy_matches = []
        if normalized_query:
            fuzzy = process.extract(normalized_query, self._choices, scorer=fuzz.WRatio, limit=limit * 2)
            fuzzy_matches = [self.entries[idx] for _, score, idx in fuzzy if score >= 60]

        seen = set()
        results = []
        for entry in ticker_matches + prefix_matches + fuzzy_matches:
            if entry.ticker in seen:
                continue
            seen.add(entry.ticker)
            results.append(entry)
            if len(results) >= limit:
                break
        return results
