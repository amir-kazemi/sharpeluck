"""The audit layer: what survives the fact that you looked N times.

Four independent lenses on one trial table.

  deflate()        Deflated Sharpe Ratio (Bailey & Lopez de Prado 2014).
                   Discounts the best observed Sharpe by the Sharpe you would
                   expect to see from the *best of N* independent noise
                   strategies, then asks -- accounting for non-normal returns --
                   for the probability that the true Sharpe exceeds it.

  pbo()            Probability of Backtest Overfitting via Combinatorially
                   Symmetric Cross-Validation. Repeatedly splits the sample in
                   half, picks the in-sample winner, and records where that
                   winner lands in the out-of-sample ranking. If the winner is
                   below the OOS median as often as not, selection is noise.

  reality_check()  White's Reality Check on a stationary bootstrap
                   (Politis & Romano), studentised. Asks whether the best of N
                   beats a zero benchmark once the whole search is resampled
                   jointly, preserving autocorrelation.

  cost_curve()     Where the edge dies. Sharpe as a function of assumed cost,
                   plus the break-even level in basis points.

Only the standard library and numpy: the normal CDF and its inverse come from
`statistics.NormalDist`, so there is no scipy dependency to ship to a worker.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, asdict
from statistics import NormalDist

import numpy as np

_N = NormalDist()
EULER_GAMMA = 0.5772156649015329
_PHI = _N.cdf
_PHI_INV = _N.inv_cdf


# --------------------------------------------------------------------------
# Deflated Sharpe Ratio
# --------------------------------------------------------------------------
def expected_max_sharpe(n_trials: int, sr_std: float) -> float:
    """E[max of N iid Sharpe ratios drawn from N(0, sr_std^2)].

    This is the benchmark a searched strategy has to beat: not zero, but the
    Sharpe that pure noise would have handed you as the winner of N tries.
    Uses the Gumbel approximation to the expected maximum.
    """
    if n_trials < 2 or sr_std <= 0:
        return 0.0
    n = float(n_trials)
    return sr_std * (
        (1.0 - EULER_GAMMA) * _PHI_INV(1.0 - 1.0 / n)
        + EULER_GAMMA * _PHI_INV(1.0 - 1.0 / (n * math.e))
    )


def probabilistic_sharpe_ratio(
    sr: float, n_obs: int, skew: float, kurtosis: float, benchmark: float = 0.0
) -> float:
    """P(true Sharpe > benchmark), correcting for skew, fat tails and sample length.

    `sr`, `benchmark` are per-observation, NOT annualised. `kurtosis` is raw
    (3.0 for a normal), not excess.
    """
    if n_obs < 3:
        return float("nan")
    denom = 1.0 - skew * sr + 0.25 * (kurtosis - 1.0) * sr * sr
    if denom <= 0:
        return float("nan")
    return _PHI((sr - benchmark) * math.sqrt(n_obs - 1) / math.sqrt(denom))


@dataclass(frozen=True)
class Deflation:
    n_trials: int
    n_obs: int
    ann_periods: int
    sr_ann: float
    sr_trials_std_ann: float
    sr0_ann: float
    skew: float
    kurtosis: float
    psr_vs_zero: float
    dsr: float

    def as_dict(self) -> dict:
        return asdict(self)


def deflate(
    best_returns: np.ndarray, trial_sharpes_ann: np.ndarray, ann_periods: int
) -> Deflation:
    """Deflate the winner's Sharpe by the dispersion of the whole trial family.

    `trial_sharpes_ann` must be EVERY trial that was run, winner included --
    the count and the spread are both inputs, and dropping the losers is the
    most common way this number gets quietly inflated.
    """
    r = np.asarray(best_returns, dtype=float)
    r = r[np.isfinite(r)]
    s = np.asarray(trial_sharpes_ann, dtype=float)
    s = s[np.isfinite(s)]
    t = r.size
    if t < 3 or s.size == 0:
        raise ValueError("need >=3 observations and >=1 trial Sharpe")

    scale = math.sqrt(ann_periods)
    sd = r.std(ddof=1)
    sr_obs = 0.0 if sd == 0 else r.mean() / sd          # per observation
    m = r - r.mean()
    var = (m**2).mean()
    skew = 0.0 if var == 0 else float((m**3).mean() / var**1.5)
    kurt = 3.0 if var == 0 else float((m**4).mean() / var**2)

    sr_trials_std = float(s.std(ddof=1) / scale) if s.size > 1 else 0.0
    sr0 = expected_max_sharpe(s.size, sr_trials_std)
    return Deflation(
        n_trials=int(s.size),
        n_obs=int(t),
        ann_periods=int(ann_periods),
        sr_ann=float(sr_obs * scale),
        sr_trials_std_ann=float(sr_trials_std * scale),
        sr0_ann=float(sr0 * scale),
        skew=skew,
        kurtosis=kurt,
        psr_vs_zero=float(probabilistic_sharpe_ratio(sr_obs, t, skew, kurt, 0.0)),
        dsr=float(probabilistic_sharpe_ratio(sr_obs, t, skew, kurt, sr0)),
    )


# --------------------------------------------------------------------------
# Probability of Backtest Overfitting (CSCV)
# --------------------------------------------------------------------------
def _block_moments(m: np.ndarray, n_blocks: int):
    """Per-block count, sum and sum-of-squares, so any half-sample Sharpe is a
    cheap aggregation rather than a re-slice of the matrix."""
    t = (m.shape[0] // n_blocks) * n_blocks
    blocks = m[:t].reshape(n_blocks, t // n_blocks, m.shape[1])
    return t // n_blocks, blocks.sum(axis=1), (blocks**2).sum(axis=1)


def _sharpe_from_moments(n: int, s: np.ndarray, ss: np.ndarray) -> np.ndarray:
    mean = s / n
    var = np.maximum(ss / n - mean**2, 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(var > 0, mean / np.sqrt(var), 0.0)


@dataclass(frozen=True)
class PBO:
    """CSCV summary.

    `selection_premium` = median_is_sharpe - median_oos_sharpe is the Sharpe you
    get purely from having chosen the winner: under a pure-noise search it is
    large, and for a trial that is genuinely best it collapses towards zero.

    `deterioration_slope` regresses OOS on IS across splits. Note it is
    mechanically negative even for a real edge, because CSCV's splits are
    complementary -- a fixed winner's IS and OOS halves sum to roughly the
    full-sample result. Read its magnitude, never its sign.
    """

    pbo: float
    n_trials: int
    n_combinations: int
    n_blocks: int
    median_is_sharpe: float
    median_oos_sharpe: float
    selection_premium: float
    prob_oos_loss: float
    deterioration_slope: float

    def as_dict(self) -> dict:
        return asdict(self)


def pbo(returns: np.ndarray, n_blocks: int = 10) -> tuple[PBO, np.ndarray]:
    """CSCV. `returns` is (n_obs, n_trials) of per-bar net returns.

    Returns the summary plus the (is_sharpe, oos_sharpe, logit) triples for
    every split -- that array is the trial cloud the frontend plots.
    """
    m = np.asarray(returns, dtype=float)
    if m.ndim != 2 or m.shape[1] < 2:
        raise ValueError("need a 2-D matrix with >=2 trials")
    m = np.nan_to_num(m, nan=0.0, posinf=0.0, neginf=0.0)
    if n_blocks % 2:
        n_blocks -= 1
    n, bs, bss = _block_moments(m, n_blocks)
    n_trials = m.shape[1]

    rows = []
    half = n_blocks // 2
    for combo in itertools.combinations(range(n_blocks), half):
        pick = np.array(combo)
        rest = np.setdiff1d(np.arange(n_blocks), pick)
        is_sr = _sharpe_from_moments(n * half, bs[pick].sum(0), bss[pick].sum(0))
        oos_sr = _sharpe_from_moments(n * half, bs[rest].sum(0), bss[rest].sum(0))
        k = int(np.argmax(is_sr))
        # Relative rank of the IS winner in the OOS ordering, in (0, 1).
        rank = float((oos_sr <= oos_sr[k]).sum())
        omega = rank / (n_trials + 1.0)
        omega = min(max(omega, 1e-9), 1 - 1e-9)
        rows.append((is_sr[k], oos_sr[k], math.log(omega / (1.0 - omega))))

    cloud = np.array(rows)
    slope = float(np.polyfit(cloud[:, 0], cloud[:, 1], 1)[0]) if cloud.shape[0] > 1 else 0.0
    med_is, med_oos = float(np.median(cloud[:, 0])), float(np.median(cloud[:, 1]))
    return (
        PBO(
            pbo=float((cloud[:, 2] < 0).mean()),
            n_trials=n_trials,
            n_combinations=cloud.shape[0],
            n_blocks=n_blocks,
            median_is_sharpe=med_is,
            median_oos_sharpe=med_oos,
            selection_premium=med_is - med_oos,
            prob_oos_loss=float((cloud[:, 1] < 0).mean()),
            deterioration_slope=slope,
        ),
        cloud,
    )


# --------------------------------------------------------------------------
# White's Reality Check on a stationary bootstrap
# --------------------------------------------------------------------------
def stationary_bootstrap_indices(
    n_obs: int, n_boot: int, mean_block: float, rng: np.random.Generator
) -> np.ndarray:
    """Politis & Romano (1994). Geometric block lengths, wrapped at the end, so
    resamples keep the serial correlation that makes a Sharpe look better than
    it is."""
    p = 1.0 / max(mean_block, 1.0)
    idx = np.empty((n_boot, n_obs), dtype=np.int64)
    idx[:, 0] = rng.integers(0, n_obs, n_boot)
    new_block = rng.random((n_boot, n_obs)) < p
    starts = rng.integers(0, n_obs, (n_boot, n_obs))
    for t in range(1, n_obs):
        cont = (idx[:, t - 1] + 1) % n_obs
        idx[:, t] = np.where(new_block[:, t], starts[:, t], cont)
    return idx


@dataclass(frozen=True)
class RealityCheck:
    p_value: float
    statistic: float
    n_boot: int
    mean_block: float
    n_trials: int

    def as_dict(self) -> dict:
        return asdict(self)


def reality_check(
    returns: np.ndarray,
    n_boot: int = 1000,
    mean_block: float = 24.0,
    seed: int = 0,
) -> RealityCheck:
    """H0: the best of N trials has no edge over a zero benchmark.

    Studentised statistic (Hansen's variant), which keeps a low-vol trial from
    being drowned out by a high-vol one:  V = max_k sqrt(T) * mean_k / sd_k.
    The bootstrap recentres each trial on its own mean, so the null is imposed
    on all N jointly rather than on the winner alone.
    """
    m = np.nan_to_num(np.asarray(returns, dtype=float), nan=0.0)
    t, k = m.shape
    rng = np.random.default_rng(seed)
    mean, sd = m.mean(0), m.std(0, ddof=1)
    sd = np.where(sd > 0, sd, np.inf)
    v = float(np.max(math.sqrt(t) * mean / sd))

    idx = stationary_bootstrap_indices(t, n_boot, mean_block, rng)
    boot_mean = m[idx].mean(axis=1)                      # (n_boot, k)
    v_star = np.max(math.sqrt(t) * (boot_mean - mean) / sd, axis=1)
    return RealityCheck(
        p_value=float((v_star >= v).mean()),
        statistic=v,
        n_boot=n_boot,
        mean_block=mean_block,
        n_trials=k,
    )


# --------------------------------------------------------------------------
# Cost sensitivity
# --------------------------------------------------------------------------
def cost_curve(
    gross: np.ndarray, turnover: np.ndarray, bps_grid=(0, 1, 2, 5, 10, 20, 50), ann_periods: int = 24 * 365
) -> dict:
    g = np.nan_to_num(np.asarray(gross, dtype=float))
    to = np.nan_to_num(np.asarray(turnover, dtype=float))
    ann = math.sqrt(ann_periods)
    pts = []
    for bps in bps_grid:
        net = g - to * bps / 1e4
        sd = net.std(ddof=1)
        pts.append({"cost_bps": float(bps),
                    "sharpe": None if sd == 0 else float(net.mean() / sd * ann)})
    mean_to = float(to.mean())
    return {
        "points": pts,
        "break_even_bps": None if mean_to <= 0 else float(g.mean() / mean_to * 1e4),
        "mean_turnover": mean_to,
    }
