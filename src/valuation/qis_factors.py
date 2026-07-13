from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

from . import av_fundamentals
from .scoring import percentile_ranks, zscore
from .sector_peers import SECTOR_ETF, get_peer_universe

LOOKBACK_DAYS = 252   # ~12 trading months
SKIP_DAYS = 21        # ~1 trading month, skipped per Jegadeesh-Titman convention
MEDIUM_TERM_DAYS = 63   # ~3 trading months
SHORT_TERM_DAYS = 21    # ~1 trading month

# Direction each raw metric moves in when it's "better" -- +1 higher-is-better,
# -1 lower-is-better. Applied to each metric's z-score before averaging into
# its factor's composite, so every factor's composite is consistently
# "higher = more attractive" regardless of how the underlying figure reads.
DIRECTION = {
    "value": {
        "trailing_pe": -1, "forward_pe": -1, "price_to_book": -1,
        "price_to_sales": -1, "ev_to_ebitda": -1, "fcf_yield": 1, "shareholder_yield": 1,
    },
    "quality": {
        "revenue_growth": 1, "gross_margin": 1, "operating_margin": 1, "net_margin": 1,
        "return_on_equity": 1, "return_on_assets": 1, "debt_to_equity": -1, "cash_conversion": 1,
    },
    "momentum": {
        "vol_adj_momentum_12_1": 1, "relative_strength_sector": 1, "relative_strength_market": 1,
    },
    "low_volatility": {
        "annualized_volatility": -1, "beta": -1, "max_drawdown": -1,
    },
    "crowding": {
        "short_percent_of_float": -1, "short_ratio": -1, "institutional_ownership": -1,
    },
}

FACTOR_LABELS = {
    "value": "Value", "quality": "Quality", "momentum": "Momentum", "low_volatility": "Low Volatility",
    "crowding": "Crowding",
}

METRIC_LABELS = {
    "trailing_pe": "Trailing P/E", "forward_pe": "Forward P/E", "price_to_book": "Price / Book",
    "price_to_sales": "Price / Sales", "ev_to_ebitda": "EV / EBITDA", "fcf_yield": "FCF Yield",
    "shareholder_yield": "Shareholder Yield (Div. + Buyback)",
    "revenue_growth": "Revenue Growth (YoY)",
    "gross_margin": "Gross Margin", "operating_margin": "Operating Margin", "net_margin": "Net Margin",
    "return_on_equity": "Return on Equity", "return_on_assets": "Return on Assets",
    "debt_to_equity": "Debt / Equity", "cash_conversion": "Cash Conversion",
    "vol_adj_momentum_12_1": "12-1 Month Momentum (vol-adj.)", "relative_strength_sector": "Rel. Strength vs. Sector",
    "relative_strength_market": "Rel. Strength vs. Market",
    "annualized_volatility": "Annualized Volatility", "beta": "Beta", "max_drawdown": "Max Drawdown (15mo)",
    "short_percent_of_float": "Short % of Float", "short_ratio": "Short Ratio (Days to Cover)",
    "institutional_ownership": "Institutional Ownership",
}

