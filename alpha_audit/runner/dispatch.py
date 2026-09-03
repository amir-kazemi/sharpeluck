"""Create, execute and finalise a run.

`create` prepares the panel once and records the spec. `execute` fans the trials
out across a local process pool -- the stand-in for an Azure queue plus
Container Apps Jobs, which is why workers are handed a run id and a trial index
rather than data. `finalise` assembles the trial table and runs the audit.
"""
from __future__ import annotations

import multiprocessing
import os
import secrets
import sys
import traceback
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
import polars as pl

from ..config import GOLD
from ..ingest.silver import load_panel
from ..research.audit import cost_curve, deflate, pbo, search_null
from ..research.backtest import HOURS_PER_YEAR
from ..research.signals import prepare_panel
from ..research.universe import build_universe
from .spec import Provenance, RunSpec, RunStatus
from .store import LocalStore, ResultStore
from .worker import run_one

# Bump when the shape of a run's stored artefacts changes. 1: initial.
# 2: audit.json gained search_null (replacing reality_check). 3: pbo_cloud gained
# annualised columns. 4: the universe became a run parameter and runs carry
# provenance.
SCHEMA_VERSION = 4

MAX_WORKERS = int(os.environ.get("ALPHA_AUDIT_WORKERS", "6"))

# Threads by default, processes on request.
#
# The seam that matters for the cloud port is the *worker*: it takes a run id
# and a trial index, reads the panel and spec from the store, and writes results
# back. How the local dispatcher invokes it is deliberately swappable, because
# in Azure it is not invoked locally at all -- a queue message starts a
# container.
#
# Threads are the local default because this development host is an HPC login
# node whose cgroup caps the user at 500 tasks (user.slice/.../pids.max), and
# every spawned Polars runtime starts a batch of threads of its own; six of them
# fail at import with EAGAIN. Threads share one Polars runtime, and Polars
# releases the GIL for the work that matters here, so the fan-out is real.
# On the Illinois Campus Cluster the honest way to use many cores is Slurm,
# not a login-node pool.
EXECUTOR = os.environ.get("ALPHA_AUDIT_EXECUTOR", "thread")
POLARS_THREADS = os.environ.get("ALPHA_AUDIT_POLARS_THREADS", "2")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _provenance(panel: pl.DataFrame, rules) -> Provenance:
    live = panel.filter(pl.col("in_universe"))
    per_bar = live.group_by("ts").len()
    return Provenance(
        bar="1h",
        start=str(panel["ts"].min()),
        end=str(panel["ts"].max()),
        n_bars=panel["ts"].n_unique(),
        n_symbols_available=panel["symbol"].n_unique(),
        n_symbols_traded=live["symbol"].n_unique(),
        mean_universe_size=float(per_bar["len"].mean() or 0.0),
        n_rebalances=live.select(
            pl.col("ts").dt.truncate(f"{rules.rebalance_every_h}h")).n_unique(),
    )


def create(spec: RunSpec, store: ResultStore, panel: pl.DataFrame | None = None) -> RunStatus:
    run_id = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"
    trials = spec.trials()
    rules = spec.universe.to_rules()
    if panel is None:
        # The universe is rebuilt per run from silver rather than read from a
        # pre-baked file, because it is now part of the experiment.
        bars = load_panel()
        panel = prepare_panel(bars, build_universe(bars, rules), rules)
    prov = _provenance(panel, rules)
    store.put_table(f"{run_id}/panel.parquet", panel)
    store.put_json(f"{run_id}/spec.json", spec.model_dump())
    st = RunStatus(run_id=run_id, state="queued", n_trials=len(trials),
                   label=spec.label, created_at=_now(),
                   schema_version=SCHEMA_VERSION, provenance=prov)
    store.put_json(f"{run_id}/status.json", st.model_dump())
    return st


def _status(store: ResultStore, run_id: str) -> RunStatus:
    return RunStatus.model_validate(store.get_json(f"{run_id}/status.json"))


def _save(store: ResultStore, st: RunStatus) -> None:
    store.put_json(f"{st.run_id}/status.json", st.model_dump())


def _one(run_id: str, i: int) -> int:
    """One unit of work, identical whether a thread, a process or a container
    calls it: everything it needs is addressed by (run_id, trial index)."""
    store = LocalStore()
    spec = RunSpec.model_validate(store.get_json(f"{run_id}/spec.json"))
    run_one(store, run_id, spec.trials()[i], spec)
    return i


