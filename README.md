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

Four independent tests, plus the quantities they are built from:

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

## The result — 723 symbols, 4.6 years, 44 trials

Bronze holds 21,175 monthly archives (24.9 GB, ~915M one-minute bars) covering
every USDT pair the archive has ever listed from 2022-01 to 2026-07. The hourly
panel is 15.3M bars over 678 symbols; **410 distinct symbols pass through a
top-50 universe**, so the cross-section turns over eight times across the sample.

The in-sample winner is a **low-volatility factor** — long the calmest names in
the universe, short the most volatile, measured over 72 hours and rebalanced
daily:

    net Sharpe                 +1.32     gross +1.39
    E[best] under the null     +0.81     (+2.20 if the 44 trials were independent)
    Deflated Sharpe             0.830
    PBO                         0.024     P(OOS loss) 0.067
    Reality check p             0.029
    effective trials            18.5 of 44
    break-even cost           102.1 bps   against 5 bps charged

**Three of the four lenses pass. The deflated Sharpe does not: 0.83 is not 0.95.**
So the verdict is still *does not survive*, but for a much more interesting
reason than the 10-month sample, where the winner was noise outright.

Two things make this more than a lucky corner of the grid. The whole low-vol
family clusters at the top — every `ts_std` variant, at both rebalance
frequencies, scores in-sample 0.91–1.15 and out-of-sample 1.29–1.51 — and the
edge is not a disguised market bet: regressed on the equal-weighted market its
**beta is +0.000** and the market-neutralised Sharpe is unchanged at 1.32.

And two reasons to keep it in the "candidate" column. Low volatility is a
*documented* factor, so rediscovering it is evidence the platform works, not
evidence of a new find. And the backtest assumes the short leg is free to
borrow: shorting the most volatile alt-coins on spot is often impossible, and on
perpetuals it carries a funding cost this model does not charge. The 102 bps of
break-even headroom is real, but it is headroom against *spread*, not against
borrow.

## Does the platform work? — the null-data self-test

Every result here is a claim about a method, and the only way to check a method
is to point it at data whose answer you already know.

`scripts/null_test.py` generates panels with the statistical character of the
real one — a common market factor, per-symbol betas, matched idiosyncratic
volatility, Student-t innovations because real crypto returns had kurtosis 41 —
and **no cross-sectional predictability at all**. It then runs the entire
research path over them: universe construction → feature panel → signal DSL →
backtest → audit. A correct platform must return nothing.

Over 20 such datasets it returned nothing, 20 times. But the interesting part is
what each lens would have concluded *on its own*:

| Lens, used alone | Said yes on data with no edge |
|---|---|
| "Sharpe above 1.0, ship it" | **7 / 20** |
| PBO < 0.30 | **11 / 20** |
| Deflated Sharpe > 0.95 | 0 / 20 |
| Reality check p < 0.05 | 0 / 20 |
| all three together (the verdict) | 0 / 20 |

The best Sharpe pure noise produced was **+2.51**, and the lowest PBO was
**0.004** — a number that reads as a spectacular result.

**PBO is the weakest lens on this trial family, and it is worth understanding
why.** PBO measures the *stability* of selection, not the *existence* of edge.
This grid contains every signal beside its exact negation plus nested horizons,
so in any single realisation one direction is consistently better across the
whole sample by luck alone — consistently enough that the in-sample winner keeps
winning out of sample, which is exactly what a low PBO reports. It is not a
defect in the implementation; it is what the statistic measures. The deflated
Sharpe and the reality check are what actually did the rejecting here, and this
is the concrete reason the platform reports four independent lenses rather than
the one everybody quotes.

## Run it

    . scripts/env.sh
    pytest -q
    python scripts/ingest.py --months 2023-12 2024-01
    python scripts/run.py --label baseline                        # fan out + audit
    uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload    # API  :8000
    cd web && npm run dev                                         # UI   :5173
