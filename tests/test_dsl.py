from __future__ import annotations

import polars as pl
import pytest

from sharpeluck.research import dsl
from tests.synth import prepared


def test_parse_roundtrip():
    e = "cs_zscore(ts_ret(close, 24))"
    assert dsl.to_str(dsl.parse(e)) == e


def test_unknown_op_is_a_parse_error():
    with pytest.raises(dsl.ParseError, match="unknown op"):
        dsl.parse("__import__(close, 1)")


def test_bad_arity_is_a_parse_error():
    with pytest.raises(dsl.ParseError, match="parameter"):
        dsl.parse("ts_mean(close)")


def test_grid_expansion_is_a_cartesian_product():
    grid = dsl.expand("cs_zscore(ts_zscore(ts_ret(close, [12, 24, 72]), [48, 96]))")
    assert len(grid) == 6
    assert len({dsl.to_str(n) for n in grid}) == 6
    assert "cs_zscore(ts_zscore(ts_ret(close, 12), 48))" in {dsl.to_str(n) for n in grid}


def test_max_lookback_sums_nested_windows():
    assert dsl.max_lookback("cs_zscore(ts_mean(ts_ret(close, 24), 72))") == 96


def test_signal_ignores_the_future():
    """Second canary: poisoning future bars must not move any past signal."""
    panel = prepared(hours=24 * 60)
    cut = panel["ts"].unique().sort()[24 * 40]
    expr = "cs_zscore(ts_zscore(ts_ret(close, 24), 72))"

    def sig(df):
        return (
            dsl.apply(df, expr, out="s")
            .filter(pl.col("ts") < cut)
            .select("symbol", "ts", "s")
        )

    poisoned = panel.with_columns(
        pl.when(pl.col("ts") >= cut).then(pl.lit(1e9)).otherwise(pl.col("close")).alias("close")
    )
    a, b = sig(panel), sig(poisoned)
    assert a.height > 0 and a["s"].null_count() < a.height
    assert a.equals(b)
