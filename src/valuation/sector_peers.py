from __future__ import annotations

# Standard SPDR sector ETFs, keyed by yfinance's own `.info['sector']` string
# -- same mapping convention used for relative-strength benchmarking in every
# major QIS/factor framework (ported pattern from equity_research's
# momentum/signals/relative_strength.py, values re-verified here).
SECTOR_ETF = {
    "Technology": "XLK",
    "Healthcare": "XLV",
    "Financial Services": "XLF",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Industrials": "XLI",
    "Energy": "XLE",
    "Basic Materials": "XLB",
    "Utilities": "XLU",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
}

# A curated, liquid large/mid-cap sample per sector -- NOT the full sector or
# index. This is the peer universe the QIS factor scorecard z-scores/ranks
# against. Sized at ~10 names per sector: enough for a meaningful percentile
# spread without fetching a full index (500+ tickers) on every page view.
SECTOR_PEERS = {
    "Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM"],
    "Healthcare": ["UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "BMY"],
    "Financial Services": ["JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "BLK", "AXP", "SPGI"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "ABNB"],
    "Consumer Defensive": ["WMT", "PG", "KO", "PEP", "COST", "PM", "MDLZ", "CL", "KMB", "GIS"],
    "Industrials": ["CAT", "HON", "UNP", "UPS", "BA", "GE", "LMT", "RTX", "DE", "MMM"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "WMB"],
    "Basic Materials": ["LIN", "SHW", "FCX", "NEM", "ECL", "APD", "NUE", "DOW", "DD", "VMC"],
    "Utilities": ["NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE", "XEL", "ED", "WEC"],
    "Real Estate": ["PLD", "AMT", "EQIX", "PSA", "O", "SPG", "WELL", "DLR", "CCI", "AVB"],
    "Communication Services": ["META", "GOOGL", "NFLX", "DIS", "CMCSA", "TMUS", "VZ", "T", "EA", "WBD"],
}


def get_peer_universe(ticker: str, sector: str | None) -> list[str]:
    """Subject ticker first, followed by its sector peers (deduped if the
    subject happens to already be in the curated list)."""
    peers = SECTOR_PEERS.get(sector, [])
    universe = [t for t in peers if t != ticker]
    return [ticker] + universe
