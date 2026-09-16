"""Point-in-time universe construction.

The contract, enforced by tests/test_universe.py:

    The universe stamped `asof = t` is a function of bars with ts < t ONLY.

Every rolling statistic below therefore uses a *time-based* window closed on
the left -- [t - w, t) -- rather than a row-count window. Row-count windows are
wrong here: symbols have missing hours, so "the last 720 rows" is not "the last
30 days", and the error is invisible until it flatters a backtest.
"""
from __future__ import annotations

from dataclasses import dataclass

import polars as pl

from ..config import GOLD


@dataclass(frozen=True)
class UniverseRules:
    rebalance_every_h: int = 24        # daily at 00:00 UTC
    min_history_h: int = 24 * 30       # need a month of quotes before trading it
    adv_window: str = "30d"            # trailing dollar-volume window
    adv_min_periods: int = 24 * 15     # ...requiring at least half of it present
    min_adv_usd: float = 1e5           # liquidity floor
    stale_window_h: int = 24           # halted/delisted detector
    min_coverage: float = 0.90         # fraction of 1m bars that must exist
    max_symbols: int = 50              # breadth cap, ranked by ADV


UNIVERSE_SCHEMA = ["asof", "symbol", "adv_usd", "history_h", "coverage_24h", "rank"]


def build_universe(panel: pl.DataFrame, rules: UniverseRules | None = None) -> pl.DataFrame:
    """Return the long-format universe: one row per (asof, selected symbol)."""
    r = rules or UniverseRules()
    stale_minutes_required = r.min_coverage * r.stale_window_h * 60

    scored = (
        panel.sort(["symbol", "ts"])
        .with_columns(
            # closed="left" == the window [t - w, t), i.e. strictly before t.
            pl.col("quote_volume")
            .rolling_mean_by("ts", window_size=r.adv_window, closed="left",
                             min_samples=r.adv_min_periods)
            .over("symbol")
            .alias("adv_usd"),
            pl.col("n_minutes")
            .rolling_sum_by("ts", window_size=f"{r.stale_window_h}h", closed="left",
                            min_samples=r.stale_window_h)
            .over("symbol")
            .alias("minutes_24h"),
            # Listing age. Depends on the FIRST bar, which is always in the past,
            # so this stays causal.
            (pl.col("ts") - pl.col("ts").min().over("symbol"))
            .dt.total_hours()
            .alias("history_h"),
        )
        .with_columns(
            (pl.col("minutes_24h") / (r.stale_window_h * 60)).alias("coverage_24h")
        )
    )

    eligible = scored.filter(
        # Rebalance grid.
        (pl.col("ts").dt.hour() % r.rebalance_every_h == 0)
        & (pl.col("ts").dt.minute() == 0)
        # Eligibility. Nulls (insufficient history for the window) fail closed.
        & pl.col("adv_usd").is_not_null()
        & pl.col("minutes_24h").is_not_null()
        & (pl.col("history_h") >= r.min_history_h)
        & (pl.col("adv_usd") >= r.min_adv_usd)
        & (pl.col("minutes_24h") >= stale_minutes_required)
    )

    return (
        eligible.with_columns(
            pl.col("adv_usd").rank("ordinal", descending=True).over("ts").cast(pl.Int32).alias("rank")
        )
        .filter(pl.col("rank") <= r.max_symbols)
        .rename({"ts": "asof"})
        .select(UNIVERSE_SCHEMA)
        .sort(["asof", "rank"])
    )


def write_universe(u: pl.DataFrame, name: str = "universe") -> str:
    out = GOLD / f"{name}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    u.write_parquet(out, compression="zstd")
    return str(out)
