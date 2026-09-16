import { Suspense, lazy, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SCHEMA_VERSION, type RunStatus } from "./api";
import { explainTrials } from "./describe";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProvenanceBar } from "./components/Provenance";
import { Figure } from "./components/Figure";
import { SubmitPanel } from "./components/SubmitPanel";
import { RunProgress } from "./components/RunProgress";
import { TrialTable } from "./components/TrialTable";
import { Verdict } from "./components/Verdict";
import { CloudTable, TrialCloud } from "./charts/TrialCloud";
import { CostCurve, CostTable } from "./charts/CostCurve";
import { EquityCurve, EquityTable } from "./charts/EquityCurve";
import { TrialSpread } from "./charts/TrialSpread";

const Guide = lazy(() => import("./pages/Guide"));

function useRoute() {
  const parse = () => {
    const h = window.location.hash;
    if (!h.startsWith("#guide")) return { page: "app" as const, anchor: h.slice(1) || undefined };
    const anchor = h.startsWith("#guide/") ? h.slice(7) : undefined;
    return { page: "guide" as const, anchor };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

type Theme = "light" | "dark";

const OS_DARK = "(prefers-color-scheme: dark)";
const osTheme = (): Theme =>
  typeof matchMedia === "function" && matchMedia(OS_DARK).matches ? "dark" : "light";
const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : null;
  } catch { return null; }
};

