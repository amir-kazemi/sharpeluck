"""Cross-sectional long/short backtest, and purged walk-forward evaluation.

Conventions, stated once because every sign error in a backtest lives here:

    signal_t   uses data through the close of bar t
    pos_t      = w_{t-1}          the weight decided one bar earlier
    pnl_t      = sum(pos_t * ret_t)
    turnover_t = sum|pos_t - pos_{t-1}|
    net_t      = pnl_t - turnover_t * cost_bps/1e4

Weights are demeaned across the universe (dollar-neutral) and scaled to unit
gross exposure, so the reported Sharpe is not a leveraged one.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import polars as pl

from . import dsl

HOURS_PER_YEAR = 24 * 365


@dataclass(frozen=True)
class BacktestParams:
    rebalance_every_h: int = 24
    cost_bps: float = 5.0


@dataclass(frozen=True)
class WalkForward:
    n_splits: int = 6
    embargo_h: int = 24        # gap between train end and test start
    label_horizon_h: int = 1   # positions earn over the next bar


def _with_signal(panel: pl.DataFrame, signal) -> pl.DataFrame:
    df = panel.sort(["symbol", "ts"])
    if isinstance(signal, pl.Expr):
        return df.with_columns(signal.alias("sig_raw"))
    return dsl.apply(df, signal, out="sig_raw")


def compute_weights(panel: pl.DataFrame, signal, params: BacktestParams) -> pl.DataFrame:
    """Signal -> dollar-neutral, unit-gross weights held between rebalances."""
    is_rebal = (pl.col("ts").dt.hour() % params.rebalance_every_h == 0) & (
        pl.col("ts").dt.minute() == 0
    )
    df = _with_signal(panel, signal).with_columns(
        pl.when(pl.col("in_universe")).then(pl.col("sig_raw")).otherwise(None).alias("sig")
    )
    df = df.with_columns(
        pl.when(is_rebal).then(pl.col("sig")).otherwise(None).alias("sig_rebal"),
        is_rebal.alias("is_rebal"),
    )
    # Demean and normalise within each rebalance bar.
    df = df.with_columns(
        (pl.col("sig_rebal") - pl.col("sig_rebal").mean().over("ts")).alias("dm")
    )
    denom = pl.col("dm").abs().sum().over("ts")
    df = df.with_columns(
        pl.when(pl.col("is_rebal") & (denom > 0))
        .then(pl.col("dm") / denom)
        .when(pl.col("is_rebal"))
        .then(0.0)
        .otherwise(None)
        .alias("w_target")
    )
    # Hold between rebalances; symbols with no signal yet carry no weight.
    return df.with_columns(
        pl.col("w_target").forward_fill().over("symbol").fill_null(0.0).alias("w")
    )


def pnl_series(weighted: pl.DataFrame, params: BacktestParams) -> pl.DataFrame:
    df = weighted.with_columns(
        pl.col("w").shift(1).over("symbol").fill_null(0.0).alias("pos")
    ).with_columns(
        (pl.col("pos") - pl.col("pos").shift(1).over("symbol").fill_null(0.0)).abs().alias("trade")
    )
    return (
        df.group_by("ts")
        .agg(
            (pl.col("pos") * pl.col("ret").fill_null(0.0)).sum().alias("gross"),
            pl.col("trade").sum().alias("turnover"),
            pl.col("pos").abs().sum().alias("gross_exposure"),
        )
        .sort("ts")
        .with_columns(
            (pl.col("gross") - pl.col("turnover") * params.cost_bps / 1e4).alias("net")
        )
    )


def metrics(p: pl.DataFrame, params: BacktestParams) -> dict:
    if p.height < 2:
        return {"n_bars": p.height, "sharpe": None, "gross_sharpe": None}
    net, gross, to = p["net"], p["gross"], p["turnover"]
    sd, gsd = net.std(), gross.std()
    ann = HOURS_PER_YEAR**0.5
    equity = (1.0 + net).cum_prod()
    peak = equity.cum_max()
    mean_to = to.mean()
    return {
        "n_bars": p.height,
        "sharpe": None if not sd else float(net.mean() / sd * ann),
        "gross_sharpe": None if not gsd else float(gross.mean() / gsd * ann),
        "ann_return": float(net.mean() * HOURS_PER_YEAR),
        "ann_vol": float(sd * ann),
        "max_drawdown": float(((equity - peak) / peak).min()),
        "hit_rate": float((net > 0).mean()),
        "turnover_per_rebal": float(mean_to * params.rebalance_every_h),
        # Cost level at which the gross edge is exactly consumed.
        "break_even_bps": (
            None if not mean_to else float(gross.mean() / mean_to * 1e4)
        ),
    }


def splits(ts: pl.Series, wf: WalkForward, lookback_h: int = 0) -> list[dict]:
    """Expanding-window walk-forward with a purge gap before each test block.

    Train is everything up to `embargo_h + label_horizon_h` before the test
    block starts. The purge matters because a train observation's forward label
    would otherwise reach into the test period; the embargo widens that gap so
    slow-moving features cannot straddle the boundary either.
    """
    u = ts.unique().sort()
    n = len(u)
    nb = wf.n_splits + 1
    if n < nb * 2:
        return []
    edges = [int(round(i * n / nb)) for i in range(nb + 1)]
    gap = pl.duration(hours=wf.embargo_h + wf.label_horizon_h)
    out = []
    for i in range(wf.n_splits):
        test_lo, test_hi = u[edges[i + 1]], u[edges[i + 2] - 1]
        train_hi = pl.select(pl.lit(test_lo) - gap).item()
        train_lo = u[0]
        if (train_hi - train_lo).total_seconds() / 3600 <= lookback_h:
            continue  # not enough warmup left after purging
        out.append(
            {"fold": i, "train_lo": train_lo, "train_hi": train_hi,
             "test_lo": test_lo, "test_hi": test_hi}
        )
    return out


def run_trial(
    panel: pl.DataFrame,
    expr: str,
    params: BacktestParams,
    wf: WalkForward | None = None,
) -> dict:
    """Full-sample metrics plus per-fold in-sample / out-of-sample Sharpes.

    Nothing is *fitted* on the training block -- the signal has no free
    parameters once the trial is concrete. The train block is where you would
    have chosen this trial out of the grid, so its Sharpe is the in-sample
    number that the deflation on Day 3 has to discount.
    """
    wf = wf or WalkForward()
    weighted = compute_weights(panel, expr, params)
    p = pnl_series(weighted, params)
    row = {"expr": expr, **asdict(params), **metrics(p, params)}

    folds = []
    for s in splits(p["ts"], wf, dsl.max_lookback(expr)):
        tr = p.filter(pl.col("ts").is_between(s["train_lo"], s["train_hi"]))
        te = p.filter(pl.col("ts").is_between(s["test_lo"], s["test_hi"]))
        folds.append(
            {"fold": s["fold"],
             "is_sharpe": metrics(tr, params)["sharpe"],
             "oos_sharpe": metrics(te, params)["sharpe"]}
        )
    row["folds"] = folds
    ok = lambda k: [f[k] for f in folds if f[k] is not None]
    row["is_sharpe"] = sum(ok("is_sharpe")) / len(ok("is_sharpe")) if ok("is_sharpe") else None
    row["oos_sharpe"] = sum(ok("oos_sharpe")) / len(ok("oos_sharpe")) if ok("oos_sharpe") else None
    return row
