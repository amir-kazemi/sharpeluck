#!/usr/bin/env python
"""Run the platform against data that is known to contain no edge.

Every backtesting result on this project is a claim about a method, and the only
way to check a method is to point it at data whose answer you already know. This
generates panels with the statistical character of the real one -- a common
market factor, per-symbol betas, matched idiosyncratic volatility, fat tails --
and *no cross-sectional predictability whatsoever*, then runs the full research
path over them:

    universe construction -> feature panel -> signal DSL -> backtest -> audit

A correct platform must return nothing. It must report PBO near 0.5, a deflated
Sharpe that is not confident, a reality check that does not reject, and a verdict
of "does not survive" on every seed. If any seed survives, something in that path
is leaking the future, and every result the platform has ever produced is suspect.

Innovations are Student-t rather than normal: real crypto returns had kurtosis
41 in the live run, and a Gaussian null would be an easier test than reality.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import polars as pl

DF = 4.0  # Student-t degrees of freedom; heavy but finite-variance tails


def calibrate(panel: pl.DataFrame) -> dict:
    """Measure what the real panel looks like, so the null is a fair imitation."""
    p = panel.sort(["symbol", "ts"]).with_columns(
        (pl.col("close") / pl.col("close").shift(1) - 1).over("symbol").alias("r")
    )
    factor = p.group_by("ts").agg(pl.col("r").mean().alias("f")).sort("ts")
    sigma_f = float(factor["f"].std())
    j = p.join(factor, on="ts").drop_nulls(["r", "f"])
    per = j.group_by("symbol").agg(
        pl.col("r").std().alias("sd"),
        pl.corr("r", "f").alias("rho"),
        pl.col("quote_volume").mean().alias("adv"),
    ).sort("symbol").fill_null(0.0)
    sd = per["sd"].to_numpy()
    rho = np.clip(per["rho"].to_numpy(), -0.99, 0.99)
    return {
        "symbols": per["symbol"].to_list(),
        "sigma_f": sigma_f,
        # beta and idiosyncratic vol from the single-factor decomposition
        "beta": rho * sd / max(sigma_f, 1e-12),
        "sigma_e": sd * np.sqrt(1.0 - rho**2),
        "adv": per["adv"].to_numpy(),
        "start": panel["ts"].min(),
        "n_hours": panel["ts"].n_unique(),
    }


def _t(rng: np.random.Generator, shape) -> np.ndarray:
    """Standardised Student-t: heavy tails, unit variance."""
    return rng.standard_t(DF, shape) / np.sqrt(DF / (DF - 2.0))


def simulate(cal: dict, seed: int) -> pl.DataFrame:
    """A panel in the silver schema with a market factor and no cross-sectional
    predictability of any kind."""
    rng = np.random.default_rng(seed)
    n, k = cal["n_hours"], len(cal["symbols"])
    f = cal["sigma_f"] * _t(rng, n)
    r = np.outer(f, cal["beta"]) + cal["sigma_e"] * _t(rng, (n, k))
    close = 100.0 * np.cumprod(1.0 + np.clip(r, -0.5, 0.5), axis=0)
    qv = cal["adv"] * np.exp(rng.normal(0.0, 0.4, (n, k)))
    base = np.datetime64(cal["start"].replace(tzinfo=None), "h")
    tarr = base + np.arange(n, dtype="timedelta64[h]")

    frames = []
    for i, sym in enumerate(cal["symbols"]):
        c = close[:, i]
        frames.append(pl.DataFrame({
            "symbol": [sym] * n,
            "ts": tarr.astype("datetime64[us]"),
            "open": c, "high": c * 1.001, "low": c * 0.999, "close": c,
            "volume": qv[:, i] / c,
            "quote_volume": qv[:, i],
            "trades": np.full(n, 1000, dtype=np.int64),
            # Taker pressure is noise around balanced flow: a signal built on it
            # must find nothing.
            "taker_buy_quote": qv[:, i] * np.clip(rng.normal(0.5, 0.05, n), 0.05, 0.95),
            "n_minutes": np.full(n, 60, dtype=np.int32),
        }).with_columns(pl.col("ts").dt.replace_time_zone("UTC")))
    return pl.concat(frames).sort(["symbol", "ts"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    # Null runs live in their own store so they never appear in the real run list.
    from alpha_audit.config import GOLD
    os.environ.setdefault("ALPHA_AUDIT_RUNS_ROOT", str(GOLD / "null_runs"))

    from alpha_audit.ingest.silver import load_panel
    from alpha_audit.research.signals import prepare_panel
    from alpha_audit.research.universe import UniverseRules, build_universe
    from alpha_audit.runner.dispatch import create, execute
    from alpha_audit.runner.spec import RunSpec
    from alpha_audit.runner.store import LocalStore
    from scripts.run import DEFAULT_GRIDS

    real = load_panel()
    cal = calibrate(real)
    print(f"calibrated on {len(cal['symbols'])} symbols x {cal['n_hours']:,} hours")
    print(f"  market vol {cal['sigma_f']*100:.3f}%/h   "
          f"median beta {np.median(cal['beta']):.2f}   "
          f"median idio vol {np.median(cal['sigma_e'])*100:.3f}%/h   t({DF:.0f}) innovations\n")

    store = LocalStore()
    spec = RunSpec(grids=DEFAULT_GRIDS, rebalances=[6, 24], label="null")
    rows = []
    for seed in range(args.seeds):
        bars = simulate(cal, seed)
        panel = prepare_panel(bars, build_universe(bars, UniverseRules()))
        st = create(spec, store, panel=panel)
        done = execute(st.run_id, store)
        if done.state != "done":
            print(done.error, file=sys.stderr)
            return 1
        a = store.get_json(f"{st.run_id}/audit.json")
        d, pb, sn = a["deflation"], a["pbo"], a["search_null"]
        rows.append({"seed": seed, "sharpe": d["sr_ann"], "dsr": sn["dsr"],
                     "pbo": pb["pbo"], "rc_p": sn["rc_p_value"],
                     "n_eff": sn["n_eff"], "survives": a["survives"]})
        print(f"  seed {seed}:  winner SR {d['sr_ann']:+.2f}   DSR {sn['dsr']:.3f}   "
              f"PBO {pb['pbo']:.3f}   RC p {sn['rc_p_value']:.3f}   "
              f"n_eff {sn['n_eff']:.1f}   {'SURVIVES' if a['survives'] else 'rejected'}")

    df = pl.DataFrame(rows)
    n_survive = int(df["survives"].sum())
    print(f"\n  {args.seeds} null datasets, {df['pbo'].len()} audits")
    print(f"  mean PBO   {df['pbo'].mean():.3f}   (0.5 = selection is a coin flip)")
    print(f"  mean DSR   {df['dsr'].mean():.3f}   (low = no edge claimed)")
    print(f"  mean RC p  {df['rc_p'].mean():.3f}   (high = cannot reject the null)")
    print(f"  survived   {n_survive}/{args.seeds}")
    print(f"\n{'PASS: the platform found nothing, which is the correct answer'
            if n_survive == 0 else
            'FAIL: an edge was reported on data that has none -- something leaks'}")

    out = Path(args.out) if args.out else GOLD / "null_test.json"
    out.write_text(json.dumps({"seeds": args.seeds, "df_t": DF,
                               "results": rows, "n_survived": n_survive}, indent=2))
    return 0 if n_survive == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
