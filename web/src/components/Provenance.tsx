import type { Provenance, UniverseSpec } from "../api";

const money = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v}`;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const yr = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : 0);

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="prov-stat">{value}</div>
      <div className="help" style={{ marginTop: 0 }}>{label}</div>
    </div>
  );
}

/**
 * Three facts, on the axes they belong on.
 *
 * `410 of 678 pairs traded` is a genuine part-to-whole and gets the bar. The
 * number held at once is an average at a point in time, not a subset of the
 * archive, so it is a figure and not a third bar -- putting it on the same
 * proportional scale compared a four-year count against an instantaneous one,
 * which is why it looked arbitrarily short.
 */
export function ProvenanceBar({ p, u }: { p: Provenance; u?: UniverseSpec }) {
  const held = Math.round(p.mean_universe_size);
  const rotations = held > 0 ? p.n_symbols_traded / held : 0;
  const pct = p.n_symbols_available > 0
    ? (p.n_symbols_traded / p.n_symbols_available) * 100
    : 0;
  const years = Array.from(
    { length: Math.max(0, yr(p.end) - yr(p.start) + 1) },
    (_, i) => yr(p.start) + i,
  );

  return (
    <section className="card">
      <h3>The data</h3>

      <div className="timeline">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{day(p.start)}</strong>
          <strong>{day(p.end)}</strong>
        </div>
        <div className="timeline-rule" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          {years.map((y) => <span key={y} className="help">{y}</span>)}
        </div>
      </div>

      <div className="prov-grid">
        <Stat value={p.n_bars.toLocaleString()} label="hourly bars" />
        <Stat value={p.n_rebalances.toLocaleString()} label="rebalances" />
        <Stat value={String(held)} label="pairs held at once" />
        <Stat value={`${rotations.toFixed(1)}×`} label="cross-section turnover" />
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="sub"><strong>{p.n_symbols_traded}</strong> pairs traded</span>
          <span className="sub">
            <strong>{p.n_symbols_available}</strong> in the archive
          </span>
        </div>
        <div className="pw-track">
          <div className="pw-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="help">
          {pct.toFixed(0)}% of every USDT pair Binance has ever listed was liquid
          enough to trade at some point in this sample.
        </div>
      </div>

      {u && (
        <>
          <div className="row" style={{ gap: 6, marginTop: 18 }}>
            {[
              `top ${u.max_symbols} by 30-day dollar volume`,
              `≥ ${money(u.min_adv_usd)}/hour`,
              `≥ ${Math.round(u.min_history_h / 24)} days of history`,
              `≥ ${(u.min_coverage * 100).toFixed(0)}% bar coverage`,
              `rebuilt every ${u.rebalance_every_h}h`,
            ].map((t) => <span key={t} className="pill">{t}</span>)}
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            The universe is rebuilt at every rebalance from the data available at
            that moment, so pairs that later died — LUNA, FTT — are still in it on
            the days they were liquid.
          </div>
        </>
      )}
    </section>
  );
}
