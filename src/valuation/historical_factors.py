from __future__ import annotations

import threading
import time

import pandas as pd
import yfinance as yf

from . import av_fundamentals
from .qis_factors import _fetch_snapshot_cached, _price_return_12_1, _unix_to_date

# Deliberately small, curated set -- each metric captures a genuinely
# distinct dimension rather than piling on near-duplicate ratios. Value:
# earnings-based (capital-structure-sensitive), earnings-based (neutral),
# cash-based, asset-based. Quality mirrors MSCI's own published Quality
# factor definition (ROE, leverage, earnings stability -- the last one is
# exactly what the "stability" score below computes). Growth is pulled out
# as its own factor. Momentum is the single academically-standard measure.
FACTOR_LABELS = {"value": "Value", "quality": "Quality", "growth": "Growth", "momentum": "Momentum"}

METRICS_BY_FACTOR = {
    "value": ("trailing_pe", "ev_to_ebitda", "fcf_yield", "price_to_book"),
    "quality": ("operating_margin", "return_on_equity", "debt_to_equity", "cash_conversion"),
    "growth": ("revenue_growth", "eps_growth"),
    "momentum": ("vol_adj_momentum_12_1",),
}

DIRECTION = {
    "trailing_pe": -1, "ev_to_ebitda": -1, "fcf_yield": 1, "price_to_book": -1,
    "operating_margin": 1, "return_on_equity": 1, "debt_to_equity": -1, "cash_conversion": 1,
    "revenue_growth": 1, "eps_growth": 1,
    "vol_adj_momentum_12_1": 1,
}

METRIC_LABELS = {
    "trailing_pe": "Trailing P/E", "ev_to_ebitda": "EV / EBITDA", "fcf_yield": "FCF Yield", "price_to_book": "Price / Book",
    "operating_margin": "Operating Margin", "return_on_equity": "Return on Equity (annualized)",
    "debt_to_equity": "Debt / Equity", "cash_conversion": "Cash Conversion",
    "revenue_growth": "Revenue Growth (YoY)", "eps_growth": "EPS Growth (YoY)",
    "vol_adj_momentum_12_1": "12-1 Month Momentum (vol-adj.)",
}

METRIC_IMPLICATIONS = {
    "trailing_pe": "Lower means cheaper relative to trailing earnings. Reconstructed from real historical net income (Alpha Vantage) and real historical price -- not an approximation.",
    "ev_to_ebitda": "Lower means the whole business (equity + real historical net debt) is cheaper relative to real historical operating cash earnings -- capital-structure neutral, unlike P/E.",
    "fcf_yield": "Higher means more free cash flow generated per dollar of market cap at that point in time -- built from real historical operating cash flow minus capex.",
    "price_to_book": "Lower means trading closer to real historical accounting net worth -- most informative for asset-heavy or cyclical businesses where earnings swing more than book value.",
    "operating_margin": "Higher indicates more efficient conversion of revenue into operating profit. Shown per-quarter (not smoothed) specifically so genuine cyclicality is visible in the chart -- the 12-quarter average is the smoothing layer, not the raw series.",
    "return_on_equity": "Higher indicates more profit per dollar of shareholder equity, annualized from each quarter's net income. Cross-check against Debt/Equity -- ROE driven mainly by leverage isn't the same as ROE driven by operating performance.",
    "debt_to_equity": "Lower means less balance-sheet leverage. A rising trend here alongside falling ROE is a materially different story than both rising together.",
    "cash_conversion": "Above 1x means operating cash flow is outpacing reported net income that same quarter (a sign of high earnings quality); persistently below 1x can flag aggressive revenue recognition.",
    "revenue_growth": "Higher means the top line is expanding faster than its own history. The most stable growth measure -- doesn't go negative and reverse sign the way earnings growth can.",
    "eps_growth": "Higher means per-share profit is expanding faster than its own history. Diverges from net-income growth when share count changes materially -- buybacks lift EPS growth above net-income growth, dilution drags it below (cross-check against Shareholder Yield in the Value factor).",
    "vol_adj_momentum_12_1": "Positive means the stock trended up over the last 12 months excluding the most recent month, scaled by its own volatility so a steady grinder and a choppy mover aren't compared on raw return alone.",
}

