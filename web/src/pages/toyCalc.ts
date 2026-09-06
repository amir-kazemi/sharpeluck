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

/** Ten days, each coin keeping its character: A choppy, B steadily declining,
 *  C oscillating tightly, D trending smoothly up. Sections 1-3 use the first
 *  four; the rest exist so positions have somewhere to be held into and the
 *  walkthrough can end in an actual score rather than asserting one. */
export const PRICES: Record<Coin, number[]> = {
  A: [100, 102, 105, 103, 107, 104, 108, 105, 109, 106],
  B: [100, 99, 97, 96, 95, 94, 93, 92, 91, 90],
  C: [100, 101, 100, 99, 100, 99, 100, 99, 100, 99],
  D: [100, 103, 108, 112, 116, 119, 123, 126, 130, 133],
};

/** Sections 1-3 walk through this many days; the volatility window needs three
 *  returns, so day 4 is the first on which a position can be formed. */
export const WALKTHROUGH_DAYS = 4;
export const VOL_WINDOW = 3;

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

/** Weights formed at the close of day `day` (1-based), using the trailing
 *  VOL_WINDOW returns. This is exactly the procedure sections 2 and 3 walk
 *  through, applied at an arbitrary day. */
export function positionsAt(day: number) {
  const window = byCoin((c) => returns(PRICES[c].slice(day - VOL_WINDOW - 1, day)));
  const vol = byCoin((c) => std(window[c]));
  const vs = COINS.map((c) => vol[c]);
  const m = mean(vs), sd = std(vs);
  const negZ = byCoin((c) => -(vol[c] - m) / sd);
  const sumAbs = COINS.reduce((a, c) => a + Math.abs(negZ[c]), 0);
  return byCoin((c) => negZ[c] / sumAbs);
}

/** Hold each day's positions into the next day and collect the P&L. */
export function backtestToy() {
  const days: { day: number; pnl: number; weights: Record<Coin, number> }[] = [];
  const lastDay = PRICES.A.length;
  for (let d = VOL_WINDOW + 1; d < lastDay; d++) {
    const weights = positionsAt(d);
    const pnl = COINS.reduce((acc, c) => {
      const r = PRICES[c][d] / PRICES[c][d - 1] - 1;   // day d -> d+1
      return acc + weights[c] * r;
    }, 0);
    days.push({ day: d + 1, pnl, weights });
  }
  const pnls = days.map((x) => x.pnl);
  const avg = mean(pnls);
  const sd = std(pnls);
  return { days, avg, sd, sharpe: sd === 0 ? 0 : avg / sd };
}

export function computeToy() {
  const first = byCoin((c) => PRICES[c].slice(0, WALKTHROUGH_DAYS));
  const rets = byCoin((c) => returns(first[c]));
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

export const EULER_GAMMA = 0.5772156649015329;

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

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, ~1e-7). */
export function normCdf(x: number): number {
  const s = Math.sign(x);
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/** Expected best-of-N Sharpe under the null, in units of trial-Sharpe sigma. */
export function expectedBestOfN(n: number): number {
  if (n < 2) return 0;
  return (1 - EULER_GAMMA) * invNorm(1 - 1 / n)
       + EULER_GAMMA * invNorm(1 - 1 / (n * Math.E));
}