# Fixed reference text per metric -- what a high/low reading actually implies
# for an investor, not just what the number is.
METRIC_IMPLICATIONS = {
    "trailing_pe": "Lower means the stock is cheaper relative to trailing 12-month earnings. Below the sector mean suggests relative value; well above it suggests the market is pricing in above-average growth or quality.",
    "forward_pe": "Same read as trailing P/E but against next-year consensus earnings -- a forward P/E meaningfully below trailing P/E implies the market expects earnings growth.",
    "price_to_book": "Lower means the stock trades closer to accounting net worth. More informative for asset-heavy businesses (financials, industrials) than asset-light ones where book value understates true economic value.",
    "price_to_sales": "Lower means the market pays less per dollar of revenue -- often used when earnings are negative or volatile and P/E isn't meaningful.",
    "ev_to_ebitda": "Lower means the whole business (equity + debt, net of cash) is cheaper relative to operating cash earnings -- unlike P/E, not distorted by differences in capital structure or tax rate between peers.",
    "fcf_yield": "Higher means more free cash flow generated per dollar of market cap -- a cash-based cheapness measure not affected by the accounting policy choices that can distort earnings-based multiples.",
    "shareholder_yield": "Dividend yield plus net buyback yield (cash spent on repurchases, net of new share issuance, divided by market cap) -- captures total cash actually returned to shareholders, which a dividend-only yield misses for companies that prefer buybacks.",
    "revenue_growth": "Higher means the top line is expanding faster than peers -- growth alone isn't quality, but persistently weak growth alongside strong margins can mean a business milking a shrinking franchise rather than compounding one.",
    "gross_margin": "Higher indicates stronger pricing power or lower direct production cost -- a structural trait of the business model, usually the slowest-moving of the three margins.",
    "operating_margin": "Higher indicates efficient conversion of revenue into operating profit after overhead -- more sensitive than gross margin to scale and cost discipline.",
    "net_margin": "Higher indicates more of each revenue dollar reaches the bottom line after interest and tax -- the most complete profitability measure, but also the most exposed to one-off items.",
    "return_on_equity": "Higher indicates more profit per dollar of shareholder equity -- watch for high ROE driven mainly by leverage rather than operating performance (cross-check against Debt/Equity).",
    "return_on_assets": "Higher indicates more profit per dollar of total assets -- less distorted by leverage than ROE, so a cleaner efficiency comparison across differently-financed peers.",
    "debt_to_equity": "Lower means less balance-sheet leverage and typically more resilience in a downturn, though unusually low leverage can also mean underutilized debt capacity.",
    "cash_conversion": "Above 1x means operating cash flow is outpacing reported net income (a sign of high earnings quality); persistently below 1x can flag aggressive revenue recognition or working-capital drag.",
    "vol_adj_momentum_12_1": "Positive means the stock trended up over the last 12 months excluding the most recent month (to avoid short-term reversal noise), scaled by its own volatility so a steady grinder and a choppy mover aren't compared on raw return alone.",
    "relative_strength_sector": "Positive means the stock outperformed its own sector ETF over the same window -- isolates stock-specific momentum from a broad sector rally or selloff.",
    "relative_strength_market": "Positive means the stock outperformed the broad market (SPY) over the same window.",
    "annualized_volatility": "Lower means calmer, more predictable price behavior -- the core Low Volatility input. Low-vol stocks have historically delivered competitive risk-adjusted returns despite lower raw returns.",
    "beta": "Below 1 means the stock has historically moved less than the market; above 1 means more. Yahoo computes this from several years of monthly returns, so it reacts slowly to a genuine change in the business.",
    "max_drawdown": "The largest peak-to-trough decline over the trailing 15 months -- a plain-language 'how bad did it get' that a percentile rank alone doesn't convey.",
    "short_percent_of_float": "Higher means a larger share of the float is sold short -- a more crowded short position that carries squeeze risk if sentiment turns, regardless of whether the short thesis is fundamentally right. Scored so lower is less crowded.",
    "short_ratio": "Days of average trading volume needed to cover all outstanding short interest -- higher means an unwind (forced or voluntary) would take longer and could be more disorderly.",
    "institutional_ownership": "Very high concentration means much of the float is already owned by similar large, benchmark-aware holders -- less room for incremental buying and more risk of a synchronized exit. This factor treats lower concentration as less crowded, a different lens than reading high institutional ownership as a quality/support signal.",
}

_snapshot_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
CACHE_TTL_SECONDS = 900  # peers are shared across every ticker in a sector, so a short cache saves a lot of re-fetching


def _fetch_snapshot(ticker: str) -> dict:
    tk = yf.Ticker(ticker)
    try:
        info = tk.info or {}
    except Exception:
        info = {}
    try:
        history = tk.history(period="15mo", auto_adjust=True)
    except Exception:
        history = pd.DataFrame()
    try:
        cashflow = tk.cashflow
    except Exception:
        cashflow = pd.DataFrame()
    return {"ticker": ticker, "info": info, "history": history, "cashflow": cashflow}


