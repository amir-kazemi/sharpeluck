"""The storage seam.

Everything the runner reads or writes goes through this interface, addressed by
blob-style keys like `runs/<run_id>/trials/7.json`. LocalStore puts them under
the lake; the Azure adapter added at deploy time is the same keys against a
container, so the worker code does not change.
"""
from __future__ import annotations

import json
import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path

import polars as pl

from ..config import GOLD


class ResultStore(ABC):
    @abstractmethod
    def put_json(self, key: str, obj) -> None: ...
    @abstractmethod
    def get_json(self, key: str): ...
    @abstractmethod
    def put_table(self, key: str, df: pl.DataFrame) -> None: ...
    @abstractmethod
    def get_table(self, key: str) -> pl.DataFrame: ...
    @abstractmethod
    def exists(self, key: str) -> bool: ...
    @abstractmethod
    def list_keys(self, prefix: str) -> list[str]: ...
    @abstractmethod
    def delete_prefix(self, prefix: str) -> int: ...


class LocalStore(ResultStore):
    def __init__(self, root: Path | None = None):
        # Env-configurable so a forked worker lands in the same store as its
        # dispatcher, and so tests can point the whole runner at a tmpdir.
        self.root = Path(root or os.environ.get("ALPHA_AUDIT_RUNS_ROOT") or GOLD / "runs")
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise ValueError(f"key escapes the store root: {key!r}")
        return p

    def put_json(self, key, obj) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_text(json.dumps(obj, indent=2, default=str))
        tmp.rename(p)                      # atomic: a reader never sees a half file

    def get_json(self, key):
        return json.loads(self._p(key).read_text())

    def put_table(self, key, df: pl.DataFrame) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        df.write_parquet(tmp, compression="zstd")
        tmp.rename(p)

    def get_table(self, key) -> pl.DataFrame:
        return pl.read_parquet(self._p(key))

    def exists(self, key) -> bool:
        return self._p(key).exists()

    def list_keys(self, prefix: str) -> list[str]:
        base = self._p(prefix)
        if not base.exists():
            return []
        return sorted(
            str(p.relative_to(self.root)) for p in base.rglob("*") if p.is_file()
        )

    def delete_prefix(self, prefix: str) -> int:
        """Remove a whole run. Each run stores its own copy of the prepared
        panel, so they are tens of megabytes each and worth clearing out."""
        base = self._p(prefix)
        if base == self.root or not base.exists():
            return 0
        n = sum(1 for p in base.rglob("*") if p.is_file())
        shutil.rmtree(base)
        return n
