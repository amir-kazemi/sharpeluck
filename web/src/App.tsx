import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SCHEMA_VERSION, type RunStatus } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProvenanceBar } from "./components/Provenance";
import { Method } from "./components/Method";
import { Figure } from "./components/Figure";
import { SubmitPanel } from "./components/SubmitPanel";
import { TrialTable } from "./components/TrialTable";
import { AuditTable, Verdict } from "./components/Verdict";
import { CloudTable, TrialCloud } from "./charts/TrialCloud";
import { CostCurve, CostTable } from "./charts/CostCurve";
import { EquityCurve, EquityTable } from "./charts/EquityCurve";
import { TrialSpread } from "./charts/TrialSpread";

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem("theme") ?? "system"; } catch { return "system"; }
  });
  // "system" looks identical to whichever mode the OS is in, which is confusing
  // when they coincide -- so say which one it resolved to.
  const osDark = typeof matchMedia === "function"
    && matchMedia("(prefers-color-scheme: dark)").matches;
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
                style={{ padding: "3px 9px", fontSize: 12 }}
                title={t === "system" ? `follows your OS (currently ${osDark ? "dark" : "light"})` : `always ${t}`}>
          {t === "system" ? `system (${osDark ? "dark" : "light"})` : t}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  // Runs written by an older build are readable but not by these charts, so
  // they are hidden unless asked for rather than left to confuse the picker.
  const [showAll, setShowAll] = useState(false);
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem("token") ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("token", token); } catch { /* private mode */ }
  }, [token]);

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

  const visible = (runs.data ?? []).filter(
    (r) => showAll || loadable(r) || r.state === "running" || r.state === "queued",
  );
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

  const remove = useMutation({
    mutationFn: (rid: string) => api.remove(rid, token || undefined),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });

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
          {visible.length === 0 && <option value="">no runs yet</option>}
          {visible.map((r) => (
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
        <label className="row" style={{ gap: 5 }}>
          <input type="checkbox" checked={showAll} style={{ width: 14, height: 14 }}
                 onChange={(e) => setShowAll(e.target.checked)} />
          <span className="sub">
            show all ({(runs.data ?? []).length - visible.length} hidden)
          </span>
        </label>
        <button disabled={!id || remove.isPending}
                onClick={() => {
                  if (id && confirm(`Delete run ${id}? This cannot be undone.`)) {
                    remove.mutate(id);
                  }
                }}
                style={{ padding: "3px 9px", fontSize: 12 }}
                title="Each run stores its own copy of the prepared panel, tens of MB">
          {remove.isPending ? "deleting…" : "delete run"}
        </button>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">token</span>
          <input value={token} type="password" placeholder="if required"
                 style={{ width: 110 }}
                 onChange={(e) => setToken(e.target.value)} />
        </label>
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
        <p className="note">
          A <strong>trial</strong> is one trading rule: score every coin in the
          universe each day, buy the high scorers, short the low ones, hold until
          the next rebalance. A <strong>run</strong> searches many trials at once
          and then asks the question that matters — <strong>how much of the best
          one&rsquo;s performance is real, and how much is just the reward for
          having looked so many times?</strong>
        </p>

        {run?.provenance && (
          <ProvenanceBar p={run.provenance} u={audit.data?.universe} />
        )}
        {audit.data && (
          <>
            <p className="note">
              The strategy below scored best <em>in sample</em> — it is the one you
              would have picked. Everything after this point is an attempt to knock
              it down.
            </p>
            <Figure title="Verdict" chart={<Verdict audit={audit.data} />}
                    table={<AuditTable audit={audit.data} />} />
          </>
        )}

        {audit.data && (
          <p className="note">
            Two independent ways of attacking it. On the left: split the history in
            half many times over, pick the winner in one half, and see where it
            lands in the other — a good rule should keep winning. On the right: the
            edge is worth nothing if trading costs eat it, so the Sharpe is
            recomputed at rising costs until it dies.
          </p>
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
          <p className="note">
            What holding this strategy would actually have done: 1.0 is your
            starting money, and the two lines are before and after trading costs.
            The gap between them is what the broker takes.
          </p>
        )}

        {equity.data && (
          <Figure title="Equity curve" sub="The winner, gross and net of cost"
                  chart={<EquityCurve points={equity.data} />}
                  table={<EquityTable points={equity.data} />} />
        )}

        {trials.data && audit.data && (
          <p className="note">
            Every trial the search ran, best to worst, with the horizontal line
            marking what the best of a search this size scores on data containing
            no edge whatsoever. Dots below that line are not evidence of anything —
            and when the whole cloud sits below it, the winner was manufactured by
            the search rather than found by it.
          </p>
        )}

        {trials.data && audit.data && (
          <Figure
            title="Trials"
            sub={`All ${trials.data.length} trials against the Sharpe the best of this search would reach on data with no edge`}
            chart={<TrialSpread trials={trials.data} audit={audit.data} />}
            table={<TrialTable trials={trials.data} winner={audit.data.winner.trial} />}
          />
        )}

        <p className="note">
          Now try your own. Change the signal, the rebalance frequency, the cost
          assumption, or how wide the universe is — every one of those is a
          research decision, and the point of this page is that they all change the
          answer.
        </p>
        <SubmitPanel onSubmitted={setSelected} token={token} />
        <Method />
      </div>
      </ErrorBoundary>
    </div>
  );
}
