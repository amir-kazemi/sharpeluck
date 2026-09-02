import { useState } from "react";
import type { Audit } from "../api";
import { Frame, M, linear, padded, ticks, useWidth } from "./primitives";

const HEIGHT = 280;

/** Sharpe against assumed cost: where the edge dies, and how far that is from
 *  the cost actually charged in the backtest. */
export function CostCurve({ audit }: { audit: Audit }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pts = audit.cost_curve.points.filter((p) => p.sharpe !== null) as
    { cost_bps: number; sharpe: number }[];
  const be = audit.cost_curve.break_even_bps;
  const assumed = audit.winner.cost_bps;

  const xhi = Math.max(...pts.map((p) => p.cost_bps));
  const x = linear(0, xhi, M.left, width - M.right);
  const [ylo, yhi] = padded(Math.min(0, ...pts.map((p) => p.sharpe)),
                            Math.max(0, ...pts.map((p) => p.sharpe)));
  const y = linear(ylo, yhi, HEIGHT - M.bottom, M.top);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.cost_bps)},${y(p.sharpe)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left + M.left;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p.cost_bps) - mx) < Math.abs(x(pts[best].cost_bps) - mx)) best = i;
    });
    setHover(best);
  };

  const h = hover === null ? null : pts[hover];
  const atAssumed = pts.reduce((a, b) =>
    Math.abs(b.cost_bps - assumed) < Math.abs(a.cost_bps - assumed) ? b : a, pts[0]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Frame width={width} height={HEIGHT} x={x} y={y}
             xTicks={ticks(0, xhi)} yTicks={ticks(ylo, yhi)}
             xLabel="Assumed cost (bps per unit turnover)" yLabel="Net Sharpe"
             fmtX={(v) => v.toFixed(0)}>
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)}
              stroke="var(--axis)" strokeWidth={1} />
        {be !== null && be > 0 && be <= xhi && (
          <g>
            <line x1={x(be)} x2={x(be)} y1={M.top} y2={HEIGHT - M.bottom}
                  stroke="var(--axis)" strokeWidth={1} />
            <text x={x(be) + 5} y={M.top + 11} fill="var(--muted)" fontSize={10.5}>
              break-even {be.toFixed(1)} bps
            </text>
          </g>
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.cost_bps)} cy={y(p.sharpe)} r={4}
                  fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
        ))}
        {/* One direct label, on the cost the backtest actually charged. */}
        <text x={x(atAssumed.cost_bps)} y={y(atAssumed.sharpe) - 12} textAnchor="middle"
              fill="var(--text-secondary)" fontSize={11.5}>
          {atAssumed.sharpe.toFixed(2)} at {assumed} bps
        </text>
        <rect x={M.left} y={M.top} width={Math.max(0, width - M.right - M.left)}
              height={Math.max(0, HEIGHT - M.bottom - M.top)} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {h && <line x1={x(h.cost_bps)} x2={x(h.cost_bps)} y1={M.top} y2={HEIGHT - M.bottom}
                    stroke="var(--grid)" strokeWidth={1} />}
      </Frame>
      {h && (
        <div className="tooltip" style={{ left: Math.min(x(h.cost_bps) + 12, width - 130), top: M.top }}>
          <div>{h.cost_bps} bps</div>
          <div className="muted">Sharpe {h.sharpe.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

export function CostTable({ audit }: { audit: Audit }) {
  return (
    <table>
      <thead><tr><th>Assumed cost (bps)</th><th>Net Sharpe</th></tr></thead>
      <tbody>
        {audit.cost_curve.points.map((p) => (
          <tr key={p.cost_bps}>
            <td>{p.cost_bps}</td>
            <td>{p.sharpe === null ? "—" : p.sharpe.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