QUARTERS_FETCHED = 44    # fetched depth (~11yr) -- needs to comfortably exceed CHART_QUARTERS + MA_WINDOW so the
                         # moving average has a full 12-quarter lookback before the very first *displayed* point
CHART_QUARTERS = 20      # displayed depth
MA_WINDOW = 12           # "normalized" = trailing 12-quarter average, per the requested methodology

_price_history_cache: dict[str, tuple[float, pd.Series]] = {}
_price_history_lock = threading.Lock()
PRICE_CACHE_TTL_SECONDS = 3600


def _fetch_price_history_5y(ticker: str) -> pd.Series:
    """A dedicated, longer price fetch -- qis_factors' cached snapshot only
    carries 15mo (enough for its own 12-1 momentum calc), too short for this
    tab's multi-year analysis. Fetches 10y (not just enough for the 20-quarter
    display window) so the Value multiples and Momentum series -- both of
    which need real price data matched to old fiscal dates -- have enough
    depth for their own 12-quarter moving average to start right at the
    beginning of the displayed window instead of partway through it."""
    now = time.time()
    with _price_history_lock:
        cached = _price_history_cache.get(ticker)
        if cached and now - cached[0] < PRICE_CACHE_TTL_SECONDS:
            return cached[1]
    try:
        history = yf.Ticker(ticker).history(period="10y", auto_adjust=True)
        close = history["Close"] if "Close" in history.columns else pd.Series(dtype=float)
    except Exception:
        close = pd.Series(dtype=float)
    with _price_history_lock:
        _price_history_cache[ticker] = (now, close)
    return close


def _price_near_date(closes: pd.Series, date_str: str, max_days: int = 12) -> float | None:
    if closes.empty or not date_str:
        return None
    try:
        target = pd.Timestamp(date_str)
    except (ValueError, TypeError):
        return None
    index = closes.index
    index_tz = getattr(index, "tz", None)
    if index_tz is not None and target.tzinfo is None:
        target = target.tz_localize(index_tz)
    elif index_tz is None and target.tzinfo is not None:
        target = target.tz_localize(None)
    try:
        pos = index.get_indexer([target], method="nearest")[0]
    except Exception:
        return None
    if pos < 0 or pos >= len(index):
        return None
    if abs((index[pos] - target).days) > max_days:
        return None
    return float(closes.iloc[pos])


def _fetch_joined_quarterly_fundamentals(ticker: str, limit: int = QUARTERS_FETCHED) -> list[dict]:
    """Joins AV's income statement, balance sheet, cash flow, and earnings
    quarterly reports by fiscal_date into one row per quarter -- the shared
    foundation every Quality/Growth/Value metric below is built from."""
    income_statement = av_fundamentals.fetch_income_statement(ticker)
    balance_sheet = av_fundamentals.fetch_balance_sheet(ticker)
    cash_flow = av_fundamentals.fetch_cash_flow(ticker)
    earnings = av_fundamentals.fetch_earnings(ticker)

    def index_by_date(reports, fields):
        out = {}
        for r in reports:
            date = r.get("fiscalDateEnding")
            if date:
                out[date] = {f: av_fundamentals._to_float(r.get(f)) for f in fields}
        return out

    income_by_date = index_by_date(income_statement.get("quarterlyReports", []),
                                    ["totalRevenue", "netIncome", "ebitda", "operatingIncome"])
    balance_by_date = index_by_date(balance_sheet.get("quarterlyReports", []),
                                     ["totalShareholderEquity", "totalAssets", "shortLongTermDebtTotal",
                                      "cashAndCashEquivalentsAtCarryingValue"])
    cashflow_by_date = index_by_date(cash_flow.get("quarterlyReports", []), ["operatingCashflow", "capitalExpenditures"])
    earnings_by_date = index_by_date(earnings.get("quarterlyEarnings", []), ["reportedEPS"])

    all_dates = sorted(set(income_by_date) | set(balance_by_date) | set(cashflow_by_date) | set(earnings_by_date))
    joined = []
    for date in all_dates:
        inc, bal, cf = income_by_date.get(date, {}), balance_by_date.get(date, {}), cashflow_by_date.get(date, {})
        eps = earnings_by_date.get(date, {})
        joined.append({
            "fiscal_date": date,
            "revenue": inc.get("totalRevenue"),
            "net_income": inc.get("netIncome"),
            "ebitda": inc.get("ebitda"),
            "operating_income": inc.get("operatingIncome"),
            "equity": bal.get("totalShareholderEquity"),
            "assets": bal.get("totalAssets"),
            "debt": bal.get("shortLongTermDebtTotal"),
            "cash": bal.get("cashAndCashEquivalentsAtCarryingValue"),
            "operating_cf": cf.get("operatingCashflow"),
            "capex": cf.get("capitalExpenditures"),
            "eps": eps.get("reportedEPS"),
        })
    return joined[-limit:]


