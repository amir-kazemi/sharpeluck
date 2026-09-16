import { Tex } from "../components/Tex";

function TailPicture({ threshold }: { threshold: number }) {
  const x = (score: number) => 24 + (score + 3.5) / 7 * 352;
  const y = (score: number) => 76 - 62 * Math.exp(-score * score / 2);
  const curve = Array.from({ length: 141 }, (_, i) => {
    const score = -3.5 + i / 20;
    return `${i ? "L" : "M"}${x(score)},${y(score)}`;
  }).join(" ");
  const tail = Array.from({ length: 61 }, (_, i) => {
    const score = threshold + (3.5 - threshold) * i / 60;
    return `L${x(score)},${y(score)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 400 108" role="img" aria-label={`Normal scores with the tail above ${threshold.toFixed(2)} sigma shaded orange.`} style={{ width: "100%", display: "block" }}>
      <path d={`M${x(threshold)},76 ${tail} L${x(3.5)},76 Z`} fill="var(--series-2)" />
      <path d={curve} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} />
      <line x1={24} x2={376} y1={76} y2={76} stroke="var(--axis)" />
      <line x1={x(threshold)} x2={x(threshold)} y1={38} y2={80} stroke="var(--series-2)" strokeWidth={2} />
      <text x={x(0)} y={99} textAnchor="middle" fill="var(--text-secondary)" fontSize={12}>0</text>
      <text x={x(threshold)} y={99} textAnchor="middle" fill="var(--text-secondary)" fontSize={12}>{threshold.toFixed(2)}σ</text>
    </svg>
  );
}

export function ShortcutDemo({ count, lower, upper }: {
  count: number; lower: number; upper: number;
}) {
  return (
    <aside className="guide-figure shortcut-picture" aria-label="Compare the normal tails above two thresholds">
      <strong>What changes when the threshold rises?</strong>
      <p className="help">Each bell curve shows one trial’s possible scores. Orange is the chance of beating the threshold.</p>
      <div>
        <div className="sub">At <Tex display={false} tex={String.raw`q=${lower.toFixed(2)}\sigma`} />: <strong>{(100 / count).toFixed(2)}% above</strong></div>
        <TailPicture threshold={lower} />
        <div className="sub"><Tex display={false} tex={String.raw`${count}\times\frac{1}{${count}}=1`} /> expected score above, per batch.</div>
      </div>
      <div className="shortcut-divider">
        <div className="sub">At <Tex display={false} tex={String.raw`${upper.toFixed(2)}\sigma`} />: <strong>{(100 / (count * Math.E)).toFixed(2)}% above</strong></div>
        <TailPicture threshold={upper} />
        <div className="sub"><Tex display={false} tex={String.raw`${count}\times\frac{1}{${count}e}=\frac1e\approx0.368`} /> expected scores above, per batch.</div>
      </div>
      <p className="help">Across 100 batches, expect about 100 scores above the first threshold and 37 above the second. These count scores, not winning batches.</p>
    </aside>
  );
}
