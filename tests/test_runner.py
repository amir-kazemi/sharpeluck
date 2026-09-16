"""End-to-end: spec -> fan-out -> audit, and the API surface around it."""
from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import pytest
from fastapi.testclient import TestClient

from sharpeluck.runner.dispatch import SCHEMA_VERSION, create, execute
from sharpeluck.runner.spec import RunSpec
from sharpeluck.runner.store import LocalStore
from tests.synth import prepared


@pytest.fixture()
def store(tmp_path, monkeypatch):
    # Workers are separate processes; they find the store through the env.
    monkeypatch.setenv("SHARPELUCK_RUNS_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("SHARPELUCK_WORKERS", "2")
    monkeypatch.setenv("SHARPELUCK_BACKEND", "local")
    monkeypatch.delenv("SHARPELUCK_SUBMIT", raising=False)
    monkeypatch.delenv("SLURM_JOB_ID", raising=False)
    return LocalStore()


def test_spec_expands_signs_and_params_into_a_counted_budget():
    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24, 72]))"], rebalances=[24])
    t = spec.trials()
    assert len(t) == 4                       # 2 windows x 2 signs x 1 rebalance
    assert [x.trial for x in t] == [0, 1, 2, 3]
    assert sum("neg(" in x.expr for x in t) == 2


def test_the_universe_is_part_of_the_experiment(store):
    """Breadth is a research decision, so it belongs in the spec and in the
    recorded provenance -- an edge that exists only in the top 4 names by
    dollar volume is a different claim from one across the whole cross-section."""
    from sharpeluck.runner.spec import UniverseSpec

    panel = prepared(hours=24 * 60)
    narrow = RunSpec(grids=["cs_zscore(ts_ret(close, [24]))"], rebalances=[24],
                     universe=UniverseSpec(max_symbols=2, min_adv_usd=1.0))
    st = create(narrow, store, panel=panel)
    prov = store.get_json(f"{st.run_id}/status.json")["provenance"]
    assert prov["mean_universe_size"] > 0
    assert store.get_json(f"{st.run_id}/spec.json")["universe"]["max_symbols"] == 2


def test_a_single_trial_run_is_refused_up_front():
    """The form can express it, so the spec has to reject it: one trial gives
    CSCV nothing to rank and the reality check no maximum to take, and the run
    would otherwise start and then die inside the audit."""
    with pytest.raises(ValueError, match="at least 2 trials"):
        RunSpec(grids=["cs_zscore(ts_ret(close, 24))"], signs=["{}"], rebalances=[24])
    # ...but any of the three ways of widening it is accepted.
    assert len(RunSpec(grids=["cs_zscore(ts_ret(close, [24, 72]))"], signs=["{}"],
                       rebalances=[24]).trials()) == 2
    assert len(RunSpec(grids=["cs_zscore(ts_ret(close, 24))"],
                       rebalances=[24]).trials()) == 2
    assert len(RunSpec(grids=["cs_zscore(ts_ret(close, 24))"], signs=["{}"],
                       rebalances=[6, 24]).trials()) == 2


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


# The frontend reads these field names directly (web/src/api.ts). Renaming one
# in the runner without touching the other breaks a chart silently -- a missing
# key reads as `undefined` and plots as an empty panel, not an error.
FRONTEND_FIELDS = {
    "audit.deflation": {"n_trials", "n_obs", "sr_ann", "sr_trials_std_ann", "sr0_ann",
                        "skew", "kurtosis", "psr_vs_zero", "dsr"},
    "audit.pbo": {"pbo", "n_combinations", "n_blocks", "median_is_sharpe",
                  "median_oos_sharpe", "selection_premium", "prob_oos_loss",
                  "deterioration_slope"},
    "audit.search_null": {"n_boot", "mean_block", "sr0_ann", "sr0_ann_q95",
                          "sr_null_std_ann", "n_eff", "n_eff_participation",
                          "mean_abs_corr", "rc_p_value", "dsr"},
    "audit.cost_curve": {"points", "break_even_bps", "mean_turnover"},
}
TRIAL_FIELDS = {"trial", "expr", "rebalance_every_h", "cost_bps", "n_bars", "sharpe",
                "gross_sharpe", "is_sharpe", "oos_sharpe", "ann_return", "ann_vol",
                "max_drawdown", "hit_rate", "turnover_per_rebal", "break_even_bps"}


