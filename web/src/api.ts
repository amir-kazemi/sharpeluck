const BASE = import.meta.env.VITE_API_BASE ?? "/api";

/** Bumped by the runner whenever stored artefacts change shape; runs written
 *  before versioning report 0. Must match SCHEMA_VERSION in dispatch.py. */
export const SCHEMA_VERSION = 4;

export type Provenance = {
  bar: string;
  start: string | null;
  end: string | null;
  n_bars: number;
  n_symbols_available: number;
  n_symbols_traded: number;
  mean_universe_size: number;
  n_rebalances: number;
};

export type UniverseSpec = {
  max_symbols: number;
  min_adv_usd: number;
  min_history_h: number;
  min_coverage: number;
  rebalance_every_h: number;
};

export type RunStatus = {
  schema_version?: number;
  provenance?: Provenance | null;
  pid?: number | null;
  run_id: string;
  state: "queued" | "running" | "done" | "failed";
  n_trials: number;
  n_done: number;
  label: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
};

export type Trial = {
  trial: number;
  expr: string;
  rebalance_every_h: number;
  cost_bps: number;
  n_bars: number;
  sharpe: number | null;
  gross_sharpe: number | null;
  is_sharpe: number | null;
  oos_sharpe: number | null;
  ann_return: number;
  ann_vol: number;
  max_drawdown: number;
  hit_rate: number;
  turnover_per_rebal: number;
  break_even_bps: number | null;
};

export type Audit = {
  schema_version?: number;
  provenance?: Provenance | null;
  universe?: UniverseSpec;
  run_id: string;
  winner: Trial;
  deflation: {
    n_trials: number;
    n_obs: number;
    sr_ann: number;
    sr_trials_std_ann: number;
    sr0_ann: number;
    skew: number;
    kurtosis: number;
    psr_vs_zero: number;
    dsr: number;
  };
  pbo: {
    pbo: number;
    n_combinations: number;
    n_blocks: number;
    median_is_sharpe: number;
    median_oos_sharpe: number;
    selection_premium: number;
    prob_oos_loss: number;
    deterioration_slope: number;
  };
  search_null: {
    n_boot: number;
    mean_block: number;
    sr0_ann: number;
    sr0_ann_q95: number;
    sr_null_std_ann: number;
    n_eff: number;
    n_eff_participation: number;
    mean_abs_corr: number;
    rc_p_value: number;
    dsr: number;
  };
  cost_curve: {
    points: { cost_bps: number; sharpe: number | null }[];
    break_even_bps: number | null;
    mean_turnover: number;
  };
  survives: boolean;
};

export type CloudPoint = {
  is_sharpe: number;
  oos_sharpe: number;
  logit: number;
  is_sharpe_ann: number;
  oos_sharpe_ann: number;
};

export type EquityPoint = { ts: string; equity: number; equity_gross: number };

export type RunSpecInput = {
  grids: string[];
  rebalances: number[];
  cost_bps: number;
  universe?: Partial<UniverseSpec>;
  label?: string | null;
};

export type Ops = {
  fields: string[];
  ts_ops: string[];
  cs_ops: string[];
  unary_ops: string[];
  param_ops: string[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${path}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    // FastAPI validation errors carry the DSL parse message; surface it.
    const detail = await r.text();
    throw new Error(detail || `${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

async function del(path: string, token?: string): Promise<void> {
  const r = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(await r.text() || `${r.status} ${r.statusText}`);
}

export const api = {
  ops: () => get<Ops>("/ops"),
  runs: () => get<RunStatus[]>("/runs"),
  trials: (id: string) => get<Trial[]>(`/runs/${id}/trials`),
  audit: (id: string) => get<Audit>(`/runs/${id}/audit`),
  cloud: (id: string) => get<CloudPoint[]>(`/runs/${id}/cloud`),
  equity: (id: string) => get<EquityPoint[]>(`/runs/${id}/equity`),
  preview: (spec: RunSpecInput) =>
    post<{
      n_trials: number;
      breakdown: { expressions: number; signs: number; rebalances: number };
    }>("/runs/preview", spec),
  submit: (spec: RunSpecInput, token?: string) =>
    post<RunStatus>("/runs", spec, token),
  remove: (id: string, token?: string) => del(`/runs/${id}`, token),
};
