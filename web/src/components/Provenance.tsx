import type { Provenance, UniverseSpec } from "../api";

const money = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v}`;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** What the numbers are about. Without this the page audits a strategy without
 *  ever saying what it traded, over what, or when. */
export function ProvenanceBar({ p, u }: { p: Provenance; u?: UniverseSpec }) {
  return (
    <section className="card" style={{ padding: "12px 16px" }}>
      <div className="row" style={{ gap: 8, rowGap: 4 }}>
        <strong style={{ fontSize: 13 }}>
          {day(p.start)} → {day(p.end)}
        </strong>
        <span className="muted">·</span>
        <span className="sub">{p.n_bars.toLocaleString()} hourly bars</span>
        <span className="muted">·</span>
        <span className="sub">
          {p.n_symbols_traded} of {p.n_symbols_available} crypto pairs traded
        </span>
        <span className="muted">·</span>
        <span className="sub">
          ~{p.mean_universe_size.toFixed(0)} held at a time over{" "}
          {p.n_rebalances.toLocaleString()} rebalances
        </span>
      </div>
      {u && (
        <div className="sub" style={{ marginTop: 6 }}>
          Universe: the top {u.max_symbols} USDT pairs by 30-day dollar volume,
          requiring at least {money(u.min_adv_usd)}/hour of volume,{" "}
          {Math.round(u.min_history_h / 24)} days of history and{" "}
          {(u.min_coverage * 100).toFixed(0)}% bar coverage — rebuilt every{" "}
          {u.rebalance_every_h}h from data available at that moment, so pairs that
          were later delisted are still in it.
        </div>
      )}
    </section>
  );
}