def _pool():
    if EXECUTOR == "process":
        # spawn, not fork: Polars keeps a live Rayon thread pool and forking a
        # process with running threads deadlocks the child.
        os.environ["POLARS_MAX_THREADS"] = POLARS_THREADS   # read at child import
        return ProcessPoolExecutor(
            max_workers=MAX_WORKERS, mp_context=multiprocessing.get_context("spawn")
        )
    return ThreadPoolExecutor(max_workers=MAX_WORKERS)


def execute(run_id: str, store: ResultStore) -> RunStatus:
    st = _status(store, run_id)
    spec = RunSpec.model_validate(store.get_json(f"{run_id}/spec.json"))
    st.state = "running"
    _save(store, st)
    try:
        with _pool() as ex:
            futs = [ex.submit(_one, run_id, t.trial) for t in spec.trials()]
            for f in as_completed(futs):
                f.result()
                st.n_done += 1
                _save(store, st)
        finalise(run_id, store)
        st.state, st.finished_at = "done", _now()
    except Exception:
        st.state, st.error, st.finished_at = "failed", traceback.format_exc(), _now()
    _save(store, st)
    return st


def finalise(run_id: str, store: ResultStore) -> dict:
    spec = RunSpec.model_validate(store.get_json(f"{run_id}/spec.json"))
    trials = spec.trials()
    rows = [store.get_json(f"{run_id}/trials/{t.trial}.json") for t in trials]
    table = pl.DataFrame(rows).sort("is_sharpe", descending=True, nulls_last=True)
    store.put_table(f"{run_id}/trials.parquet", table)

    series = [
        store.get_table(f"{run_id}/series/{t.trial}.parquet")
        .select("ts", "gross", "net", "turnover")
        .with_columns(pl.lit(t.trial).alias("trial"))
        for t in trials
    ]
    allser = pl.concat(series)
    store.put_table(f"{run_id}/series.parquet", allser)

    wide = allser.pivot(on="trial", index="ts", values="net").sort("ts")
    cols = [c for c in wide.columns if c != "ts"]
    m = wide.select(cols).fill_null(0.0).to_numpy()

    winner = table.row(0, named=True)
    wcol = cols.index(str(winner["trial"]))
    wr = allser.filter(pl.col("trial") == winner["trial"]).sort("ts")
    d = deflate(m[:, wcol], table.sort("trial")["sharpe"].to_numpy(), HOURS_PER_YEAR)
    pb, cloud = pbo(m, n_blocks=spec.n_blocks)
    # One bootstrap pass gives the reality-check p-value, the measured
    # expected-best-Sharpe under the null, and the effective number of
    # independent trials -- so the deflation no longer has to assume the 44
    # trials were 44 independent looks.
    sn = search_null(m, wcol, HOURS_PER_YEAR, n_boot=spec.n_boot,
                     mean_block=spec.mean_block_h)
    cc = cost_curve(wr["gross"].to_numpy(), wr["turnover"].to_numpy(),
                    ann_periods=HOURS_PER_YEAR)

    report = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "provenance": _status(store, run_id).provenance.model_dump()
        if _status(store, run_id).provenance else None,
        "universe": spec.universe.model_dump(),
        "winner": winner,
        "deflation": d.as_dict(),
        "pbo": pb.as_dict(),
        "search_null": sn.as_dict(),
        "cost_curve": cc,
        # Judged on the measured null, not the analytic one.
        "survives": bool(sn.dsr > 0.95 and pb.pbo < 0.3 and sn.rc_p_value < 0.05),
    }
    store.put_json(f"{run_id}/audit.json", report)
    # Annualised alongside per-bar: the frontend should not have to know the
    # bar frequency to label an axis.
    ann = HOURS_PER_YEAR**0.5
    store.put_table(f"{run_id}/pbo_cloud.parquet", pl.DataFrame({
        "is_sharpe": cloud[:, 0], "oos_sharpe": cloud[:, 1], "logit": cloud[:, 2],
        "is_sharpe_ann": cloud[:, 0] * ann, "oos_sharpe_ann": cloud[:, 1] * ann}))
    equity = wr.select(
        "ts", (1.0 + pl.col("net").fill_null(0.0)).cum_prod().alias("equity"),
        (1.0 + pl.col("gross").fill_null(0.0)).cum_prod().alias("equity_gross"))
    store.put_table(f"{run_id}/equity.parquet", equity)
    return report


def main() -> int:
    """`python -m alpha_audit.runner.dispatch <run_id>` -- what the API launches
    locally, and what a queue message triggers in the cloud."""
    execute(sys.argv[1], LocalStore())
    return 0


if __name__ == "__main__":
    sys.exit(main())
