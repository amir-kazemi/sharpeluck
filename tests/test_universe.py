"""Causality tests for the point-in-time universe.

test_universe_ignores_the_future is the project's lookahead canary: it poisons
every bar at or after time t with absurd values and asserts the universe for
asof <= t is bit-identical. If a future value can ever reach a past decision,
this test fails. It runs before anything else in CI.
"""
from __future__ import annotations

import polars as pl
import pytest

from alpha_audit.research.universe import UniverseRules, build_universe
from tests.synth import synth_panel

RULES = UniverseRules(max_symbols=10, min_adv_usd=1.0)


@pytest.fixture(scope="module")
def panel() -> pl.DataFrame:
    return synth_panel({"AAA": 5e6, "BBB": 2e6, "CCC": 9e6, "DDD": 1e6}, hours=24 * 60)


def test_universe_is_non_empty(panel):
    u = build_universe(panel, RULES)
    assert u.height > 0
    # Daily rebalance over 60 days, minus the 30-day warmup.
    assert u["asof"].n_unique() == pytest.approx(30, abs=2)
    assert set(u["symbol"].unique()) == {"AAA", "BBB", "CCC", "DDD"}


def test_universe_ignores_the_future(panel):
    """THE CANARY. Corrupt the present and the future; the past must not move."""
    cut = panel["ts"].sort().unique()[24 * 45]  # a rebalance boundary, mid-sample
    future = pl.col("ts") >= cut
    poisoned = panel.with_columns(
        pl.when(future).then(pl.lit(1e15)).otherwise(pl.col("quote_volume")).alias("quote_volume"),
        pl.when(future).then(pl.lit(0)).otherwise(pl.col("n_minutes")).alias("n_minutes"),
        pl.when(future).then(pl.lit(1e9)).otherwise(pl.col("close")).alias("close"),
    )
    clean_hist = build_universe(panel, RULES).filter(pl.col("asof") <= cut)
    pois_hist = build_universe(poisoned, RULES).filter(pl.col("asof") <= cut)
    assert clean_hist.height > 0, "nothing to compare -- fixture too short"
    assert clean_hist.equals(pois_hist)


def test_stale_symbol_is_dropped(panel):
    """A pair that stops printing trades but keeps quoting must leave the
    universe, and must leave it the day *after* it goes quiet, not before."""
    halt = panel["ts"].sort().unique()[24 * 50]
    halted = panel.with_columns(
        pl.when((pl.col("symbol") == "AAA") & (pl.col("ts") >= halt))
        .then(pl.lit(0))
        .otherwise(pl.col("n_minutes"))
        .alias("n_minutes")
    )
    u = build_universe(halted, RULES)
    at_halt = u.filter(pl.col("asof") == halt)["symbol"].to_list()
    after = u.filter(pl.col("asof") > halt)["symbol"].unique().to_list()
    assert "AAA" in at_halt, "the halt bar itself is not yet knowable at asof=halt"
    assert "AAA" not in after


def test_young_symbol_is_dropped():
    """A late listing is excluded until it has min_history_h of quotes."""
    old = synth_panel({"AAA": 5e6, "BBB": 5e6}, hours=24 * 60)
    young = synth_panel({"NEW": 9e9}, hours=24 * 60, start="2024-02-10", seed=9)
    u = build_universe(pl.concat([old, young]).sort(["symbol", "ts"]), RULES)
    first_seen = u.filter(pl.col("symbol") == "NEW")["asof"].min()
    listed_at = young["ts"].min()
    assert first_seen is not None, "NEW never qualified -- check fixture length"
    assert (first_seen - listed_at).total_seconds() / 3600 >= RULES.min_history_h


def test_rank_is_by_liquidity_and_capped(panel):
    u = build_universe(panel, UniverseRules(max_symbols=2, min_adv_usd=1.0))
    by_asof = u.group_by("asof").len()
    assert by_asof["len"].max() == 2
    day = u.filter(pl.col("asof") == u["asof"].max())
    assert day["adv_usd"].is_sorted(descending=True)
    assert day["symbol"].to_list()[0] == "CCC"  # highest ADV in the fixture
