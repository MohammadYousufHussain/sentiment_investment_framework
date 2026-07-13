from __future__ import annotations

from . import av_fundamentals, yf_ratios

VALID_PERIODS = ("annual", "quarterly")
DEFAULT_LIMIT = {"annual": 5, "quarterly": 8}


def get_valuation(ticker: str, period: str = "annual") -> dict:
    """Combines yfinance's point-in-time valuation ratios with Alpha Vantage's
    multi-period income statement (for the profitability trend). Two sources
    because they're each better at a different thing: yfinance's `.info`
    snapshot has forward P/E and free-cash-flow fields AV's OVERVIEW doesn't
    reliably expose, while AV's INCOME_STATEMENT gives clean structured
    multi-period data (65 quarters / 19 annual reports observed for a
    mega-cap) that yfinance would require parsing raw statement DataFrames
    for, with no material accuracy advantage."""
    if period not in VALID_PERIODS:
        period = "annual"

    ratios = yf_ratios.fetch_valuation_ratios(ticker)

    income_statement = av_fundamentals.fetch_income_statement(ticker)
    profitability = av_fundamentals.compute_profitability_series(
        income_statement, period=period, limit=DEFAULT_LIMIT[period]
    )

    return {
        "ticker": ticker,
        "period": period,
        "ratios": ratios,
        "profitability": profitability,
    }
