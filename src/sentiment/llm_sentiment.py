from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from .. import config

MODEL_NAME = "gemini-flash-lite-latest"
DEFAULT_BATCH_SIZE = 15
GROUNDING_MATCH_FLOOR = 85.0
HALLUCINATION_DISCOUNT = 0.3

LABELS = ["Bullish", "Somewhat-Bullish", "Neutral", "Somewhat-Bearish", "Bearish"]

PROMPT = """You are scoring news articles for sentiment specifically toward one \
company: {company_name} (ticker: {ticker}).

You will be given several article excerpts, each wrapped in its own \
=== ARTICLE <id> === / === END ARTICLE <id> === markers. Process every article \
STRICTLY INDEPENDENTLY.

For each article, judge the sentiment specifically TOWARD {company_name} -- not the \
article's overall tone. Articles are often mixed: a story can read negatively for one \
company and neutrally or positively for another mentioned alongside it. Judge only how \
the article treats {company_name} specifically.

Classify sentiment as one of exactly these five labels: "Bullish", "Somewhat-Bullish", \
"Neutral", "Somewhat-Bearish", "Bearish".
- "Bullish": clearly positive for {company_name}'s business, outlook, or position
- "Somewhat-Bullish": leans positive, but mild or partial
- "Neutral": no clear positive or negative lean, or purely factual/descriptive
- "Somewhat-Bearish": leans negative, but mild or partial
- "Bearish": clearly negative for {company_name}'s business, outlook, or position

ALSO judge how central {company_name} is to the article -- this is a DIFFERENT \
question from sentiment. An article can mention {company_name} clearly and even with a \
clear tone, while the article itself is actually about a completely different company, \
using {company_name} only as a reference point or comparison. Classify relevance as one \
of exactly these three labels:
- "Primary": the article is substantively about {company_name} -- its business, \
products, financials, or strategy are what the article is actually reporting on
- "Secondary": {company_name} is discussed as a meaningful part of the article (a real \
competitor comparison, a supplier/customer relationship examined in some depth) but \
isn't the main subject
- "Incidental": {company_name} is merely referenced in passing -- e.g. used as a \
historical comparison ("imagine buying shares of {company_name} when it IPO'd"), a size/\
scale analogy, or a brief aside -- while the article is actually about someone or \
something else entirely

For each article, provide:
- label: one of the five sentiment labels above
- confidence: 0-1, how clearly the article expresses this sentiment toward {company_name} \
specifically (not how important the article is)
- supporting_quote: a short, VERBATIM quote (exact substring) from THAT SAME article's \
text that justifies the label
- reasoning: one short sentence explaining the label
- relevance: one of "Primary", "Secondary", "Incidental" as defined above
- relevance_reason: one short sentence justifying the relevance classification

Return a result for every article id below. The "idx" field in your response must \
exactly match the <id> from that article's markers.

{articles_block}
"""


class SentimentResult(BaseModel):
    idx: int
    label: Literal["Bullish", "Somewhat-Bullish", "Neutral", "Somewhat-Bearish", "Bearish"]
    confidence: float
    supporting_quote: str
    reasoning: str
    relevance: Literal["Primary", "Secondary", "Incidental"]
    relevance_reason: str


class BatchResult(BaseModel):
    articles: list[SentimentResult]


def _is_grounded(quote: str, source_text: str) -> bool:
    if not quote:
        return False
    if quote in source_text:
        return True
    return fuzz.partial_ratio(quote, source_text) >= GROUNDING_MATCH_FLOOR


class LLMSentimentAnalyzer:
    def __init__(self, client=None, batch_size: int = DEFAULT_BATCH_SIZE):
        if client is None:
            from google import genai
            client = genai.Client(api_key=config.GOOGLE_API_KEY)
        self.client = client
        self.batch_size = batch_size

    def _call_batch(self, batch: list[dict], ticker: str, company_name: str) -> BatchResult:
        articles_block = "\n\n".join(
            f"=== ARTICLE {item['idx']} ===\n{item['text'][:4000]}\n=== END ARTICLE {item['idx']} ==="
            for item in batch
        )
        response = self.client.models.generate_content(
            model=MODEL_NAME,
            contents=PROMPT.format(ticker=ticker, company_name=company_name, articles_block=articles_block),
            config={
                "response_mime_type": "application/json",
                "response_schema": BatchResult,
            },
        )
        return response.parsed

    def analyze_many_iter(self, articles: list[dict], ticker: str, company_name: str):
        """Generator version of analyze_many -- yields ("progress", processed,
        total) after each batch completes (batches are the unit of wall-clock
        cost, since each is one Gemini call), then a final ("done", results)
        with the same shape analyze_many returns."""
        results: dict[int, dict] = {}
        text_by_id = {a["id"]: a["text"] for a in articles}
        total = len(articles)

        for start in range(0, len(articles), self.batch_size):
            chunk = articles[start:start + self.batch_size]
            batch_input = [{"idx": a["id"], "text": a["text"]} for a in chunk]
            batch_result = self._call_batch(batch_input, ticker, company_name)

            for item in batch_result.articles:
                source_text = text_by_id.get(item.idx, "")
                grounded = _is_grounded(item.supporting_quote, source_text)
                confidence = item.confidence if grounded else item.confidence * HALLUCINATION_DISCOUNT

                results[item.idx] = {
                    "label": item.label,
                    "confidence": round(confidence, 4),
                    "evidence_text": item.supporting_quote,
                    "reasoning": item.reasoning,
                    "relevance": item.relevance,
                    "relevance_reason": item.relevance_reason,
                }

            yield ("progress", min(start + self.batch_size, total), total)

        yield ("done", results)

    def analyze_many(self, articles: list[dict], ticker: str, company_name: str) -> dict[int, dict]:
        """articles: [{'id': article_id, 'text': str}, ...].
        Returns {article_id: {label, confidence, evidence_text, reasoning,
        relevance, relevance_reason}}."""
        for kind, *payload in self.analyze_many_iter(articles, ticker, company_name):
            if kind == "done":
                return payload[0]
        return {}
