import type { Audit } from "../api";
import { describe } from "../describe";

function Tile({ label, value, note, help }:
  { label: string; value: string; note?: string; help?: string }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="sub" style={{ marginTop: 2 }}>{note}</div>}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

/**
 * The lead. One hero figure -- the probability the winner's edge is real once
 * the search is accounted for -- and the numbers that produced it.
 *
 * The status colour never carries the verdict alone: it always arrives with a
 * glyph and a word.
 */
export function Verdict({ audit }: { audit: Audit }) {
  const { deflation: d, pbo: pb, search_null: sn, cost_curve: cc, winner } = audit;
  const ok = audit.survives;
  const color = ok ? "var(--good)" : "var(--critical)";

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3>Verdict</h3>
          <div className="sub">
            {describe(winner.expr) ?? "In-sample winner"} — rebalanced every{" "}
            {winner.rebalance_every_h}h, dollar-neutral. Best of {d.n_trials}{" "}
            trials searched.
          </div>
          <div className="sub" style={{ marginTop: 2 }}>
            <code>{winner.expr}</code>
          </div>
        </div>
        <span className="pill" style={{ borderColor: color, color }}>
          <span aria-hidden>{ok ? "✓" : "✕"}</span>
          <strong>{ok ? "Survives the audit" : "Does not survive"}</strong>
        </span>
      </div>

      <div className="row" style={{ gap: 28, marginTop: 18, alignItems: "flex-end" }}>
        <div>
          <div className="hero">{(sn.dsr * 100).toFixed(0)}%</div>
          <div className="sub" style={{ maxWidth: 340 }}>
            Deflated Sharpe: the probability this edge is real, given that {d.n_trials} trials
            were run and behaved like {sn.n_eff.toFixed(1)} independent ones.
          </div>
        </div>
        <p className="sub" style={{ maxWidth: 420, margin: 0 }}>
          A net Sharpe of {d.sr_ann.toFixed(2)} sounds like something, but the best of this
          search would have scored {sn.sr0_ann.toFixed(2)} on data with no edge at all. The
          gross Sharpe is {(winner.gross_sharpe ?? 0).toFixed(2)}, and the edge breaks even at{" "}
          {cc.break_even_bps?.toFixed(1) ?? "—"} bps of cost against the {winner.cost_bps} bps
          charged here.
        </p>
      </div>

      <div className="sub" style={{ marginTop: 20, marginBottom: 6 }}>
        What was measured
      </div>
      <div className="tiles">
        <Tile label="Net Sharpe" value={d.sr_ann.toFixed(2)}
              note={`gross ${(winner.gross_sharpe ?? 0).toFixed(2)}`}
              help="Return per unit of risk, annualised, after costs. Around 1 is respectable; the catch is that a big enough search produces big numbers from nothing." />
        <Tile label="Best the noise would give" value={sn.sr0_ann.toFixed(2)}
              note={`${d.sr0_ann.toFixed(2)} if the trials were independent`}
              help="Run this same search on data with no edge in it and the winner would still score about this. The observed Sharpe has to beat it to mean anything." />
        <Tile label="Effective trials" value={`${sn.n_eff.toFixed(1)} / ${d.n_trials}`}
              note={`average correlation ${sn.mean_abs_corr.toFixed(2)}`}
              help="The trials overlap heavily — nested windows, and every signal run beside its own negation — so they amount to fewer genuinely independent looks than the raw count." />
      </div>

      <div className="sub" style={{ marginTop: 20, marginBottom: 6 }}>
        The four tests · all must pass
      </div>
      <div className="tiles">
        <Tile label="Deflated Sharpe" value={sn.dsr.toFixed(3)}
              note={sn.dsr > 0.95 ? "passes (> 0.95)" : "fails (needs > 0.95)"}
              help="Probability the edge is real once the size of the search is accounted for. This is the headline number above." />
        <Tile label="Overfitting probability" value={pb.pbo.toFixed(2)}
              note={`loses money out of sample ${(pb.prob_oos_loss * 100).toFixed(0)}% of splits`}
              help="Split the history in half many times over: how often does the winner of one half fall below average in the other? 0.5 means picking it was a coin flip." />
        <Tile label="Reality check p" value={sn.rc_p_value.toFixed(3)}
              note={`${sn.n_boot} resampled histories`}
              help="The chance of seeing a winner this good if none of the trials had any edge. Below 0.05 is the usual bar." />
        <Tile label="Break-even cost" value={`${cc.break_even_bps?.toFixed(1) ?? "—"} bps`}
              note={`vs ${winner.cost_bps} bps charged here`}
              help="The trading cost at which the edge disappears entirely. The further above what you actually pay, the more room for error." />
      </div>
    </section>
  );
}

export function AuditTable({ audit }: { audit: Audit }) {
  const rows: [string, string][] = [
    ["Observed net Sharpe (annualised)", audit.deflation.sr_ann.toFixed(4)],
    ["Observed gross Sharpe", (audit.winner.gross_sharpe ?? 0).toFixed(4)],
    ["Trials run", String(audit.deflation.n_trials)],
    ["Effective independent trials", audit.search_null.n_eff.toFixed(2)],
    ["Participation ratio", audit.search_null.n_eff_participation.toFixed(2)],
    ["Mean |correlation| between trials", audit.search_null.mean_abs_corr.toFixed(4)],
    ["E[best Sharpe] under null, measured", audit.search_null.sr0_ann.toFixed(4)],
    ["E[best Sharpe] under null, if independent", audit.deflation.sr0_ann.toFixed(4)],
    ["95th pct of null best Sharpe", audit.search_null.sr0_ann_q95.toFixed(4)],
    ["Deflated Sharpe (measured null)", audit.search_null.dsr.toFixed(4)],
    ["Deflated Sharpe (independence assumed)", audit.deflation.dsr.toFixed(4)],
    ["Probabilistic Sharpe vs zero", audit.deflation.psr_vs_zero.toFixed(4)],
    ["Return skew", audit.deflation.skew.toFixed(3)],
    ["Return kurtosis", audit.deflation.kurtosis.toFixed(2)],
    ["Observations", audit.deflation.n_obs.toLocaleString()],
    ["PBO", audit.pbo.pbo.toFixed(4)],
    ["CSCV splits", String(audit.pbo.n_combinations)],
    ["Selection premium (per bar)", audit.pbo.selection_premium.toFixed(5)],
    ["P(out-of-sample loss)", audit.pbo.prob_oos_loss.toFixed(4)],
    ["Reality-check p-value", audit.search_null.rc_p_value.toFixed(4)],
    ["Bootstrap mean block (hours)", audit.search_null.mean_block.toFixed(0)],
    ["Break-even cost (bps)", audit.cost_curve.break_even_bps?.toFixed(2) ?? "—"],
  ];
  return (
    <table>
      <thead><tr><th>Statistic</th><th>Value</th></tr></thead>
      <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
    </table>
  );
}