def test_result_shapes_match_what_the_frontend_reads(store):
    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24, 72]))"], rebalances=[24],
                   n_splits=4, n_blocks=8, n_boot=50)
    st = create(spec, store, panel=prepared(hours=24 * 90))
    assert execute(st.run_id, store).state == "done"

    report = store.get_json(f"{st.run_id}/audit.json")
    for path, fields in FRONTEND_FIELDS.items():
        section = report[path.split(".")[1]]
        assert fields <= set(section), f"{path} missing {fields - set(section)}"
    assert TRIAL_FIELDS <= set(report["winner"])
    assert isinstance(report["survives"], bool)
    # The UI gates on this; an unversioned artefact would render as a crash.
    assert report["schema_version"] == SCHEMA_VERSION
    # An audit without provenance is an audit of nothing in particular.
    prov = report["provenance"]
    assert prov["n_symbols_traded"] > 0 and prov["n_bars"] > 0
    assert prov["start"] < prov["end"]
    assert report["universe"]["max_symbols"] == spec.universe.max_symbols
    assert store.get_json(f"{st.run_id}/status.json")["schema_version"] == SCHEMA_VERSION
    assert {"cost_bps", "sharpe"} <= set(report["cost_curve"]["points"][0])

    assert TRIAL_FIELDS <= set(store.get_table(f"{st.run_id}/trials.parquet").columns)
    assert {"is_sharpe", "oos_sharpe", "logit", "is_sharpe_ann", "oos_sharpe_ann"} <= set(
        store.get_table(f"{st.run_id}/pbo_cloud.parquet").columns)
    assert {"ts", "equity", "equity_gross"} <= set(
        store.get_table(f"{st.run_id}/equity.parquet").columns)


def test_deleting_a_run_removes_its_artefacts(store):
    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24]))"], rebalances=[24])
    st = create(spec, store, panel=prepared(hours=24 * 45))
    assert store.exists(f"{st.run_id}/status.json")
    removed = store.delete_prefix(st.run_id)
    assert removed > 0
    assert not store.exists(f"{st.run_id}/status.json")
    assert store.delete_prefix("does-not-exist") == 0


def test_the_store_root_cannot_be_deleted(store):
    """A run id of '' or '.' must not take the whole store with it."""
    for bad in ("", ".", "./"):
        assert store.delete_prefix(bad) == 0
    with pytest.raises(ValueError):
        store.delete_prefix("../escape")


def test_store_rejects_a_sibling_with_the_same_name_prefix(store):
    with pytest.raises(ValueError, match="escapes"):
        store.put_json("../runs-other/file.json", {})


