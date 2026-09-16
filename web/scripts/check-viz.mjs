/**
 * Render the guide's diagrams and check their geometry.
 *
 * Written after shipping a chart whose labels were clipped above the viewBox
 * and whose zero rule ran through a label. The tiering algorithm was verified
 * numerically and was correct; nobody checked where anything actually landed.
 * This renders the real components and inspects every emitted coordinate.
 */
import { build } from "esbuild";
import { readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUT = "node_modules/.cache/check-viz.mjs";

await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { createElement as h } from "react";
      import { BookRing, NumberLine, SearchCostCurve, SharpeScale } from "../src/pages/GuideViz.tsx";
      import { backtestToy } from "../src/pages/toyCalc.ts";
      import Guide from "../src/pages/Guide.tsx";
      import { NotationTable } from "../src/components/GuideNotation.tsx";
      import { CostCurve, CostTable } from "../src/charts/CostCurve.tsx";
      import { RunSettings, lookbacks } from "../src/components/RunSettings.tsx";
      import { Verdict } from "../src/components/Verdict.tsx";
      import { TrialCloud } from "../src/charts/TrialCloud.tsx";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import App from "../src/App.tsx";
      import { computeToy, COINS } from "../src/pages/toyCalc.ts";
      const t = computeToy();
      export const cases = {
        "z-scores": COINS.map((c) => ({ coin: c, v: t.z[c] })),
        "negated z-scores": COINS.map((c) => ({ coin: c, v: t.negZ[c] })),
        // An outlier stretches the scale so the other three land almost on top
        // of one another -- the shape that broke the original layout, only worse.
        "outlier + tight cluster": [
          { coin: "A", v: 8 }, { coin: "B", v: 0.01 },
          { coin: "C", v: 0.02 }, { coin: "D", v: 0.03 },
        ],
        "all four identical": COINS.map((c) => ({ coin: c, v: 0.4 })),
        "single point": [{ coin: "A", v: 0.5 }],
        "wide negative spread": COINS.map((c, i) => ({ coin: c, v: -3 + i * 2 })),
      };
      export const render = (vals) => renderToStaticMarkup(h(NumberLine, { values: vals }));
      export const renderStatic = {
        "search cost curve": () => renderToStaticMarkup(h(SearchCostCurve)),
        // Every frame of the book ring: the slice spans change completely from
        // one day to the next, so one frame proves nothing about the others.
        "sharpe scale": () => {
          const b = backtestToy();
          return renderToStaticMarkup(h(SharpeScale, { days: b.days, avg: b.avg, sd: b.sd }));
        },
        ...Object.fromEntries(backtestToy().days.map((d) => [
          "book ring day " + d.day,
          () => renderToStaticMarkup(h(BookRing, { coins: COINS, weights: d.weights })),
        ])),
      };
      export const renderGuide = () => renderToStaticMarkup(h(Guide));
      export const renderNotation = () => renderToStaticMarkup(h(NotationTable));
      export const renderCost = (cost, sharpe) => {
        const audit = {
          winner: { cost_bps: cost, sharpe },
          cost_curve: { break_even_bps: 10, points: [
            { cost_bps: 0, sharpe: sharpe === null ? null : 2 },
            { cost_bps: 5, sharpe: sharpe === null ? null : 1 },
            { cost_bps: 10, sharpe: sharpe === null ? null : 0 },
          ] },
        };
        return renderToStaticMarkup(h(CostCurve, { audit }))
          + renderToStaticMarkup(h(CostTable, { audit }));
      };
      export const renderCloud = () => renderToStaticMarkup(h(TrialCloud, {
        points: [1, 2, -1].map((v) => ({
          is_sharpe_ann: 3, oos_sharpe_ann: v, logit: -1,
        })),
      }));
      export const renderSettings = (spec) =>
        renderToStaticMarkup(h(RunSettings, { spec, nTrials: 44,
          winner: { expr: "neg(cs_zscore(ts_std(ret, 72)))", rebalance_every_h: 24 } }));
      export const renderVerdict = (dsr, pbo, p) => renderToStaticMarkup(h(Verdict, {
        audit: {
          survives: dsr > 0.95 && pbo < 0.30 && p < 0.05,
          winner: { expr: "neg(cs_zscore(ts_std(ret, 72)))", rebalance_every_h: 24,
            cost_bps: 5, gross_sharpe: 1.4 },
          deflation: { n_trials: 44, sr_ann: 1.3, sr0_ann: 2.2,
            dsr: 0.2, psr_vs_zero: 0.99, skew: 0, kurtosis: 3, n_obs: 10000 },
          search_null: { dsr, n_eff: 18, sr0_ann: 0.8, mean_abs_corr: 0.3, rc_p_value: p,
            n_eff_participation: 12, sr0_ann_q95: 1.2, mean_block: 48 },
          pbo: { pbo, n_combinations: 252, selection_premium: 0.001, prob_oos_loss: 0.1 },
          cost_curve: { break_even_bps: 100 },
        },
      }));
      export { lookbacks };
      export const toy = { positions: t, backtest: backtestToy() };
      export const renderApp = (runs, tokenRequired) => {
        const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
        client.setQueryData(["runs"], runs);
        client.setQueryData(["health"], { write_token_required: tokenRequired });
        globalThis.window = { location: { hash: "" } };
        try {
          return renderToStaticMarkup(h(QueryClientProvider, { client }, h(App)));
        } finally {
          client.clear();
          delete globalThis.window;
        }
      };
    `,
    resolveDir: "scripts",
    loader: "tsx",
  },
  bundle: true, format: "esm", platform: "node", outfile: OUT,
  // Guide now pulls in KaTeX, which imports a stylesheet; Node has no use for it.
  loader: { ".css": "empty" },
  define: { "import.meta.env": "{}" },
  external: ["react", "react-dom", "react-dom/server"], logLevel: "error",
});

const { cases, render, renderStatic, renderGuide, renderNotation, renderCost, renderCloud, renderSettings, renderVerdict, lookbacks, renderApp, toy } =
  await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

const num = (s, k) => { const m = s.match(new RegExp(`${k}="([-\\d.]+)"`)); return m ? +m[1] : null; };
const M = { ASCENT: 11 * 0.78, DESCENT: 11 * 0.22, CHAR_W: 11 * 0.62 };

let failures = 0;
const fail = (name, msg) => { failures++; console.log(`  ✕ [${name}] ${msg}`); };

const svgs = [
  ...Object.entries(cases).map(([name, values]) => [name, render(values)]),
  ...Object.entries(renderStatic).map(([name, fn]) => [name, fn()]),
];

for (const [name, svg] of svgs) {
  const [, , vbW, vbH] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/).slice(1).map(Number);

  // Labels may be anchored start/end and may be built from tspans; measuring
  // every one as centred plain text put the box in the wrong place.
  const texts = [...svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/g)].map(([, attrs, inner]) => {
    const body = inner.replace(/<[^>]*>/g, "");
    const x = num(attrs, "x"), y = num(attrs, "y");
    const fs = num(attrs, "font-size") ?? 11;
    const w = body.length * fs * 0.62;
    const anchor = (attrs.match(/text-anchor="(\w+)"/) ?? [, "middle"])[1];
    const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    return { body, x0, x1: x0 + w, y0: y - fs * 0.78, y1: y + fs * 0.22 };
  });
  const circles = [...svg.matchAll(/<circle ([^>]*)\/?>/g)].map(([, a]) => ({
    cx: num(a, "cx"), cy: num(a, "cy"), r: num(a, "r") + 1,
  }));
  const lines = [...svg.matchAll(/<line ([^>]*)\/?>/g)].map(([, a]) => ({
    x1: num(a, "x1"), x2: num(a, "x2"), y1: num(a, "y1"), y2: num(a, "y2"),
    zero: /data-role="zero"/.test(a),
    halo: /paint-order="stroke"/.test(a),
  }));
  const haloed = [...svg.matchAll(/<text ([^>]*)>/g)].filter(([, a]) => /paint-order="stroke"/.test(a));

  // 1. nothing escapes the viewBox
  for (const t of texts) {
    if (t.y0 < 0 || t.y1 > vbH) fail(name, `text "${t.body}" spans y ${t.y0.toFixed(1)}..${t.y1.toFixed(1)}, viewBox is 0..${vbH}`);
    if (t.x0 < 0 || t.x1 > vbW) fail(name, `text "${t.body}" spans x ${t.x0.toFixed(1)}..${t.x1.toFixed(1)}, viewBox is 0..${vbW}`);
  }
  for (const c of circles) {
    if (c.cy - c.r < 0 || c.cy + c.r > vbH) fail(name, `circle at ${c.cx},${c.cy} escapes vertically`);
    if (c.cx - c.r < 0 || c.cx + c.r > vbW) fail(name, `circle at ${c.cx},${c.cy} escapes horizontally`);
  }
  for (const l of lines) {
    if ([l.y1, l.y2].some((y) => y < 0 || y > vbH)) fail(name, `line spans y ${l.y1}..${l.y2}, viewBox is 0..${vbH}`);
  }

  // 2. no two labels overlap each other
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        fail(name, `labels "${a.body}" and "${b.body}" overlap`);
      }
    }
  }

  // 3. Leader lines may pass BEHIND a label -- the halo masks them -- but the
  //    zero rule carries meaning and must never strike through text.
  for (const l of lines.filter((l) => l.x1 === l.x2 && l.zero)) {
    for (const t of texts) {
      const [top, bot] = [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)];
      if (l.x1 > t.x0 && l.x1 < t.x1 && top < t.y1 && bot > t.y0) {
        fail(name, `vertical rule at x=${l.x1} crosses label "${t.body}"`);
      }
    }
  }


  if (!failures) console.log(`  ✓ ${name.padEnd(24)} ${texts.length} labels, ${circles.length} dots, viewBox ${vbW}×${Math.round(vbH)}`);
}

// Tables: every body row must have as many cells as the header has columns.
// A data column with no header slipped through once, because SVG checks cannot
// see an HTML table.
{
  const guide = renderGuide() + renderNotation();
  const tables = [...guide.matchAll(/<table(?:\s[^>]*)?>(.*?)<\/table>/gs)].map(([, t]) => t);
  if (!tables.length) fail("guide tables", "no tables rendered at all");
  tables.forEach((t, i) => {
    // <th[^>]*> would also match <thead>, inflating every count by one.
    const headers = (t.match(/<th(?:\s[^>]*)?>/g) ?? []).length;
    const rows = [...t.matchAll(/<tr>((?:(?!<\/tr>).)*)<\/tr>/gs)]
      .map(([, r]) => (r.match(/<td[^>]*>/g) ?? []).length)
      .filter((n) => n > 0);
    for (const cells of rows) {
      if (cells !== headers) {
        fail("guide tables", `table ${i + 1}: header has ${headers} columns, a row has ${cells} cells`);
      }
    }
    if (!failures) console.log(`  ✓ table ${i + 1} ${String(headers).padStart(2)} columns × ${rows.length} rows`);
  });
}

// Formulas: KaTeX is configured with throwOnError:false so a bad expression
// renders as a red fragment rather than blanking the page -- which means a
// broken formula ships silently unless something looks for it. Checking the
// rendered output rather than the source, because the source contains template
// interpolation that is not valid LaTeX until it resolves.
{
  const formulas = renderGuide() + renderNotation();
  const rendered = (formulas.match(/class="katex"/g) ?? []).length;
  // KaTeX with throwOnError:false does not mark errors with a class -- it just
  // paints the offending token in errorColor. That colour is the only signal.
  const errors = [...formulas.matchAll(/mathcolor="#cc0000"><mtext>([^<]*)<\/mtext>/g)];
  for (const [, tok] of errors) fail("formulas", `KaTeX could not parse ${tok}`);
  if (formulas.includes('class="katex-error"')) fail("formulas", "KaTeX rendered an error");
  if (!rendered) fail("formulas", "no formulas rendered at all");
  if (!failures) console.log(`  ✓ formulas       ${rendered} rendered, 0 errors`);
}

// The audit belongs to the final guide section, with one PBO schematic and
// working destinations for the app and notation table's guide links.
{
  const guide = renderGuide();
  const app = renderApp([], false);
  for (const id of ["four-tests", "deflated-sharpe", "backtest-overfitting", "reality-check", "cost-sensitivity"]) {
    if (guide.split(`id="${id}"`).length !== 2) fail("guide audit", `${id} must appear exactly once`);
  }
  if (guide.split('class="pbo-blocks"').length !== 2) fail("guide audit", "expected one PBO schematic");
  if (guide.indexOf('id="cost-sensitivity"') > guide.indexOf("What the verdict means")) {
    fail("guide audit", "the verdict must follow the calculations");
  }
  for (const [, id] of (guide + renderNotation() + app).matchAll(/href="#guide\/([^"]+)"/g)) {
    if (!guide.includes(`id="${id}"`)) fail("guide links", `missing target ${id}`);
  }
  if (!app.includes('href="#guide/four-tests">Methodology') || app.includes('id="deflated-sharpe"')) {
    fail("guide audit", "app must link to methodology instead of duplicating it");
  }
  if (!guide.includes('aria-controls="guide-symbols-panel"') || !guide.includes('aria-expanded="false"')) {
    fail("guide symbols", "notation control must expose its panel and closed state");
  }
  if (!failures) console.log("  ✓ merged guide audit, single schematic, notation control and section links");
}

// A custom cost must label the actual result, not the nearest stored grid point.
for (const [cost, sharpe] of [[3, 1.6], [80, -4]]) {
  const chart = renderCost(cost, sharpe);
  if (!chart.includes(`${sharpe.toFixed(2)} at ${cost} bps`)) {
    fail("cost curve", `incorrect label at ${cost} bps`);
  }
  if (!chart.includes(`<td>${cost}</td><td>${sharpe.toFixed(3)}</td>`)) {
    fail("cost curve", "table omits the configured cost");
  }
}
if (!renderCost(3, null).includes("Sharpe is undefined")) {
  fail("cost curve", "zero-variance returns should not crash the chart");
}
// All three winners rank below median, but only one has a negative return.
if (!renderCloud().includes("OOS loss (33% of splits)")) {
  fail("trial cloud", "loss frequency confused with rank-based PBO");
}
{
  const verdict = renderVerdict(0.8423, 0.0159, 0.0225);
  const rows = [...verdict.matchAll(/class="verdict-result (verdict-result-\w+)"[\s\S]*?<strong>([\d.]+)<\/strong>[\s\S]*?<span>([^<]+)<\/span>/g)];
  const actual = rows.map(([, status, value, word]) => [status, value, word]);
  const expected = [
    ["verdict-result-fail", "0.8423", "✕ Fail"],
    ["verdict-result-pass", "0.0159", "✓ Pass"],
    ["verdict-result-pass", "0.0225", "✓ Pass"],
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("verdict", "all three tests must appear in order with the correct pass/fail status");
  }
}
{
  const spec = {
    grids: [
      "cs_zscore(ts_ret(close, [24, 72, 168, 336]))",
      "cs_zscore(ts_std(ret, [24, 72, 168, 336]))",
      "cs_zscore(ts_mean(taker_imb, [24, 72, 168]))",
    ],
    signs: ["{}", "neg({})"], rebalances: [6, 24], cost_bps: 5,
    n_splits: 6, n_blocks: 10, n_boot: 2000, mean_block_h: 48,
    universe: { max_symbols: 50, min_adv_usd: 100000, min_history_h: 720,
      min_coverage: 0.9, rebalance_every_h: 24 },
  };
  const settings = renderSettings(spec);
  if (!settings.includes("1d") || !settings.includes("3d")
    || !settings.includes("1w") || !settings.includes("2w")
    || !settings.includes('aria-label="Buy pressure, 2w: not tested"')
    || !settings.includes("Original + reversed") || !settings.includes("Top 50")
    || !settings.includes("$100,000/h") || !settings.includes("≥ 90%")
    || !settings.includes("Volatility: long low, short high · 3d lookback · 1d rebalance")
    || settings.includes("cs_zscore") || settings.includes("$$") || settings.includes("${")) {
    fail("run settings", "saved signal windows or search dimensions are missing");
  }
  if (lookbacks("cs_rank(ts_std(ts_mean(ret, 24), 72))").join(",") !== "24,72") {
    fail("run settings", "nested signal lookbacks were not recovered");
  }
}
// The guide uses the same sample-standard-deviation convention as the backend.
{
  const { days, avg, sd } = toy.backtest;
  const sumSquares = days.reduce((sum, d) => sum + (d.pnl - avg) ** 2, 0);
  if (Math.abs(sd ** 2 - sumSquares / (days.length - 1)) > 1e-14) {
    fail("toy Sharpe", "guide and backend disagree on sample variance");
  }
  const z = Object.values(toy.positions.z);
  if (Math.abs(z.reduce((sum, v) => sum + v * v, 0) - (z.length - 1)) > 1e-12) {
    fail("toy z-scores", "guide and backend disagree on cross-sectional variance");
  }
}
if (!failures) console.log("  ✓ app chart values and sample-variance conventions");

{
  const empty = renderApp([], false);
  if (!empty.includes("an existing run is not required") || empty.includes("Write token")) {
    fail("empty app", "missing empty state or unnecessary authentication field");
  }
  if (!renderApp([], true).includes("Write token")) fail("authentication", "required token field is hidden");
  const queued = renderApp([{
    run_id: "queued-test", state: "queued", created_at: "2026-01-01T00:00:00",
    n_trials: 4, n_done: 0, label: null,
  }], false);
  if (!queued.includes('value="queued-test" selected=""') || !queued.includes("waiting to start")) {
    fail("queued app", "queued run is not selected or explained");
  }
  if (!/<button[^>]*disabled=""[^>]*>delete run<\/button>/.test(queued)) {
    fail("queued app", "active run can be deleted");
  }
  const progressRun = {
    run_id: "progress-test", state: "running", created_at: "2026-01-01T00:00:00",
    n_trials: 44, n_done: 22, label: null,
  };
  const running = renderApp([progressRun], false);
  if (!running.includes('aria-valuenow="22"') || !running.includes('aria-valuemax="44"')
    || !running.includes("50%") || !running.includes("22 of 44 trials complete")) {
    fail("run progress", "progress must reflect actual completed trials");
  }
  const auditing = renderApp([{ ...progressRun, n_done: 44 }], false);
  if (!auditing.includes("Computing the audit") || auditing.includes('aria-valuenow=') || />100%<\/span>/.test(auditing)) {
    fail("run progress", "finished trials must not imply the audit is finished");
  }
  const preparing = renderApp([{
    ...progressRun, n_done: 0, phase: "preparing", backend: "slurm", job_id: "12345", node: "compute-1",
  }], false);
  if (!preparing.includes("Preparing market data") || preparing.includes('aria-valuenow=')
    || !preparing.includes("compute-1") || !preparing.includes("12345")) {
    fail("run progress", "data preparation or compute job identity is missing");
  }
  if (queued.includes('aria-valuenow=')) fail("run progress", "queue duration is unknown");
  const complete = renderApp([{ ...progressRun, state: "done", schema_version: 4, n_done: 44 }], false);
  if (complete.includes('id="run-progress"')) fail("run progress", "completed run still shows active progress");
  const failed = renderApp([{
    run_id: "failed-test", state: "failed", created_at: "2026-01-01T00:00:00",
    n_trials: 4, n_done: 0, label: null, error: "Test launch failed",
  }], false);
  if (!failed.includes("Test launch failed")) fail("failed app", "failed run is hidden");
  if (!failures) console.log("  ✓ empty, queued, running, auditing, complete, failed and authenticated app states");
}

// Section 1's table and its sparklines must plot the same days. Extending the
// price series once left the table at four days and the charts at ten.
{
  const guide = renderGuide();
  const setup = guide.slice(guide.indexOf('id="setup"'));
  const section = setup.slice(0, setup.indexOf("<section"));
  const rows = [...section.matchAll(/<tr>((?:(?!<\/tr>).)*)<\/tr>/gs)]
    .map(([, r]) => (r.match(/<td[^>]*>/g) ?? []).length).filter((n) => n > 0).length;
  const paths = [...section.matchAll(/<path d="([^"]+)"/g)]
    .map(([, d]) => (d.match(/[ML]/g) ?? []).length);
  if (!rows || !paths.length) fail("setup section", "expected a price table and sparklines");
  for (const pts of paths) {
    if (pts !== rows) {
      fail("setup section", `table shows ${rows} days but a sparkline plots ${pts}`);
    }
  }
  if (!failures) console.log(`  ✓ setup section  table ${rows} days = ${paths.length} sparklines × ${paths[0]} points`);
}

try { unlinkSync(OUT); } catch {}
if (failures) { console.log(`\n${failures} geometry problem(s)`); process.exit(1); }
console.log("\nall diagram geometry checks pass");
