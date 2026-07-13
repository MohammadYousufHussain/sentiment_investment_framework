#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.database import Database

if __name__ == "__main__":
    db = Database()
    db.init_schema()
    print(f"Initialized schema at {db.db_path}")
