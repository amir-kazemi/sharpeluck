"""The research API.

A POST records the spec and submits a compute job. Data preparation, trials
and audit calculations all run in that job, outside the HTTP server.
"""
from __future__ import annotations

import os
import subprocess

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from sharpeluck.research import dsl
from sharpeluck.runner.dispatch import create
from sharpeluck.runner.jobs import backend, fail, launch, reconcile
from sharpeluck.runner.spec import RunSpec, RunStatus
from sharpeluck.runner.store import LocalStore, ResultStore

# Submitting a run costs compute; reading results does not. One token, checked
# on writes only, is the whole authorisation model -- see the README.
WRITE_TOKEN = os.environ.get("SHARPELUCK_TOKEN")

app = FastAPI(
    title="SharpeLuck",
    summary="Is your crypto strategy just lucky?",
    version="0.3.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def store() -> LocalStore:
    return LocalStore()


def require_write(authorization: str | None = Header(default=None)) -> None:
    if not WRITE_TOKEN:
        return                                  # open in local development
    if authorization != f"Bearer {WRITE_TOKEN}":
        raise HTTPException(401, "a valid write token is required to submit or delete runs")


def _need(s: ResultStore, key: str):
    if not s.exists(key):
        raise HTTPException(404, f"not found: {key}")
    return key


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "version": app.version,
            "write_token_required": bool(WRITE_TOKEN), "runner": backend()}


@app.get("/ops")
def ops() -> dict:
    """The signal language, for the frontend's expression builder."""
    return {
        "fields": sorted(dsl.FIELDS),
        "ts_ops": sorted(dsl.TS_OPS),
        "cs_ops": sorted(dsl.CS_OPS),
        "unary_ops": sorted(dsl.UNARY_OPS),
        "param_ops": sorted(dsl.PARAM_OPS),
    }


@app.post("/runs/preview")
def preview(spec: RunSpec) -> dict:
    """Expand a spec without running it, so the UI can show the trial budget --
    and where it came from -- before anyone spends it."""
    t = spec.trials()
    n_expr = sum(len(dsl.expand(g)) for g in spec.grids)
    return {
        "n_trials": len(t),
        "breakdown": {
            "expressions": n_expr,
            "signs": len(spec.signs),
            "rebalances": len(spec.rebalances),
        },
        "trials": [x.model_dump() for x in t],
    }


@app.post("/runs", status_code=202)
def submit(spec: RunSpec, s: LocalStore = Depends(store),
           _: None = Depends(require_write)) -> RunStatus:
    st = create(spec, s)
    try:
        execution = launch(s, st.run_id)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        detail = exc.stderr if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        return fail(s, st.run_id, f"Could not launch the run: {detail or exc}")
    # The job may already be preparing data. Never write this older queued
    # snapshot over the worker's status.
    st = RunStatus.model_validate(s.get_json(f"{st.run_id}/status.json"))
    st.backend, st.job_id, st.pid = execution["backend"], execution.get("job_id"), execution.get("pid")
    return st


@app.get("/runs")
def list_runs(s: ResultStore = Depends(store)) -> list[RunStatus]:
    out = []
    for key in s.list_keys(""):
        if key.endswith("status.json"):
            out.append(reconcile(s, RunStatus.model_validate(s.get_json(key))))
    return sorted(out, key=lambda r: r.created_at, reverse=True)


@app.get("/runs/{run_id}")
def get_run(run_id: str, s: ResultStore = Depends(store)) -> dict:
    st = reconcile(s, RunStatus.model_validate(
        s.get_json(_need(s, f"{run_id}/status.json"))))
    return {"status": st.model_dump(), "spec": s.get_json(f"{run_id}/spec.json")}


@app.get("/runs/{run_id}/trials")
def get_trials(run_id: str, s: ResultStore = Depends(store)) -> list[dict]:
    return s.get_table(_need(s, f"{run_id}/trials.parquet")).to_dicts()


@app.get("/runs/{run_id}/audit")
def get_audit(run_id: str, s: ResultStore = Depends(store)) -> dict:
    return s.get_json(_need(s, f"{run_id}/audit.json"))


@app.get("/runs/{run_id}/cloud")
def get_cloud(run_id: str, s: ResultStore = Depends(store)) -> list[dict]:
    """The trial cloud: in-sample vs out-of-sample Sharpe for every CSCV split."""
    return s.get_table(_need(s, f"{run_id}/pbo_cloud.parquet")).to_dicts()


@app.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: str, s: ResultStore = Depends(store),
               _: None = Depends(require_write)) -> Response:
    """Discard a run and its artefacts. Write-gated like submission: a run is
    tens of megabytes of stored panel, but deleting one is not reversible."""
    st = reconcile(s, RunStatus.model_validate(
        s.get_json(_need(s, f"{run_id}/status.json"))))
    if st.state in ("queued", "running"):
        raise HTTPException(409, "Wait for the run to finish before deleting it.")
    s.delete_prefix(run_id)
    return Response(status_code=204)


@app.get("/runs/{run_id}/equity")
def get_equity(run_id: str, s: ResultStore = Depends(store)) -> list[dict]:
    return s.get_table(_need(s, f"{run_id}/equity.parquet")).to_dicts()
