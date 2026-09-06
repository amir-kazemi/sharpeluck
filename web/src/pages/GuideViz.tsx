import { Fragment } from "react";
import { linear, padded } from "../charts/primitives";

/** Small illustrative diagrams for the walkthrough. Unlike the app's data
 *  charts these have no hover layer: every value that matters is already a
 *  direct label, so there is nothing hover would add. */

export function Sparkline({ prices, label }: { prices: number[]; label: string }) {
  const w = 108, h = 46, pad = 6;
  const [lo, hi] = padded(Math.min(...prices), Math.max(...prices), 0.2);
  const x = (i: number) => pad + (i / (prices.length - 1)) * (w - pad * 2);
  const y = linear(lo, hi, h - pad, pad);
  const d = prices.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p)}`).join(" ");
  const last = prices[prices.length - 1];
  return (
    <div style={{ textAlign: "center" }}>
      <div className="sub" style={{ fontWeight: 600 }}>{label}</div>
      <svg width={w} height={h} style={{ marginTop: 2 }}>
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="var(--grid)" strokeWidth={1} />
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(prices.length - 1)} cy={y(last)} r={3.5}
                fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={1.5} />
      </svg>
      <div className="help">{prices[0]} → {last}</div>
    </div>
  );
}

export function CategoryBars(
  { items, fmt }: { items: { label: string; value: number }[]; fmt?: (v: number) => string },
) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  const f = fmt ?? ((v: number) => v.toFixed(3));
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {items.map((it) => (
        <div key={it.label} className="row" style={{ gap: 10 }}>
          <span className="sub" style={{ width: "1.4em", textAlign: "right" }}>{it.label}</span>
          <div style={{ flex: 1, background: "var(--grid)", borderRadius: 3, height: 16 }}>
            <div style={{
              width: `${(Math.abs(it.value) / max) * 100}%`, height: 16,
              background: "var(--series-1)", borderRadius: "0 3px 3px 0", minWidth: 3,
            }} />
          </div>
          <span className="sub" style={{ width: "4.5em", fontVariantNumeric: "tabular-nums" }}>
            {f(it.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A single-hue number line: at this stage a value's sign means "more or less
 *  than average," not yet "long or short," so it deliberately does not use the
 *  long/short colours below.
 *
 *  Coins cluster in value -- B, C and D all sit within half a standard
 *  deviation here -- so a single label row collides. Labels are placed left to
 *  right into the lowest tier that clears whatever is already there, and a
 *  label pushed up keeps a thin leader down to its dot.
 *
 *  Geometry grows DOWNWARD from a fixed top: the topmost tier's baseline is
 *  pinned just below y=0 and the dot row is pushed down to make room, so
 *  adding a tier can never push a label off the top of the viewBox. Zero is a
 *  short tick straddling the axis rather than a full-height rule, which would
 *  otherwise run straight through any label sitting near it.
 */
const FONT = 11;
const CHAR_W = FONT * 0.62;   // monospace, approximate
const ASCENT = FONT * 0.78;
const DESCENT = FONT * 0.22;
const TIER_H = 16;
const TOP_PAD = 3;
const LABEL_GAP = 12;         // tier-0 baseline to dot centre
const R = 5;

export function numberLineGeometry(
  values: { coin: string; v: number }[], w = 460, pad = 34,
) {
  const vs = values.map((x) => x.v);
  const [lo, hi] = padded(Math.min(0, ...vs), Math.max(0, ...vs), 0.3);
  const x = linear(lo, hi, pad, w - pad);

  const items = values
    .map(({ coin, v }) => {
      const label = `${coin} ${v.toFixed(2)}`;
      return { coin, v, label, px: x(v), halfW: (label.length * CHAR_W) / 2, tier: 0 };
    })
    .sort((a, b) => a.px - b.px);

  const lastRight: number[] = [];
  for (const it of items) {
    let tier = 0;
    while (lastRight[tier] !== undefined && it.px - it.halfW < lastRight[tier] + 4) tier++;
    lastRight[tier] = it.px + it.halfW;
    it.tier = tier;
  }

  const maxTier = Math.max(0, ...items.map((it) => it.tier));
  const topBaseline = TOP_PAD + ASCENT;
  const dotY = topBaseline + maxTier * TIER_H + LABEL_GAP;
  const zeroX = x(0);
  const h = dotY + R + 2 + 16;   // dot, then room for the "0" beneath the axis
  return { items, x, w, pad, dotY, zeroX, h, maxTier, labelY: (tier: number) => dotY - LABEL_GAP - tier * TIER_H };
}

export function NumberLine({ values }: { values: { coin: string; v: number }[] }) {
  const g = numberLineGeometry(values);
  return (
    <svg width="100%" viewBox={`0 0 ${g.w} ${g.h}`} preserveAspectRatio="xMinYMid meet">
      <line x1={g.pad} x2={g.w - g.pad} y1={g.dotY} y2={g.dotY}
            stroke="var(--axis)" strokeWidth={1} />
      <line data-role="zero" x1={g.zeroX} x2={g.zeroX} y1={g.dotY - 7} y2={g.dotY + 7}
            stroke="var(--rule)" strokeWidth={1.5} />
      <text x={g.zeroX} y={g.dotY + 18} textAnchor="middle" fontSize={10}
            fill="var(--muted)">0</text>
      {g.items.filter((it) => it.tier > 0).map((it) => (
        <line key={`lead-${it.coin}`} x1={it.px} x2={it.px}
              y1={g.labelY(it.tier) + DESCENT + 1} y2={g.dotY - R - 2}
              stroke="var(--grid)" strokeWidth={1} />
      ))}
      {g.items.map((it) => {
        const ly = g.labelY(it.tier);
        return (
          <g key={it.coin}>
            <circle cx={it.px} cy={g.dotY} r={R} fill="var(--series-1)"
                    stroke="var(--surface-1)" strokeWidth={2} />
            <text x={it.px} y={ly} textAnchor="middle" fontSize={FONT}
                  fill="var(--text-secondary)" stroke="var(--surface-1)"
                  strokeWidth={3.5} paintOrder="stroke">
              {it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const NUMBER_LINE_METRICS = { FONT, CHAR_W, ASCENT, DESCENT, R };

/** The one place sign genuinely means a polarity -- long vs. short -- rather
 *  than an ordering, so this is the one diagram that earns the diverging pair.
 *  Both hexes are already-validated categorical slots (1 and 8), reused for
 *  their warm/cool contrast rather than as a fresh palette. */
export function DivergingBars({ items }: { items: { coin: string; weight: number }[] }) {
  const w = 460, mid = w / 2, pad = 46;
  const max = Math.max(...items.map((i) => Math.abs(i.weight)), 1e-9);
  const scale = mid - pad;
  return (
    <div style={{ display: "grid", gap: 9 }}>
      {items.map(({ coin, weight }) => {
        const px = (Math.abs(weight) / max) * scale;
        const long = weight >= 0;
        return (
          <div key={coin} className="row" style={{ gap: 10 }}>
            <span className="sub" style={{ width: "1.4em" }}>{coin}</span>
            <svg width="100%" viewBox={`0 0 ${w} 20`} preserveAspectRatio="xMinYMid meet" style={{ flex: 1 }}>
              <line x1={mid} x2={mid} y1={0} y2={20} stroke="var(--axis)" strokeWidth={1} />
              <rect x={long ? mid : mid - px} y={2} width={px} height={16} rx={2}
                    fill={long ? "var(--pos)" : "var(--neg)"} />
            </svg>
            <span className="sub" style={{ width: "6.5em", textAlign: "right" }}>
              {long ? "long" : "short"} {(Math.abs(weight) * 100).toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

const FAMILIES = [
  { name: "price change", windows: [12, 24, 72, 168, 336] },
  { name: "volatility", windows: [24, 72, 168] },
  { name: "buy pressure", windows: [24, 72, 168] },
];

/** The 44-trial grid, literally: 11 columns (one per window, grouped by
 *  signal family) times 4 rows (raw/negated x 6h/24h). Counting the cells is
 *  the point, so they carry no value -- only presence. */
export function TrialGrid() {
  const cols = FAMILIES.flatMap((f) => f.windows.map((w) => `${w}h`));
  const rows = ["6h · raw", "6h · negated", "24h · raw", "24h · negated"];
  const famEdges = new Set(
    FAMILIES.slice(0, -1).reduce<number[]>((acc, f, i) => {
      const prev = acc[i - 1] ?? 0;
      return [...acc, prev + f.windows.length];
    }, []),
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `6.5em repeat(${cols.length}, 1fr)`, gap: 3 }}>
        <div />
        {cols.map((c, i) => (
          <div key={i} className="help" style={{ textAlign: "center", marginLeft: famEdges.has(i) ? 8 : 0 }}>
            {c}
          </div>
        ))}
        {rows.map((rl, ri) => (
          <Fragment key={rl}>
            <div className="help" style={{ textAlign: "right", paddingRight: 6, alignSelf: "center" }}>
              {rl}
            </div>
            {cols.map((_, ci) => (
              <div key={ci} style={{
                height: 15, borderRadius: 2, background: "var(--series-1)",
                opacity: 0.5, marginTop: ri === 2 ? 5 : 0, marginLeft: famEdges.has(ci) ? 8 : 0,
              }} />
            ))}
          </Fragment>
        ))}
      </div>
      <div className="help" style={{ marginTop: 10 }}>
        {cols.length} expressions × 2 signs × 2 rebalance frequencies ={" "}
        {cols.length * 2 * 2} cells — count them.
      </div>
    </div>
  );
}

/** A schematic bell shape: the distribution of "best of N" Sharpes you would
 *  see from pure noise. Illustrative only -- shaped by hand, not sampled from
 *  any run's actual data, which the caption around it says explicitly. */
export function BellCurve({ markerAt, markerLabel }: { markerAt: number; markerLabel: string }) {
  const w = 460, h = 130, pad = 22;
  const n = 70;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const u = (t - 0.5) * 4.2;
    return { t, y: Math.exp(-0.5 * u * u) };
  });
  const x = linear(0, 1, pad, w - pad);
  const y = linear(0, 1, h - pad, pad + 14);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.y)}`).join(" ");
  const area = `${line} L${x(1)},${y(0)} L${x(0)},${y(0)} Z`;
  const mx = x(Math.min(0.97, Math.max(0.03, markerAt)));
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="var(--axis)" strokeWidth={1} />
      <path d={area} fill="var(--series-1)" opacity={0.12} />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} />
      <line x1={mx} x2={mx} y1={pad - 6} y2={h - pad} stroke="var(--rule)" strokeWidth={1.5} />
      <text x={mx} y={pad - 10} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
        {markerLabel}
      </text>
    </svg>
  );
}