/**
 * Two states, because a third "system" button reads as a duplicate: it is
 * always showing one of the other two, so two of the three look identical and
 * the odd one out is doing nothing visible.
 *
 * The OS preference is still the default -- it just arrives as a starting
 * value rather than as a button, and is followed live until a choice is made.
 * An older stored "system" is not a valid value here, so it falls through to
 * the OS, which is what it meant anyway.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? osTheme());
  const [chosen, setChosen] = useState(() => stored() !== null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // Only a click is worth persisting; writing the OS's current answer would
    // freeze this page to it the first time it was ever opened.
    if (chosen) {
      try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
    }
  }, [theme, chosen]);

  useEffect(() => {
    if (chosen || typeof matchMedia !== "function") return;
    const mq = matchMedia(OS_DARK);
    const sync = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [chosen]);

  return (
    <div className="row" style={{ gap: 4 }}>
      {(["light", "dark"] as const).map((t) => (
        <button key={t} aria-pressed={theme === t}
                onClick={() => { setTheme(t); setChosen(true); }}
                style={{ padding: "3px 9px", fontSize: 12 }}
                title={`always ${t}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  // Hide completed runs whose stored format these charts cannot read.
  const [showAll, setShowAll] = useState(false);
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem("token") ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("token", token); } catch { /* private mode */ }
  }, [token]);

  const health = useQuery({ queryKey: ["health"], queryFn: api.health });

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
    (r) => showAll || loadable(r) || r.state !== "done",
  );
  const id = visible.find((r) => r.run_id === selected)?.run_id
    ?? visible.find((r) => r.state === "queued" || r.state === "running")?.run_id
    ?? visible.find(loadable)?.run_id ?? visible[0]?.run_id ?? null;
  const run = runs.data?.find((r) => r.run_id === id) ?? null;
  const ready = !!run && loadable(run);
  // A finished run whose artefacts predate this build: readable, but not by
  // these charts. Say so rather than rendering empty panels.
  const outdated = run?.state === "done" && !ready;

  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => api.audit(id!), enabled: !!id && ready });
  const runDetails = useQuery({ queryKey: ["run", id], queryFn: () => api.run(id!), enabled: !!id });
  const trials = useQuery({ queryKey: ["trials", id], queryFn: () => api.trials(id!), enabled: !!id && ready });
  const cloud = useQuery({ queryKey: ["cloud", id], queryFn: () => api.cloud(id!), enabled: !!id && ready });
  const equity = useQuery({ queryKey: ["equity", id], queryFn: () => api.equity(id!), enabled: !!id && ready });

  const remove = useMutation({
    mutationFn: (rid: string) => api.remove(rid, token || undefined),
    onSuccess: (_, rid) => {
      setSelected(null);
      qc.setQueryData<RunStatus[]>(["runs"], (xs) => xs?.filter((r) => r.run_id !== rid));
      for (const name of ["audit", "trials", "cloud", "equity"]) {
        qc.removeQueries({ queryKey: [name, rid] });
      }
      qc.removeQueries({ queryKey: ["run", rid] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const busy = audit.isFetching || trials.isFetching || cloud.isFetching || equity.isFetching;
  const active = run?.state === "queued" || run?.state === "running";
  const error = runs.error ?? health.error ?? remove.error ?? runDetails.error ?? audit.error
    ?? trials.error ?? cloud.error ?? equity.error;

  // A bookmarked section may mount after its results finish loading.
  useEffect(() => {
    if (route.page === "app" && route.anchor) {
      document.getElementById(route.anchor)?.scrollIntoView({ block: "start" });
    }
  }, [route, !!audit.data, !!cloud.data, !!equity.data, !!trials.data, !!run?.provenance]);

  return (
    <div className="wrap">
      <header className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 21 }}>SharpeLuck</h1>
          <div className="sub"><em>Is your crypto strategy just lucky?</em></div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {route.page === "guide" ? (
            <a href="#" className="pill" style={{ textDecoration: "none" }}>
              ← back to the app
            </a>
          ) : (
            <a href="#guide" className="pill" style={{ textDecoration: "none" }}>
              Guide ↗
            </a>
          )}
          <ThemeToggle />
        </div>
      </header>

{route.page === "guide" ? (
        <Suspense fallback={<p className="sub">loading…</p>}>
          <Guide />
        </Suspense>
      ) : (
        <>
      {/* One filter row, above everything it scopes. */}
      <div className="row" style={{ margin: "18px 0 16px", gap: 10 }}>
        <span className="sub">Run</span>
        <select aria-label="Run" value={id ?? ""} onChange={(e) => setSelected(e.target.value || null)}
                style={{ width: 340, maxWidth: "100%" }}>
          {visible.length === 0 && <option value="">{runs.isPending ? "loading runs…" : "no current runs"}</option>}
          {visible.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {r.created_at.replace("T", " ").slice(0, 16)} · {r.n_trials} trials
              {r.label ? ` · ${r.label}` : ""} · {r.state}
              {r.state === "running" ? ` ${r.n_done}/${r.n_trials}` : ""}
              {r.state === "done" && !loadable(r) ? " · older format" : ""}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 5 }}>
          <input type="checkbox" checked={showAll} style={{ width: 14, height: 14 }}
                 onChange={(e) => setShowAll(e.target.checked)} />
          <span className="sub">
            show all ({(runs.data ?? []).length - visible.length} hidden)
          </span>
        </label>
        <button disabled={!id || active || remove.isPending}
                onClick={() => {
                  if (id && confirm(`Delete run ${id}? This cannot be undone.`)) {
                    remove.mutate(id);
                  }
                }}
                style={{ padding: "3px 9px", fontSize: 12 }}
                title={active ? "Wait for the run to finish before deleting it" : "Delete this run’s results; keep the source market data"}>
          {remove.isPending ? "deleting…" : "delete run"}
        </button>
        {health.data?.write_token_required && <label className="row" style={{ gap: 6 }}
          title="This server requires a write token to submit or delete runs. Reading results needs no token.">
          <span className="sub">Write token</span>
          <input value={token} type="password" placeholder="server access token"
                 style={{ width: 110 }}
                 onChange={(e) => setToken(e.target.value)} />
        </label>}
      </div>

      <nav className="app-jumps" aria-label="App sections">
        {audit.data && <a href="#verdict">Verdict</a>}
        {run?.provenance && <a href="#data">Data</a>}
        {audit.data && <a href="#evidence">Evidence</a>}
        {(equity.data || (trials.data && audit.data)) && <a href="#performance">Performance</a>}
        <a href="#new-run">New run</a>
      </nav>

      {error && <p role="alert" className="sub" style={{ color: "var(--critical)" }}>{error.message}</p>}
      {run && <RunProgress run={run} />}
      {runs.isSuccess && !run && (
        <p className="note">No current results. <a href="#new-run">Configure a run below</a>; an existing run is not required.</p>
      )}

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
          A <strong>trial</strong> is one trading rule. A <strong>run</strong> searches
          many rules, selects a winner using training scores, and audits its
          performance against what the search could produce by chance.
        </p>
        <div className="grid2">
          {audit.data && (
            <div className="col app-section" id="verdict">
              <Verdict audit={audit.data} spec={runDetails.data?.spec} />
              <p className="sub" style={{ margin: "-6px 2px 0" }}>
                <a href="#guide/four-tests">how to interpret the audit ↗</a>
              </p>
            </div>
          )}
          {run?.provenance && (
            <div className="col app-section" id="data">
              <ProvenanceBar p={run.provenance} u={audit.data?.universe} />
            </div>
          )}
        </div>

        {audit.data && (
          <section className="app-section app-section-group" id="evidence" aria-labelledby="evidence-title">
            <h2 className="app-section-title" id="evidence-title">Evidence</h2>
            <div className="grid2">
              {cloud.data && (
                <Figure
                  title="Held-out performance"
                  sub={`${cloud.data.length} splits: choose a winner on one half, score it on the other`}
                  chart={<TrialCloud points={cloud.data} />}
                  table={<CloudTable points={cloud.data} />}
                />
              )}
              <Figure
                title="Cost sensitivity"
                sub="Net Sharpe of the winner against assumed transaction cost"
                chart={<CostCurve audit={audit.data} />}
                table={<CostTable audit={audit.data} />}
              />
            </div>
          </section>
        )}

        {(equity.data || (trials.data && audit.data)) && (
          <section className="app-section app-section-group" id="performance" aria-labelledby="performance-title">
            <h2 className="app-section-title" id="performance-title">Performance</h2>
            <div className="grid2 paired">
              {equity.data && (
                <div className="col">
                  <p className="note">
                    Simulated portfolio value starts at 1.0. The two lines show
                    performance before and after the assumed trading costs.
                  </p>
                  <Figure title="Equity curve" sub="The winner, gross and net of cost"
                          chart={<EquityCurve points={equity.data} />}
                          table={<EquityTable points={equity.data} />} />
                </div>
              )}

              {trials.data && audit.data && (
                <div className="col">
                  <p className="note">
                    Trials are ordered from best to worst. The horizontal line marks
                    the estimated average best Sharpe from a search with no edge.
                    A trial below this line has not exceeded that noise benchmark.
                  </p>
                  <Figure
                    title="Trials"
                    sub={`${explainTrials(trials.data)} — against the Sharpe the best of this search would reach on data with no edge`}
                    chart={<TrialSpread trials={trials.data} audit={audit.data} />}
                    table={<TrialTable trials={trials.data} winner={audit.data.winner.trial} />}
                  />
                </div>
              )}
            </div>
          </section>
        )}

        <div className="app-section" id="new-run">
          <SubmitPanel onSubmitted={(rid) => {
            setSelected(rid);
            window.location.hash = "run-progress";
            requestAnimationFrame(() => {
              document.getElementById("run-progress")?.scrollIntoView({ block: "start" });
            });
          }} token={token} />
        </div>
        <p className="note">
          <a href="#guide/four-tests">Methodology — how the audit is calculated ↗</a>
        </p>
      </div>
      </ErrorBoundary>
        </>
      )}
    </div>
  );
}
