import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env")

NEWSAPI_KEY = os.environ.get("NEWSAPI_KEY")
ALPHA_VANTAGE_API_KEY = os.environ.get("ALPHA_VANTAGE_API_KEY")
BENZINGA_API_KEY = os.environ.get("BENZINGA_API_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

DB_PATH = os.environ.get("DB_PATH") or str(PROJECT_ROOT / "data" / "sentiment_investment.db")
SP500_CONSTITUENTS_PATH = PROJECT_ROOT / "config" / "sp500_constituents.csv"
SEC_COMPANY_TICKERS_PATH = PROJECT_ROOT / "config" / "sec_company_tickers.json"
