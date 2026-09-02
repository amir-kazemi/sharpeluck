import { useState } from "react";
import type { Audit, Trial } from "../api";
import { Frame, M, linear, padded, ticks, useWidth } from "./primitives";

const HEIGHT = 300;

/**
 * Every trial's Sharpe, ranked, against the Sharpe the *best of this search*
 * would have reached on data with no edge in it.
 *
 * This is the argument of the whole platform in one picture: when the noise
 * benchmark sits above the entire trial family, the winner did not beat the
 * search -- it was produced by it.
 */
export function TrialSpread({ trials, audit }: { trials: Trial[]; audit: Audit }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const ranked = [...trials]
    .filter((t) => t.sharpe !== null)
    .sort((a, b) => (b.sharpe ?? 0) - (a.sharpe ?? 0));
  const sr0 = audit.search_null.sr0_ann;
  const vals = ranked.map((t) => t.sharpe as number);

  const x = linear(0, Math.max(1, ranked.length - 1), M.left, width - M.right);
  // The benchmark is part of the story, so the scale must always contain it.
  const [ylo, yhi] = padded(Math.min(0, ...vals), Math.max(sr0, ...vals));
  const y = linear(ylo, yhi, HEIGHT - M.bottom, M.top);

  const winnerRank = ranked.findIndex((t) => t.trial === audit.winner.trial);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (ranked.length - 1));
    setHover(Math.min(ranked.length - 1, Math.max(0, i)));
  };

  const h = hover === null ? null : ranked[hover];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Frame width={width} height={HEIGHT} x={x} y={y}
             xTicks={ticks(0, ranked.length - 1).filter((t) => t >= 0)}
             yTicks={ticks(ylo, yhi)}
             xLabel="Trials, ranked by net Sharpe" yLabel="Net Sharpe (annualised)"
             fmtX={(v) => String(Math.round(v) + 1)}>
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)}
              stroke="var(--axis)" strokeWidth={1} />
        <line x1={M.left} x2={width - M.right} y1={y(sr0)} y2={y(sr0)}
              stroke="var(--rule)" strokeWidth={1.5} />
        <text x={width - M.right - 2} y={y(sr0) - 6} textAnchor="end"
              fill="var(--text-secondary)" fontSize={11}>
          {sr0.toFixed(2)} — best expected from noise alone
        </text>
        {ranked.map((t, i) => (
          <circle key={t.trial} cx={x(i)} cy={y(t.sharpe as number)} r={4}
                  fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2}
                  opacity={hover !== null && hover !== i ? 0.45 : 1} />
        ))}
        {winnerRank >= 0 && (
          <g>
            <circle cx={x(winnerRank)} cy={y(ranked[winnerRank].sharpe as number)} r={7}
                    fill="none" stroke="var(--series-1)" strokeWidth={2} />
            <text x={x(winnerRank)} y={y(ranked[winnerRank].sharpe as number) - 14}
                  textAnchor="middle" fill="var(--text-secondary)" fontSize={11}>
              in-sample winner
            </text>
          </g>
        )}
        <rect x={M.left} y={M.top} width={Math.max(0, width - M.right - M.left)}
              height={Math.max(0, HEIGHT - M.bottom - M.top)} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </Frame>
      {h && hover !== null && (
        <div className="tooltip" style={{
          left: Math.min(x(hover) + 12, Math.max(0, width - 260)), top: M.top,
        }}>
          <div><code>{h.expr}</code></div>
          <div className="muted">
            every {h.rebalance_every_h}h · net {(h.sharpe ?? 0).toFixed(2)} ·
            gross {(h.gross_sharpe ?? 0).toFixed(2)} · OOS {(h.oos_sharpe ?? 0).toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
