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

/* ------------------------------------------------------------------------ *
 * The cost of looking more times.
 *
 * The same expression the audit layer uses for its noise benchmark (SR0 in the
 * Method panel), evaluated here in units of "standard deviations of trial
 * Sharpe" so it needs no data to be meaningful: it is the expected best of N
 * independent trials that all have zero real edge.
 * ------------------------------------------------------------------------ */

const EULER_GAMMA = 0.5772156649015329;

/** Acklam's rational approximation to the inverse normal CDF (~1e-9). */
export function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Expected best-of-N Sharpe under the null, in units of trial-Sharpe sigma. */
export function expectedBestOfN(n: number): number {
  if (n < 2) return 0;
  return (1 - EULER_GAMMA) * invNorm(1 - 1 / n)
       + EULER_GAMMA * invNorm(1 - 1 / (n * Math.E));
}
