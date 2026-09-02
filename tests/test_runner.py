"""End-to-end: spec -> fan-out -> audit, and the API surface around it."""
from __future__ import annotations

import polars as pl
import pytest
from fastapi.testclient import TestClient

from alpha_audit.runner.dispatch import create, execute
from alpha_audit.runner.spec import RunSpec
from alpha_audit.runner.store import LocalStore
from tests.synth import prepared


@pytest.fixture()
def store(tmp_path, monkeypatch):
    # Workers are separate processes; they find the store through the env.
    monkeypatch.setenv("ALPHA_AUDIT_RUNS_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("ALPHA_AUDIT_WORKERS", "2")
    return LocalStore()


def test_spec_expands_signs_and_params_into_a_counted_budget():
    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24, 72]))"], rebalances=[24])
    t = spec.trials()
    assert len(t) == 4                       # 2 windows x 2 signs x 1 rebalance
    assert [x.trial for x in t] == [0, 1, 2, 3]
    assert sum("neg(" in x.expr for x in t) == 2


def test_spec_rejects_an_unparseable_grid():
    with pytest.raises(ValueError):
        RunSpec(grids=["cs_zscore(nope(close, 1))"])


def test_run_end_to_end_produces_an_audit(store):
    spec = RunSpec(
        grids=["cs_zscore(ts_ret(close, [24, 72]))"],
        rebalances=[24], n_splits=4, n_blocks=8, n_boot=50,
    )
    st = create(spec, store, panel=prepared(hours=24 * 60))
    assert st.state == "queued" and st.n_trials == 4

    done = execute(st.run_id, store)
    assert done.state == "done", done.error
    assert done.n_done == 4

    trials = store.get_table(f"{st.run_id}/trials.parquet")
    assert trials.height == 4
    report = store.get_json(f"{st.run_id}/audit.json")
    assert set(report) >= {"winner", "deflation", "pbo", "search_null", "cost_curve"}
    assert 0.0 <= report["pbo"]["pbo"] <= 1.0
    assert 0.0 <= report["deflation"]["dsr"] <= 1.0
    assert 1.0 <= report["search_null"]["n_eff"] <= report["search_null"]["n_trials"] * 3
    # Synthetic data has no edge, so nothing should be allowed to survive.
    assert report["survives"] is False

    cloud = store.get_table(f"{st.run_id}/pbo_cloud.parquet")
    assert cloud.height == 70            # C(8,4)
    assert store.get_table(f"{st.run_id}/equity.parquet").height > 0


def test_api_surface(store):
    client = TestClient(__import__("api.main", fromlist=["app"]).app)
    assert client.get("/healthz").json()["ok"] is True
    assert "cs_zscore" in client.get("/ops").json()["cs_ops"]

    p = client.post("/runs/preview", json={"grids": ["cs_zscore(ts_ret(close, [1, 2, 3]))"],
                                          "rebalances": [24]}).json()
    assert p["n_trials"] == 6

    bad = client.post("/runs/preview", json={"grids": ["cs_zscore(bogus(close))"]})
    assert bad.status_code == 422        # DSL parse errors surface as validation

    assert client.get("/runs/nope/audit").status_code == 404
    assert client.get("/runs").json() == []
