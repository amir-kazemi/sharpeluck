# alpha-audit

**How much of your Sharpe is selection bias?**

A cross-sectional factor research platform whose headline output is not a Sharpe
ratio but an estimate of how much of that Sharpe survives the fact that you
looked at thousands of configurations before picking it. Signals are defined as
parameter *ranges*, expanded into a trial grid, backtested in parallel on Azure,
and then put through Deflated Sharpe Ratio, combinatorial cross-validation
(PBO), a stationary-bootstrap reality check, and a transaction-cost sensitivity
curve.

## Layout

    alpha_audit/ingest/     bronze download + silver aggregation
    alpha_audit/research/   universe, signals, backtest, audit
    scripts/ingest.py       bronze -> silver -> gold driver
    tests/                  causality tests (run these first)
    data -> scratch         the lake; never in git, fully reproducible

## Data

Binance monthly kline archives (`data.binance.vision`), 1m bars in bronze,
aggregated to an hourly research panel in silver. Symbols are enumerated from
the **archive listing**, not the live `exchangeInfo` endpoint: the archive keeps
files for delisted pairs, the live endpoint does not, and building a universe
from the latter bakes in survivorship bias. The Jan-2024 universe accordingly
contains MATIC and WAVES, both later delisted or migrated off Binance.

## The causality contract

    The universe stamped asof = t is a function of bars with ts < t ONLY.

`tests/test_universe.py::test_universe_ignores_the_future` is the canary: it
poisons every bar at or after time `t` with absurd values and asserts the
universe for `asof <= t` is bit-identical. All rolling statistics use
time-based windows closed on the left, `[t - w, t)`, never row-count windows —
symbols have missing hours, so "the last 720 rows" is not "the last 30 days",
and that error is invisible until it flatters a backtest.

## The signal language

    cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))

One expression, five trials. Parameters are declared as *ranges*, because the
number of trials you ran is an input to the deflated Sharpe ratio — the grid has
to be a recorded object, not something you did by hand and forgot. Expressions
parse to a tree and evaluate to Polars columns; there is no `eval`, and an
unknown op is a parse error.

The sign is expanded like any other parameter. Trying a signal, finding it
negative, and quietly reporting the flipped version is a free doubling of the
search space that never reaches the deflation if it is not recorded.

## Backtest conventions

    signal_t   uses data through the close of bar t
    pos_t      = w_{t-1}
    pnl_t      = sum(pos_t * ret_t)
    turnover_t = sum|pos_t - pos_{t-1}|
    net_t      = pnl_t - turnover_t * cost_bps/1e4

Weights are demeaned across the universe and scaled to unit gross exposure, so
no reported Sharpe is a leveraged one. Evaluation is expanding-window
walk-forward, purged by the label horizon plus a 24h embargo.

`test_backtest.py::test_engine_detects_a_real_edge_and_only_a_real_edge` is the
alignment canary: a signal that *is* next bar's return must produce an absurd
Sharpe, or the engine cannot detect edge at all; the same signal without the
peek must not.

## A first pass (10 months, 53 symbols, 44 trials)

Selecting on in-sample, the winner is 72h cross-sectional reversal at daily
rebalance: IS 0.59 → OOS 0.69, net Sharpe 0.55, break-even 10.4 bps against 5
bps assumed. The best *out-of-sample* trial scored 1.18 but had an IS Sharpe of
−0.28, so it was unpickable — which is the entire reason the audit layer exists. IS/OOS
rank correlation across the 44 trials is 0.56. None of these numbers should be
read as an edge until they have been deflated.

## Run it

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q
    .venv/bin/python scripts/ingest.py --months 2023-12 2024-01
