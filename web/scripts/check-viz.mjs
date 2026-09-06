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
      import { NumberLine, SearchCostCurve } from "../src/pages/GuideViz.tsx";
      import Guide from "../src/pages/Guide.tsx";
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
      };
      export const renderGuide = () => renderToStaticMarkup(h(Guide));
    `,
    resolveDir: "scripts",
    loader: "tsx",
  },
  bundle: true, format: "esm", platform: "node", outfile: OUT,
  // Guide now pulls in KaTeX, which imports a stylesheet; Node has no use for it.
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server"], logLevel: "error",
});

const { cases, render, renderStatic, renderGuide } =
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

  const texts = [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map(([, attrs, body]) => {
    const x = num(attrs, "x"), y = num(attrs, "y");
    const fs = num(attrs, "font-size") ?? 11;
    const halfW = (body.length * fs * 0.62) / 2;
    return { body, x0: x - halfW, x1: x + halfW, y0: y - fs * 0.78, y1: y + fs * 0.22 };
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
  const guide = renderGuide();
  const tables = [...guide.matchAll(/<table>(.*?)<\/table>/gs)].map(([, t]) => t);
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
  const guide = renderGuide();
  const rendered = (guide.match(/class="katex"/g) ?? []).length;
  // KaTeX with throwOnError:false does not mark errors with a class -- it just
  // paints the offending token in errorColor. That colour is the only signal.
  const errors = [...guide.matchAll(/mathcolor="#cc0000"><mtext>([^<]*)<\/mtext>/g)];
  for (const [, tok] of errors) fail("formulas", `KaTeX could not parse ${tok}`);
  if (!rendered) fail("formulas", "no formulas rendered at all");
  if (!failures) console.log(`  ✓ formulas       ${rendered} rendered, 0 errors`);
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
