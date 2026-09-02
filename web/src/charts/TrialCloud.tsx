import { useState } from "react";
import type { CloudPoint } from "../api";
import { Frame, M, linear, padded, ticks, useWidth } from "./primitives";

const HEIGHT = 300;

/**
 * The trial cloud. One point per CSCV split: where the in-sample winner landed
 * out of sample. Points below the zero rule are splits where the winner lost
 * money on data it was not chosen on -- PBO is (near enough) how many.
 */
export function TrialCloud({ points, pbo }: { points: CloudPoint[]; pbo: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);

  const xs = points.map((p) => p.is_sharpe_ann);
  const ys = points.map((p) => p.oos_sharpe_ann);
  const [xlo, xhi] = padded(Math.min(0, ...xs), Math.max(0, ...xs));
  const [ylo, yhi] = padded(Math.min(0, ...ys), Math.max(0, ...ys));
  const x = linear(xlo, xhi, M.left, width - M.right);
  const y = linear(ylo, yhi, HEIGHT - M.bottom, M.top);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left + M.left;
    const my = e.clientY - r.top + M.top;
    let best = -1;
    let bd = 26 * 26; // generous hit radius; an 8px dot is not a hit target
    points.forEach((p, i) => {
      const dx = x(p.is_sharpe_ann) - mx;
      const dy = y(p.oos_sharpe_ann) - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    });
    setHover(best < 0 ? null : { i: best, px: x(points[best].is_sharpe_ann), py: y(points[best].oos_sharpe_ann) });
  };

  const h = hover ? points[hover.i] : null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Frame width={width} height={HEIGHT} x={x} y={y}
             xTicks={ticks(xlo, xhi)} yTicks={ticks(ylo, yhi)}
             xLabel="In-sample Sharpe (annualised)" yLabel="Out-of-sample Sharpe">
        {/* The region that defines overfitting, marked in neutral surface ink. */}
        {ylo < 0 && (
          <rect x={M.left} y={y(0)} width={Math.max(0, width - M.right - M.left)}
                height={Math.max(0, y(ylo) - y(0))} fill="var(--grid)" opacity={0.45} />
        )}
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--rule)" strokeWidth={1.5} />
        <line x1={x(0)} x2={x(0)} y1={M.top} y2={HEIGHT - M.bottom} stroke="var(--axis)" strokeWidth={1} />
        <text x={M.left + 6} y={y(0) + 14} fill="var(--text-secondary)" fontSize={10.5}>
          below: winner lost money out of sample ({(pbo * 100).toFixed(0)}%)
        </text>
        {points.map((p, i) => (
          <circle key={i} cx={x(p.is_sharpe_ann)} cy={y(p.oos_sharpe_ann)} r={4}
                  fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2}
                  opacity={hover && hover.i !== i ? 0.45 : 1} />
        ))}
        {hover && (
          <circle cx={hover.px} cy={hover.py} r={6.5} fill="none"
                  stroke="var(--series-1)" strokeWidth={2} />
        )}
        <rect x={M.left} y={M.top} width={Math.max(0, width - M.right - M.left)}
              height={Math.max(0, HEIGHT - M.bottom - M.top)} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </Frame>
      {h && hover && (
        <div className="tooltip" style={{
          left: Math.min(hover.px + 12, width - 150),
          top: Math.max(hover.py - 44, 0),
        }}>
          <div>IS {h.is_sharpe_ann.toFixed(2)} &rarr; OOS {h.oos_sharpe_ann.toFixed(2)}</div>
          <div className="muted">logit {h.logit.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

export function CloudTable({ points }: { points: CloudPoint[] }) {
  return (
    <table>
      <thead>
        <tr><th>Split</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>Logit</th></tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{p.is_sharpe_ann.toFixed(3)}</td>
            <td>{p.oos_sharpe_ann.toFixed(3)}</td>
            <td>{p.logit.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
