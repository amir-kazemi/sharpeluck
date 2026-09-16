import type { Audit, SavedRunSpec } from "../api";
import { RunSettings } from "./RunSettings";

function Tile({ label, value, note, help }:
  { label: string; value: string; note?: string; help?: string }) {
  return (
    <div className="verdict-metric">
      <div className="verdict-metric-label">{label}</div>
      <div className="verdict-metric-value">{value}</div>
      {note && <div className="verdict-metric-note">{note}</div>}
      {help && <div className="verdict-result-description">{help}</div>}
    </div>
  );
}

/**
 * The lead: all three tests that determine the verdict.
 *
 * The status colour never carries the verdict alone: it always arrives with a
 * glyph and a word.
 */
export function Verdict({ audit, spec }: { audit: Audit; spec?: SavedRunSpec }) {
  const { deflation: d, pbo: pb, search_null: sn, cost_curve: cc, winner } = audit;
  const ok = audit.survives;
  const color = ok ? "var(--good)" : "var(--critical)";
  const checks = [
    { label: "Deflated Sharpe", value: sn.dsr, passes: sn.dsr > 0.95, threshold: "> 0.95",
      description: "How confidently the winner clears the noise benchmark." },
    { label: "Overfitting probability", value: pb.pbo, passes: pb.pbo < 0.30, threshold: "< 0.30",
      description: "How often the training winner ranks below the middle on held-out data." },
    { label: "Reality check p", value: sn.rc_p_value, passes: sn.rc_p_value < 0.05, threshold: "< 0.05",
      description: "How often a no-edge simulation finds a winner at least this good." },
  ];

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3>Verdict</h3>
        <span className="pill" style={{ borderColor: color, color }}>
          <span aria-hidden>{ok ? "✓" : "✕"}</span>
          <strong>{ok ? "Survives the audit" : "Does not survive"}</strong>
        </span>
      </div>

      <div className="verdict-overview">
        <div className="verdict-results">
          {checks.map(check => (
            <div key={check.label} className={`verdict-result ${check.passes ? "verdict-result-pass" : "verdict-result-fail"}`}>
              <div className="verdict-result-heading">
                <span>{check.label}</span><span>needs {check.threshold}</span>
              </div>
              <div className="verdict-result-reading">
                <strong>{check.value.toFixed(4)}</strong>
                <span>{check.passes ? "✓ Pass" : "✕ Fail"}</span>
              </div>
              <div className="verdict-result-description">{check.description}</div>
            </div>
          ))}
        </div>
        {spec && <RunSettings spec={spec} nTrials={d.n_trials} winner={winner} />}
      </div>

      <div className="verdict-support-heading">
        Supporting metrics
      </div>
      <div className="verdict-metrics">
        <Tile label="Net Sharpe" value={d.sr_ann.toFixed(2)}
              note={`${(winner.gross_sharpe ?? 0).toFixed(2)} before costs`}
              help="Winner’s annualised score after costs; compared with the noise benchmark." />
        <Tile label="Noise benchmark" value={sn.sr0_ann.toFixed(2)}
              note={`${d.sr0_ann.toFixed(2)} if the trials were independent`}
              help="Average best Sharpe in no-edge simulations; used by Deflated Sharpe." />
        <Tile label="Effective trials" value={`${sn.n_eff.toFixed(1)} / ${d.n_trials}`}
              note={`mean |correlation| ${sn.mean_abs_corr.toFixed(2)}`}
              help="Independent trials giving the same noise benchmark. Context for the search size." />
        <Tile label="Break-even cost" value={`${cc.break_even_bps?.toFixed(1) ?? "—"} bps`}
              note={`${winner.cost_bps} bps charged in this run`}
              help="Cost that brings average net return to zero. Shows sensitivity to trading costs." />
      </div>
      <details className="verdict-statistics">
        <summary>All statistics</summary>
        <div className="scroll"><AuditTable audit={audit} /></div>
      </details>
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
