#!/usr/bin/env python
"""Submit and execute a run locally, the same path the API takes.

    python scripts/run.py --label "day3 baseline"

Must be a real module on disk, not piped to stdin: workers are started with
spawn and re-import __main__.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alpha_audit.runner.dispatch import create, execute
from alpha_audit.runner.spec import RunSpec
from alpha_audit.runner.store import LocalStore

DEFAULT_GRIDS = [
    "cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))",
    "cs_zscore(ts_std(ret, [24, 72, 168]))",
    "cs_zscore(ts_mean(taker_imb, [24, 72, 168]))",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grids", nargs="+", default=DEFAULT_GRIDS)
    ap.add_argument("--rebalances", nargs="+", type=int, default=[6, 24])
    ap.add_argument("--cost-bps", type=float, default=5.0)
    ap.add_argument("--label", default=None)
    a = ap.parse_args()

    store = LocalStore()
    spec = RunSpec(grids=a.grids, rebalances=a.rebalances,
                   cost_bps=a.cost_bps, label=a.label)
    st = create(spec, store)
    print(f"run {st.run_id}: {st.n_trials} trials")
    done = execute(st.run_id, store)
    if done.state != "done":
        print(done.error, file=sys.stderr)
        return 1

    r = store.get_json(f"{st.run_id}/audit.json")
    d, pb, sn = r["deflation"], r["pbo"], r["search_null"]
    print(f"winner  {r['winner']['expr']} @ {r['winner']['rebalance_every_h']}h")
    print(f"  net Sharpe                 {d['sr_ann']:+.2f}")
    print(f"  E[best] if {d['n_trials']} independent  {d['sr0_ann']:+.2f}"
          f"   -> DSR {d['dsr']:.3f}")
    print(f"  E[best] as measured        {sn['sr0_ann']:+.2f}"
          f"   -> DSR {sn['dsr']:.3f}")
    print(f"  effective trials           {sn['n_eff']:.1f} of {sn['n_trials']}"
          f"   (participation ratio {sn['n_eff_participation']:.1f}, "
          f"mean |corr| {sn['mean_abs_corr']:.2f})")
    print(f"  PBO {pb['pbo']:.3f}   P(OOS loss) {pb['prob_oos_loss']:.3f}   "
          f"RC p {sn['rc_p_value']:.3f}")
    print(f"  break-even                 {r['cost_curve']['break_even_bps']:.1f} bps")
    print(f"VERDICT: {'SURVIVES' if r['survives'] else 'DOES NOT SURVIVE'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
