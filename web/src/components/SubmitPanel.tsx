import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type RunSpecInput } from "../api";

const REBALANCES = [1, 6, 24];
const DEFAULT_GRIDS = [
  "cs_zscore(ts_ret(close, [12, 24, 72, 168, 336]))",
  "cs_zscore(ts_std(ret, [24, 72, 168]))",
  "cs_zscore(ts_mean(taker_imb, [24, 72, 168]))",
].join("\n");

/** Submitting a run costs compute, so the trial budget is shown before it is
 *  spent -- and the sign of each signal is expanded automatically, which is why
 *  the count is double what the expressions look like. */
export function SubmitPanel({ onSubmitted }: { onSubmitted: (id: string) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(DEFAULT_GRIDS);
  const [rebalances, setRebalances] = useState<number[]>([6, 24]);
  const [cost, setCost] = useState(5);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  // The universe is a research decision, not a constant: whether an edge
  // survives at 200 names as well as 50 is exactly the kind of question this
  // platform exists to ask.
  const [maxSymbols, setMaxSymbols] = useState(50);
  const [minAdv, setMinAdv] = useState(100_000);
  const [minHistoryDays, setMinHistoryDays] = useState(30);

  const spec: RunSpecInput = useMemo(() => ({
    grids: text.split("\n").map((s) => s.trim()).filter(Boolean),
    rebalances,
    cost_bps: cost,
    universe: {
      max_symbols: maxSymbols,
      min_adv_usd: minAdv,
      min_history_h: minHistoryDays * 24,
    },
    label: label || null,
  }), [text, rebalances, cost, label, maxSymbols, minAdv, minHistoryDays]);

  const ops = useQuery({ queryKey: ["ops"], queryFn: api.ops, staleTime: Infinity });
  const preview = useQuery({
    queryKey: ["preview", spec],
    queryFn: () => api.preview(spec),
    enabled: spec.grids.length > 0 && rebalances.length > 0,
    retry: false,
  });
  const submit = useMutation({
    mutationFn: () => api.submit(spec, token || undefined),
    onSuccess: (st) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      onSubmitted(st.run_id);
    },
  });

  const err = preview.error ?? submit.error;

  return (
    <section className="card">
      <h3>New run</h3>
      <div className="sub">
        One expression per line. A list-valued parameter such as <code>[12, 24, 72]</code>{" "}
        expands into one trial per value.
      </div>

      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
                style={{ marginTop: 12 }} spellCheck={false} />

      <div className="row" style={{ marginTop: 12, gap: 18 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="sub">Rebalance</span>
          {REBALANCES.map((r) => (
            <button key={r} aria-pressed={rebalances.includes(r)}
                    onClick={() => setRebalances((xs) =>
                      xs.includes(r) ? xs.filter((v) => v !== r) : [...xs, r].sort((a, b) => a - b))}
                    style={{ padding: "3px 9px", fontSize: 12 }}>
              {r}h
            </button>
          ))}
        </span>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">Cost (bps)</span>
          <input type="number" min={0} step={1} value={cost} style={{ width: 74 }}
                 onChange={(e) => setCost(Number(e.target.value))} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">Label</span>
          <input value={label} placeholder="optional" style={{ width: 150 }}
                 onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">Token</span>
          <input value={token} placeholder="if required" type="password" style={{ width: 130 }}
                 onChange={(e) => setToken(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 10, gap: 18 }}>
        <span className="sub" style={{ minWidth: 62 }}>Universe</span>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">top N by volume</span>
          <input type="number" min={2} max={500} step={10} value={maxSymbols}
                 style={{ width: 74 }}
                 onChange={(e) => setMaxSymbols(Number(e.target.value))} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">min $/hour</span>
          <input type="number" min={0} step={25000} value={minAdv}
                 style={{ width: 104 }}
                 onChange={(e) => setMinAdv(Number(e.target.value))} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="sub">min history (days)</span>
          <input type="number" min={1} max={365} step={5} value={minHistoryDays}
                 style={{ width: 74 }}
                 onChange={(e) => setMinHistoryDays(Number(e.target.value))} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 14 }}>
        <button onClick={() => submit.mutate()}
                disabled={submit.isPending || !preview.data}
                style={{ fontWeight: 600 }}>
          {submit.isPending ? "Submitting…" : "Run audit"}
        </button>
        <span className="sub">
          {preview.data
            ? `${preview.data.n_trials} trials (each signal is run alongside its negation) · `
              + `universe rebuilt for this run`
            : preview.isFetching ? "counting trials…" : "—"}
        </span>
      </div>

      {err && (
        <p className="sub" style={{ color: "var(--critical)", marginTop: 10, whiteSpace: "pre-wrap" }}>
          <span aria-hidden>✕ </span>{String(err instanceof Error ? err.message : err).slice(0, 400)}
        </p>
      )}

      {ops.data && (
        <details style={{ marginTop: 14 }}>
          <summary className="sub" style={{ cursor: "pointer" }}>The signal language</summary>
          <div className="sub" style={{ marginTop: 8, lineHeight: 1.9 }}>
            <div><strong>fields</strong> <code>{ops.data.fields.join(", ")}</code></div>
            <div><strong>time series</strong> <code>{ops.data.ts_ops.join(", ")}</code> — each takes a window in bars</div>
            <div><strong>cross section</strong> <code>{ops.data.cs_ops.join(", ")}</code> — computed across the universe at each bar</div>
            <div><strong>unary</strong> <code>{[...ops.data.unary_ops, ...ops.data.param_ops].join(", ")}</code></div>
          </div>
        </details>
      )}
    </section>
  );
}
