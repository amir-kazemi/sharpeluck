import { useState } from "react";
import type { EquityPoint } from "../api";
import { Legend } from "../components/Figure";
import { Frame, M, linear, padded, ticks, useWidth } from "./primitives";

const HEIGHT = 280;
const MAX_POINTS = 700;

const month = (iso: string) => iso.slice(0, 7);

/** Downsample by stride. The series is smooth and monotone-ish in time, so
 *  every nth bar preserves the shape at a fraction of the DOM. */
function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = Math.ceil(xs.length / max);
  const out = xs.filter((_, i) => i % step === 0);
  if (xs.length && out[out.length - 1] !== xs[xs.length - 1]) out.push(xs[xs.length - 1]);
  return out;
}

export function EquityCurve({ points }: { points: EquityPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = thin(points, MAX_POINTS);

  const x = linear(0, data.length - 1, M.left, width - M.right);
  const all = data.flatMap((p) => [p.equity, p.equity_gross]);
  const [ylo, yhi] = padded(Math.min(1, ...all), Math.max(1, ...all));
  const y = linear(ylo, yhi, HEIGHT - M.bottom, M.top);

  const line = (key: "equity" | "equity_gross") =>
    data.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[key])}`).join(" ");

  const xTickIdx = ticks(0, data.length - 1, 5).map((t) => Math.round(t))
    .filter((i) => i >= 0 && i < data.length);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  const last = data[data.length - 1];
  const h = hover === null ? null : data[hover];
  // Only direct-label the ends when they actually separate; otherwise the
  // legend carries identity and stacked labels would just detach from the lines.
  const separated = last && Math.abs(y(last.equity) - y(last.equity_gross)) > 15;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Frame width={width} height={HEIGHT} x={x} y={y}
             xTicks={xTickIdx} yTicks={ticks(ylo, yhi)}
             xLabel="" yLabel="Equity (1.0 = flat)"
             fmtX={(i) => (data[i] ? month(data[i].ts) : "")}>
        <line x1={M.left} x2={width - M.right} y1={y(1)} y2={y(1)}
              stroke="var(--axis)" strokeWidth={1} />
        <path d={line("equity_gross")} fill="none" stroke="var(--series-2)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        <path d={line("equity")} fill="none" stroke="var(--series-1)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {last && separated && (
          <>
            <text x={width - M.right - 2} y={y(last.equity_gross) - 8} textAnchor="end"
                  fill="var(--text-secondary)" fontSize={11}>gross</text>
            <text x={width - M.right - 2} y={y(last.equity) + 14} textAnchor="end"
                  fill="var(--text-secondary)" fontSize={11}>net</text>
          </>
        )}
        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={M.top} y2={HEIGHT - M.bottom}
                  stroke="var(--grid)" strokeWidth={1} />
            <circle cx={x(hover!)} cy={y(h.equity_gross)} r={4} fill="var(--series-2)"
                    stroke="var(--surface-1)" strokeWidth={2} />
            <circle cx={x(hover!)} cy={y(h.equity)} r={4} fill="var(--series-1)"
                    stroke="var(--surface-1)" strokeWidth={2} />
          </g>
        )}
        <rect x={M.left} y={M.top} width={Math.max(0, width - M.right - M.left)}
              height={Math.max(0, HEIGHT - M.bottom - M.top)} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </Frame>
      <Legend items={[{ label: "Net of cost", color: "var(--series-1)" },
                      { label: "Gross", color: "var(--series-2)" }]} />
      {h && (
        <div className="tooltip" style={{ left: Math.min(x(hover!) + 12, width - 150), top: M.top }}>
          <div>{h.ts.slice(0, 10)}</div>
          <div className="muted">net {h.equity.toFixed(3)} · gross {h.equity_gross.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}

export function EquityTable({ points }: { points: EquityPoint[] }) {
  const rows = thin(points, 200);
  return (
    <table>
      <thead><tr><th>Bar</th><th>Net equity</th><th>Gross equity</th></tr></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.ts}>
            <td>{p.ts.slice(0, 13).replace("T", " ")}</td>
            <td>{p.equity.toFixed(4)}</td>
            <td>{p.equity_gross.toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
