"""Copy finished runs out of the lake into `results/`, for the deployed image.

Only the artefacts the frontend fetches. A run directory also holds the 650 MB
panel it was computed from and a per-trial series dump; neither is ever served,
and neither belongs in a container image or in git.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sharpeluck.config import GOLD

SERVED = ["status.json", "spec.json", "audit.json",
          "trials.parquet", "equity.parquet", "pbo_cloud.parquet"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=GOLD / "runs")
    ap.add_argument("--dest", type=Path,
                    default=Path(__file__).resolve().parents[1] / "results")
    args = ap.parse_args()

    args.dest.mkdir(parents=True, exist_ok=True)
    for run in sorted(p for p in args.src.iterdir() if p.is_dir()):
        if not (run / "audit.json").exists():
            print(f"skip {run.name}: unfinished")
            continue
        out = args.dest / run.name
        out.mkdir(exist_ok=True)
        total = 0
        for name in SERVED:
            src = run / name
            if src.exists():
                shutil.copy2(src, out / name)
                total += src.stat().st_size
        print(f"{run.name}  {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
