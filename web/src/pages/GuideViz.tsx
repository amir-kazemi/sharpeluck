import { linear, padded } from "../charts/primitives";
import { expectedBestOfN, normCdf } from "./toyCalc";

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

/** Bars sized by magnitude. Only valid for quantities that cannot be negative
 *  -- it uses the absolute value, so a signed series would render its losses
 *  and gains identically. Use PnlBars for anything that can go below zero. */
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

/** Daily results around zero. Direction carries the sign rather than colour:
 *  a second hue here would clash with the long/short pair used for positions,
 *  where blue and red already mean something else. */
export function PnlBars(
  { days, avg }: { days: { day: number; pnl: number }[]; avg: number },
) {
  const w = 460, mid = w / 2, pad = 52;
  const max = Math.max(...days.map((d) => Math.abs(d.pnl)), 1e-9);
  const scale = mid - pad;
  const avgX = mid + (avg / max) * scale;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {days.map(({ day, pnl }) => {
        const px = (Math.abs(pnl) / max) * scale;
        const up = pnl >= 0;
        return (
          <div key={day} className="row" style={{ gap: 10 }}>
            <span className="sub" style={{ width: "2.6em" }}>day {day}</span>
            <svg width="100%" viewBox={`0 0 ${w} 18`} preserveAspectRatio="xMinYMid meet"
                 style={{ flex: 1 }}>
              <line x1={mid} x2={mid} y1={0} y2={18} stroke="var(--axis)" strokeWidth={1} />
              <rect x={up ? mid : mid - px} y={2} width={px} height={14} rx={2}
                    fill="var(--series-1)" />
            </svg>
            <span className="sub" style={{ width: "5em", textAlign: "right" }}>
              {pnl >= 0 ? "+" : ""}{(pnl * 100).toFixed(2)}%
            </span>
          </div>
        );
      })}
      <div className="row" style={{ gap: 10, marginTop: 2 }}>
        <span className="sub" style={{ width: "2.6em", color: "var(--muted)" }}>avg</span>
        <svg width="100%" viewBox={`0 0 ${w} 20`} preserveAspectRatio="xMinYMid meet"
             style={{ flex: 1 }}>
          <line x1={mid} x2={mid} y1={0} y2={12} stroke="var(--axis)" strokeWidth={1} />
          <line x1={avgX} x2={avgX} y1={0} y2={12} stroke="var(--rule)" strokeWidth={2} />
          <text x={mid} y={20} textAnchor="middle" fontSize={9.5} fill="var(--muted)">0</text>
        </svg>
        <span className="sub" style={{ width: "5em", textAlign: "right" }}>
          {avg >= 0 ? "+" : ""}{(avg * 100).toFixed(3)}%
        </span>
      </div>
    </div>
  );
}

const FAMILIES = [
  { name: "price change", windows: 5 },
  { name: "volatility", windows: 3 },
  { name: "buy pressure", windows: 3 },
];

/** Where "11 expressions" comes from -- as labelled text, because the count is
 *  a fact to read, not a quantity to compare. An earlier version drew all 44
 *  trials as identical rectangles, which encoded no variable and left the three
 *  families unlabelled: strictly worse than the sentence underneath it. */
export function SearchBreakdown() {
  const total = FAMILIES.reduce((a, f) => a + f.windows, 0);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {FAMILIES.map((f) => (
        <div key={f.name} className="row" style={{ gap: 10 }}>
          <span className="sub" style={{ minWidth: "9em" }}>{f.name}</span>
          <span className="sub" style={{ color: "var(--muted)" }}>
            {f.windows} lookback window{f.windows === 1 ? "" : "s"}
          </span>
        </div>
      ))}
      <div className="row" style={{ gap: 10, borderTop: "1px solid var(--grid)", paddingTop: 8 }}>
        <span className="sub" style={{ minWidth: "9em" }}><strong>{total} expressions</strong></span>
        <span className="sub" style={{ color: "var(--muted)" }}>
          × 2 signs × 2 rebalance frequencies = <strong>{total * 4} trials</strong>
        </span>
      </div>
    </div>
  );
}

/** What a wider search costs you: the Sharpe the best of N trials reaches with
 *  no real edge at all. Same expression as the audit layer's SR0, in units of
 *  trial-Sharpe sigma so it needs no data to be read. */
// The axis is trials, so every marker is labelled in trials. 11 is what the
// same 11 signals would cost with a single sign and a single rebalance
// frequency -- not a count of signals, which is a different unit.
const MARKS = [
  { n: 11, label: "11 trials" },
  { n: 44, label: "44 trials" },
  { n: 500, label: "500 trials" },
];

