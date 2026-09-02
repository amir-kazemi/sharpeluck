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
