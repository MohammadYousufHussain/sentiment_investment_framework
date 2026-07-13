from __future__ import annotations

from typing import Any

import yfinance as yf

# Point-in-time valuation ratios, all sourced from yfinance's single `.info`
# snapshot (TTM-based, same convention Yahoo itself uses for these fields).
# Adapted from a sibling project's drilldown/valuation.py + drilldown/scorecard.py
# (equity_research) -- those were pure functions over the `.info` dict with no
# framework coupling, so the formulas port directly; trimmed to just the
# metrics asked for here (no sector-median benchmarking, no grading/scoring).


def _safe(info: dict, key: str) -> float | None:
    v = info.get(key)
    if v in (None, "N/A", float("inf"), float("-inf")):
        return None
    try:
        f = float(v)
        return round(f, 4) if abs(f) < 1_000_000 else None
    except (TypeError, ValueError):
        return None


def fetch_valuation_ratios(ticker: str) -> dict[str, Any]:
    """Trailing P/E, forward P/E, P/B, P/S, EV/EBITDA, FCF yield, and cash
    conversion for one ticker. Returns None for any field yfinance doesn't
    have (e.g. FCF yield needs both freeCashflow and marketCap present)."""
    info = yf.Ticker(ticker).info or {}

    market_cap = info.get("marketCap")
    fcf = info.get("freeCashflow")
    op_cf = info.get("operatingCashflow")
    net_income = info.get("netIncomeToCommon")

    fcf_yield = round(fcf / market_cap, 4) if (fcf and market_cap and market_cap > 0) else None
    cash_conversion = round(op_cf / net_income, 2) if (op_cf and net_income and net_income > 0) else None

    return {
        "trailing_pe": {"value": _safe(info, "trailingPE"), "label": "Trailing P/E"},
        "forward_pe": {"value": _safe(info, "forwardPE"), "label": "Forward P/E"},
        "price_to_book": {"value": _safe(info, "priceToBook"), "label": "Price / Book"},
        "price_to_sales": {"value": _safe(info, "priceToSalesTrailing12Months"), "label": "Price / Sales"},
        "ev_to_ebitda": {"value": _safe(info, "enterpriseToEbitda"), "label": "EV / EBITDA"},
        "fcf_yield": {"value": fcf_yield, "label": "Free Cash Flow Yield"},
        "cash_conversion": {"value": cash_conversion, "label": "Cash Conversion (OpCF / Net Income)"},
        "sector": info.get("sector"),
        "market_cap": market_cap,
        "currency": info.get("currency"),
    }
