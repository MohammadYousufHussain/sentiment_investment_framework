from __future__ import annotations

import spacy

from .reference_data import CompanyReference, normalize_company_name

MODEL_NAME = "en_core_web_trf"

# Single-token spans matching these (or otherwise very short) are penalized --
# empirically, plain length was a bad proxy: "Energy"/"Bank" and "Tesla"/"Apple"
# are both short single words, but only the former are generic-enough to
# produce false-positive-prone fuzzy matches (see architecture doc §4a).
GENERIC_TERMS = {
    "bank", "energy", "group", "holdings", "holding", "capital", "partners",
    "industries", "systems", "technologies", "technology", "solutions",
    "services", "company", "companies", "ventures", "labs", "media",
    "digital", "global", "international", "national", "financial",
    "resources", "power", "health", "pharma",
}

MARGIN_FULL_CONFIDENCE_THRESHOLD = 0.15  # margin at/above this -> no discount
MARGIN_DISCOUNT_FLOOR = 0.5


def margin_discount(margin: float) -> float:
    return MARGIN_DISCOUNT_FLOOR + (1 - MARGIN_DISCOUNT_FLOOR) * min(margin / MARGIN_FULL_CONFIDENCE_THRESHOLD, 1.0)


def genericness_penalty(span_text: str) -> float:
    # Length alone is a bad proxy here -- "RTX", "GE", "3M" are short but
    # legitimate; the token_sort_ratio confirmation gate in reference_data
    # already screens out the spurious-substring failure mode that a length
    # cutoff was trying to catch. Penalize only actual generic business words.
    tokens = normalize_company_name(span_text).split()
    if len(tokens) == 1 and tokens[0] in GENERIC_TERMS:
        return 0.6
    return 1.0


class SpacyFuzzyExtractor:
    def __init__(self, reference: CompanyReference = None):
        self.nlp = spacy.load(MODEL_NAME)
        self.reference = reference or CompanyReference()

    def extract(self, text: str) -> list[dict]:
        """Returns a list of {ticker, company_name, confidence, evidence_text}
        for one article's text. Multiple spans resolving to the same ticker
        are collapsed, keeping the highest-confidence occurrence."""
        doc = self.nlp(text)
        best_by_ticker: dict[str, dict] = {}

        for ent in doc.ents:
            if ent.label_ != "ORG":
                continue
            match = self.reference.resolve(ent.text)
            if match is None:
                continue
            entry, fuzzy_score, margin = match

            confidence = fuzzy_score * margin_discount(margin) * genericness_penalty(ent.text)

            existing = best_by_ticker.get(entry.ticker)
            if existing is None or confidence > existing["confidence"]:
                best_by_ticker[entry.ticker] = {
                    "ticker": entry.ticker,
                    "company_name": entry.company_name,
                    "confidence": round(confidence, 4),
                    "evidence_text": ent.text,
                }

        return list(best_by_ticker.values())
