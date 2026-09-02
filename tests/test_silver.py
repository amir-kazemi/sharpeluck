"""Aggregation and the two Binance archive format gotchas."""
from __future__ import annotations

import io
import zipfile

import polars as pl

from alpha_audit.ingest.silver import _epoch_unit, read_kline_zip, to_hourly


def _zip(tmp_path, body: str, name="k.csv"):
    p = tmp_path / "k.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr(name, body)
    return p


def _row(open_time, o, h, l, c, v):
    return f"{open_time},{o},{h},{l},{c},{v},{open_time+59999},{v*c},10,{v/2},{v*c/2},0"


def test_epoch_unit_detection():
    assert _epoch_unit(1704067200000) == "ms"       # 2024-01-01 in ms
    assert _epoch_unit(1735689600000000) == "us"    # 2025-01-01 in us


def test_header_row_is_skipped(tmp_path):
    t0 = 1704067200000
    body = "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore\n"
    body += "\n".join(_row(t0 + i * 60000, 10, 11, 9, 10.5, 100) for i in range(60))
    df = read_kline_zip(_zip(tmp_path, body))
    assert df.height == 60
    assert df["ts"][0] == pl.Series([t0], dtype=pl.Int64).cast(pl.Datetime("ms", "UTC")).cast(pl.Datetime("us", "UTC"))[0]


def test_hourly_aggregation(tmp_path):
    t0 = 1704067200000  # 2024-01-01T00:00Z
    rows = [_row(t0 + i * 60000, 10 + i, 20 + i, 5 + i, 12 + i, 100) for i in range(90)]
    df = read_kline_zip(_zip(tmp_path, "\n".join(rows)))
    h = to_hourly(df, "TESTUSDT")
    assert h.height == 2
    first = h.row(0, named=True)
    assert first["symbol"] == "TESTUSDT"
    assert first["open"] == 10          # first minute's open
    assert first["close"] == 12 + 59    # last minute's close
    assert first["high"] == 20 + 59     # max over the hour
    assert first["low"] == 5            # min over the hour
    assert first["volume"] == 60 * 100
    assert first["n_minutes"] == 60
    # Partial final hour is kept, flagged by its coverage count.
    assert h.row(1, named=True)["n_minutes"] == 30
