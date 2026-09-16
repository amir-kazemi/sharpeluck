"""Run specifications. These are the objects the API accepts and the store keeps.

A run is defined entirely by this spec, so a result is reproducible from it and
the trial count -- the input the deflation depends on -- is recorded rather than
remembered.
"""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

from ..research import dsl
from ..research.universe import UniverseRules


class TrialSpec(BaseModel):
    trial: int
    expr: str
    rebalance_every_h: int
    cost_bps: float


class UniverseSpec(BaseModel):
    """How the tradable set is defined. This is a research decision, not a
    constant: an edge that only exists in the top 50 names by dollar volume,
    or only survives a lax liquidity floor, is a different claim from one that
    holds across the whole liquid cross-section."""

    max_symbols: int = Field(default=50, ge=2, le=500)
    min_adv_usd: float = Field(default=1e5, ge=0)
    min_history_h: int = Field(default=24 * 30, ge=24)
    min_coverage: float = Field(default=0.90, ge=0.0, le=1.0)
    rebalance_every_h: int = Field(default=24, ge=1, le=168)

    def to_rules(self) -> UniverseRules:
        return UniverseRules(
            max_symbols=self.max_symbols,
            min_adv_usd=self.min_adv_usd,
            min_history_h=self.min_history_h,
            min_coverage=self.min_coverage,
            rebalance_every_h=self.rebalance_every_h,
        )


class Provenance(BaseModel):
    """What the numbers are actually about. Stored with every run because an
    audit of a strategy is meaningless without the data it traded."""

    bar: str = "1h"
    start: str | None = None
    end: str | None = None
    n_bars: int = 0
    n_symbols_available: int = 0
    n_symbols_traded: int = 0
    mean_universe_size: float = 0.0
    n_rebalances: int = 0


class RunSpec(BaseModel):
    grids: list[str] = Field(
        default=["cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))"],
        description="Signal expressions; list-valued parameters expand into trials.",
    )
    signs: list[str] = Field(
        default=["{}", "neg({})"],
        description="Sign is a searched dimension and is counted in the trial budget.",
    )
    rebalances: list[Annotated[int, Field(ge=1, le=24)]] = Field(default=[6, 24], min_length=1)
    cost_bps: float = Field(default=5.0, ge=0, allow_inf_nan=False)
    n_splits: int = Field(default=6, ge=2)       # walk-forward folds
    n_blocks: int = Field(default=10, ge=2)      # CSCV blocks -> C(n, n/2) splits
    n_boot: int = Field(default=2000, ge=1)
    mean_block_h: float = Field(default=48.0, ge=1, allow_inf_nan=False)
    universe: UniverseSpec = Field(default_factory=UniverseSpec)
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
            try:
                expr = s.format("close")
            except (IndexError, KeyError, ValueError) as exc:
                raise ValueError(f"invalid sign template: {s!r}") from exc
            dsl.parse(expr)
        return v

    @field_validator("rebalances")
    @classmethod
    def _daily_intervals(cls, v: list[int]) -> list[int]:
        if any(24 % h for h in v):
            raise ValueError("rebalance intervals must divide 24 hours evenly")
        return v

    @field_validator("n_blocks")
    @classmethod
    def _even_blocks(cls, v: int) -> int:
        if v % 2:
            raise ValueError("n_blocks must be even for half-sample splits")
        return v

    @model_validator(mode="after")
    def _enough_to_audit(self) -> "RunSpec":
        """Every statistic here is about choosing among trials, so a single
        trial has nothing to audit -- cross-validation cannot rank one thing and
        the reality check has no maximum to take. Refuse it up front rather than
        letting the run start and die in the audit."""
        n = len(self.trials())
        if n < 2:
            raise ValueError(
                "a run needs at least 2 trials to audit -- there is nothing to "
                "deflate when only one was tried. Widen a parameter list "
                "(e.g. [24, 72]), add another rebalance frequency, or keep "
                "'also test each signal negated' on."
            )
        return self

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
    # 0 means "written before versioning existed". Results are stored as files,
    # so a run outlives the code that produced it; the UI needs to know which
    # generation it is looking at rather than discovering it via a TypeError.
    schema_version: int = 0
    run_id: str
    provenance: Provenance | None = None
    # PID of a locally-launched dispatcher, so a run whose worker died can be
    # told apart from one still going. None when an external scheduler owns it.
    pid: int | None = None
    backend: str | None = None
    job_id: str | None = None
    node: str | None = None
    phase: str | None = None      # queued | preparing | trials | audit | done | failed
    queue_reason: str | None = None
    state: str                 # queued | running | done | failed
    n_trials: int
    n_done: int = 0
    label: str | None = None
    created_at: str
    finished_at: str | None = None
    error: str | None = None
