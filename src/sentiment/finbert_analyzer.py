from __future__ import annotations

from .snippets import extract_ticker_snippets

MODEL_NAME = "ProsusAI/finbert"
MAX_CHARS = 2000

# Alpha Vantage's own published bucket thresholds for overall_sentiment_score
# (confirmed from their live API response during source evaluation) -- reused
# here so our categories are numerically grounded the same way theirs are,
# not just similarly named (see architecture doc §3a).
BUCKET_THRESHOLDS = [
    (0.35, "Bullish"),
    (0.15, "Somewhat-Bullish"),
    (-0.15, "Neutral"),
    (-0.35, "Somewhat-Bearish"),
]


def bucket_score(signed_score: float) -> str:
    for threshold, label in BUCKET_THRESHOLDS:
        if signed_score >= threshold:
            return label
    return "Bearish"


class FinBertAnalyzer:
    def __init__(self, pipeline_obj=None):
        if pipeline_obj is None:
            from transformers import pipeline
            pipeline_obj = pipeline("sentiment-analysis", model=MODEL_NAME, top_k=None)
        self.clf = pipeline_obj

    def analyze(self, text: str, ticker: str, company_name: str) -> dict:
        """Returns {label, score, confidence, evidence_text}. score is the
        continuous p_positive - p_negative before bucketing (§3a); confidence
        is FinBERT's own winning-class softmax probability -- a real value,
        not a heuristic, unlike NER's spaCy-based confidence."""
        snippets, matched = extract_ticker_snippets(text, ticker, company_name)
        if not snippets:
            return None

        combined = " ".join(snippets)[:MAX_CHARS]
        class_scores = self.clf(combined, truncation=True)[0]
        score_map = {c["label"]: c["score"] for c in class_scores}
        p_pos = score_map.get("positive", 0.0)
        p_neg = score_map.get("negative", 0.0)
        p_neu = score_map.get("neutral", 0.0)

        signed_score = p_pos - p_neg
        confidence = max(p_pos, p_neg, p_neu)
        if not matched:
            # Fell back to the article's opening sentences, not a genuine
            # ticker-focused excerpt -- reflect that with a lower confidence
            # rather than presenting it as equally reliable.
            confidence *= 0.6

        return {
            "label": bucket_score(signed_score),
            "score": round(signed_score, 4),
            "confidence": round(confidence, 4),
            "evidence_text": combined[:500],
        }
