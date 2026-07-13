from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from .. import config
from .reference_data import CompanyReference

MODEL_NAME = "gemini-flash-lite-latest"
DEFAULT_BATCH_SIZE = 15
GROUNDING_MATCH_FLOOR = 85.0  # fuzzy partial-ratio floor for "quote found in source text"
HALLUCINATION_DISCOUNT = 0.3

PROMPT = """The user is researching the topic: "{query}"

You will be given several news article excerpts, each wrapped in its own \
=== ARTICLE <id> === / === END ARTICLE <id> === markers. Process every article \
STRICTLY INDEPENDENTLY: a company only belongs to the article whose markers it \
appeared between. Never attribute a company or quote found in one article's text to \
a different article's id.

For each article, identify every real, publicly-traded company that is genuinely \
discussed in THAT article (not merely named in passing) -- exclude government \
agencies, people, and generic terms. Do not guess ticker symbols; give the company's \
commonly-used name only.

For each company found, provide:
- company_name: the company's commonly-used name
- confidence: 0-1, how clearly/directly this company is a subject of the article \
(not an incidental mention)
- supporting_quote: a short, VERBATIM quote (exact substring) from THAT SAME \
article's text that justifies this identification
- relevance: how relevant this company is to "{query}" FROM AN INVESTOR'S PERSPECTIVE \
-- this is a DIFFERENT question from confidence above, and a narrower one than "is \
{query} discussed in this article." A company can be confidently identified, and the \
topic can be genuinely discussed, while the company is STILL irrelevant as an \
investment angle on that topic. Specifically: an article that helps a CONSUMER use, \
charge, maintain, or troubleshoot a product (tips, how-tos, reviews, buying guides) is \
LOW relevance even if it discusses "{query}" as a technical detail of that product --\
that is not a story about the company's business, strategy, market position, supply \
chain, or financial outlook with respect to "{query}"; it is consumer advice that \
happens to name the topic. Only rate High/Medium if the article is the kind of thing \
that would actually inform an investment thesis: the company's manufacturing, R&D, \
partnerships, competitive position, or financial exposure specifically regarding \
"{query}". Example: if "{query}" is "lithium batteries" and the article is "why your \
iPhone's battery health indicator disappeared" or generic phone-charging tips, Apple \
is LOW relevance -- discussing battery health as a device feature is not a lithium-\
battery business story about Apple, no matter how much of the article it occupies. \
Classify as:
  - "High": the article is substantively about this company's business/strategy/market \
position with respect to "{query}" -- the kind of thing that shapes an investment view
  - "Medium": meaningfully connected to "{query}" as a business matter, but not the \
main focus
  - "Low": mentioned in the article, and "{query}" may even be discussed at length, but \
not as a business/investment matter for this company -- e.g. consumer tips, reviews, \
troubleshooting, or an incidental/generic mention
- relevance_reason: one short sentence justifying the relevance classification

Return a result for every article id below, even if its companies list is empty. \
The "idx" field in your response must exactly match the <id> from that article's markers.

{articles_block}
"""


class CompanyMention(BaseModel):
    company_name: str
    confidence: float
    supporting_quote: str
    relevance: Literal["High", "Medium", "Low"]
    relevance_reason: str


class ArticleResult(BaseModel):
    idx: int
    companies: list[CompanyMention]


class BatchResult(BaseModel):
    articles: list[ArticleResult]


def _is_grounded(quote: str, source_text: str) -> bool:
    if not quote:
        return False
    if quote in source_text:
        return True
    return fuzz.partial_ratio(quote, source_text) >= GROUNDING_MATCH_FLOOR


class GeminiExtractor:
    def __init__(self, client=None, reference: CompanyReference = None, batch_size: int = DEFAULT_BATCH_SIZE):
        if client is None:
            from google import genai
            client = genai.Client(api_key=config.GOOGLE_API_KEY)
        self.client = client
        self.reference = reference or CompanyReference()
        self.batch_size = batch_size

    def _call_batch(self, batch: list[dict], query: str) -> BatchResult:
        articles_block = "\n\n".join(
            f"=== ARTICLE {item['idx']} ===\n{item['text'][:4000]}\n=== END ARTICLE {item['idx']} ==="
            for item in batch
        )
        response = self.client.models.generate_content(
            model=MODEL_NAME,
            contents=PROMPT.format(query=query, articles_block=articles_block),
            config={
                "response_mime_type": "application/json",
                "response_schema": BatchResult,
            },
        )
        return response.parsed

    def extract_many(self, articles: list[dict], query: str) -> dict[int, list[dict]]:
        """articles: [{'id': article_id, 'text': str}, ...]. query: the search
        topic these articles came from, used to judge relevance (see PROMPT).
        Returns {article_id: [{ticker, company_name, confidence, evidence_text,
        relevance, relevance_reason}, ...]}."""
        results: dict[int, list[dict]] = {a["id"]: [] for a in articles}
        text_by_id = {a["id"]: a["text"] for a in articles}

        for start in range(0, len(articles), self.batch_size):
            chunk = articles[start:start + self.batch_size]
            batch_input = [{"idx": a["id"], "text": a["text"]} for a in chunk]
            batch_result = self._call_batch(batch_input, query)

            for article_result in batch_result.articles:
                article_id = article_result.idx
                source_text = text_by_id.get(article_id, "")
                for mention in article_result.companies:
                    grounded = _is_grounded(mention.supporting_quote, source_text)
                    confidence = mention.confidence if grounded else mention.confidence * HALLUCINATION_DISCOUNT

                    match = self.reference.resolve(mention.company_name)
                    if match is None:
                        continue
                    entry, _fuzzy_score, _margin = match

                    results[article_id].append({
                        "ticker": entry.ticker,
                        "company_name": entry.company_name,
                        "confidence": round(confidence, 4),
                        "evidence_text": mention.supporting_quote,
                        "relevance": mention.relevance,
                        "relevance_reason": mention.relevance_reason,
                    })

        return results