def _ttm_at(joined: list[dict], index: int, field: str) -> float | None:
    if index < 3:
        return None
    window = joined[index - 3: index + 1]
    values = [q[field] for q in window if q.get(field) is not None]
    return sum(values) if len(values) == 4 else None


def _quality_growth_series(joined: list[dict], metric: str) -> list[tuple[str, float | None]]:
    """Single-quarter (not TTM-smoothed) values, deliberately -- the point is
    to let genuine cyclicality show up in the chart; the 12-quarter moving
    average computed downstream is the smoothing layer, not this series."""
    series = []
    for i, q in enumerate(joined):
        value = None
        if metric == "operating_margin":
            rev, opinc = q.get("revenue"), q.get("operating_income")
            if rev and opinc is not None:
                value = opinc / rev
        elif metric == "return_on_equity":
            ni, equity = q.get("net_income"), q.get("equity")
            if ni is not None and equity:
                value = (ni * 4) / equity  # annualized (ROE is conventionally an annual rate)
        elif metric == "debt_to_equity":
            debt, equity = q.get("debt"), q.get("equity")
            if debt is not None and equity:
                value = debt / equity
        elif metric == "cash_conversion":
            ocf, ni = q.get("operating_cf"), q.get("net_income")
            if ocf is not None and ni and ni > 0:
                value = ocf / ni
        elif metric == "revenue_growth" and i >= 4:
            rev, prior = q.get("revenue"), joined[i - 4].get("revenue")
            if rev is not None and prior:
                value = (rev - prior) / prior
        elif metric == "eps_growth" and i >= 4:
            eps, prior = q.get("eps"), joined[i - 4].get("eps")
            if eps is not None and prior and prior > 0:
                value = (eps - prior) / prior
        series.append((q["fiscal_date"], value))
    return series


def _value_series(joined: list[dict], metric: str, closes_5y: pd.Series, shares_outstanding: float | None) -> list[tuple[str, float | None]]:
    """P/E, EV/EBITDA, and FCF Yield are conventionally quoted against
    trailing-twelve-month fundamentals (never a single quarter), combined
    with the real price at that point in time. P/B uses point-in-time book
    value (a balance is a snapshot, not a flow, so no TTM concept applies).
    Net debt for EV/EBITDA uses the real historical debt/cash at each
    quarter -- not held constant."""
    series = []
    if not shares_outstanding:
        return [(q["fiscal_date"], None) for q in joined]

    for i, q in enumerate(joined):
        value = None
        price = _price_near_date(closes_5y, q["fiscal_date"])
        if price is not None:
            market_cap = price * shares_outstanding
            if metric == "trailing_pe":
                ttm_ni = _ttm_at(joined, i, "net_income")
                if ttm_ni and ttm_ni > 0:
                    eps = ttm_ni / shares_outstanding
                    value = price / eps
            elif metric == "ev_to_ebitda":
                ttm_ebitda = _ttm_at(joined, i, "ebitda")
                debt, cash = q.get("debt"), q.get("cash")
                if ttm_ebitda and ttm_ebitda > 0:
                    net_debt = (debt or 0) - (cash or 0)
                    value = (market_cap + net_debt) / ttm_ebitda
            elif metric == "fcf_yield":
                ttm_ocf = _ttm_at(joined, i, "operating_cf")
                ttm_capex = _ttm_at(joined, i, "capex")
                if ttm_ocf is not None and ttm_capex is not None and market_cap > 0:
                    fcf = ttm_ocf - ttm_capex
                    value = fcf / market_cap
            elif metric == "price_to_book":
                equity = q.get("equity")
                if equity and equity > 0:
                    value = market_cap / equity
        series.append((q["fiscal_date"], value))
    return series


