"""End-to-end: spec -> fan-out -> audit, and the API surface around it."""
from __future__ import annotations

import polars as pl
import pytest
from fastapi.testclient import TestClient

from alpha_audit.runner.dispatch import SCHEMA_VERSION, create, execute
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


def test_the_universe_is_part_of_the_experiment(store):
    """Breadth is a research decision, so it belongs in the spec and in the
    recorded provenance -- an edge that exists only in the top 4 names by
    dollar volume is a different claim from one across the whole cross-section."""
    from alpha_audit.runner.spec import UniverseSpec

    panel = prepared(hours=24 * 60)
    narrow = RunSpec(grids=["cs_zscore(ts_ret(close, [24]))"], rebalances=[24],
                     universe=UniverseSpec(max_symbols=2, min_adv_usd=1.0))
    st = create(narrow, store, panel=panel)
    prov = store.get_json(f"{st.run_id}/status.json")["provenance"]
    assert prov["mean_universe_size"] > 0
    assert store.get_json(f"{st.run_id}/spec.json")["universe"]["max_symbols"] == 2


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
