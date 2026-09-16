import { useEffect, useState } from "react";
import { linear, padded } from "../charts/primitives";
import { expectedBestOfN, GROSS_USD, usd } from "./toyCalc";

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
 *  and gains identically. Use SharpeScale for anything that can go below zero. */
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

/* -------------------------------------------------------------------------
 * The book, day by day.
 *
 * A ring rather than bars because the quantity being shown is a share of one
 * fixed thing -- the gross book -- and because the rule's defining constraint
 * is visible in the geometry: the shorts always sum to exactly half, so the
 * boundary between the two sides is a vertical diameter that never moves.
 * Only the slices inside it change hands. Four segments of a whole is the one
 * case a ring is the right form; comparing close values in it would not be.
 *
 * Three discrete frames, cycled -- the animated version of three table rows.
 * ---------------------------------------------------------------------- */

const RING_R = 82, RING_IR = 42, RING_CX = 150, RING_CY = 104;
const RING_TAU = Math.PI * 2;

const ringPt = (a: number, r: number) =>
  [RING_CX + r * Math.sin(a), RING_CY - r * Math.cos(a)] as const;

/** Annular sector from a0 to a1; negative sweep runs anticlockwise. */
function sector(a0: number, a1: number) {
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  const [x0, y0] = ringPt(a0, RING_R), [x1, y1] = ringPt(a1, RING_R);
  const [x2, y2] = ringPt(a1, RING_IR), [x3, y3] = ringPt(a0, RING_IR);
  return `M${x0},${y0} A${RING_R},${RING_R} 0 ${large} ${sweep} ${x1},${y1} `
       + `L${x2},${y2} A${RING_IR},${RING_IR} 0 ${large} ${1 - sweep} ${x3},${y3} Z`;
}

type BookDay = {
  day: number;
  pnl: number;
  cum: number;
  weights: Record<string, number>;
};

export function BookRing({ coins, weights }: { coins: readonly string[]; weights: Record<string, number> }) {
  // Longs sweep clockwise from twelve, shorts anticlockwise. Each side sums to
  // a half turn on its own, so the two meet at six o'clock without being told.
  let longA = 0, shortA = 0;
  const slices = coins.map((c) => {
    const w = weights[c];
    const span = Math.abs(w) * RING_TAU;
    const a0 = w >= 0 ? longA : shortA;
    const a1 = w >= 0 ? (longA += span) : (shortA -= span);
    return { coin: c, w, a0, a1, mid: (a0 + a1) / 2 };
  });
  return (
    <svg viewBox="0 0 300 212" width="100%" style={{ maxWidth: 300 }} role="img"
         aria-label="Share of the book held in each coin, long and short">
      {slices.map(({ coin, w, a0, a1 }) => (
        <path key={coin} d={sector(a0, a1)}
              fill={w >= 0 ? "var(--pos)" : "var(--neg)"}
              stroke="var(--surface-1)" strokeWidth={2} />
      ))}
      {slices.map(({ coin, w, mid }) => {
        const [lx, ly] = ringPt(mid, RING_R + 17);
        const side = Math.sin(mid);
        const anchor = side > 0.12 ? "start" : side < -0.12 ? "end" : "middle";
        return (
          <text key={coin} x={lx} y={ly} textAnchor={anchor} dy="0.32em" fontSize={11.5}>
            <tspan fill="var(--text-primary)" fontWeight={600}>{coin}</tspan>
            <tspan fill="var(--text-secondary)"> {(Math.abs(w) * 100).toFixed(1)}%</tspan>
          </text>
        );
      })}
      <text x={RING_CX} y={RING_CY - 3} textAnchor="middle" fontSize={13} fontWeight={600}
            fill="var(--text-primary)">{usd(GROSS_USD, 0)}</text>
      <text x={RING_CX} y={RING_CY + 13} textAnchor="middle" fontSize={10.5} fill="var(--muted)">gross</text>
    </svg>
  );
}

