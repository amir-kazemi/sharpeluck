"""Paths and shared constants.

The data lake lives outside the repo (on scratch) because it is large and
fully reproducible from the Binance archive; `./data` is a symlink to it.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("ALPHA_AUDIT_DATA", REPO_ROOT / "data")).resolve()

BRONZE = DATA_ROOT / "bronze"
SILVER = DATA_ROOT / "silver"
GOLD = DATA_ROOT / "gold"
CACHE = DATA_ROOT / "cache"

# Research panel resolution. Bronze keeps native 1m bars; everything downstream
# works on hourly bars, which is plenty for cross-sectional factor research and
# keeps the working set in memory.
PANEL_EVERY = "1h"
