import { useEffect, useRef, useState } from "react";

export type Scale = (v: number) => number;

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Clean round tick values, so axes read 0 / 0.5 / 1.0 rather than 0.43 / 0.86. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const n = raw / mag;
  const step = (n >= 5 ? 5 : n >= 2 ? 2 : n >= 1 ? 1 : 0.5) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) {
    out.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return out;
}

export function padded(lo: number, hi: number, pad = 0.08): [number, number] {
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * pad, hi + span * pad];
}

/** Measured width, so hover maths works in real pixels rather than viewBox units. */
export function useWidth<T extends HTMLElement>(fallback = 520) {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(280, e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export const M = { top: 14, right: 22, bottom: 40, left: 54 };

type FrameProps = {
  width: number;
  height: number;
  x: Scale;
  y: Scale;
  xTicks: number[];
  yTicks: number[];
  xLabel: string;
  yLabel: string;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  children: React.ReactNode;
};

const num = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/** Grid and axes: solid hairlines one step off the surface, deliberately recessive. */
export function Frame({
  width, height, x, y, xTicks, yTicks, xLabel, yLabel,
  fmtX = num, fmtY = num, children,
}: FrameProps) {
  const x0 = M.left;
  const x1 = width - M.right;
  const y0 = height - M.bottom;
  const y1 = M.top;
  return (
    <svg width={width} height={height} role="img">
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
          <text x={x0 - 8} y={y(t)} dy="0.32em" textAnchor="end"
                fill="var(--muted)" fontSize={11} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtY(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={y0 + 18} textAnchor="middle"
              fill="var(--muted)" fontSize={11} style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtX(t)}
        </text>
      ))}
      <line x1={x0} x2={x1} y1={y0} y2={y0} stroke="var(--axis)" strokeWidth={1} />
      <line x1={x0} x2={x0} y1={y1} y2={y0} stroke="var(--axis)" strokeWidth={1} />
      {children}
      <text x={(x0 + x1) / 2} y={height - 4} textAnchor="middle" fill="var(--text-secondary)" fontSize={11.5}>
        {xLabel}
      </text>
      <text x={12} y={(y1 + y0) / 2} textAnchor="middle" fill="var(--text-secondary)" fontSize={11.5}
            transform={`rotate(-90 12 ${(y1 + y0) / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}

/** A reference rule. Solid, one step darker than the grid, optionally labelled. */
export function Rule({
  x1, x2, y1, y2, label, anchor = "start",
}: { x1: number; x2: number; y1: number; y2: number; label?: string; anchor?: "start" | "end" }) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y1} y2={y2} stroke="var(--axis)" strokeWidth={1} />
      {label && (
        <text x={anchor === "start" ? x1 + 4 : x2 - 4} y={y1 - 5} textAnchor={anchor}
              fill="var(--muted)" fontSize={10.5}>
          {label}
        </text>
      )}
    </g>
  );
}
