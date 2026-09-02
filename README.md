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

## Run it

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q
    .venv/bin/python scripts/ingest.py --months 2023-12 2024-01
