#!/usr/bin/env python
"""Audit the trial table: deflate, cross-validate, bootstrap, cost-test.

Run after scripts/trials.py. Reads the per-bar return series of every trial and
answers one question: how much of the winner's Sharpe survives the search?
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import polars as pl

from sharpeluck.config import GOLD
from sharpeluck.research.audit import cost_curve, deflate, pbo, reality_check
from sharpeluck.research.backtest import HOURS_PER_YEAR

N_BLOCKS = 10
MEAN_BLOCK_H = 48.0   # positions are held ~24h, so resample in longer blocks
N_BOOT = 2000


def main() -> int:
    trials = pl.read_parquet(GOLD / "trials.parquet")
    rets = pl.read_parquet(GOLD / "trial_returns.parquet")

    wide = rets.pivot(on="trial", index="ts", values="net").sort("ts")
    cols = [c for c in wide.columns if c != "ts"]
    m = wide.select(cols).fill_null(0.0).to_numpy()
    sharpes = trials.sort("trial")["sharpe"].to_numpy()

    # The winner is chosen in-sample -- that is the whole point of deflating it.
    winner = trials.sort("is_sharpe", descending=True, nulls_last=True).row(0, named=True)
    wcol = cols.index(str(winner["trial"]))
    wr = rets.filter(pl.col("trial") == winner["trial"]).sort("ts")

    print(f"trials        {m.shape[1]}   bars {m.shape[0]:,}   cost {winner['cost_bps']} bps")
    print(f"IS winner     {winner['expr']} @ {winner['rebalance_every_h']}h")
    print(f"              net SR {winner['sharpe']:.2f}  (IS {winner['is_sharpe']:.2f}, "
          f"OOS {winner['oos_sharpe']:.2f})\n")

    d = deflate(m[:, wcol], sharpes, HOURS_PER_YEAR)
    print("DEFLATED SHARPE (Bailey & Lopez de Prado)")
    print(f"  observed Sharpe            {d.sr_ann:+.2f}")
    print(f"  expected best-of-{d.n_trials} noise  {d.sr0_ann:+.2f}   "
          f"(trial Sharpe dispersion {d.sr_trials_std_ann:.2f})")
    print(f"  skew {d.skew:+.2f}  kurtosis {d.kurtosis:.1f}  n_obs {d.n_obs:,}")
    print(f"  PSR vs zero                {d.psr_vs_zero:.3f}")
    print(f"  DSR (vs the search)        {d.dsr:.3f}\n")

    pb, cloud = pbo(m, n_blocks=N_BLOCKS)
    print(f"BACKTEST OVERFITTING (CSCV, {pb.n_combinations} splits of {pb.n_blocks} blocks)")
    print(f"  PBO                        {pb.pbo:.3f}")
    print(f"  median IS / OOS Sharpe     {pb.median_is_sharpe:+.4f} / {pb.median_oos_sharpe:+.4f}"
          f"   (per bar)")
    print(f"  selection premium          {pb.selection_premium:+.4f}")
    print(f"  P(OOS loss)                {pb.prob_oos_loss:.3f}\n")

    rc = reality_check(m, n_boot=N_BOOT, mean_block=MEAN_BLOCK_H)
    print(f"REALITY CHECK (stationary bootstrap, {rc.n_boot} paths, mean block {rc.mean_block:.0f}h)")
    print(f"  studentised max statistic  {rc.statistic:.2f}")
    print(f"  p-value for best-of-{rc.n_trials}     {rc.p_value:.4f}\n")

    cc = cost_curve(wr["gross"].to_numpy(), wr["turnover"].to_numpy(),
                    bps_grid=(0, 1, 2, 5, 10, 20, 50), ann_periods=HOURS_PER_YEAR)
    print("COST SENSITIVITY (winner)")
    for pt in cc["points"]:
        bar = "#" * max(0, int(round((pt["sharpe"] or 0) * 10)))
        print(f"  {pt['cost_bps']:>4.0f} bps   SR {pt['sharpe']:+.2f}  {bar}")
    print(f"  break-even                 {cc['break_even_bps']:.1f} bps")

    report = {"winner": {k: v for k, v in winner.items() if k != "series"},
              "deflation": d.as_dict(), "pbo": pb.as_dict(),
              "reality_check": rc.as_dict(), "cost_curve": cc}
    (GOLD / "audit.json").write_text(json.dumps(report, indent=2, default=str))
    pl.DataFrame({"is_sharpe": cloud[:, 0], "oos_sharpe": cloud[:, 1],
                  "logit": cloud[:, 2]}).write_parquet(GOLD / "pbo_cloud.parquet")

    verdict = ("SURVIVES" if (d.dsr > 0.95 and pb.pbo < 0.3 and rc.p_value < 0.05)
               else "DOES NOT SURVIVE")
    print(f"\nVERDICT: {verdict} the audit "
          f"(DSR {d.dsr:.2f}, PBO {pb.pbo:.2f}, RC p {rc.p_value:.3f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
