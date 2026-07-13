from __future__ import annotations

import threading
import time

from .. import config
from ..ingestion.http_utils import get_with_retry

BASE_URL = "https://www.alphavantage.co/query"

# AV's key here turned out to be on the free 25-requests/day tier (confirmed
# empirically) and shares that quota with news ingestion -- each statement
# type only actually changes once a quarter, so cache aggressively rather
# than spending quota on repeat fetches. One cache dict shared by function
# name (INCOME_STATEMENT / BALANCE_SHEET / CASH_FLOW), keyed by ticker.
_statement_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_cache_lock = threading.Lock()
CACHE_TTL_SECONDS = 24 * 60 * 60


def _to_float(v):
    if v in (None, "None", ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch_statement(function: str, ticker: str, api_key: str = None,
                      success_keys: tuple[str, ...] = ("annualReports", "quarterlyReports")) -> dict:
    """Shared fetch/cache/error-handling for AV's fundamental data endpoints.
    INCOME_STATEMENT/BALANCE_SHEET/CASH_FLOW share one response shape
    ({symbol, annualReports, quarterlyReports}); EARNINGS uses different key
    names (annualEarnings/quarterlyEarnings), hence `success_keys`. Same
    failure mode either way: a rate-limit/error response has neither of its
    expected keys, and must raise clearly rather than be silently read as
    "no data exists"."""
    cache_key = (function, ticker)
    now = time.time()
    with _cache_lock:
        cached = _statement_cache.get(cache_key)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    api_key = api_key or config.ALPHA_VANTAGE_API_KEY
    if not api_key:
        raise ValueError("ALPHA_VANTAGE_API_KEY not set (check .env)")
    resp = get_with_retry(BASE_URL, params={"function": function, "symbol": ticker, "apikey": api_key})
    data = resp.json()
    if not any(key in data for key in success_keys):
        message = data.get("Information") or data.get("Note") or data.get("Error Message") or str(data)
        raise RuntimeError(f"Alpha Vantage {function} failed for {ticker}: {message}")

    with _cache_lock:
        _statement_cache[cache_key] = (now, data)
    return data


def fetch_income_statement(ticker: str, api_key: str = None) -> dict:
    """Raw AV INCOME_STATEMENT response: {symbol, annualReports, quarterlyReports}.
    Confirmed empirically to return up to ~19 annual and ~65 quarterly reports
    per ticker -- real multi-period statement data, not just a single TTM
    snapshot like yfinance's `.info`. Cached 24h -- see module docstring."""
    return _fetch_statement("INCOME_STATEMENT", ticker, api_key)


def fetch_balance_sheet(ticker: str, api_key: str = None) -> dict:
    """Raw AV BALANCE_SHEET response -- same shape/depth as the income
    statement. Confirmed fields: totalShareholderEquity, totalAssets,
    shortLongTermDebtTotal, per quarter."""
    return _fetch_statement("BALANCE_SHEET", ticker, api_key)


def fetch_cash_flow(ticker: str, api_key: str = None) -> dict:
    """Raw AV CASH_FLOW response -- same shape/depth. Confirmed fields:
    operatingCashflow, capitalExpenditures, dividendPayout, per quarter.
    Note paymentsForRepurchaseOfCommonStock came back consistently null in
    testing (at least for some tickers) -- AV's buyback-specific field looks
    unreliable, so it isn't relied on here."""
    return _fetch_statement("CASH_FLOW", ticker, api_key)


def fetch_earnings(ticker: str, api_key: str = None) -> dict:
    """Raw AV EARNINGS response: {symbol, annualEarnings, quarterlyEarnings}.
    Confirmed empirically to return ~122 quarterly reports for a mega-cap --
    deeper than the other three statement endpoints. INCOME_STATEMENT has no
    per-share EPS field at all, so this is the only source for it. Fields:
    reportedEPS, estimatedEPS, surprise, surprisePercentage, reportedDate."""
    return _fetch_statement("EARNINGS", ticker, api_key, success_keys=("annualEarnings", "quarterlyEarnings"))


def compute_profitability_series(income_statement: dict, period: str = "annual", limit: int = 5) -> list[dict]:
    """period: 'annual' or 'quarterly'. Returns periods oldest-to-newest, each
    with revenue, YoY revenue growth, gross/operating/net margin -- all
    standardized to the same (revenue-denominated) basis so periods are
    directly comparable to each other.

    Growth is always year-over-year (vs. the prior annual report, or 4
    quarters back for quarterly data) rather than period-over-period, since
    sequential quarterly growth is dominated by seasonality for most
    businesses and wouldn't be a meaningful trend signal."""
    key = "annualReports" if period == "annual" else "quarterlyReports"
    reports = income_statement.get(key, [])

    parsed = []
    for r in reports:
        parsed.append({
            "fiscal_date": r.get("fiscalDateEnding"),
            "revenue": _to_float(r.get("totalRevenue")),
            "gross_profit": _to_float(r.get("grossProfit")),
            "operating_income": _to_float(r.get("operatingIncome")),
            "net_income": _to_float(r.get("netIncome")),
        })
    parsed.sort(key=lambda x: x["fiscal_date"] or "")

    lookback = 1 if period == "annual" else 4
    series = []
    for i, row in enumerate(parsed):
        revenue = row["revenue"]
        gross_margin = round(row["gross_profit"] / revenue, 4) if row["gross_profit"] is not None and revenue else None
        operating_margin = round(row["operating_income"] / revenue, 4) if row["operating_income"] is not None and revenue else None
        net_margin = round(row["net_income"] / revenue, 4) if row["net_income"] is not None and revenue else None

        revenue_growth = None
        if i >= lookback:
            prior_revenue = parsed[i - lookback]["revenue"]
            if prior_revenue and revenue is not None:
                revenue_growth = round((revenue - prior_revenue) / prior_revenue, 4)

        series.append({
            "fiscal_date": row["fiscal_date"],
            "revenue": revenue,
            "revenue_growth": revenue_growth,
            "gross_margin": gross_margin,
            "operating_margin": operating_margin,
            "net_margin": net_margin,
        })

    return series[-limit:]
