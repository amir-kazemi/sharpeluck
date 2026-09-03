/** Build signals by clicking rather than by learning the syntax.
 *
 *  Each row is one measurement plus the lookback windows to try, and it renders
 *  the expression it produces underneath — so the guided mode teaches the text
 *  mode instead of hiding it.
 */
export type Row = {
  measure: keyof typeof MEASURES;
  cs: "zscore" | "rank";
  windows: number[];
};

export const MEASURES = {
  price: { label: "price change", inner: "ts_ret(close, W)" },
  vol: { label: "volatility", inner: "ts_std(ret, W)" },
  buy: { label: "buy pressure", inner: "ts_mean(taker_imb, W)" },
  volume: { label: "dollar volume", inner: "ts_mean(dollar_vol, W)" },
  trades: { label: "trade count", inner: "ts_mean(trades, W)" },
} as const;

const HINT: Record<keyof typeof MEASURES, string> = {
  price: "return over the window — momentum as written, reversal negated",
  vol: "standard deviation of hourly returns — the low-volatility factor, negated",
  buy: "share of volume hitting the ask, averaged — order-flow imbalance",
  volume: "average dollar volume — a liquidity or size tilt",
  trades: "average number of trades — activity rather than size",
};

export const WINDOWS = [
  { h: 12, label: "12h" },
  { h: 24, label: "1d" },
  { h: 72, label: "3d" },
  { h: 168, label: "1w" },
  { h: 336, label: "2w" },
  { h: 720, label: "30d" },
];

export function rowToExpr(r: Row): string | null {
  if (!r.windows.length) return null;
  const w = [...r.windows].sort((a, b) => a - b);
  const arg = w.length === 1 ? String(w[0]) : `[${w.join(", ")}]`;
  return `cs_${r.cs}(${MEASURES[r.measure].inner.replace("W", arg)})`;
}

export function rowsToGrids(rows: Row[]): string[] {
  return rows.map(rowToExpr).filter((x): x is string => x !== null);
}

export const DEFAULT_ROWS: Row[] = [
  { measure: "price", cs: "zscore", windows: [12, 24, 72, 168, 336] },
  { measure: "vol", cs: "zscore", windows: [24, 72, 168] },
  { measure: "buy", cs: "zscore", windows: [24, 72, 168] },
];

export function SignalBuilder(
  { rows, onChange }: { rows: Row[]; onChange: (r: Row[]) => void },
) {
  const set = (i: number, patch: Partial<Row>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} className="builder-row">
          <div className="row" style={{ gap: 8 }}>
            <span className="sub" style={{ minWidth: "5.5em" }}>rank coins by</span>
            <select value={r.measure} style={{ minWidth: 150 }}
                    onChange={(e) => set(i, { measure: e.target.value as Row["measure"] })}>
              {Object.entries(MEASURES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <span className="sub">over</span>
            {WINDOWS.map((w) => (
              <button key={w.h} aria-pressed={r.windows.includes(w.h)}
                      style={{ padding: "3px 8px", fontSize: 12 }}
                      title={`${w.h} hours`}
                      onClick={() => set(i, {
                        windows: r.windows.includes(w.h)
                          ? r.windows.filter((x) => x !== w.h)
                          : [...r.windows, w.h],
                      })}>
                {w.label}
              </button>
            ))}
            <button onClick={() => set(i, { cs: r.cs === "zscore" ? "rank" : "zscore" })}
                    title="z-score weights by how extreme a coin is; rank treats the ordering only"
                    style={{ padding: "3px 8px", fontSize: 12 }}>
              {r.cs === "zscore" ? "z-score" : "rank"}
            </button>
            {rows.length > 1 && (
              <button onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      title="remove this signal"
                      style={{ padding: "3px 8px", fontSize: 12 }}>
                ✕
              </button>
            )}
          </div>
          <div className="help">
            {HINT[r.measure]}
            {r.windows.length === 0
              ? " · pick at least one window"
              : <> · <code>{rowToExpr(r)}</code></>}
          </div>
        </div>
      ))}
      <div>
        <button style={{ padding: "3px 10px", fontSize: 12 }}
                onClick={() => onChange([
                  ...rows, { measure: "volume", cs: "zscore", windows: [168] },
                ])}>
          + add a signal
        </button>
      </div>
    </div>
  );
}