export function BookWheel(
  { days, coins, windowLabel }:
  { days: BookDay[]; coins: readonly string[]; windowLabel: (day: number) => string },
) {
  const [i, setI] = useState(0);
  // Auto-advance is the point -- it is the animation -- but a reader who wants
  // to stop on a frame clicks one, and that must not be fought over.
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % days.length), 2600);
    return () => clearInterval(t);
  }, [playing, days.length]);

  const d = days[i];
  const stat = (label: string, value: string, tone?: string) => (
    <div>
      <div className="tile-label">{label}</div>
      <div className="tile-value" style={{ fontSize: 23, color: tone }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="row" style={{ gap: 6 }}>
        {days.map((x, n) => (
          <button key={x.day} aria-pressed={n === i}
                  onClick={() => { setI(n); setPlaying(false); }}
                  style={{ padding: "3px 9px", fontSize: 12 }}>
            day {x.day}
          </button>
        ))}
        {!playing && (
          <button onClick={() => setPlaying(true)} style={{ padding: "3px 9px", fontSize: 12 }}>
            play
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 26, alignItems: "center" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <BookRing coins={coins} weights={d.weights} />
        </div>
        <div style={{ display: "grid", gap: 14, flex: "1 1 170px", minWidth: 0 }}>
          {stat("weighted from", `days ${windowLabel(d.day)}`)}
          {stat("day's P&L", `${d.pnl >= 0 ? "+" : ""}${(d.pnl * 100).toFixed(2)}%`,
                d.pnl >= 0 ? "var(--pos)" : "var(--neg)")}
          {stat(`on ${usd(GROSS_USD, 0)}`, usd(d.pnl * GROSS_USD))}
          {stat("running total", usd(d.cum * GROSS_USD))}
        </div>
      </div>
      <div className="row" style={{ gap: 16 }}>
        {[["long", "var(--pos)"], ["short", "var(--neg)"]].map(([label, color]) => (
          <span key={label} className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: color }} />
            <span className="sub">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * What the Sharpe ratio actually is, drawn.
 *
 * Replaces a bar per day, which showed the three numbers again after the ring
 * had already shown them. The ratio is a comparison between two lengths -- how
 * far the average sits from zero, against how far the days scatter -- so the
 * useful picture is those two lengths on one axis, where the reader can see
 * one is a fraction of the other before meeting the formula.
 * ---------------------------------------------------------------------- */

export function SharpeScale(
  { days, avg, sd }: { days: { day: number; pnl: number }[]; avg: number; sd: number },
) {
  const w = 460, h = 132, pad = 46;
  const vals = days.map((d) => d.pnl);
  const [lo, hi] = padded(Math.min(0, avg - sd, ...vals), Math.max(0, avg + sd, ...vals), 0.12);
  const x = linear(lo, hi, pad, w - pad);
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

  // The two lowest days sit a fifth of a percent apart; labelling both on one
  // row would overlap them, so the row alternates by rank instead.
  const ranked = [...days].sort((a, b) => a.pnl - b.pnl);
  const above = (d: number) => ranked.findIndex((r) => r.day === d) % 2 === 1;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img"
         aria-label="The three daily returns, their average, and their spread, on one axis">
      <rect x={x(avg - sd)} y={40} width={Math.max(0, x(avg + sd) - x(avg - sd))} height={18}
            fill="var(--wash)" />
      <line x1={x(0)} x2={x(0)} y1={32} y2={66} stroke="var(--axis)" strokeWidth={1} />
      <line x1={x(avg)} x2={x(avg)} y1={32} y2={66} stroke="var(--rule)" strokeWidth={2} />

      {days.map(({ day, pnl }) => (
        <circle key={day} cx={x(pnl)} cy={49} r={5} fill="var(--series-1)"
                stroke="var(--surface-1)" strokeWidth={2} />
      ))}
      {days.map(({ day, pnl }) => (
        <text key={day} x={x(pnl)} y={above(day) ? 30 : 80} textAnchor="middle"
              fontSize={11} fill="var(--text-secondary)">
          day {day} {fmt(pnl)}
        </text>
      ))}

      <text x={x(0)} y={98} textAnchor="middle" fontSize={11} fill="var(--muted)">zero</text>

      {/* The two lengths the ratio is made of. */}
      <line x1={x(avg)} x2={x(avg + sd)} y1={112} y2={112} stroke="var(--axis)" strokeWidth={1} />
      <line x1={x(avg)} x2={x(avg)} y1={108} y2={116} stroke="var(--axis)" strokeWidth={1} />
      <line x1={x(avg + sd)} x2={x(avg + sd)} y1={108} y2={116} stroke="var(--axis)" strokeWidth={1} />
      <text x={(x(avg) + x(avg + sd)) / 2} y={128} textAnchor="middle" fontSize={11}
            fill="var(--text-secondary)">spread {(sd * 100).toFixed(2)}%</text>
      <text x={x(avg)} y={14} textAnchor="middle" fontSize={11} fill="var(--text-primary)">
        average {fmt(avg)}
      </text>
    </svg>
  );
}
