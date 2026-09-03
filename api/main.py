"""The research API.

Reads and writes nothing but the store, and never computes a run in-process: a
POST records the spec and launches the dispatcher as a separate process. In
Azure that launch becomes a queue message and the dispatcher becomes a
Container Apps Job, which is the only line that changes.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from alpha_audit.research import dsl
from alpha_audit.runner.dispatch import create
from alpha_audit.runner.spec import RunSpec, RunStatus
from alpha_audit.runner.store import LocalStore, ResultStore

REPO_ROOT = Path(__file__).resolve().parents[1]
# Submitting a run costs compute; reading results does not. One token, checked
# on writes only, is the whole authorisation model -- see the README.
WRITE_TOKEN = os.environ.get("ALPHA_AUDIT_TOKEN")

app = FastAPI(
    title="alpha-audit",
    summary="How much of your Sharpe is selection bias?",
    version="0.3.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def store() -> ResultStore:
    return LocalStore()


def require_write(authorization: str | None = Header(default=None)) -> None:
    if not WRITE_TOKEN:
        return                                  # open in local development
    if authorization != f"Bearer {WRITE_TOKEN}":
        raise HTTPException(401, "a write token is required to submit runs")


def _need(s: ResultStore, key: str):
    if not s.exists(key):
        raise HTTPException(404, f"not found: {key}")
    return key


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "version": app.version}


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
    """Expand a spec without running it, so the UI can show the trial budget
    before anyone spends it."""
    t = spec.trials()
    return {"n_trials": len(t), "trials": [x.model_dump() for x in t]}


@app.post("/runs", status_code=202)
def submit(spec: RunSpec, s: ResultStore = Depends(store),
           _: None = Depends(require_write)) -> RunStatus:
    st = create(spec, s)
    subprocess.Popen(
        [sys.executable, "-m", "alpha_audit.runner.dispatch", st.run_id],
        cwd=REPO_ROOT, start_new_session=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return st


@app.get("/runs")
def list_runs(s: ResultStore = Depends(store)) -> list[RunStatus]:
    out = []
    for key in s.list_keys(""):
        if key.endswith("status.json"):
            out.append(RunStatus.model_validate(s.get_json(key)))
    return sorted(out, key=lambda r: r.created_at, reverse=True)


@app.get("/runs/{run_id}")
def get_run(run_id: str, s: ResultStore = Depends(store)) -> dict:
    st = s.get_json(_need(s, f"{run_id}/status.json"))
    return {"status": st, "spec": s.get_json(f"{run_id}/spec.json")}


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
    _need(s, f"{run_id}/status.json")
    s.delete_prefix(run_id)
    return Response(status_code=204)


@app.get("/runs/{run_id}/equity")
def get_equity(run_id: str, s: ResultStore = Depends(store)) -> list[dict]:
    return s.get_table(_need(s, f"{run_id}/equity.parquet")).to_dicts()
