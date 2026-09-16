import type { SavedRunSpec, Trial } from "../api";
import { describe } from "../describe";

const SIGNAL_NAMES: Record<string, string> = {
  "ret:close": "Price change",
  "std:ret": "Volatility",
  "mean:taker_imb": "Buy pressure",
  "mean:dollar_vol": "Dollar volume",
  "mean:trades": "Trade count",
};

function signalName(expr: string, index: number): string {
  const match = expr.match(/\bts_(\w+)\((\w+),/);
  return match ? SIGNAL_NAMES[`${match[1]}:${match[2]}`] ?? `Signal ${index + 1}` : `Signal ${index + 1}`;
}

/** Read the window argument of each time-series operation, including nested ones. */
export function lookbacks(expr: string): number[] {
  const found = new Set<number>();
  for (const match of expr.matchAll(/\bts_(?:mean|std|sum|ret|zscore)\(/g)) {
    let depth = 1;
    let brackets = 0;
    let comma = -1;
    let end = -1;
    for (let i = match.index + match[0].length; i < expr.length; i++) {
      const char = expr[i];
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) { end = i; break; }
      if (char === "[") brackets++;
      if (char === "]") brackets--;
      if (char === "," && depth === 1 && brackets === 0) comma = i;
    }
    if (comma < 0 || end < 0) continue;
    const arg = expr.slice(comma + 1, end).trim();
    if (!/^(?:\d+|\[\s*\d+(?:\s*,\s*\d+)*\s*\])$/.test(arg)) continue;
    for (const value of arg.match(/\d+/g) ?? []) found.add(Number(value));
  }
  return [...found].sort((a, b) => a - b);
}

function windowLabel(hours: number): string {
  if (hours % 168 === 0) return `${hours / 168}w`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

export function RunSettings({ spec, nTrials, winner }: {
  spec: SavedRunSpec; nTrials: number; winner: Pick<Trial, "expr" | "rebalance_every_h">;
}) {
  const signals = spec.grids.map((grid, index) => ({
    name: signalName(grid, index),
    expr: grid,
    windows: lookbacks(grid),
  }));
  const axis = [...new Set(signals.flatMap(signal => signal.windows))].sort((a, b) => a - b);
  const directions = spec.signs.includes("{}") && spec.signs.includes("neg({})")
    ? "Original + reversed" : spec.signs.map(sign => sign === "{}" ? "Original" : sign === "neg({})" ? "Reversed" : sign).join(", ");
  const winnerName = signalName(winner.expr, 0);
  const winnerWindows = lookbacks(winner.expr);
  const winnerDirection = winner.expr.startsWith("neg(") ? "long low, short high" : "long high, short low";
  const winnerText = winnerName !== "Signal 1" && winnerWindows.length === 1
    ? `${winnerName}: ${winnerDirection} · ${windowLabel(winnerWindows[0])} lookback · ${windowLabel(winner.rebalance_every_h)} rebalance`
    : `${describe(winner.expr) ?? winner.expr} · ${windowLabel(winner.rebalance_every_h)} rebalance`;

  return (
    <figure className="run-design">
      <figcaption>Search <span>· {nTrials} trials</span></figcaption>
      <div className="run-design-winner"><strong>Winner</strong><span>{winnerText}</span></div>
      {axis.length > 0 && (
        <div className="run-design-scroll">
          <div className="run-design-matrix"
            style={{ gridTemplateColumns: `minmax(84px, 1fr) repeat(${axis.length}, minmax(26px, 1fr))`,
              minWidth: 84 + axis.length * 30 }}>
            <span className="run-design-axis-label">Lookback</span>
            {axis.map(hours => <span key={hours} className="run-design-axis-label">{windowLabel(hours)}</span>)}
            {signals.flatMap(signal => [
              <span key={signal.expr + "-label"} className="run-design-signal">{signal.name}</span>,
              ...axis.map(hours => (
                <span key={signal.expr + "-" + hours}
                  role="img"
                  className={signal.windows.includes(hours) ? "run-design-dot is-tested" : "run-design-dot"}
                  title={`${signal.name}: ${windowLabel(hours)} ${signal.windows.includes(hours) ? "tested" : "not tested"}`}
                  aria-label={`${signal.name}, ${windowLabel(hours)}: ${signal.windows.includes(hours) ? "tested" : "not tested"}`} />
              )),
            ])}
          </div>
        </div>
      )}
      <div className="run-design-key">● tested lookback · one bar = 1 hour</div>
      <div className="run-design-facts">
        <span title="Signal directions tested">{directions}</span>
        <span title="Rebalance frequencies">↻ {spec.rebalances.map(windowLabel).join(", ")}</span>
        <span title="Trading cost">{spec.cost_bps} bps</span>
        <span title="Maximum coin universe">Top {spec.universe.max_symbols}</span>
      </div>
      <details className="run-design-details">
        <summary>Universe &amp; audit</summary>
        <dl>
          <div><dt>Dollar volume</dt><dd>≥ ${spec.universe.min_adv_usd.toLocaleString()}/h</dd></div>
          <div><dt>History</dt><dd>≥ {windowLabel(spec.universe.min_history_h)}</dd></div>
          <div><dt>Coverage</dt><dd>≥ {(spec.universe.min_coverage * 100).toFixed(0)}%</dd></div>
          <div><dt>Universe refresh</dt><dd>Every {windowLabel(spec.universe.rebalance_every_h)}</dd></div>
          <div><dt>Training folds</dt><dd>{spec.n_splits}</dd></div>
          <div><dt>PBO blocks</dt><dd>{spec.n_blocks}</dd></div>
          <div><dt>Bootstrap histories</dt><dd>{spec.n_boot.toLocaleString()}</dd></div>
          <div><dt>Mean block</dt><dd>{windowLabel(spec.mean_block_h)}</dd></div>
        </dl>
      </details>
    </figure>
  );
}
