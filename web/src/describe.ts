/** Render a DSL expression as the sentence a reader actually needs.
 *  Returns null for anything the patterns don't cover, so the caller falls
 *  back to showing the expression itself rather than inventing a description. */
const FIELD: Record<string, string> = {
  close: "price",
  ret: "return",
  dollar_vol: "dollar volume",
  taker_imb: "taker buy pressure",
  trades: "trade count",
};

const WINDOW: Record<string, (field: string, n: number) => string> = {
  ret: (f, n) => `${n}-hour ${f} change`,
  std: (_f, n) => `${n}-hour realised volatility`,
  mean: (f, n) => `${n}-hour average ${f}`,
  sum: (f, n) => `${n}-hour total ${f}`,
  zscore: (f, n) => `${n}-hour normalised ${f}`,
};

export function describe(expr: string): string | null {
  const m = expr.match(
    /^(neg\()?cs_(?:zscore|rank|demean)\(ts_(\w+)\((\w+),\s*(\d+)\)\)\)?$/,
  );
  if (!m) return null;
  const [, negated, op, field, n] = m;
  const phrase = WINDOW[op]?.(FIELD[field] ?? field, Number(n));
  if (!phrase) return null;
  return negated
    ? `Long the lowest ${phrase}, short the highest`
    : `Long the highest ${phrase}, short the lowest`;
}

/** Where a trial count comes from, derived from the trials themselves so it is
 *  shown wherever the count is, not only in the form that produced it. */
export function explainTrials(
  trials: { expr: string; rebalance_every_h: number }[],
): string {
  const base = (e: string) => (e.startsWith("neg(") ? e.slice(4, -1) : e);
  const expressions = new Set(trials.map((t) => base(t.expr))).size;
  const signs = new Set(trials.map((t) => (t.expr.startsWith("neg(") ? "-" : "+"))).size;
  const rebalances = new Set(trials.map((t) => t.rebalance_every_h)).size;
  const parts = [
    `${expressions} signal${expressions === 1 ? "" : "s"}`,
    `${signs} sign${signs === 1 ? "" : "s"}`,
    `${rebalances} rebalance frequenc${rebalances === 1 ? "y" : "ies"}`,
  ];
  return `${parts.join(" × ")} = ${trials.length} trials`;
}
