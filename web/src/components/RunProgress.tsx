import type { RunStatus } from "../api";

export function RunProgress({ run }: { run: RunStatus }) {
  if (run.state !== "queued" && run.state !== "running") return null;

  const total = Math.max(0, run.n_trials);
  const done = Math.min(total, Math.max(0, run.n_done));
  const queued = run.state === "queued";
  const preparing = !queued && run.phase === "preparing";
  const auditing = !queued && (run.phase === "audit" || (total > 0 && done === total));
  const indeterminate = queued || preparing || auditing || total === 0;
  const percent = total ? Math.floor(done / total * 100) : 0;
  const phase = queued ? 0 : preparing ? 1 : auditing ? 3 : 2;
  const title = queued ? "Queued — waiting to start" : preparing ? "Preparing market data"
    : auditing ? "Computing the audit" : "Running trials";
  const detail = queued ? (run.backend === "slurm" ? "Waiting for a compute node." : `${total} trials ready to run`)
    : preparing ? "Building the universe and preparing returns on the compute worker."
    : auditing ? "All trials finished. Calculating the statistical checks."
    : `${done} of ${total} trials complete`;

  return (
    <section id="run-progress" className="run-progress" aria-label="Run progress">
      <div className="run-progress-heading">
        <div role="status" aria-live="polite" aria-atomic="true">
          <div className="run-progress-title">
            <span className="run-progress-dot" aria-hidden="true" />
            <strong>{title}</strong>
          </div>
          <div className="sub">{detail}</div>
          {run.job_id && <div className="help">Job {run.job_id}{run.node ? ` · ${run.node}` : ""}
            {queued && run.queue_reason ? ` · ${run.queue_reason}` : ""}</div>}
        </div>
        {!indeterminate && <span className="run-progress-percent" aria-hidden="true">{percent}%</span>}
      </div>
      <div className={`run-progress-track${indeterminate ? " is-indeterminate" : ""}`}
        role="progressbar" aria-label={indeterminate ? title : "Trials completed"}
        aria-valuemin={0} aria-valuemax={total || 100}
        aria-valuenow={indeterminate ? undefined : done}
        aria-valuetext={detail}>
        <div className="run-progress-fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      <ol className="run-progress-stages" aria-label="Run stages">
        {["Queued", "Data", "Trials", "Audit"].map((label, i) => (
          <li key={label} className={i < phase ? "is-finished" : undefined}
            aria-current={i === phase ? "step" : undefined}>
            <span aria-hidden="true">{i < phase ? "✓" : "○"}</span> {label}
          </li>
        ))}
      </ol>
    </section>
  );
}
