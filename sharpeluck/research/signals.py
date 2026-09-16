"""Turn the silver panel + gold universe into a gap-free feature panel.

Silver bars are missing whenever a symbol did not trade for an entire hour.
Everything downstream uses row-count rolling windows, which are only equal to
time windows on a complete grid -- so the grid is completed here, once, and the
synthetic bars are marked.

Filling a missing bar forward creates a zero return, which is a real (small)
distortion. It is bounded by the universe rule: a symbol needs >=90% of its 1m
bars over the trailing 24h to be tradable at all, so synthetic bars are rare
among the names that can actually carry weight, and `is_real` keeps them
auditable.
"""
from __future__ import annotations

import polars as pl

from .universe import UniverseRules

PRICE_COLS = ["open", "high", "low", "close"]
FLOW_COLS = ["volume", "quote_volume", "trades", "taker_buy_quote"]


def prepare_panel(
    panel: pl.DataFrame,
    universe: pl.DataFrame,
    rules: UniverseRules | None = None,
) -> pl.DataFrame:
    r = rules or UniverseRules()
    grid = (
        panel.sort(["symbol", "ts"])
        .with_columns(pl.lit(True).alias("is_real"))
        .upsample("ts", every="1h", group_by="symbol", maintain_order=True)
        .with_columns(
            pl.col("symbol").forward_fill(),
            pl.col("is_real").fill_null(False),
            *[pl.col(c).forward_fill().over("symbol") for c in PRICE_COLS],
            *[pl.col(c).fill_null(0) for c in FLOW_COLS],
            pl.col("n_minutes").fill_null(0),
        )
    )

    feats = grid.with_columns(
        (pl.col("close") / pl.col("close").shift(1) - 1.0).over("symbol").alias("ret"),
        pl.when(pl.col("quote_volume") > 0)
        .then(2.0 * pl.col("taker_buy_quote") / pl.col("quote_volume") - 1.0)
        .otherwise(None)
        .alias("taker_imb"),
    )

    # Membership decided at `asof` holds until the next rebalance.
    u = universe.select("asof", "symbol").sort(["symbol", "asof"])
    return (
        feats.sort(["symbol", "ts"])
        .join_asof(u, left_on="ts", right_on="asof", by="symbol", strategy="backward")
        .with_columns(
            (
                pl.col("asof").is_not_null()
                & ((pl.col("ts") - pl.col("asof")).dt.total_hours() < r.rebalance_every_h)
            ).alias("in_universe")
        )
        .drop("asof")
        .sort(["symbol", "ts"])
    )
