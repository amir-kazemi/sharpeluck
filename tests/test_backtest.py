from __future__ import annotations

import polars as pl

from alpha_audit.research.backtest import (
    BacktestParams, WalkForward, compute_weights, metrics, pnl_series, run_trial, splits,
)
from tests.synth import prepared

HOURLY = BacktestParams(rebalance_every_h=1, cost_bps=0.0)


def _sharpe(panel, signal, params=HOURLY):
    p = pnl_series(compute_weights(panel, signal, params), params)
    return metrics(p, params)["sharpe"]


def test_engine_detects_a_real_edge_and_only_a_real_edge():
    """THE ALIGNMENT CANARY.

    A signal that is literally next bar's return must produce an absurd Sharpe
    -- otherwise the engine cannot detect edge at all and every result it
    reports is meaningless. The same signal without the peek must not.
    """
    panel = prepared(hours=24 * 60)
    cheat = pl.col("ret").shift(-1).over("symbol")   # knows the future
    honest = pl.col("ret")                            # knows only the past
    cheat_sharpe = _sharpe(panel, cheat)
    honest_sharpe = _sharpe(panel, honest)
    assert cheat_sharpe > 10, f"engine cannot see a perfect signal ({cheat_sharpe})"
    assert abs(honest_sharpe) < 5, f"engine leaks the future ({honest_sharpe})"


def test_weights_are_dollar_neutral_and_unit_gross():
    panel = prepared(hours=24 * 60)
    w = compute_weights(panel, "cs_zscore(ts_ret(close, 24))", HOURLY)
    live = w.filter(pl.col("w") != 0).group_by("ts").agg(
        pl.col("w").sum().alias("net"), pl.col("w").abs().sum().alias("gross")
    )
    assert live.height > 0
    assert live["net"].abs().max() < 1e-9
    assert (live["gross"] - 1.0).abs().max() < 1e-9


def test_a_symbol_leaving_the_universe_is_closed_out():
    """Gross exposure must stay at 1 no matter how the universe churns.

    A name that drops out has a null signal; if that null reaches the
    forward-fill it carries the old position for ever and the book accumulates
    every symbol it has ever held. This was invisible on a 53-symbol sample
    where the universe held 50 names and nothing ever left, and it inflated
    per-bar return dispersion by two orders of magnitude on the full one.
    """
    panel = prepared(hours=24 * 60)
    cut = panel["ts"].unique().sort()[24 * 40]
    churned = panel.with_columns(
        pl.when((pl.col("symbol") == "AAA") & (pl.col("ts") >= cut))
        .then(False).otherwise(pl.col("in_universe")).alias("in_universe")
    )
    w = compute_weights(churned, "cs_zscore(ts_ret(close, 24))", HOURLY)

    dropped = w.filter((pl.col("symbol") == "AAA") & (pl.col("ts") > cut))
    assert dropped.height > 0
    assert dropped["w"].abs().max() == 0.0, "a departed symbol kept its position"

    gross = (w.group_by("ts").agg(pl.col("w").abs().sum().alias("g"))
              .filter(pl.col("g") > 0))
    assert gross.height > 0
    assert (gross["g"] - 1.0).abs().max() < 1e-9, "gross exposure drifted from 1"


def test_costs_only_ever_reduce_sharpe():
    panel = prepared(hours=24 * 60)
    expr = "cs_zscore(ts_ret(close, 24))"
    free = run_trial(panel, expr, BacktestParams(24, 0.0))
    dear = run_trial(panel, expr, BacktestParams(24, 50.0))
    assert dear["sharpe"] < free["sharpe"]
    assert free["gross_sharpe"] == dear["gross_sharpe"]  # gross is cost-invariant
    assert free["break_even_bps"] is not None


def test_splits_are_ordered_purged_and_disjoint():
    panel = prepared(hours=24 * 120)
    ts = panel["ts"].unique().sort()
    wf = WalkForward(n_splits=5, embargo_h=24)
    ss = splits(ts, wf)
    assert len(ss) == 5
    for s in ss:
        assert s["train_lo"] < s["train_hi"] < s["test_lo"] < s["test_hi"]
        gap = (s["test_lo"] - s["train_hi"]).total_seconds() / 3600
        assert gap >= wf.embargo_h, f"purge gap only {gap}h"
    for a, b in zip(ss, ss[1:]):
        assert b["test_lo"] > a["test_hi"]  # test blocks never overlap


def test_run_trial_reports_both_sides():
    panel = prepared(hours=24 * 120)
    row = run_trial(panel, "cs_zscore(ts_ret(close, 24))", BacktestParams(24, 5.0))
    assert len(row["folds"]) >= 4
    assert row["is_sharpe"] is not None and row["oos_sharpe"] is not None
