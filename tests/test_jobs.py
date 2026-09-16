"""Compute launch and monitoring, without submitting real cluster jobs."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import time

import pytest

from sharpeluck.runner import jobs, worker
from sharpeluck.runner.dispatch import create
from sharpeluck.runner.spec import RunSpec
from sharpeluck.runner.store import LocalStore


@pytest.fixture
def run(tmp_path, monkeypatch):
    monkeypatch.setenv("SHARPELUCK_BACKEND", "slurm")
    monkeypatch.delenv("SHARPELUCK_SUBMIT", raising=False)
    jobs._slurm_state.cache_clear()
    store = LocalStore(tmp_path / "runs")
    return store, create(RunSpec(), store)


def test_slurm_launch_captures_job_id_and_uses_shared_store(run, monkeypatch):
    store, st = run
    calls = []

    def submit(cmd, **kw):
        calls.append((cmd, kw))
        return SimpleNamespace(stdout="12345;cluster\n", returncode=0)

    monkeypatch.setattr(jobs.subprocess, "run", submit)
    execution = jobs.launch(store, st.run_id)
    cmd, kw = calls[0]
    assert cmd[0] == "sbatch" and "--parsable" in cmd
    assert kw["env"]["RUN_ID"] == st.run_id
    assert kw["env"]["SHARPELUCK_RUNS_ROOT"] == str(store.root)
    assert f"--output={store.root / st.run_id / 'dispatch.log'}" in cmd
    assert execution["job_id"] == "12345"
    assert store.get_json(f"{st.run_id}/execution.json")["job_id"] == "12345"
    assert store.get_json(f"{st.run_id}/status.json")["state"] == "queued"


def test_failed_sbatch_is_not_recorded_as_a_running_job(run, monkeypatch):
    store, st = run

    def rejected(*a, **kw):
        raise subprocess.CalledProcessError(1, a[0], stderr="Invalid account")

    monkeypatch.setattr(jobs.subprocess, "run", rejected)
    with pytest.raises(subprocess.CalledProcessError):
        jobs.launch(store, st.run_id)
    assert not store.exists(f"{st.run_id}/execution.json")


def test_scheduler_status_uses_accounting_after_job_leaves_queue(monkeypatch):
    jobs._slurm_state.cache_clear()
    calls = []

    def scheduler(cmd, **kw):
        calls.append(cmd[0])
        output = "" if cmd[0] == "squeue" else "123|OUT_OF_MEMORY|0:9\n123.batch|FAILED|0:9\n"
        return SimpleNamespace(stdout=output, returncode=0)

    monkeypatch.setattr(jobs.subprocess, "run", scheduler)
    assert jobs._slurm_state("123", 0) == ("OUT_OF_MEMORY", "exit 0:9")
    assert jobs._slurm_state("123", 0) == ("OUT_OF_MEMORY", "exit 0:9")
    assert calls == ["squeue", "sacct"]


@pytest.mark.parametrize("state", ["OUT_OF_MEMORY", "TIMEOUT", "CANCELLED", "FAILED", "COMPLETED"])
def test_terminal_scheduler_state_clears_false_running_status(run, monkeypatch, state):
    store, st = run
    st.state, st.n_done = "running", 2
    store.put_json(f"{st.run_id}/status.json", st.model_dump())
    store.put_json(f"{st.run_id}/execution.json", {"backend": "slurm", "job_id": "123"})
    monkeypatch.setattr(jobs, "_slurm_state", lambda *a: (state, "exit 0:9"))
    result = jobs.reconcile(store, st)
    assert result.state == "failed"
    assert state in result.error and "2/20 trials" in result.error
    assert result.finished_at is not None


def test_pending_slurm_job_reports_reason_without_checking_remote_pid(run, monkeypatch):
    store, st = run
    st.pid = 9876543
    store.put_json(f"{st.run_id}/execution.json", {"backend": "slurm", "job_id": "123"})
    monkeypatch.setattr(jobs, "_slurm_state", lambda *a: ("PENDING", "Resources"))
    monkeypatch.setattr(jobs, "_alive", lambda *a: pytest.fail("remote PID must not be checked locally"))
    result = jobs.reconcile(store, st)
    assert result.state == "queued" and result.queue_reason == "Resources"


def test_scheduler_unavailable_does_not_mark_a_job_failed(run, monkeypatch):
    store, st = run
    store.put_json(f"{st.run_id}/execution.json", {"backend": "slurm", "job_id": "123"})
    monkeypatch.setattr(jobs, "_slurm_state", lambda *a: None)
    assert jobs.reconcile(store, st).state == "queued"


def test_completed_worker_wins_over_stale_scheduler_poll(run, monkeypatch):
    store, st = run
    store.put_json(f"{st.run_id}/execution.json", {"backend": "slurm", "job_id": "123"})
    store.put_json(f"{st.run_id}/status.json", {**st.model_dump(), "state": "done"})
    monkeypatch.setattr(jobs, "_slurm_state", lambda *a: ("COMPLETED", "exit 0:0"))
    assert jobs.reconcile(store, st).state == "done"


def test_a_zombie_is_not_an_alive_worker():
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    try:
        for _ in range(100):
            stat = Path(f"/proc/{proc.pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
            if stat == "Z":
                break
            time.sleep(0.01)
        assert not jobs._alive(proc.pid)
    finally:
        proc.wait(timeout=5)


def test_parallel_trials_load_only_one_copy_of_the_panel(monkeypatch):
    loads = []
    panel = object()

    def read(key):
        loads.append(key)
        time.sleep(0.02)  # Make concurrent cache misses overlap.
        return panel

    store = SimpleNamespace(get_table=read)
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: worker.panel_for(store, "shared-test"), range(4)))
        assert all(p is panel for p in results)
        assert loads == ["shared-test/panel.parquet"]
    finally:
        worker.clear_panel("shared-test")