def _momentum_series(closes: pd.Series) -> list[tuple[str, float | None]]:
    """Vol-adjusted 12-1 month momentum re-computed as of many points in the
    past, stepping back ~quarterly (63 trading days) so it's on the same
    cadence as the fundamentals-based metrics above."""
    closes = closes.dropna()
    n = len(closes)
    min_needed = 252 + 21
    step = 63
    points = []
    end = n - 1
    while end > min_needed and len(points) < QUARTERS_FETCHED:
        window = closes.iloc[: end + 1]
        ret, vol = _price_return_12_1(window)
        value = (ret / vol) if (ret is not None and vol and vol > 1e-6) else None
        label = closes.index[end].strftime("%Y-%m-%d")
        points.append((label, value))
        end -= step
    points.reverse()
    return points


def _rolling_ma(values: list[float | None], window: int = MA_WINDOW) -> list[float | None]:
    # Growth metrics (revenue/EPS growth) legitimately go undefined for any
    # quarter whose YoY comparison base was a loss -- a genuine multi-quarter
    # downturn (like MU's 2023) can knock out ~5 of the trailing 12 points.
    # Requiring half the window (6 of 12) rather than 60% (7.2, i.e. 8) is
    # still a reasonable floor for "this is a real average," and avoids
    # discarding an otherwise perfectly usable 7-point sample over a
    # one-point margin.
    min_valid = max(4, window // 2)
    ma = []
    for i in range(len(values)):
        if i < window - 1:
            ma.append(None)
            continue
        chunk = [v for v in values[i - window + 1: i + 1] if v is not None]
        ma.append(round(sum(chunk) / len(chunk), 6) if len(chunk) >= min_valid else None)
    return ma


def _stability(values: list[float | None], window: int = MA_WINDOW) -> float | None:
    """Coefficient of variation (|stdev / mean|) over the trailing window --
    the number that says, purely from the company's own data, how much a
    single point-in-time reading of this metric should be trusted. Low =
    stable/compounder-like; high = cyclical/volatile."""
    recent = [v for v in values[-window:] if v is not None]
    if len(recent) < 4:
        return None
    mean = sum(recent) / len(recent)
    if abs(mean) < 1e-9:
        return None
    variance = sum((v - mean) ** 2 for v in recent) / len(recent)
    return round(abs((variance ** 0.5) / mean), 4)


def _format_period_label(fiscal_date: str) -> str:
    try:
        year, month, _ = fiscal_date.split("-")
        quarter = (int(month) - 1) // 3 + 1
        return f"Q{quarter} {year}"
    except (ValueError, AttributeError):
        return fiscal_date or ""


def _build_metric_output(metric: str, factor_name: str, raw_series: list[tuple[str, float | None]], as_of: str | None) -> dict:
    labels = [label for label, _ in raw_series]
    values = [value for _, value in raw_series]
    ma = _rolling_ma(values)

    current = values[-1] if values else None
    normalized = ma[-1] if ma else None
    stability = _stability(values)
    direction = DIRECTION[metric]

    # Deviation from Normalized: how far current sits from its own 12-quarter
    # average, as a %. This is a plain descriptive statistic -- it says
    # nothing about "good" or "bad" on its own (that depends on which way
    # this metric is supposed to move), which is why `favorable` below is a
    # separate, direction-aware field rather than folded into the sign here.
    deviation_from_normalized = None
    if current is not None and normalized is not None and abs(normalized) > 1e-9:
        deviation_from_normalized = round((current - normalized) / normalized, 4)

    # Direction-aware read: for a lower-is-better metric (e.g. EV/EBITDA),
    # sitting ABOVE its own normalized level is adverse (currently pricier
    # than usual); for a higher-is-better metric, the same positive deviation
    # is favorable. None when there's nothing to compare (no deviation value).
    favorable = None
    if deviation_from_normalized is not None:
        favorable = (deviation_from_normalized > 0) == (direction == 1)

    # Time-series z-score: how many of this metric's OWN typical swings away
    # from normal is today's reading. deviation_from_normalized ~= (current -
    # mean)/mean and stability (CoV) = stdev/mean, so dividing one by the
    # other cancels the mean and leaves (current - mean)/stdev -- a z-score
    # against this metric's own trailing distribution, not a peer set.
    # Direction-adjusted so positive always means "favorable," consistent
    # with `favorable` above. Replaces the old rank-based percentile: a
    # metric whose normalized value sits near zero (e.g. FCF Yield) produces
    # a huge, meaningless % deviation, but the CoV in the denominator is
    # inflated by the same near-zero mean, so the ratio stays sane.
    zscore = None
    if deviation_from_normalized is not None and stability is not None and stability > 1e-6:
        zscore = round((deviation_from_normalized / stability) * direction, 4)

    chart_labels = labels[-CHART_QUARTERS:]
    chart_values = values[-CHART_QUARTERS:]
    chart_ma = ma[-CHART_QUARTERS:]

    return {
        "label": METRIC_LABELS[metric],
        "direction": direction,
        "current": round(current, 6) if current is not None else None,
        "normalized": round(normalized, 6) if normalized is not None else None,
        "stability": stability,
        "deviation_from_normalized": deviation_from_normalized,
        "favorable": favorable,
        "zscore": zscore,
        "implication": METRIC_IMPLICATIONS.get(metric),
        "as_of": as_of,
        "history_count": len([v for v in values if v is not None]),
        "chart": {
            "periods": [_format_period_label(label) for label in chart_labels],
            "values": [round(v, 6) if v is not None else None for v in chart_values],
            "ma": [round(v, 6) if v is not None else None for v in chart_ma],
        },
    }


def build_historical_scorecard(ticker: str) -> dict:
    """Scores each metric against the company's OWN historical distribution
    (not a peer set), per the Quantitative Valuation stage of the case
    study. Peer-relative scoring lives on the Comparables tab instead (see
    qis_factors.build_factor_scorecard)."""
    snapshot = _fetch_snapshot_cached(ticker)
    info = snapshot["info"]
    close_5y = _fetch_price_history_5y(ticker)
    close = close_5y if not close_5y.empty else snapshot["history"].get("Close", pd.Series(dtype=float))

    price_as_of = _unix_to_date(info.get("regularMarketTime"))
    fundamentals_as_of = _unix_to_date(info.get("mostRecentQuarter"))
    shares_outstanding = info.get("sharesOutstanding")

    joined = _fetch_joined_quarterly_fundamentals(ticker)

    factors_out = {}
    for factor_name, metrics in METRICS_BY_FACTOR.items():
        metrics_out = {}
        for metric in metrics:
            if metric in ("operating_margin", "return_on_equity", "debt_to_equity", "cash_conversion",
                          "revenue_growth", "eps_growth"):
                raw_series = _quality_growth_series(joined, metric)
                as_of = fundamentals_as_of
            elif metric in ("trailing_pe", "ev_to_ebitda", "fcf_yield", "price_to_book"):
                raw_series = _value_series(joined, metric, close_5y, shares_outstanding)
                as_of = price_as_of
            else:  # vol_adj_momentum_12_1
                raw_series = _momentum_series(close)
                as_of = price_as_of

            metrics_out[metric] = _build_metric_output(metric, factor_name, raw_series, as_of)

        factors_out[factor_name] = {
            "label": FACTOR_LABELS[factor_name],
            "raw": metrics_out,
        }

    return {"ticker": ticker, "factors": factors_out}
