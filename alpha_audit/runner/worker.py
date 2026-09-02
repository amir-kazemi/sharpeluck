"""One trial, start to finish. This is the container entrypoint.

    ALPHA_AUDIT_RUN_ID=... ALPHA_AUDIT_TRIAL=7 python -m alpha_audit.runner.worker

Reads the prepared panel and its trial spec from the store, backtests, writes
the summary and the per-bar series back. It holds no state and talks to nothing
but the store, which is what lets the same image run behind a local process pool
or an Azure queue.
"""
from __future__ import annotations

import os
import sys

import polars as pl

from ..research.backtest import BacktestParams, WalkForward, run_trial
from .spec import RunSpec, TrialSpec
from .store import LocalStore, ResultStore

_PANEL: dict[str, pl.DataFrame] = {}   # per-process cache; the panel is immutable


def panel_for(store: ResultStore, run_id: str) -> pl.DataFrame:
    if run_id not in _PANEL:
        _PANEL[run_id] = store.get_table(f"{run_id}/panel.parquet")
    return _PANEL[run_id]


def run_one(store: ResultStore, run_id: str, trial: TrialSpec, spec: RunSpec) -> dict:
    row = run_trial(
        panel_for(store, run_id),
        trial.expr,
        BacktestParams(trial.rebalance_every_h, trial.cost_bps),
        WalkForward(n_splits=spec.n_splits),
        keep_series=True,
    )
    series = row.pop("series")
    row = {"trial": trial.trial, **row}
    store.put_json(f"{run_id}/trials/{trial.trial}.json", row)
    store.put_table(f"{run_id}/series/{trial.trial}.parquet", series)
    return row


def main() -> int:
    run_id = os.environ["ALPHA_AUDIT_RUN_ID"]
    i = int(os.environ["ALPHA_AUDIT_TRIAL"])
    store = LocalStore()
    spec = RunSpec.model_validate(store.get_json(f"{run_id}/spec.json"))
    run_one(store, run_id, spec.trials()[i], spec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
