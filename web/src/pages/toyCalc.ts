/**
 * A tiny, self-contained re-implementation of one research step -- prices to
 * positions -- for four coins over four days. Deliberately not the real
 * pipeline (real bars are hourly, the universe is ~50 wide, the engine is
 * Polars): this is small enough to check by hand, and every number the guide
 * shows is computed here rather than typed twice, so prose and figures can
 * never drift out of sync with each other.
 */

export const COINS = ["A", "B", "C", "D"] as const;
export type Coin = (typeof COINS)[number];

export const PRICES: Record<Coin, number[]> = {
  A: [100, 102, 105, 103],
  B: [100, 99, 97, 96],
  C: [100, 101, 100, 99],
  D: [100, 103, 108, 112],
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function returns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}

function byCoin<T>(f: (c: Coin) => T): Record<Coin, T> {
  return Object.fromEntries(COINS.map((c) => [c, f(c)])) as Record<Coin, T>;
}

export function computeToy() {
  const rets = byCoin((c) => returns(PRICES[c]));
  const vol = byCoin((c) => std(rets[c]));
  const volValues = COINS.map((c) => vol[c]);
  const volMean = mean(volValues);
  const volStd = std(volValues);
  const z = byCoin((c) => (vol[c] - volMean) / volStd);
  const negZ = byCoin((c) => -z[c]);
  const sumAbs = COINS.reduce((a, c) => a + Math.abs(negZ[c]), 0);
  const weight = byCoin((c) => negZ[c] / sumAbs);
  return { rets, vol, volMean, volStd, z, negZ, weight };
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const signed = (v: number, d = 2) => (v >= 0 ? "+" : "") + v.toFixed(d);