def _dividend_yield(info: dict) -> float | None:
    # yfinance's `dividendYield` field is inconsistently already-a-percent
    # (e.g. 0.34 meaning 0.34%, not 34%) on some versions/tickers --
    # `trailingAnnualDividendYield` is reliably a fraction, so prefer it.
    trailing = info.get("trailingAnnualDividendYield")
    if trailing is not None:
        return _num(trailing)
    quirky = info.get("dividendYield")
    return round(quirky / 100, 6) if quirky is not None else None


def _buyback_yield(cashflow: pd.DataFrame, market_cap) -> float | None:
    """Net buyback yield = -(Net Common Stock Issuance) / market cap -- that
    cash-flow line is negative when the company is a net repurchaser (buybacks
    exceeding any new share issuance) and positive when it's a net issuer, so
    negating it gives a yield that's positive exactly when cash is flowing
    back to shareholders via buybacks."""
    if cashflow is None or cashflow.empty or not market_cap or market_cap <= 0:
        return None
    row_name = next((r for r in ("Net Common Stock Issuance", "Repurchase Of Capital Stock") if r in cashflow.index), None)
    if row_name is None:
        return None
    try:
        value = cashflow.loc[row_name].iloc[0]
    except (IndexError, KeyError):
        return None
    value = _num(value)
    return round(-value / market_cap, 4) if value is not None else None


def _fetch_snapshot_cached(ticker: str) -> dict:
    now = time.time()
    with _cache_lock:
        cached = _snapshot_cache.get(ticker)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
    snapshot = _fetch_snapshot(ticker)
    with _cache_lock:
        _snapshot_cache[ticker] = (now, snapshot)
    return snapshot


def _num(v):
    if v in (None, "N/A"):
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    except (TypeError, ValueError):
        return None


def _unix_to_date(ts) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return None


def _return_over(closes: pd.Series, days_ago: int, skip: int = 0) -> float | None:
    closes = closes.dropna()
    if len(closes) < days_ago + skip + 1:
        return None
    recent_idx = -(skip + 1)
    past_idx = -(days_ago + skip + 1)
    price_recent = float(closes.iloc[recent_idx])
    price_past = float(closes.iloc[past_idx])
    if price_past <= 0:
        return None
    return (price_recent / price_past) - 1.0


def _annualized_vol_over(closes: pd.Series, window_days: int) -> float | None:
    closes = closes.dropna()
    if len(closes) < window_days + 1:
        return None
    daily_returns = closes.iloc[-(window_days + 1):].pct_change().dropna()
    if len(daily_returns) < window_days * 0.8:
        return None
    return float(daily_returns.std() * math.sqrt(252))


def _price_return_12_1(closes: pd.Series) -> tuple[float | None, float | None]:
    """Returns (return_12_1, annualized_volatility) -- ported from
    equity_research's momentum/signals/price_momentum.py _compute_single."""
    ret_12_1 = _return_over(closes, LOOKBACK_DAYS, skip=SKIP_DAYS)
    vol_ann = _annualized_vol_over(closes, LOOKBACK_DAYS)
    return ret_12_1, vol_ann


def _max_drawdown(closes: pd.Series) -> float | None:
    closes = closes.dropna()
    if closes.empty:
        return None
    drawdown = closes / closes.cummax() - 1.0
    return round(float(-drawdown.min()), 4)  # positive magnitude, 0 = no drawdown


