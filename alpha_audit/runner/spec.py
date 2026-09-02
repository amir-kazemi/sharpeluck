"""Run specifications. These are the objects the API accepts and the store keeps.

A run is defined entirely by this spec, so a result is reproducible from it and
the trial count -- the input the deflation depends on -- is recorded rather than
remembered.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from ..research import dsl


class TrialSpec(BaseModel):
    trial: int
    expr: str
    rebalance_every_h: int
    cost_bps: float


class RunSpec(BaseModel):
    grids: list[str] = Field(
        default=["cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))"],
        description="Signal expressions; list-valued parameters expand into trials.",
    )
    signs: list[str] = Field(
        default=["{}", "neg({})"],
        description="Sign is a searched dimension and is counted in the trial budget.",
    )
    rebalances: list[int] = [6, 24]
    cost_bps: float = 5.0
    n_splits: int = 6          # walk-forward folds
    n_blocks: int = 10         # CSCV blocks -> C(n, n/2) splits
    n_boot: int = 2000
    mean_block_h: float = 48.0
    label: str | None = None

    @field_validator("grids")
    @classmethod
    def _parseable(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("at least one grid is required")
        for g in v:
            dsl.parse(g)          # raises ParseError, surfaced as HTTP 422
        return v

    @field_validator("signs")
    @classmethod
    def _has_placeholder(cls, v: list[str]) -> list[str]:
        for s in v:
            if "{}" not in s:
                raise ValueError(f"sign template {s!r} must contain '{{}}'")
        return v

    def trials(self) -> list[TrialSpec]:
        out = []
        for g in self.grids:
            for node in dsl.expand(g):
                for sign in self.signs:
                    for reb in self.rebalances:
                        out.append(
                            TrialSpec(
                                trial=len(out),
                                expr=sign.format(dsl.to_str(node)),
                                rebalance_every_h=reb,
                                cost_bps=self.cost_bps,
                            )
                        )
        return out


class RunStatus(BaseModel):
    run_id: str
    state: str                 # queued | running | done | failed
    n_trials: int
    n_done: int = 0
    label: str | None = None
    created_at: str
    finished_at: str | None = None
    error: str | None = None
