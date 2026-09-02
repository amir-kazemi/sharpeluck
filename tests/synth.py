"""Synthetic hourly panels, so the causality tests need no network or lake."""
from __future__ import annotations

import numpy as np
import polars as pl


def synth_panel(
    symbols: dict[str, float],
    hours: int = 24 * 60,
    start: str = "2024-01-01",
    seed: int = 7,
) -> pl.DataFrame:
    """`symbols` maps symbol -> mean hourly quote volume in USD."""
    rng = np.random.default_rng(seed)
    frames = []
    base = np.datetime64(start, "h")
    for sym, adv in symbols.items():
        t = base + np.arange(hours, dtype="timedelta64[h]")
        px = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.004, hours)))
        qv = adv * rng.lognormal(0, 0.3, hours)
        frames.append(
            pl.DataFrame(
                {
                    "symbol": [sym] * hours,
                    "ts": t.astype("datetime64[us]"),
                    "open": px,
                    "high": px * 1.001,
                    "low": px * 0.999,
                    "close": px,
                    "volume": qv / px,
                    "quote_volume": qv,
                    "trades": np.full(hours, 1000, dtype=np.int64),
                    "taker_buy_quote": qv * 0.5,
                    "n_minutes": np.full(hours, 60, dtype=np.int32),
                }
            ).with_columns(pl.col("ts").dt.replace_time_zone("UTC"))
        )
    return pl.concat(frames).sort(["symbol", "ts"])