def _compute_raw_factors(snapshot: dict, sector_return_12_1: float | None, market_return_12_1: float | None) -> dict:
    info = snapshot["info"]
    history = snapshot["history"]
    close = history["Close"] if "Close" in history.columns else pd.Series(dtype=float)

    ret_12_1, vol_ann = _price_return_12_1(close)
    vol_adj_momentum = (ret_12_1 / vol_ann) if (ret_12_1 is not None and vol_ann and vol_ann > 1e-6) else None
    rel_sector = (ret_12_1 - sector_return_12_1) if (ret_12_1 is not None and sector_return_12_1 is not None) else None
    rel_market = (ret_12_1 - market_return_12_1) if (ret_12_1 is not None and market_return_12_1 is not None) else None

    debt_to_equity = info.get("debtToEquity")
    de_ratio = (debt_to_equity / 100) if debt_to_equity is not None else None  # yfinance reports this as a %

    fcf, market_cap = info.get("freeCashflow"), info.get("marketCap")
    op_cf, net_income = info.get("operatingCashflow"), info.get("netIncomeToCommon")

    dividend_yield = _dividend_yield(info)
    buyback_yield = _buyback_yield(snapshot.get("cashflow"), market_cap)
    yield_components = [v for v in (dividend_yield, buyback_yield) if v is not None]
    shareholder_yield = round(sum(yield_components), 4) if yield_components else None

    return {
        "value": {
            "trailing_pe": _num(info.get("trailingPE")),
            "forward_pe": _num(info.get("forwardPE")),
            "price_to_book": _num(info.get("priceToBook")),
            "price_to_sales": _num(info.get("priceToSalesTrailing12Months")),
            "ev_to_ebitda": _num(info.get("enterpriseToEbitda")),
            "fcf_yield": round(fcf / market_cap, 4) if (fcf and market_cap and market_cap > 0) else None,
            "shareholder_yield": shareholder_yield,
        },
        "quality": {
            "revenue_growth": _num(info.get("revenueGrowth")),
            "gross_margin": _num(info.get("grossMargins")),
            "operating_margin": _num(info.get("operatingMargins")),
            "net_margin": _num(info.get("profitMargins")),
            "return_on_equity": _num(info.get("returnOnEquity")),
            "return_on_assets": _num(info.get("returnOnAssets")),
            "debt_to_equity": de_ratio,
            "cash_conversion": round(op_cf / net_income, 2) if (op_cf and net_income and net_income > 0) else None,
        },
        "momentum": {
            "vol_adj_momentum_12_1": round(vol_adj_momentum, 4) if vol_adj_momentum is not None else None,
            "relative_strength_sector": round(rel_sector, 4) if rel_sector is not None else None,
            "relative_strength_market": round(rel_market, 4) if rel_market is not None else None,
        },
        "low_volatility": {
            "annualized_volatility": round(vol_ann, 4) if vol_ann is not None else None,
            "beta": _num(info.get("beta")),
            "max_drawdown": _max_drawdown(close),
        },
        "crowding": {
            "short_percent_of_float": _num(info.get("shortPercentOfFloat")),
            "short_ratio": _num(info.get("shortRatio")),
            "institutional_ownership": _num(info.get("heldPercentInstitutions")),
        },
    }


# ── Subject-only enrichment: sector mean, as-of date, implication, horizons ──
# Peers only ever need the single current-period raw value above (for
# z-scoring); everything below runs once, for the subject ticker only.

_PRICE_APPROX_METRICS = {"trailing_pe", "price_to_book", "price_to_sales", "ev_to_ebitda", "fcf_yield", "shareholder_yield"}
_DENOMINATOR_SIDE_METRICS = {"fcf_yield", "shareholder_yield"}  # price up -> lower yield (inverse relation)


def _value_horizons(metric: str, current_value: float | None, closes: pd.Series) -> dict | None:
    """Approximates a P/E-family multiple's value ~3mo and ~12mo ago by
    holding the trailing fundamental constant and scaling by how much the
    price alone has moved since then -- same approximation approach
    equity_research's drilldown/valuation.py used for its historical P/E
    range. Not exact (the real trailing fundamental also moved), but a
    reasonable, clearly-labeled directional read with no extra data cost."""
    if metric not in _PRICE_APPROX_METRICS or current_value is None:
        return None
    closes = closes.dropna()
    if closes.empty:
        return None
    price_now = float(closes.iloc[-1])
    if price_now <= 0:
        return None

    def price_ago(days):
        idx = -(days + 1)
        return float(closes.iloc[idx]) if len(closes) >= days + 1 else None

    price_3m, price_12m = price_ago(63), price_ago(252)
    denominator_side = metric in _DENOMINATOR_SIDE_METRICS

    def scale(price_past):
        if not price_past or price_past <= 0:
            return None
        ratio = (price_now / price_past) if denominator_side else (price_past / price_now)
        return round(current_value * ratio, 4)

    return {
        "short_term": {"label": "Current", "value": round(current_value, 4)},
        "medium_term": {"label": "~3mo ago (price-based approx.)", "value": scale(price_3m)},
        "long_term": {"label": "~12mo ago (price-based approx.)", "value": scale(price_12m)},
    }


