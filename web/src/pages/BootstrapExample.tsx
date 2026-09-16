import { useEffect, useRef, useState } from "react";
import { Tex } from "../components/Tex";

// Percentage-point daily returns; all stages use the same two rules.
const returns = [[0.3, 0.2], [0.2, 0.1], [-0.1, -0.2], [-0.2, -0.1], [0.4, 0.3], [0, 0]];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const means = [0, 1].map(i => mean(returns.map(row => row[i])));
const centered = returns.map(row => row.map((value, i) => value - means[i]));
const spreads = [0, 1].map(i => Math.sqrt(centered.reduce((sum, row) => sum + row[i] ** 2, 0) / 5));
const draws = [
  [0, 1, 0, 1, 4, 5],
  [2, 3, 2, 3, 0, 1],
  [4, 5, 4, 5, 2, 3],
];
const scores = draws.map(draw => [0, 1].map(i => Math.sqrt(365) * mean(draw.map(day => centered[day][i])) / spreads[i]));
const winners = scores.map(row => Math.max(...row));
const colors = ["var(--series-1)", "var(--series-2)"];

export function BootstrapExample() {
  const [stage, setStage] = useState(0);
  const [draw, setDraw] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = useState(260);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0) setPlotHeight(height * 440 / width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = stage === 0 ? returns : stage === 1 ? centered : draws[draw].map(day => centered[day]);
  const x = (position: number) => 65 + position * 64;
  const y = (value: number) => 24 + (0.44 - value) / 0.78 * (plotHeight - 72);
  return (
    <aside className="guide-figure bootstrap-example">
      <strong>Two rules, one return history</strong>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {["Original", "Subtract means", "Resample"].map((label, i) => (
          <button type="button" key={label} aria-pressed={stage === i}
            style={{ background: stage === i ? "var(--wash)" : undefined }}
            onClick={() => setStage(i)}>{label}</button>
        ))}
      </div>
      <div className="sub">Blue circles: rule A · Orange squares: rule B</div>
      <div className="bootstrap-plot" ref={plotRef}>
      <svg viewBox={`0 0 440 ${plotHeight}`} role="img"
        aria-label={`${["Original", "Centered", "Resampled"][stage]} daily returns of two rules, on the same fixed scale.`}>
        {[-0.3, 0, 0.4].map(value => (
          <g key={value}>
            <line x1={48} x2={410} y1={y(value)} y2={y(value)} stroke={value === 0 ? "var(--axis)" : "var(--grid)"} />
            <text x={42} y={y(value) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">{value.toFixed(1)}%</text>
          </g>
        ))}
        {[0, 1].map(rule => (
          <g key={rule}>
            <path d={values.map((row, i) => `${i ? "L" : "M"}${x(i)},${y(row[rule])}`).join(" ")}
              fill="none" stroke={colors[rule]} strokeWidth={2} strokeDasharray={rule ? "5 3" : undefined} />
            {values.map((row, i) => (
              <g key={i}>
                <title>{`Position ${i + 1}, rule ${rule ? "B" : "A"}: ${row[rule].toFixed(2)}%`}</title>
                {rule ? <rect x={x(i) - 4} y={y(row[rule]) - 4} width={8} height={8} fill={colors[rule]} /> :
                  <circle cx={x(i)} cy={y(row[rule])} r={4} fill={colors[rule]} />}
              </g>
            ))}
          </g>
        ))}
        {values.map((_, i) => (
          <text key={i} x={x(i)} y={plotHeight - 27} textAnchor="middle" fontSize={12} fill="var(--text-secondary)">
            {stage === 2 ? draws[draw][i] + 1 : i + 1}
          </text>
        ))}
        <text x={230} y={plotHeight - 6} textAnchor="middle" fontSize={12} fill="var(--text-secondary)">
          {stage === 2 ? "Source day selected (repeats allowed)" : "Day"}
        </text>
      </svg>
      </div>
      <div aria-live="polite">
        {stage === 0 && <p className="help">Six days of net returns. A averages +{means[0].toFixed(2)}% per day; B averages +{means[1].toFixed(2)}%. Their rises and falls largely coincide.</p>}
        {stage === 1 && <p className="help">Subtract 0.10 percentage points from A and 0.05 from B. Each line shifts down; both now average zero. Their shapes and shared movements stay intact.</p>}
        {stage === 2 && <p className="help">Use days {draws[draw].map(day => day + 1).join(", ")} for both rules, sampled in consecutive pairs. The same days may appear more than once. The app samples groups of varying lengths.</p>}
      </div>
      {stage === 2 && <>
        <button type="button" onClick={() => setDraw((draw + 1) % draws.length)}>Show another resampled history</button>
        <p className="help">Using the original return spreads and 365 days per year: A scores {scores[draw][0].toFixed(2)}, B scores {scores[draw][1].toFixed(2)}. Keep the higher score: <strong>{winners[draw].toFixed(2)}</strong>.</p>
        <Tex tex={String.raw`S_0=\frac{${winners.map(value => `(${value.toFixed(2)})`).join("+")}}{3}\approx${mean(winners).toFixed(2)}`} />
        <p className="help">That averages the winners of the three example histories, including the negative winner. Six days illustrate the arithmetic; estimating a benchmark needs a longer history and many resamples.</p>
      </>}
    </aside>
  );
}
