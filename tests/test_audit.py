"""Calibration tests for the audit layer.

These assert *statistical behaviour under a known null*, not golden constants
copied from a paper. A constant I cannot re-derive is a constant I cannot debug;
a calibration test fails loudly when an implementation drifts, and doubles as
the evidence that the platform's own numbers mean what they claim.

The null is always the same: strategies with genuinely zero edge. A correct
audit layer must report PBO ~= 0.5, a DSR that is not confident, and a reality
check that rejects at roughly its nominal rate.
"""
from __future__ import annotations

import numpy as np
import pytest

from alpha_audit.research.audit import (
    cost_curve, deflate, expected_max_sharpe, pbo, probabilistic_sharpe_ratio,
    reality_check, stationary_bootstrap_indices,
)

ANN = 24 * 365


def _noise(t, k, rng, drift=0.0):
    m = rng.normal(0.0, 0.01, (t, k))
    if drift:
        m[:, 0] += drift
    return m


def _sharpes_ann(m):
    sd = m.std(0, ddof=1)
    return np.where(sd > 0, m.mean(0) / sd, 0.0) * np.sqrt(ANN)


# --------------------------------------------------------------------------
# Deflated Sharpe
# --------------------------------------------------------------------------
def test_expected_max_sharpe_grows_with_the_search():
    v = [expected_max_sharpe(n, 0.05) for n in (2, 10, 100, 1000)]
    assert v == sorted(v)
    assert expected_max_sharpe(1, 0.05) == 0.0      # nothing to deflate
    assert expected_max_sharpe(100, 0.0) == 0.0     # no dispersion, no penalty


def test_psr_rises_with_sample_length_and_falls_with_fat_tails():
    base = probabilistic_sharpe_ratio(0.05, 500, 0.0, 3.0)
    assert probabilistic_sharpe_ratio(0.05, 5000, 0.0, 3.0) > base
    assert probabilistic_sharpe_ratio(0.05, 500, 0.0, 12.0) < base
    assert probabilistic_sharpe_ratio(0.05, 500, -2.0, 3.0) < base  # left tail hurts


def test_more_trials_lowers_the_deflated_sharpe():
    rng = np.random.default_rng(0)
    r = rng.normal(0.0005, 0.01, 4000)
    few = deflate(r, np.array([1.0, 1.2, 0.8]), ANN)
    many = deflate(r, np.concatenate([[1.0, 1.2, 0.8], rng.normal(0, 1.0, 500)]), ANN)
    assert many.dsr < few.dsr
    assert many.sr0_ann > few.sr0_ann
    assert few.sr_ann == pytest.approx(many.sr_ann)   # the raw Sharpe is untouched


def test_dsr_is_not_fooled_by_the_best_of_fifty_noise_strategies():
    rng = np.random.default_rng(11)
    dsrs = []
    for _ in range(120):
        m = _noise(1000, 50, rng)
        s = _sharpes_ann(m)
        best = int(np.argmax(s))
        dsrs.append(deflate(m[:, best], s, ANN).dsr)
    dsrs = np.array(dsrs)
    # Calibrated: the winner of a pure-noise search is a coin flip, not a find.
    assert 0.30 < dsrs.mean() < 0.70, f"mean DSR under the null = {dsrs.mean():.3f}"
    assert (dsrs > 0.95).mean() < 0.10, f"false-positive rate = {(dsrs > 0.95).mean():.3f}"


def test_dsr_still_credits_a_genuine_edge():
    rng = np.random.default_rng(3)
    m = _noise(4000, 50, rng, drift=0.0035)          # trial 0 is real
    s = _sharpes_ann(m)
    assert int(np.argmax(s)) == 0
    assert deflate(m[:, 0], s, ANN).dsr > 0.95


