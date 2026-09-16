import { useEffect, useState } from "react";
import { Tex } from "../components/Tex";

type Search = { seed: number; scores: number[]; winners: number[]; total: number };
const initial: Search = { seed: 1709, scores: [], winners: [], total: 0 };

// A reproducible normal simulation; keep state updates pure for React StrictMode.
export function nextSearch(previous: Search, count: number): Search {
  let seed = previous.seed;
  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const scores = Array.from({ length: count }, () =>
    Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()));
  const winner = Math.max(...scores);
  return { seed, scores, winners: [...previous.winners, winner], total: previous.total + winner };
}

export function WinnerDemo({ count, threshold, expected }: {
  count: number; threshold: number; expected: number;
}) {
  const [search, setSearch] = useState<Search>(initial);
  const [playing, setPlaying] = useState(false);
  const batches = search.winners.length;
  const limit = 2000;
  useEffect(() => {
    if (!playing || batches >= limit) return;
    const timer = window.setInterval(() => setSearch(previous =>
      previous.winners.length < limit ? nextSearch(previous, count) : previous), 180);
    return () => window.clearInterval(timer);
  }, [playing, batches >= limit, count]);

  const mean = batches ? search.total / batches : null;
  const winner = batches ? search.winners[batches - 1] : null;
  const lo = Math.floor(Math.min(-4, ...search.scores, ...search.winners));
  const hi = Math.ceil(Math.max(5, ...search.scores, ...search.winners));
  const x = (value: number) => 32 + (value - lo) / (hi - lo) * 376;
  const bins = Array.from({ length: (hi - lo) * 4 }, () => 0);
  search.winners.forEach(value => {
    bins[Math.min(bins.length - 1, Math.floor((value - lo) * 4))]++;
  });
  const peak = Math.max(1, ...bins);
  const below = search.winners.filter(value => value < threshold).length;
  const active = playing && batches < limit;

  return (
    <aside className="guide-figure winner-demo" aria-label="Simulate the average winner">
      <strong>Keep the winner. Repeat. Average.</strong>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" disabled={batches >= limit} onClick={() => setPlaying(!playing)}>
          {active ? "Pause" : "Play"}
        </button>
        <button type="button" disabled={batches >= limit} onClick={() => {
          setPlaying(false);
          setSearch(previous => nextSearch(previous, count));
        }}>One batch</button>
        <button type="button" onClick={() => { setPlaying(false); setSearch(initial); }}>Reset</button>
      </div>
      <div className="help">
        Latest batch: {count} scores; highlighted dot wins.
        <br />{batches ? `Winner: ${winner!.toFixed(2)}σ · ${batches} batches collected` : "Press Play or One batch to draw scores"}
      </div>
      <svg className="winner-plot" viewBox="0 0 440 300" role="img" aria-label={
        `${batches} batches. ${mean === null ? "Press Play to start." : `Average winner ${mean.toFixed(3)} sigma. ${below} winners below the threshold.`}`
      }>
        {[threshold, expected].map((value, index) => (
          <line key={index} x1={x(value)} x2={x(value)} y1={30} y2={250}
            stroke={index ? "var(--text-secondary)" : "var(--series-1)"}
            strokeDasharray={index ? "2 4" : "6 4"} opacity={0.65} />
        ))}
        {search.scores.map((score, i) => (
          <circle key={i} cx={x(score)} cy={43 + (i % 5) * 10}
            r={score === winner ? 5 : 3}
            fill={score === winner ? "var(--series-1)" : "var(--text-secondary)"}
            opacity={score === winner ? 1 : 0.45} />
        ))}
        {bins.map((value, i) => (
          <rect key={i} x={x(lo + i / 4) + 0.5} y={250 - value / peak * 140}
            width={376 / bins.length - 1} height={value / peak * 140}
            fill="var(--series-1)" opacity={0.5} />
        ))}
        {mean !== null && <path d={`M${x(mean)},105 v145`}
          stroke="var(--text-primary)" strokeWidth={2.5} />}
        <line x1={32} x2={408} y1={250} y2={250} stroke="var(--grid)" />
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map(value => (
          <text key={value} x={x(value)} y={269} textAnchor="middle" fill="var(--text-secondary)" fontSize={11}>{value}</text>
        ))}
        <text x={220} y={291} textAnchor="middle" fill="var(--text-secondary)" fontSize={12}>Score (σ units)</text>
      </svg>
      <div className="sub">
        Bars: collected winners; height = number of batches.
        <br />
        Solid line: average collected winner <strong>{mean === null ? "—" : `${mean.toFixed(3)}σ`}</strong>
        <br />Dashed: <Tex display={false} tex={String.raw`q=${threshold.toFixed(2)}\sigma`} />
        {" · "}Dotted: <Tex display={false} tex={String.raw`\mathbb E[M]=${expected.toFixed(2)}\sigma`} />
      </div>
      <p className="help">
        {below} of {batches} winners below <Tex display={false} tex="q" />. Every winner counts in the average.
        {batches >= limit ? " Run complete. Reset to replay." : " The average fluctuates as more batches arrive."}
      </p>
    </aside>
  );
}
