"""Launch and monitor a run independently of the HTTP server.

Execution metadata is separate from status.json: the launcher must never
overwrite progress written by a worker that has already started.
"""
from __future__ import annotations

import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from ..config import REPO_ROOT
from .spec import RunStatus
from .store import LocalStore, ResultStore


def backend() -> str:
    choice = os.environ.get("SHARPELUCK_BACKEND")
    if choice is None:
        choice = "slurm" if os.environ.get("SHARPELUCK_SUBMIT") or shutil.which("sbatch") else "local"
    if choice not in {"local", "slurm"}:
        raise ValueError("SHARPELUCK_BACKEND must be local or slurm")
    return choice


def launch(s: LocalStore, run_id: str) -> dict:
    mode = backend()
    log_path = s.root.resolve() / run_id / "dispatch.log"
    env = {**os.environ, "RUN_ID": run_id,
           "SHARPELUCK_RUNS_ROOT": str(s.root.resolve())}
    execution = {"backend": mode, "host": socket.gethostname()}
    if mode == "slurm":
        custom = os.environ.get("SHARPELUCK_SUBMIT")
        cmd = shlex.split(custom.format(run_id=run_id)) if custom else [
            "sbatch", str(REPO_ROOT / "slurm/dispatch.sbatch")]
        if not cmd or Path(cmd[0]).name != "sbatch":
            raise ValueError("SHARPELUCK_SUBMIT must invoke sbatch")
        # CLI options override script defaults; all output belongs to this run.
        cmd[1:1] = ["--parsable", f"--output={log_path}", f"--error={log_path}",
                    "--open-mode=append", f"--chdir={REPO_ROOT}"]
        result = subprocess.run(cmd, cwd=REPO_ROOT, env=env, capture_output=True,
                                text=True, timeout=30, check=True)
        job_id = result.stdout.strip().split(";", 1)[0]
        if not re.fullmatch(r"\d+", job_id):
            raise ValueError(f"Slurm did not return a job ID: {result.stdout.strip()}")
        execution["job_id"] = job_id
    else:
        with log_path.open("ab", buffering=0) as handle:
            proc = subprocess.Popen(
                [sys.executable, "-m", "sharpeluck.runner.dispatch", run_id],
                cwd=REPO_ROOT, env=env, start_new_session=True,
                stdout=handle, stderr=subprocess.STDOUT,
            )
        execution["pid"] = proc.pid
    s.put_json(f"{run_id}/execution.json", execution)
    return execution


def _alive(pid: int) -> bool:
    try:
        # Reap a local child if it has exited. kill(pid, 0) alone treats zombies
        # as alive, which previously left killed runs displaying "running".
        try:
            ended, _ = os.waitpid(pid, os.WNOHANG)
            if ended:
                return False
        except ChildProcessError:
            pass
        os.kill(pid, 0)
        stat = Path(f"/proc/{pid}/stat")
        if stat.exists() and stat.read_text().rsplit(")", 1)[1].split()[0] in {"Z", "X"}:
            return False
    except ProcessLookupError:
        return False
    except FileNotFoundError:
        return False
    except PermissionError:
        return True
    return True


@lru_cache(maxsize=128)
def _slurm_state(job_id: str, time_bucket: int) -> tuple[str, str] | None:
    """Consult Slurm at most once per job per ten seconds, across UI polls."""
    try:
        q = subprocess.run(["squeue", "--noheader", "--jobs", job_id,
                            "--format=%T|%R"], capture_output=True, text=True, timeout=5)
        if q.returncode == 0 and q.stdout.strip():
            state, _, reason = q.stdout.strip().splitlines()[0].partition("|")
            return state, reason
        # Finished jobs disappear from squeue; accounting retains the outcome.
        a = subprocess.run(["sacct", "--noheader", "--parsable2", "--jobs", job_id,
                            "--format=JobIDRaw,State,ExitCode"],
                           capture_output=True, text=True, timeout=5)
        if a.returncode == 0:
            for row in a.stdout.splitlines():
                fields = row.split("|")
                if len(fields) >= 3 and fields[0] == job_id:
                    return fields[1].split()[0].rstrip("+"), f"exit {fields[2]}"
    except (OSError, subprocess.TimeoutExpired):
        pass
    # A scheduler outage or accounting delay is not evidence the job died.
    return None


def _log_tail(s: ResultStore, run_id: str) -> str:
    if isinstance(s, LocalStore):
        try:
            with (s.root / run_id / "dispatch.log").open("rb") as f:
                f.seek(0, 2)
                f.seek(max(0, f.tell() - 4000))
                return f.read().decode(errors="replace")
        except OSError:
            pass
    return ""


def fail(s: ResultStore, run_id: str, reason: str) -> RunStatus:
    # Read afresh in case a worker finished while the scheduler was queried.
    st = RunStatus.model_validate(s.get_json(f"{run_id}/status.json"))
    if st.state in {"done", "failed"}:
        return st
    st.state = st.phase = "failed"
    st.finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    st.error = reason
    tail = _log_tail(s, run_id)
    if tail:
        st.error += f"\n\n{tail}"
    s.put_json(f"{run_id}/status.json", st.model_dump())
    return st


def reconcile(s: ResultStore, st: RunStatus) -> RunStatus:
    key = f"{st.run_id}/execution.json"
    execution = s.get_json(key) if s.exists(key) else {}
    st.backend = execution.get("backend", st.backend)
    st.job_id = execution.get("job_id", st.job_id)
    st.pid = execution.get("pid", st.pid)
    if st.state not in {"queued", "running"}:
        return st
    if st.job_id:
        result = _slurm_state(st.job_id, int(time.monotonic() // 10))
        if result:
            state, reason = result
            if state in {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "OUT_OF_MEMORY",
                         "NODE_FAIL", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED"}:
                return fail(s, st.run_id,
                            f"Slurm job {st.job_id}: {state} ({reason}) after "
                            f"{st.n_done}/{st.n_trials} trials, before the audit finished.")
            if st.state == "queued":
                st.queue_reason = reason if state == "PENDING" else "Starting worker"
    elif st.pid and execution.get("host", socket.gethostname()) == socket.gethostname():
        if not _alive(st.pid):
            return fail(s, st.run_id, f"The dispatcher (pid {st.pid}) exited after "
                        f"{st.n_done}/{st.n_trials} trials without finishing. "
                        "It may have been killed by a memory limit; see the run log.")
    return st