# --------------------------------------------------------------------------
# PBO / CSCV
# --------------------------------------------------------------------------
def test_pbo_is_a_coin_flip_under_the_null():
    t, k, blocks = 2400, 30, 10
    res, cloud = pbo(_noise(t, k, np.random.default_rng(5)), n_blocks=blocks)
    assert res.n_combinations == 252
    assert cloud.shape == (252, 3)
    # PBO sits at or a little above 0.5 under the null: part of the IS winner's
    # advantage is sample-specific noise, which reverses in the complementary
    # half more often than a coin flip would.
    assert 0.35 < res.pbo < 0.75, f"PBO under the null = {res.pbo:.3f}"
    # Choosing the winner buys in-sample Sharpe that does not survive. These
    # Sharpes are per-observation, so the yardstick is the sampling error of a
    # Sharpe over half the sample, 1/sqrt(T/2).
    sigma = (2.0 / t) ** 0.5
    assert res.selection_premium > 1.5 * sigma, (res.selection_premium, sigma)
    # ...and the winner loses money out-of-sample about half the time.
    assert 0.3 < res.prob_oos_loss < 0.75, res.prob_oos_loss


def test_pbo_is_low_when_one_trial_is_genuinely_good():
    rng = np.random.default_rng(7)
    res, _ = pbo(_noise(2400, 30, rng, drift=0.004), n_blocks=10)
    assert res.pbo < 0.20, f"PBO with a real edge = {res.pbo:.3f}"
    # A genuinely-best trial is chosen for the right reason, so selection buys
    # almost nothing and the out-of-sample half almost never loses.
    assert abs(res.selection_premium) < 0.05, res.selection_premium
    assert res.prob_oos_loss < 0.05, res.prob_oos_loss


def test_pbo_rejects_a_single_trial():
    with pytest.raises(ValueError):
        pbo(np.random.default_rng(0).normal(size=(100, 1)))


# --------------------------------------------------------------------------
# Reality check
# --------------------------------------------------------------------------
def test_stationary_bootstrap_is_in_range_and_resamples():
    rng = np.random.default_rng(0)
    idx = stationary_bootstrap_indices(500, 20, 24.0, rng)
    assert idx.shape == (20, 500)
    assert idx.min() >= 0 and idx.max() < 500
    assert idx[0].tolist() != list(range(500))       # not the identity
    # Mean block length ~24 => roughly T/24 restarts per path.
    restarts = (np.diff(idx[0]) != 1).sum()
    assert 5 < restarts < 120, restarts


def test_reality_check_rejects_at_about_its_nominal_rate_under_the_null():
    rng = np.random.default_rng(13)
    p = [reality_check(_noise(600, 12, rng), n_boot=200, mean_block=8.0, seed=i).p_value
         for i in range(40)]
    rate = float(np.mean(np.array(p) < 0.05))
    assert rate < 0.20, f"rejection rate under the null = {rate:.3f}"


def test_reality_check_finds_a_genuine_edge():
    rng = np.random.default_rng(17)
    res = reality_check(_noise(2000, 12, rng, drift=0.004), n_boot=400, mean_block=8.0)
    assert res.p_value < 0.05, f"p = {res.p_value:.4f}"


# --------------------------------------------------------------------------
# Cost curve
# --------------------------------------------------------------------------
def test_cost_curve_is_monotone_and_agrees_with_break_even():
    rng = np.random.default_rng(0)
    gross = rng.normal(0.0002, 0.01, 5000)
    turnover = np.abs(rng.normal(0.3, 0.05, 5000))
    c = cost_curve(gross, turnover, bps_grid=(0, 5, 10, 50))
    sr = [p["sharpe"] for p in c["points"]]
    assert sr == sorted(sr, reverse=True)
    be = c["break_even_bps"]
    # At the break-even cost the mean net return is ~0, so the Sharpe is ~0.
    at_be = cost_curve(gross, turnover, bps_grid=(be,))["points"][0]["sharpe"]
    assert abs(at_be) < 0.05, at_be
