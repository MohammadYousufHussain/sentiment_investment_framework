# Deploying Sentinel (Railway)

## What you're deploying

One container: a Flask process (`webapp/app.py`) that serves both the JSON/
SSE API and the pre-built React SPA (`webapp/dist`, produced by the frontend
build stage in the `Dockerfile`) — no separate frontend service needed.

**Two constraints that shape this setup, both load-bearing:**

1. **Single worker, always.** Stage B ingestion job status and several
   in-memory TTL caches (peer suggestions, factor scorecards, Comparables
   rationale, Investment Thesis/pitch results) live in plain Python dicts
   inside the process. They are **not** shared across workers or container
   instances. Running more than one worker/replica means different users can
   get inconsistent answers depending on which process handles their
   request. The `Dockerfile`'s `gunicorn --workers 1 --threads 4` reflects
   this — don't raise `--workers` or add a second Railway replica without
   first moving that state to something shared (e.g. Redis).
2. **SQLite needs a persistent volume.** The container filesystem is wiped
   on every redeploy. Without a volume, all ingested articles/sentiment/
   scores vanish on the next deploy. `DB_PATH` (read by
   `src/db/database.py` and `src/config.py`) controls where the DB file
   lives — point it at the mounted volume.

## One-time setup

1. **Create the Railway project** from this repo (Railway auto-detects the
   `Dockerfile` at the repo root and builds from it — no `railway.toml`
   needed unless you want to override something).

2. **Attach a volume** to the service *first* — this determines what
   `DB_PATH` is allowed to be in the next step. Service → Settings →
   Volumes → Add Volume → Mount Path `/data`. Everything the app writes
   inside `/data` survives redeploys; everything outside it (including the
   rest of `/app`, which is the code from the image) is rebuilt from scratch
   on every deploy.

3. **Set environment variables** on the service (Settings → Variables — a
   different tab from Volumes). Use **Service Variables**, not the
   project-level **Shared Variables** — Shared Variables exist for values
   multiple *different services* in one project need; this is a single
   service (everything runs in one Flask process), so there's nothing to
   share with, and Service Variables keeps secrets scoped to only the thing
   that uses them:

   | Variable | Value |
   |---|---|
   | `DB_PATH` | `/data/sentinel.db` |
   | `NEWSAPI_KEY` | your key |
   | `ALPHA_VANTAGE_API_KEY` | your key |
   | `BENZINGA_API_KEY` | your key |
   | `GOOGLE_API_KEY` | your Gemini key |

   Two easy mistakes here, both silent (no error, just data loss on the
   *next* deploy):
   - `DB_PATH` must be a **file** inside the mount, not the bare directory
     -- `/data/sentinel.db`, not `/data`. `Database.__init__` auto-creates
     it with the schema already applied on first use (see
     `src/db/database.py`), so there's no manual init step.
   - The directory in `DB_PATH` must match the volume's mount path from
     step 2 exactly. Setting `DB_PATH=/app/data/sentinel.db` (matching the
     Dockerfile's local-dev default) lands the file on the ephemeral
     filesystem instead -- the app works fine until the next deploy wipes
     it, with nothing telling you why.

   Railway injects `PORT` automatically — the `Dockerfile`'s `CMD` already
   reads it (`--bind 0.0.0.0:${PORT:-8000}`), nothing to set there.

   **Verify persistence actually works, don't just assume it from the
   config**: after deploying, add a company or run a search so something
   real gets written, confirm it via `GET /api/companies` on your Railway
   URL, then trigger a redeploy (Settings → Redeploy, or push a trivial
   commit) and check `/api/companies` again. Same data still there means
   it's wired correctly; empty again means `DB_PATH` isn't actually
   pointing inside the mounted volume.

4. **Deploy.** Railway builds the image and starts the container. First
   build is slow (torch + the spaCy transformer model are large downloads,
   see below) — expect several minutes. Subsequent builds are faster if
   Railway's layer cache holds (the `requirements.txt`/model-download layer
   only re-runs if `requirements.txt` changes).

5. **Get a public URL**: Settings → Networking → Generate Domain. Gives you
   a `*.up.railway.app` URL immediately; a custom domain can be attached
   later the same way.

## Starting from an empty database vs. carrying over existing data

A fresh deploy starts with no articles/scores — the app is fully functional
immediately, it just has nothing ingested yet (use the Search page to run a
Stage A search, or the Companies page's "add a company" box to jump straight
to Stage B for a known ticker). If you want to carry over what's already in
your local `data/sentiment_investment.db` (48MB as of this writing) instead
of starting empty, copy it onto the volume before the app writes a fresh one
-- e.g. `railway ssh` into the running container (or use the Railway CLI's
volume tools) and `scp`/upload the file to `/data/sentinel.db`.

## Image size / build time reality check

The final image is large (order of several GB) because of `torch` +
`transformers` (FinBERT) + spaCy's `en_core_web_trf` (a transformer NER
model), all genuinely needed at runtime, not build-only. The `Dockerfile`
installs the **CPU-only** torch wheel specifically (`--index-url
https://download.pytorch.org/whl/cpu`) to avoid pulling CUDA libraries that
are dead weight on a CPU host — skipping that flag would roughly triple the
download. There's no further trimming available without dropping one of the
two sentiment models entirely, which would be a real capability cut (see
`architecture/sentiment_analysis.md` §3 for why both exist).

## Memory

Budget **at least 2GB RAM** for the Railway service. FinBERT and
`en_core_web_trf` are both loaded fully into memory (not lazily/on-demand)
the first time each is used, and stay resident. Under 2GB, expect OOM kills
mid-request the first time someone triggers Stage B ingestion or NER.

## Secrets hygiene

`.env` is git-ignored and `.dockerignore`'d — it's never baked into the
image. The four API keys above plus `FLASK_SECRET_KEY` are the only
secrets; set them as Railway variables, not in a committed file.
`FLASK_SECRET_KEY` signs login session cookies — generate one with
`python3 -c "import secrets; print(secrets.token_hex(32))"` and set it as
a Service Variable; without it the app falls back to an insecure dev
constant and logs a warning, and rotating it logs every user out.

To serve the app at **sentix.ae**: Settings → Networking → Custom Domain,
add `sentix.ae` (and `www.sentix.ae` if wanted), then create the CNAME
record Railway shows at your DNS provider. Railway provisions TLS
automatically once the record resolves. `python-dotenv`'s `load_dotenv()` in
`src/config.py` is a no-op if there's no `.env` file present (which there
won't be in the container), so this needs no code change to work — it just
falls through to `os.environ`, which Railway populates from the variables
you set.

## If you outgrow this setup

The two constraints in the top section are what to revisit first, roughly
in this order:

1. **In-memory caches/job-state → Redis** (a small Railway Redis add-on is
   the easy path) — unblocks running more than one worker/replica.
2. **SQLite → Postgres** — unblocks true concurrent writers, which SQLite
   handles poorly regardless of worker count; a real concern once ingestion
   volume or simultaneous users grow past "a small team."
3. Move the two ML models to a dedicated inference service if the main
   API's request latency starts being dominated by model load/inference
   time under load.

None of this is needed for "a persistent URL a small team can use."
