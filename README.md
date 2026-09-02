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

## The audit layer

Four independent lenses on one trial table:

| | asks |
|---|---|
| **Deflated Sharpe Ratio** | Does the winner beat the Sharpe that the *best of N* noise strategies would have handed you, given non-normal returns? |
| **PBO** (CSCV) | Across many half-sample splits, how often does the in-sample winner land below the out-of-sample median? |
| **Reality Check** | Studentised White/Hansen statistic on a Politis–Romano stationary bootstrap, so autocorrelation is preserved and the null is imposed on all N trials jointly. |
| **Effective N** | Same bootstrap pass: how many *independent* trials this search was actually worth, which is what the DSR needs and cannot assume. |
| **Cost curve** | At what assumed cost in bps does the edge die? |

Calibration is asserted by simulation rather than against constants copied from
a paper: under a known zero-edge null the layer must report PBO ≈ 0.5, a
selection premium of a couple of sampling sigmas, an uninformative DSR, and a
reality check that rejects at roughly its nominal rate. A constant I cannot
re-derive is a constant I cannot debug.

**The independence problem, and its fix.** The DSR's analytic benchmark assumes
the N trials are independent draws. Ours are not: nested windows are
near-duplicates, and every signal is run beside its exact negation. Taking N at
face value therefore deflates against the wrong benchmark.

So the benchmark is *measured* instead of assumed. The stationary bootstrap
already resamples the whole trial family jointly under the null, preserving both
the correlation between trials and the autocorrelation within them — so the same
pass that produces the reality-check p-value also produces the null distribution
of the best trial's Sharpe. Inverting the Gumbel expression against that gives
an **effective number of trials**: how many genuinely independent looks this
search was worth.

    E[best] if 44 independent   +2.72     ->  DSR 0.023
    E[best] as measured         +1.80     ->  DSR 0.125
    effective trials             20.5 of 44

`test_measured_null_matches_the_analytic_one_when_trials_really_are_independent`
pins the two together where the analytic form is valid; the divergence above is
therefore the correlation structure, not a bug.

A correlation-matrix participation ratio is reported alongside (3.7 here, mean
|corr| 0.40) but not trusted over the bootstrap. It counts a signal and its
negation as one direction, whereas a search that takes the maximum gets more
than that from them: `max(SR, -SR) = |SR|`, whose expectation exceeds the
expected best of two *independent* trials. Two anti-correlated trials are worth
roughly 2.8 independent looks, not 1 — which is why the two estimates differ by
so much here, and why the honest one is the one derived from the actual maximum.

## The result — the winner does not survive

The in-sample winner, 72h cross-sectional reversal at daily rebalance:

    net Sharpe                 +0.55
    E[best] as measured        +1.80
    DSR (measured null)         0.125      P(edge is real) ~ 13%
    effective trials            20.5 of 44
    PBO                         0.270
    P(OOS loss)                 0.675
    Reality Check p             0.950
    break-even cost            10.4 bps    vs 5 bps assumed

Verdict: **does not survive**. Correcting the independence assumption raises the
DSR five-fold and changes nothing — 0.125 is not an edge. Gross Sharpe is 1.06
and half of it is eaten by 5 bps of cost. This is the intended outcome of the
exercise: a platform that only ever confirms signals is not an audit.

## The runner seam

A run is a spec, and a spec is the whole experiment: grids, sign templates,
rebalances, cost, fold and block counts. Trial expansion is deterministic, so
the trial budget the deflation needs is recorded rather than remembered.

One worker does one trial. It takes a run id and a trial index, reads the
prepared panel and spec from the store, and writes a summary and a per-bar
return series back. It holds no state and talks to nothing but the store:

    alpha_audit/runner/store.py      keys like runs/<id>/trials/7.json
    alpha_audit/runner/worker.py     ALPHA_AUDIT_RUN_ID + ALPHA_AUDIT_TRIAL
    alpha_audit/runner/dispatch.py   create / execute / finalise

That is the only thing the Azure port has to preserve. `LocalStore` becomes a
blob adapter over the same keys; the dispatcher's pool becomes a queue and a
Container Apps Job; the worker does not change.

Locally the dispatcher defaults to **threads**, switchable with
`ALPHA_AUDIT_EXECUTOR=process`. This development host is an HPC login node whose
cgroup caps the user at 500 tasks, and every spawned Polars runtime starts a
batch of threads of its own, so a six-process pool fails at import with EAGAIN.
Threads share one Polars runtime and Polars releases the GIL for this work, so
the fan-out is real. On Delta the honest way to use many cores is Slurm, not a
login-node pool — in Azure the question does not arise, because each worker is
its own container.

## The API

    GET  /healthz
    GET  /ops                    the signal language, for the expression builder
    POST /runs/preview           expand a spec and count the trials, without spending them
    POST /runs                   record the spec, launch the dispatcher, 202 + run id
    GET  /runs                   all runs, newest first
    GET  /runs/{id}              status + spec
    GET  /runs/{id}/trials       the trial table
    GET  /runs/{id}/audit        deflation, PBO, reality check, cost curve
    GET  /runs/{id}/cloud        IS vs OOS Sharpe per CSCV split -- the trial cloud
    GET  /runs/{id}/equity       the winner's net and gross equity curves

Never computes a run in-process: a POST records the spec and launches the
dispatcher separately. Reading results is open; submitting a run costs compute
and needs `ALPHA_AUDIT_TOKEN`. That single check is the entire authorisation
model, deliberately — see *deliberate omissions*.

## Run it

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q
    .venv/bin/python scripts/ingest.py --months 2023-12 2024-01
    .venv/bin/python scripts/run.py --label baseline      # fan out + audit
    .venv/bin/uvicorn api.main:app --reload               # the API on :8000