def test_relative_store_root_cannot_be_deleted(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    relative = LocalStore(root=Path("runs"))
    relative.put_json("keep.json", {"keep": True})
    assert relative.delete_prefix(".") == 0
    assert relative.exists("keep.json")


@pytest.mark.parametrize("fields", [
    {"cost_bps": -1}, {"cost_bps": float("inf")}, {"rebalances": [0]},
    {"rebalances": [5]}, {"rebalances": [48]}, {"rebalances": []},
    {"n_splits": 0}, {"n_blocks": 0}, {"n_blocks": 3}, {"n_boot": 0},
    {"mean_block_h": 0}, {"signs": ["bogus({})"]}, {"signs": ["{}{bad}"]},
])
def test_invalid_run_settings_are_rejected_before_launch(fields):
    with pytest.raises(ValueError):
        RunSpec(**fields)


def test_write_token_is_advertised_and_enforced(store, monkeypatch):
    import api.main as api

    client = TestClient(api.app)
    monkeypatch.setattr(api, "WRITE_TOKEN", "test-write-token")
    health = client.get("/healthz").json()
    assert health["write_token_required"] is True
    assert "test-write-token" not in str(health)
    assert client.get("/runs").status_code == 200
    assert client.post("/runs", json={}).status_code == 401
    assert client.delete("/runs/nope").status_code == 401
    assert client.delete("/runs/nope", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.delete("/runs/nope", headers={"Authorization": "Bearer test-write-token"}).status_code == 404
    monkeypatch.setattr(api, "WRITE_TOKEN", None)
    assert client.get("/healthz").json()["write_token_required"] is False


def test_delete_all_then_submit_and_complete_a_new_run(store, tmp_path, monkeypatch):
    """Use the normal data-loading path, with market data isolated in a tmpdir."""
    from types import SimpleNamespace
    import api.main as api
    from sharpeluck.ingest import silver
    from tests.synth import synth_panel

    monkeypatch.setattr(api, "WRITE_TOKEN", None)
    monkeypatch.setattr(silver, "SILVER", tmp_path / "silver")
    source = silver.SILVER / "klines_1h" / "bars.parquet"
    source.parent.mkdir(parents=True)
    synth_panel({"AAA": 5e6, "BBB": 3e6, "CCC": 9e6}, hours=24 * 60).write_parquet(source)
    # Execute synchronously below so the test waits for the actual audit.
    monkeypatch.setattr(api.subprocess, "Popen", lambda *a, **kw: SimpleNamespace(pid=os.getpid()))
    client = TestClient(api.app)
    spec = dict(grids=["cs_zscore(ts_ret(close, [24, 72]))"], rebalances=[24],
                n_splits=4, n_blocks=8, n_boot=30, cost_bps=3)
    for _ in range(2):
        assert client.get("/runs").json() == []
        submitted = client.post("/runs", json=spec)
        assert submitted.status_code == 202, submitted.text
        rid = submitted.json()["run_id"]
        assert client.delete(f"/runs/{rid}").status_code == 409
        done = execute(rid, store)
        assert done.state == "done", done.error
        assert client.get(f"/runs/{rid}/audit").status_code == 200
        assert client.delete(f"/runs/{rid}").status_code == 204
        assert client.get(f"/runs/{rid}/audit").status_code == 404
        assert source.exists()
    assert client.get("/runs").json() == []


def test_failed_launch_is_recorded(store, monkeypatch):
    import api.main as api

    st = create(RunSpec(), store, panel=prepared(hours=24 * 45))
    monkeypatch.setattr(api, "WRITE_TOKEN", None)
    monkeypatch.setattr(api, "create", lambda *a: st)

    def failed_launch(*args, **kwargs):
        raise OSError("launcher unavailable")

    monkeypatch.setattr(api.subprocess, "Popen", failed_launch)
    response = TestClient(api.app).post("/runs", json={})
    assert response.status_code == 202
    assert response.json()["state"] == "failed"
    assert "launcher unavailable" in response.json()["error"]
    assert store.get_json(f"{st.run_id}/status.json")["state"] == "failed"


def test_submission_does_not_prepare_data_in_the_api(store, monkeypatch):
    import api.main as api
    import sharpeluck.runner.dispatch as dispatch

    def forbidden():
        pytest.fail("API submission must not load market data")

    monkeypatch.setattr(dispatch, "load_panel", forbidden)
    monkeypatch.setattr(api, "WRITE_TOKEN", None)
    monkeypatch.setattr(api, "launch", lambda *a: {"backend": "slurm", "job_id": "123"})
    response = TestClient(api.app).post("/runs", json={})
    assert response.status_code == 202
    st = response.json()
    assert st["state"] == "queued" and st["job_id"] == "123"
    assert st["provenance"] is None
    assert not store.exists(f"{st['run_id']}/panel.parquet")


def test_launch_does_not_overwrite_worker_progress(store, monkeypatch):
    import api.main as api

    monkeypatch.setattr(api, "WRITE_TOKEN", None)

    def fast_worker(s, rid):
        data = s.get_json(f"{rid}/status.json")
        s.put_json(f"{rid}/status.json", {**data, "state": "running", "phase": "trials", "n_done": 2})
        return {"backend": "slurm", "job_id": "123"}

    monkeypatch.setattr(api, "launch", fast_worker)
    response = TestClient(api.app).post("/runs", json={}).json()
    assert response["state"] == "running" and response["n_done"] == 2
    assert store.get_json(f"{response['run_id']}/status.json")["n_done"] == 2


def test_data_preparation_errors_are_visible_as_failed_runs(store, monkeypatch):
    import sharpeluck.runner.dispatch as dispatch

    def missing_data():
        raise FileNotFoundError("No hourly market data")

    monkeypatch.setattr(dispatch, "load_panel", missing_data)
    st = create(RunSpec(), store)
    done = execute(st.run_id, store)
    assert done.state == done.phase == "failed"
    assert "No hourly market data" in done.error
    assert done.finished_at is not None


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


def test_a_dead_dispatcher_is_reported_rather_than_left_running(store, tmp_path):
    """A crashed dispatcher takes no status with it, so without this a run sits
    at `running` for ever and the UI shows nothing with no explanation."""
    from api.main import reconcile
    from sharpeluck.runner.spec import RunStatus

    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24]))"], rebalances=[24])
    st = create(spec, store, panel=prepared(hours=24 * 45))
    st.state = "running"
    st.pid = 2**22            # a pid that cannot be running
    store.put_json(f"{st.run_id}/dispatch.log", "MemoryError: out of memory")
    store.put_json(f"{st.run_id}/status.json", st.model_dump())

    back = reconcile(store, RunStatus.model_validate(
        store.get_json(f"{st.run_id}/status.json")))
    assert back.state == "failed"
    assert "exited after 0/2 trials" in (back.error or "")
    # ...and it is persisted, not just returned.
    assert store.get_json(f"{st.run_id}/status.json")["state"] == "failed"


def test_reconcile_leaves_live_and_finished_runs_alone(store):
    from api.main import reconcile
    from sharpeluck.runner.spec import RunStatus

    spec = RunSpec(grids=["cs_zscore(ts_ret(close, [24]))"], rebalances=[24])
    st = create(spec, store, panel=prepared(hours=24 * 45))

    live = RunStatus.model_validate({**st.model_dump(), "state": "running",
                                     "pid": os.getpid()})
    assert reconcile(store, live).state == "running"

    done = RunStatus.model_validate({**st.model_dump(), "state": "done", "pid": 2**22})
    assert reconcile(store, done).state == "done"

    unowned = RunStatus.model_validate({**st.model_dump(), "state": "running",
                                        "pid": None})
    assert reconcile(store, unowned).state == "running"
