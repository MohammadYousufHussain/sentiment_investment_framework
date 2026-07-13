# Multi-stage build: the React SPA is compiled in a Node stage and the
# resulting static bundle is copied into the Python runtime image that
# actually serves it (see webapp/app.py's spa() route) -- no Node in the
# final image, no separate frontend server/process needed at runtime.

# ---- Stage 1: build the frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /build/webapp/frontend
COPY webapp/frontend/package.json webapp/frontend/package-lock.json ./
RUN npm ci
COPY webapp/frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.11-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1

# build-essential: some pip packages (e.g. transitive deps of spaCy/
# transformers) still need a compiler for source builds on some platforms.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt \
    && pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && python -m spacy download en_core_web_trf

COPY src/ ./src/
COPY webapp/app.py ./webapp/app.py
COPY config/ ./config/
COPY --from=frontend-build /build/webapp/dist ./webapp/dist

# data/ is created at runtime by Database.__init__ (mkdir parents=True) --
# not baked into the image. Point DB_PATH at a mounted volume in production
# (see DEPLOYMENT.md) so it survives redeploys; this default is only hit if
# DB_PATH is unset, which happens to still work for a quick local `docker run`.
ENV DB_PATH=/app/data/sentiment_investment.db

EXPOSE 8000

# Single worker, several threads: the app keeps in-memory state (Stage B job
# status, several TTL caches) in plain process memory, not shared across
# workers -- see DEPLOYMENT.md. Long timeout because some routes chain
# multiple LLM calls (the Investment Thesis pitch can take 30-60s+ on a cold
# cache). Shell form (not exec-form JSON array) deliberately, so $PORT is
# expanded -- Railway (and most PaaS) assign a port at runtime rather than
# letting the container pick one; falls back to 8000 for a plain local
# `docker run` where $PORT is unset.
CMD gunicorn --workers 1 --threads 4 --timeout 180 --bind 0.0.0.0:${PORT:-8000} webapp.app:app