def _momentum_horizons(closes: pd.Series, current_value: float | None) -> dict | None:
    return {
        "short_term": {"label": "1M Return", "value": round(r, 4) if (r := _return_over(closes, SHORT_TERM_DAYS)) is not None else None},
        "medium_term": {"label": "3M Return", "value": round(r, 4) if (r := _return_over(closes, MEDIUM_TERM_DAYS)) is not None else None},
        "long_term": {"label": "12-1M Return (vol-adj.)", "value": current_value},
    }


def _low_vol_horizons(closes: pd.Series, current_value: float | None) -> dict | None:
    return {
        "short_term": {"label": "21-Day Realized Vol (ann.)", "value": round(v, 4) if (v := _annualized_vol_over(closes, 21)) is not None else None},
        "medium_term": {"label": "63-Day Realized Vol (ann.)", "value": round(v, 4) if (v := _annualized_vol_over(closes, 63)) is not None else None},
        "long_term": {"label": "252-Day Realized Vol (ann.)", "value": current_value},
    }


def _quality_margin_horizons(ticker: str, metric: str) -> dict | None:
    """Last quarter / last fiscal year / 3-year average, from Alpha Vantage's
    income statement -- a genuinely different source and window than the
    yfinance TTM figure used for peer scoring above, so the two numbers may
    not match exactly; both are shown so that's visible rather than hidden."""
    try:
        income_statement = av_fundamentals.fetch_income_statement(ticker)
    except Exception:
        return None

    quarterly = av_fundamentals.compute_profitability_series(income_statement, period="quarterly", limit=1)
    annual = av_fundamentals.compute_profitability_series(income_statement, period="annual", limit=3)
    if not quarterly and not annual:
        return None

    short_term = quarterly[-1].get(metric) if quarterly else None
    medium_term = annual[-1].get(metric) if annual else None
    long_values = [a[metric] for a in annual if a.get(metric) is not None]
    long_term = round(sum(long_values) / len(long_values), 4) if long_values else None

    return {
        "short_term": {"label": "Last Quarter (AV)", "value": short_term},
        "medium_term": {"label": "Last Fiscal Year (AV)", "value": medium_term},
        "long_term": {"label": "3yr Avg (AV)", "value": long_term},
    }


def _enrich_subject_metrics(ticker: str, factors_out: dict, raw: dict, universe: list[str], snapshots: dict) -> None:
    subject_close = snapshots[ticker]["history"].get("Close", pd.Series(dtype=float))
    subject_info = snapshots[ticker]["info"]
    price_as_of = _unix_to_date(subject_info.get("regularMarketTime"))
    fundamentals_as_of = _unix_to_date(subject_info.get("mostRecentQuarter"))

    for factor_name, metrics in DIRECTION.items():
        for metric, direction in metrics.items():
            entry = factors_out[factor_name]["raw"][metric]
            peer_values = [raw[t][factor_name][metric] for t in universe if t != ticker and raw[t][factor_name][metric] is not None]
            entry["sector_mean"] = round(sum(peer_values) / len(peer_values), 4) if peer_values else None
            entry["sector_min"] = round(min(peer_values), 4) if peer_values else None
            entry["sector_max"] = round(max(peer_values), 4) if peer_values else None
            entry["direction"] = direction
            entry["implication"] = METRIC_IMPLICATIONS.get(metric)

            if factor_name == "quality":
                entry["as_of"] = fundamentals_as_of
                horizons = _quality_margin_horizons(ticker, metric) if metric in ("revenue_growth", "gross_margin", "operating_margin", "net_margin") else None
            elif factor_name == "momentum":
                entry["as_of"] = price_as_of
                horizons = _momentum_horizons(subject_close, entry["value"]) if metric == "vol_adj_momentum_12_1" else None
            elif factor_name == "low_volatility":
                entry["as_of"] = price_as_of
                horizons = _low_vol_horizons(subject_close, entry["value"]) if metric == "annualized_volatility" else None
            elif factor_name == "crowding":
                entry["as_of"] = price_as_of
                horizons = None
            else:  # value
                entry["as_of"] = price_as_of
                horizons = _value_horizons(metric, entry["value"], subject_close)

            if horizons:
                entry.update(horizons)


