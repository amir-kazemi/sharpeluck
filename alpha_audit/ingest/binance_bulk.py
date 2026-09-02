"""Bronze layer: fetch Binance monthly kline archives.

Symbols are enumerated from the *archive listing*, not from the live
`exchangeInfo` endpoint. The archive retains files for delisted symbols; the
live endpoint does not. Building a universe from the live endpoint is the
single easiest way to bake survivorship bias into a crypto backtest.
"""
from __future__ import annotations

import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from ..config import BRONZE

BASE = "https://data.binance.vision"
LISTING = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
_TIMEOUT = 120


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=_TIMEOUT) as r:
        return r.read()


def list_archive_symbols(market: str = "spot", quote: str | None = "USDT") -> list[str]:
    """Every symbol that has ever had a monthly kline file, delisted included."""
    prefix = f"data/{market}/monthly/klines/"
    out: list[str] = []
    token: str | None = None
    while True:
        q = {"list-type": "2", "delimiter": "/", "prefix": prefix}
        if token:
            q["continuation-token"] = token
        xml = _get(f"{LISTING}?{urllib.parse.urlencode(q)}").decode()
        out += [
            p.rstrip("/").split("/")[-1]
            for p in re.findall(r"<CommonPrefixes>\s*<Prefix>([^<]+)</Prefix>", xml)
        ]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if not m or "<IsTruncated>false</IsTruncated>" in xml:
            break
        token = m.group(1)
    if quote:
        out = [s for s in out if s.endswith(quote)]
    return sorted(set(out))


def month_url(symbol: str, month: str, market: str = "spot", interval: str = "1m") -> str:
    return f"{BASE}/data/{market}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{month}.zip"


def bronze_path(symbol: str, month: str, interval: str = "1m") -> Path:
    return BRONZE / "klines" / interval / symbol / f"{symbol}-{interval}-{month}.zip"


def download_month(symbol: str, month: str, interval: str = "1m", market: str = "spot") -> Path | None:
    """Download one symbol-month. Returns None if the file does not exist
    upstream, which simply means the symbol did not trade that month."""
    dest = bronze_path(symbol, month, interval)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        raw = _get(month_url(symbol, month, market, interval))
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(raw)
    tmp.rename(dest)
    return dest
