#!/usr/bin/env python
"""Day-1 pipeline driver: bronze -> silver -> gold universe.

  python scripts/ingest.py --months 2023-12 2024-01
  python scripts/ingest.py --months ... --all-usdt      # the full backfill

The default symbol set is a documented liquid subset used to smoke-test the
pipeline. It deliberately includes MATIC, AGIX, OCEAN and WAVES: all four were
live in Jan 2024 and were later delisted or migrated off Binance, so their
presence proves the bronze layer is not survivorship-filtered.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import polars as pl

from alpha_audit.config import BRONZE, GOLD
from alpha_audit.ingest import binance_bulk as bb
from alpha_audit.ingest import silver as sv
from alpha_audit.research.universe import UniverseRules, build_universe, write_universe

SEED = """
BTCUSDT ETHUSDT BNBUSDT SOLUSDT XRPUSDT ADAUSDT DOGEUSDT AVAXUSDT DOTUSDT
LINKUSDT TRXUSDT MATICUSDT LTCUSDT BCHUSDT ATOMUSDT UNIUSDT ICPUSDT ETCUSDT
FILUSDT APTUSDT NEARUSDT ARBUSDT OPUSDT INJUSDT SUIUSDT SEIUSDT TIAUSDT
IMXUSDT RNDRUSDT GRTUSDT AAVEUSDT MKRUSDT SANDUSDT MANAUSDT AXSUSDT EGLDUSDT
FTMUSDT ALGOUSDT VETUSDT HBARUSDT THETAUSDT XTZUSDT EOSUSDT FLOWUSDT CHZUSDT
GALAUSDT CRVUSDT COMPUSDT SNXUSDT LDOUSDT AGIXUSDT OCEANUSDT WAVESUSDT
""".split()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", nargs="+", required=True, help="e.g. 2023-12 2024-01")
    ap.add_argument("--all-usdt", action="store_true")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    symbols = bb.list_archive_symbols(quote="USDT") if args.all_usdt else SEED
    print(f"symbols: {len(symbols)}  months: {args.months}")

    jobs = [(s, m) for s in symbols for m in args.months]
    t0 = time.time()
    got, errors = [], []
    with ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(bb.download_month, s, m): (s, m) for s, m in jobs}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                got.append((futs[f], f.result()))
            except Exception as e:
                # One exhausted symbol-month must not end the backfill; collect
                # it, report it, and let the rerun pick it up.
                errors.append((futs[f], repr(e)))
                got.append((futs[f], None))
            if i % 500 == 0 or i == len(jobs):
                ok = sum(p is not None for _, p in got)
                print(f"  bronze {i}/{len(jobs)}  ({ok} present)  {time.time()-t0:.0f}s",
                      flush=True)
    present = [(j, p) for j, p in got if p is not None]
    missing = [j for j, p in got if p is None]
    mb = sum(p.stat().st_size for _, p in present) / 1e6
    print(f"bronze: {len(present)}/{len(jobs)} files, {mb:.0f} MB "
          f"({len(missing) - len(errors)} symbol-months not listed upstream, "
          f"{len(errors)} failed after retries)", flush=True)
    for (sym, month), err in errors[:10]:
        print(f"  failed {sym} {month}: {err}", flush=True)

    # Silver is rebuilt only where it is missing or older than its source, so a
    # requeued job resumes instead of redoing hours of work.
    def to_silver(item):
        (sym, month), path = item
        out = sv.silver_path(sym, month)
        if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
            return 0
        sv.build_month(path, sym, month)
        return 1

    t1 = time.time()
    built = 0
    with ThreadPoolExecutor(args.workers) as ex:
        for i, n in enumerate(ex.map(to_silver, present), 1):
            built += n
            if i % 1000 == 0 or i == len(present):
                print(f"  silver {i}/{len(present)}  ({built} rebuilt)  "
                      f"{time.time()-t1:.0f}s", flush=True)
    panel = sv.load_panel()
    print(f"silver: {panel.height:,} hourly bars, {panel['symbol'].n_unique()} symbols, "
          f"{panel['ts'].min()} -> {panel['ts'].max()}")

    u = build_universe(panel, UniverseRules())
    write_universe(u)
    print(f"gold:   {u.height:,} universe rows over {u['asof'].n_unique()} rebalances, "
          f"{u['symbol'].n_unique()} distinct symbols")
    if u.height:
        last = u.filter(pl.col("asof") == u["asof"].max())
        print(f"        last rebalance {last['asof'][0]}: "
              f"{last.height} names, top-5 by ADV "
              f"{last['symbol'].head(5).to_list()}")

    manifest = {
        "months": args.months,
        "symbols_requested": len(symbols),
        "bronze_files": len(present),
        "missing_symbol_months": len(missing),
        "download_errors": [f"{s}/{m}: {e}" for (s, m), e in errors],
        "silver_bars": panel.height,
        "universe_rows": u.height,
    }
    (GOLD / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
