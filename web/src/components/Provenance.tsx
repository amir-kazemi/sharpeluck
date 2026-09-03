import type { Provenance, UniverseSpec } from "../api";

const money = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v}`;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const year = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : 0);

/** One series, one colour: these three counts are nested subsets of each other,
 *  so the bar lengths carry the whole comparison and a second hue would encode
 *  nothing. Every value is directly labelled, so nothing needs a hover. */
function Bar({ n, of, label }: { n: number; of: number; label: string }) {
  const pct = of > 0 ? Math.max(0.6, (n / of) * 100) : 0;
  return (
    <div className="funnel-row">
      <div className="funnel-n">{n.toLocaleString()}</div>
      <div className="funnel-track">
        <div className="funnel-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="funnel-label">{label}</div>
    </div>
  );
}

export function ProvenanceBar({ p, u }: { p: Provenance; u?: UniverseSpec }) {
  const y0 = year(p.start);
  const y1 = year(p.end);
  const years = y1 >= y0 ? Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i) : [];
  const held = Math.round(p.mean_universe_size);

  return (
    <section className="card">
      <h3>The data</h3>

      {/* Span. The axis is the sample; the ticks are the years it covers. */}
      <div className="timeline">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{day(p.start)}</strong>
          <span className="sub">
            {p.n_bars.toLocaleString()} hourly bars · {p.n_rebalances.toLocaleString()}{" "}
            rebalances
          </span>
          <strong>{day(p.end)}</strong>
        </div>
        <div className="timeline-rule" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          {years.map((y) => (
            <span key={y} className="help" style={{ marginTop: 2 }}>{y}</span>
          ))}
        </div>
      </div>

      {/* Counts of pairs, from every one the archive lists down to how many are
          held at a given moment. The first two are cumulative over the sample
          and the third is an average at a point in time, which is why the last
          bar is so much shorter -- and is the point of the figure. */}
      <div className="funnel">
        <Bar n={p.n_symbols_available} of={p.n_symbols_available}
             label="in the archive" />
        <Bar n={p.n_symbols_traded} of={p.n_symbols_available}
             label="traded, ever" />
        <Bar n={held} of={p.n_symbols_available} label="traded at once" />
      </div>

      {u && (
        <>
          <div className="row" style={{ gap: 6, marginTop: 14 }}>
            {[
              `top ${u.max_symbols} by 30-day dollar volume`,
              `≥ ${money(u.min_adv_usd)}/hour`,
              `≥ ${Math.round(u.min_history_h / 24)} days of history`,
              `≥ ${(u.min_coverage * 100).toFixed(0)}% bar coverage`,
              `rebuilt every ${u.rebalance_every_h}h`,
            ].map((t) => <span key={t} className="pill">{t}</span>)}
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            The first two bars count pairs over the whole sample; the last is how
            many are held at any given moment — so{" "}
            <strong>{p.n_symbols_traded} pairs rotate through {held} slots,
            turning the cross-section over{" "}
            {(p.n_symbols_traded / Math.max(1, held)).toFixed(1)}×</strong>. The
            universe is rebuilt at each rebalance from data available then, which
            is why pairs that were later delisted are still in it.
          </div>
        </>
      )}
    </section>
  );
}
