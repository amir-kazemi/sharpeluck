"""Silver layer: raw 1m klines -> clean hourly panel.

Two documented gotchas in the Binance archive, both handled here:
  1. Files gained a CSV header row partway through the archive's history.
  2. Timestamps switched from milliseconds to microseconds in 2025.
Both are detected per file rather than assumed, so a backfill spanning the
change does not silently produce bars in the year 56000.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import polars as pl

from ..config import SILVER

# Positional schema of a Binance kline CSV row. Names are ours, not Binance's,
# because Binance's own header names changed over time.
RAW_SCHEMA: dict[str, pl.DataType] = {
    "open_time": pl.Int64,
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Float64,
    "close_time": pl.Int64,
    "quote_volume": pl.Float64,
    "trades": pl.Int64,
    "taker_buy_base": pl.Float64,
    "taker_buy_quote": pl.Float64,
    "ignore": pl.Float64,
}

# Bars per hour at 1m resolution; used as the coverage denominator.
MINUTES_PER_HOUR = 60


def _epoch_unit(first_open_time: int) -> str:
    """ms epochs for 'now' are ~1.7e12; us epochs are ~1.7e15."""
    return "us" if first_open_time > 1e14 else "ms"


def read_kline_zip(path: Path) -> pl.DataFrame:
    """Read one monthly kline zip into a frame with a proper UTC `ts` column."""
    with zipfile.ZipFile(path) as z:
        name = z.namelist()[0]
        raw = z.read(name)
    has_header = raw[:9].lower().startswith(b"open_time")
    df = pl.read_csv(
        io.BytesIO(raw),
        has_header=False,
        skip_rows=1 if has_header else 0,
        schema=RAW_SCHEMA,
    )
    if df.height == 0:
        return df.with_columns(ts=pl.lit(None, dtype=pl.Datetime("us", "UTC")))
    unit = _epoch_unit(df["open_time"][0])
    return df.with_columns(
        pl.from_epoch("open_time", time_unit=unit).dt.replace_time_zone("UTC").alias("ts")
    )


def to_hourly(df: pl.DataFrame, symbol: str) -> pl.DataFrame:
    """Aggregate 1m bars to hourly bars, keeping a coverage count.

    `n_minutes` is the number of 1m bars that actually existed in the hour.
    It is the honest gap indicator: a symbol halted, delisted, or newly listed
    shows partial or zero coverage, and the universe builder uses that instead
    of pretending a missing bar is a flat bar.
    """
    if df.height == 0:
        return pl.DataFrame(schema=HOURLY_SCHEMA)
    return (
        df.sort("ts")
        .group_by_dynamic("ts", every="1h", closed="left")
        .agg(
            pl.col("open").first().alias("open"),
            pl.col("high").max().alias("high"),
            pl.col("low").min().alias("low"),
            pl.col("close").last().alias("close"),
            pl.col("volume").sum().alias("volume"),
            pl.col("quote_volume").sum().alias("quote_volume"),
            pl.col("trades").sum().alias("trades"),
            pl.col("taker_buy_quote").sum().alias("taker_buy_quote"),
            pl.len().alias("n_minutes"),
        )
        .with_columns(
            pl.lit(symbol).alias("symbol"),
            pl.col("n_minutes").cast(pl.Int32),
        )
        .select(list(HOURLY_SCHEMA.keys()))
    )


HOURLY_SCHEMA: dict[str, pl.DataType] = {
    "symbol": pl.String,
    "ts": pl.Datetime("us", "UTC"),
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Float64,
    "quote_volume": pl.Float64,
    "trades": pl.Int64,
    "taker_buy_quote": pl.Float64,
    "n_minutes": pl.Int32,
}


def silver_path(symbol: str, month: str) -> Path:
    # Hive-partitioned by symbol so a single-symbol rerun rewrites one file.
    return SILVER / "klines_1h" / f"symbol={symbol}" / f"{month}.parquet"


def build_month(zip_path: Path, symbol: str, month: str) -> Path:
    out = silver_path(symbol, month)
    out.parent.mkdir(parents=True, exist_ok=True)
    to_hourly(read_kline_zip(zip_path), symbol).write_parquet(out, compression="zstd")
    return out


def load_panel(symbols: list[str] | None = None) -> pl.DataFrame:
    """Read the hourly panel back out of silver."""
    root = SILVER / "klines_1h"
    df = pl.read_parquet(root / "**/*.parquet", hive_partitioning=True)
    # `symbol` is stored in the file *and* the partition path; keep the column.
    if symbols:
        df = df.filter(pl.col("symbol").is_in(symbols))
    return df.select(list(HOURLY_SCHEMA.keys())).sort(["symbol", "ts"])