def build_factor_scorecard(ticker: str) -> dict:
    """Fetches the subject ticker + its curated sector peer set (concurrently,
    cached 15min), z-scores each raw metric cross-sectionally within that
    peer set, direction-adjusts and equal-weight-averages within each of the
    4 QIS factors, then converts each factor's composite z-score into a
    percentile rank -- 100 = most attractive in the peer set, on that factor,
    right now. Percentile scoring always uses the current/TTM value only; the
    short/medium/long-term breakdown added per metric is for context, not
    re-ranking."""
    subject_snapshot = _fetch_snapshot_cached(ticker)
    sector = subject_snapshot["info"].get("sector")
    universe = get_peer_universe(ticker, sector)

    with ThreadPoolExecutor(max_workers=8) as pool:
        snapshots = dict(zip(universe, pool.map(_fetch_snapshot_cached, universe)))
    snapshots[ticker] = subject_snapshot  # avoid re-fetching what we already have

    sector_etf = SECTOR_ETF.get(sector)
    benchmark_tickers = [t for t in (sector_etf, "SPY") if t]
    with ThreadPoolExecutor(max_workers=4) as pool:
        benchmarks = dict(zip(benchmark_tickers, pool.map(_fetch_snapshot_cached, benchmark_tickers)))

    def bench_return(bench_ticker):
        snap = benchmarks.get(bench_ticker)
        if not snap:
            return None
        close = snap["history"]["Close"] if "Close" in snap["history"].columns else pd.Series(dtype=float)
        ret, _ = _price_return_12_1(close)
        return ret

    sector_ret = bench_return(sector_etf)
    market_ret = bench_return("SPY")

    raw = {t: _compute_raw_factors(snapshots[t], sector_ret, market_ret) for t in universe}

    factors_out = {}
    for factor_name, directions in DIRECTION.items():
        metric_names = list(directions.keys())
        per_metric_signed_z: dict[str, dict[str, float | None]] = {}
        for metric in metric_names:
            raw_values = [raw[t][factor_name][metric] for t in universe]
            z = zscore(raw_values)
            direction = directions[metric]
            per_metric_signed_z[metric] = {
                t: (z[i] * direction if z[i] is not None else None) for i, t in enumerate(universe)
            }

        composite = {}
        for t in universe:
            vals = [per_metric_signed_z[m][t] for m in metric_names if per_metric_signed_z[m][t] is not None]
            composite[t] = round(sum(vals) / len(vals), 4) if vals else None

        percentiles = percentile_ranks(composite)
        peers_with_data = sum(1 for t in universe if t != ticker and raw[t][factor_name].get(metric_names[0]) is not None)

        factors_out[factor_name] = {
            "label": FACTOR_LABELS[factor_name],
            "percentile": percentiles.get(ticker),
            "raw": {
                metric: {"label": METRIC_LABELS[metric], "value": raw[ticker][factor_name][metric]}
                for metric in metric_names
            },
            "peer_count": peers_with_data,
        }

    _enrich_subject_metrics(ticker, factors_out, raw, universe, snapshots)

    factor_percentiles = [f["percentile"] for f in factors_out.values() if f["percentile"] is not None]
    composite_score = round(sum(factor_percentiles) / len(factor_percentiles), 1) if factor_percentiles else None

    return {
        "ticker": ticker,
        "sector": sector,
        "sector_etf": sector_etf,
        "peer_universe_size": len(universe) - 1,
        "composite_score": composite_score,
        "factors": factors_out,
    }