export function SplitHalf() {
  const w = 460, h = 92;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <defs>
        <marker id="gd-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--rule)" />
        </marker>
      </defs>
      <rect x={20} y={32} width={200} height={28} rx={4} fill="var(--series-1)" opacity={0.18} />
      <rect x={240} y={32} width={200} height={28} rx={4} fill="var(--series-2)" opacity={0.18} />
      <text x={120} y={24} textAnchor="middle" fontSize={12} fill="var(--text-secondary)">first half</text>
      <text x={340} y={24} textAnchor="middle" fontSize={12} fill="var(--text-secondary)">second half</text>
      <text x={120} y={50} textAnchor="middle" fontSize={12} fill="var(--text-primary)">pick the winner</text>
      <text x={340} y={50} textAnchor="middle" fontSize={12} fill="var(--text-primary)">check it here</text>
      <path d="M120,60 L120,76 L338,76 L338,62" fill="none" stroke="var(--rule)"
            strokeWidth={1.5} markerEnd="url(#gd-arrow)" />
    </svg>
  );
}

export function DecliningLine({ zeroAt, label }: { zeroAt: number; label: string }) {
  const w = 460, h = 116, pad = 20;
  const x = linear(0, 1, pad, w - pad);
  const midY = pad + (h - 2 * pad) * 0.32;
  const zx = x(zeroAt);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <line x1={pad} x2={w - pad} y1={midY} y2={midY} stroke="var(--axis)" strokeWidth={1} />
      <path d={`M${x(0)},${pad + 6} L${x(1)},${h - pad}`} fill="none"
            stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" />
      <line x1={zx} x2={zx} y1={pad - 6} y2={h - pad + 6} stroke="var(--rule)" strokeWidth={1.5} />
      <text x={zx} y={pad - 10} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">{label}</text>
      <text x={pad} y={midY - 8} fontSize={10.5} fill="var(--muted)">edge</text>
      <text x={pad} y={midY + 18} fontSize={10.5} fill="var(--muted)">no edge</text>
    </svg>
  );
}
