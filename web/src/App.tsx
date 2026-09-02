import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, SCHEMA_VERSION, type RunStatus } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Figure } from "./components/Figure";
import { SubmitPanel } from "./components/SubmitPanel";
import { TrialTable } from "./components/TrialTable";
import { AuditTable, Verdict } from "./components/Verdict";
import { CloudTable, TrialCloud } from "./charts/TrialCloud";
import { CostCurve, CostTable } from "./charts/CostCurve";
import { EquityCurve, EquityTable } from "./charts/EquityCurve";

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("theme") ?? "system",
  );
  useEffect(() => {
    const r = document.documentElement;
    if (theme === "system") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
  }, [theme]);
  return (
    <div className="row" style={{ gap: 4 }}>
      {(["light", "system", "dark"] as const).map((t) => (
        <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}
                style={{ padding: "3px 9px", fontSize: 12 }}>
          {t}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [selected, setSelected] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: api.runs,
    // Poll only while something is actually in flight.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.state === "queued" || r.state === "running")
        ? 1500 : false,
  });

  const loadable = (r: RunStatus) =>
    r.state === "done" && (r.schema_version ?? 0) === SCHEMA_VERSION;

  const id = selected ?? runs.data?.find(loadable)?.run_id ?? null;
  const run = runs.data?.find((r) => r.run_id === id) ?? null;
  const ready = !!run && loadable(run);
  // A finished run whose artefacts predate this build: readable, but not by
  // these charts. Say so rather than rendering empty panels.
  const outdated = run?.state === "done" && !ready;

  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => api.audit(id!), enabled: !!id && ready });
  const trials = useQuery({ queryKey: ["trials", id], queryFn: () => api.trials(id!), enabled: !!id && ready });
  const cloud = useQuery({ queryKey: ["cloud", id], queryFn: () => api.cloud(id!), enabled: !!id && ready });
  const equity = useQuery({ queryKey: ["equity", id], queryFn: () => api.equity(id!), enabled: !!id && ready });

  const busy = audit.isFetching || trials.isFetching || cloud.isFetching || equity.isFetching;

  return (
    <div className="wrap">
      <header className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 21 }}>alpha-audit</h1>
          <div className="sub">How much of your Sharpe is selection bias?</div>
        </div>
        <ThemeToggle />
      </header>

      {/* One filter row, above everything it scopes. */}
      <div className="row" style={{ margin: "18px 0 16px", gap: 10 }}>
        <span className="sub">Run</span>
        <select value={id ?? ""} onChange={(e) => setSelected(e.target.value || null)}
                style={{ minWidth: 340 }}>
          {(runs.data ?? []).length === 0 && <option value="">no runs yet</option>}
          {(runs.data ?? []).map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {r.created_at.replace("T", " ").slice(0, 16)} · {r.n_trials} trials
              {r.label ? ` · ${r.label}` : ""} · {r.state}
              {r.state === "running" ? ` ${r.n_done}/${r.n_trials}` : ""}
              {r.state === "done" && !loadable(r) ? " · older format" : ""}
            </option>
          ))}
        </select>
        {run && run.state === "running" && (
          <span className="sub">{run.n_done}/{run.n_trials} trials complete</span>
        )}
      </div>

      {outdated && (
        <section className="card">
          <h3>Older result format</h3>
          <p className="sub">
            This run finished, but its stored results predate the current audit
            layer (schema {run?.schema_version ?? 0}, this build reads{" "}
            {SCHEMA_VERSION}). Submit the run again below to produce results these
            charts can read.
          </p>
        </section>
      )}

      {run?.state === "failed" && (
        <section className="card" style={{ borderColor: "var(--critical)" }}>
          <h3 style={{ color: "var(--critical)" }}>✕ Run failed</h3>
          <pre className="sub" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{run.error}</pre>
        </section>
      )}

      <ErrorBoundary resetKey={id ?? ""}>
      <div className={busy ? "stale" : undefined}
           style={{ display: "grid", gap: 16 }}>
        {audit.data && (
          <Figure title="Verdict" chart={<Verdict audit={audit.data} />}
                  table={<AuditTable audit={audit.data} />} />
        )}

        <div className="grid2">
          {cloud.data && audit.data && (
            <Figure
              title="Trial cloud"
              sub={`${cloud.data.length} half-sample splits: where the in-sample winner landed out of sample`}
              chart={<TrialCloud points={cloud.data} pbo={audit.data.pbo.pbo} />}
              table={<CloudTable points={cloud.data} />}
            />
          )}
          {audit.data && (
            <Figure
              title="Cost sensitivity"
              sub="Net Sharpe of the winner against assumed transaction cost"
              chart={<CostCurve audit={audit.data} />}
              table={<CostTable audit={audit.data} />}
            />
          )}
        </div>

        {equity.data && (
          <Figure title="Equity curve" sub="The winner, gross and net of cost"
                  chart={<EquityCurve points={equity.data} />}
                  table={<EquityTable points={equity.data} />} />
        )}

        {trials.data && audit.data && (
          <Figure title="Trials"
                  sub={`All ${trials.data.length} trials, sorted by the column selection happened on`}
                  chart={<div className="scroll">
                    <TrialTable trials={trials.data} winner={audit.data.winner.trial} />
                  </div>}
                  table={<TrialTable trials={trials.data} winner={audit.data.winner.trial} />} />
        )}

        <SubmitPanel onSubmitted={setSelected} />
      </div>
      </ErrorBoundary>
    </div>
  );
}