export function SearchCostCurve() {
  const w = 460, h = 190;
  const m = { top: 30, right: 22, bottom: 34, left: 40 };
  const lgLo = Math.log10(2), lgHi = 3;
  const x = linear(lgLo, lgHi, m.left, w - m.right);
  const y = linear(0, 3.4, h - m.bottom, m.top);

  const pts = Array.from({ length: 90 }, (_, i) => {
    const lg = lgLo + (i / 89) * (lgHi - lgLo);
    const n = Math.pow(10, lg);
    return { lg, v: expectedBestOfN(n) };
  });
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.lg)},${y(p.v)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      {[0, 1, 2, 3].map((t) => (
        <g key={t}>
          <line x1={m.left} x2={w - m.right} y1={y(t)} y2={y(t)}
                stroke="var(--grid)" strokeWidth={1} />
          <text x={m.left - 7} y={y(t)} dy="0.32em" textAnchor="end"
                fontSize={10} fill="var(--muted)">{t}σ</text>
        </g>
      ))}
      {[2, 10, 100, 1000].map((n) => (
        <text key={n} x={x(Math.log10(n))} y={h - m.bottom + 15} textAnchor="middle"
              fontSize={10} fill="var(--muted)">{n}</text>
      ))}
      <line x1={m.left} x2={w - m.right} y1={h - m.bottom} y2={h - m.bottom}
            stroke="var(--axis)" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
      {MARKS.map(({ n, label }) => {
        const v = expectedBestOfN(n);
        return (
          <g key={n}>
            <circle cx={x(Math.log10(n))} cy={y(v)} r={4.5} fill="var(--series-1)"
                    stroke="var(--surface-1)" strokeWidth={2} />
            <text x={x(Math.log10(n))} y={y(v) - 9} textAnchor="middle" fontSize={10.5}
                  fill="var(--text-secondary)" stroke="var(--surface-1)"
                  strokeWidth={3} paintOrder="stroke">
              {label} · {v.toFixed(2)}σ
            </text>
          </g>
        );
      })}
      <text x={(m.left + w - m.right) / 2} y={h - 6} textAnchor="middle"
            fontSize={10.5} fill="var(--text-secondary)">
        number of trials searched
      </text>
    </svg>
  );
}

/** The distribution of the winner's score.
 *
 *  Not a schematic and not simulated: the maximum of N standard normals has
 *  density N*Phi(x)^(N-1)*phi(x) exactly, so this is that curve evaluated.
 *  Two markers, deliberately -- the first guess and the average -- because the
 *  gap between them is the entire point of the passage it illustrates.
 */
export function MaxDistribution(
  { n, guess, mean }: { n: number; guess: number; mean: number },
) {
  const w = 460, h = 176;
  const m = { top: 30, right: 20, bottom: 34, left: 24 };
  const lo = 0.5, hi = 4.5;
  const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const dens = (x: number) => n * Math.pow(normCdf(x), n - 1) * phi(x);

  const pts = Array.from({ length: 140 }, (_, i) => {
    const x = lo + (i / 139) * (hi - lo);
    return { x, y: dens(x) };
  });
  const peak = Math.max(...pts.map((p) => p.y));
  const X = linear(lo, hi, m.left, w - m.right);
  const Y = linear(0, peak * 1.12, h - m.bottom, m.top);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.y)}`).join(" ");
  const right = pts.filter((p) => p.x >= guess);
  const shaded = right.length
    ? `M${X(right[0].x)},${Y(0)} `
      + right.map((p) => `L${X(p.x)},${Y(p.y)}`).join(" ")
      + ` L${X(hi)},${Y(0)} Z`
    : "";

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet">
      <path d={shaded} fill="var(--series-1)" opacity={0.16} />
      <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} />
      <line x1={m.left} x2={w - m.right} y1={Y(0)} y2={Y(0)}
            stroke="var(--axis)" strokeWidth={1} />
      {[1, 2, 3, 4].map((t) => (
        <text key={t} x={X(t)} y={Y(0) + 15} textAnchor="middle" fontSize={10}
              fill="var(--muted)">{t}σ</text>
      ))}
      <line x1={X(guess)} x2={X(guess)} y1={m.top - 8} y2={Y(0)}
            stroke="var(--rule)" strokeWidth={1.5} />
      <text x={X(guess) - 6} y={m.top - 12} textAnchor="end" fontSize={10.5}
            fill="var(--text-secondary)">first guess {guess.toFixed(2)}σ</text>
      <line x1={X(mean)} x2={X(mean)} y1={m.top + 6} y2={Y(0)}
            stroke="var(--neg)" strokeWidth={2} />
      <text x={X(mean) + 6} y={m.top + 2} textAnchor="start" fontSize={10.5}
            fill="var(--text-secondary)">average {mean.toFixed(2)}σ</text>
      <text x={(m.left + w - m.right) / 2} y={h - 6} textAnchor="middle"
            fontSize={10.5} fill="var(--text-secondary)">
        score of the best of {n} rules, over many repeats
      </text>
    </svg>
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
