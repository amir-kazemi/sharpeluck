#!/usr/bin/env python
"""Expand signal grids into trials, backtest each, report IS vs OOS.

Every number printed here is in-sample in the sense that matters: these are the
trials you looked at. Day 3 takes the count and the dispersion of this table and
turns them into a deflated Sharpe ratio and a probability of backtest
overfitting. Nothing here should be read as an edge yet.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import polars as pl

from sharpeluck.config import GOLD
from sharpeluck.ingest.silver import load_panel
from sharpeluck.research import dsl
from sharpeluck.research.backtest import BacktestParams, WalkForward, run_trial
from sharpeluck.research.signals import prepare_panel

GRIDS = [
    "cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))",          # price trend
    "cs_zscore(ts_std(ret, [24, 72, 168]))",                     # realised volatility
    "cs_zscore(ts_mean(taker_imb, [24, 72, 168]))",              # taker buy pressure
]
# The sign is a searched dimension, so it is expanded like any other parameter
# and counted in the trial budget. Trying a signal, finding it negative, and
# quietly reporting the flipped version is a free doubling of the search space
# that never shows up in the deflation if it is not recorded here.
SIGNS = ["{}", "neg({})"]
REBALANCES = [6, 24]
COST_BPS = 5.0


def main() -> int:
    panel = load_panel()
    universe = pl.read_parquet(GOLD / "universe.parquet")
    feats = prepare_panel(panel, universe)
    print(f"panel: {feats.height:,} rows, {feats['symbol'].n_unique()} symbols, "
          f"{feats['ts'].min():%Y-%m-%d} -> {feats['ts'].max():%Y-%m-%d}")

    trials = [
        (sign.format(dsl.to_str(n)), r)
        for g in GRIDS for n in dsl.expand(g) for sign in SIGNS for r in REBALANCES
    ]
    print(f"trials: {len(trials)}\n")

    rows, folds, series = [], [], []
    for i, (expr, reb) in enumerate(trials):
        row = run_trial(feats, expr, BacktestParams(reb, COST_BPS),
                        WalkForward(n_splits=6), keep_series=True)
        for f in row.pop("folds"):
            folds.append({"expr": expr, "rebalance_every_h": reb, **f})
        series.append(row.pop("series").with_columns(
            pl.lit(i).alias("trial"), pl.lit(expr).alias("expr"),
            pl.lit(reb).alias("rebalance_every_h")))
        rows.append({"trial": i, **row})

    df = pl.DataFrame(rows).sort("is_sharpe", descending=True, nulls_last=True)
    GOLD.mkdir(parents=True, exist_ok=True)
    df.write_parquet(GOLD / "trials.parquet", compression="zstd")
    pl.DataFrame(folds).write_parquet(GOLD / "trial_folds.parquet", compression="zstd")
    pl.concat(series).write_parquet(GOLD / "trial_returns.parquet", compression="zstd")

    show = df.select(
        pl.col("expr").str.slice(0, 40),
        pl.col("rebalance_every_h").alias("reb_h"),
        pl.col("sharpe").round(2).alias("net_SR"),
        pl.col("gross_sharpe").round(2).alias("gross_SR"),
        pl.col("is_sharpe").round(2).alias("IS_SR"),
        pl.col("oos_sharpe").round(2).alias("OOS_SR"),
        pl.col("turnover_per_rebal").round(3).alias("turnover"),
        pl.col("break_even_bps").round(1).alias("be_bps"),
    )
    with pl.Config(tbl_rows=100, tbl_width_chars=140, fmt_str_lengths=42):
        print(show)

    # The honest experiment: pick on in-sample, then look at out-of-sample once.
    best = df.row(0, named=True)
    print(f"\nIS winner (the one you would actually have picked): "
          f"{best['expr']} @ {best['rebalance_every_h']}h")
    oos_best = df.sort("oos_sharpe", descending=True, nulls_last=True).row(0, named=True)
    print(f"  IS {best['is_sharpe']:.2f} -> OOS {best['oos_sharpe']:.2f}   "
          f"net SR {best['sharpe']:.2f}, break-even {best['break_even_bps']:.1f} bps "
          f"vs {COST_BPS} bps assumed")
    print(f"  (the best OOS trial was {oos_best['expr']} @ {oos_best['rebalance_every_h']}h "
          f"at {oos_best['oos_sharpe']:.2f}, but its IS was {oos_best['is_sharpe']:.2f} -- "
          f"you could not have chosen it)")
    print(f"  IS/OOS rank correlation across all {df.height} trials: "
          f"{pl.DataFrame(rows).select(pl.corr('is_sharpe', 'oos_sharpe', method='spearman')).item():.3f}")
    (GOLD / "trials_meta.json").write_text(json.dumps(
        {"n_trials": df.height, "cost_bps": COST_BPS, "grids": GRIDS,
         "signs": SIGNS, "rebalances": REBALANCES}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
