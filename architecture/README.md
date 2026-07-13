# Architecture Documentation

This folder documents the design of the sentiment-driven investment scoring system,
built for the Mubadala Lead Data Scientist case study.

## Documents

- [`news_ingestion.md`](./news_ingestion.md) — Part 1 data ingestion design: Stage A
  (keyword-driven discovery), the NLP phase (NER + sentiment) that sits between the
  two ingestion stages, and Stage B (ticker-driven deep collection). Covers source
  selection rationale, data flow, database schema, and resilience/rate-limit handling.

More documents will be added here as later parts of the pipeline (quantitative
validation, integrated scoring, comparable analysis) are designed.
