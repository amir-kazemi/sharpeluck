import { useEffect } from "react";
import {
  backtestToy, COINS, computeToy, EULER_GAMMA, exactBestOfN, expectedBestOfN,
  invNorm, normCdf,
  GROSS_USD, pct, PRICES, returns, signed, usd, WALKTHROUGH_DAYS,
} from "./toyCalc";
import {
  BookWheel, CategoryBars, DivergingBars, NumberLine,
  SearchBreakdown, SearchCostCurve, SharpeScale, Sparkline,
} from "./GuideViz";
import { Tex } from "../components/Tex";
import { WinnerDemo } from "./WinnerDemo";
import { ShortcutDemo } from "./ShortcutDemo";
import { BootstrapExample } from "./BootstrapExample";
import AuditMethods from "../components/AuditMethods";
import { GuideNotation } from "../components/GuideNotation";

function Toc() {
  const items = [
    ["setup", "1. A toy universe"],
    ["ranking", "2. From price to a ranking"],
    ["weighting", "3. From ranking to a position"],
    ["scoring", "4. From a position to a score"],
    ["trial-grid", "5. One trial among many"],
    ["four-tests", "6. Why the winner isn't enough"],
  ] as const;
  return (
    <nav className="guide-toc">
      {items.map(([id, label]) => <a key={id} href={`#guide/${id}`}>{label}</a>)}
    </nav>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return <div className="guide-callout">{children}</div>;
}

function Figure({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="guide-figure">
      {children}
      <div className="help" style={{ marginTop: 8 }}>{caption}</div>
    </div>
  );
}

export default function Guide() {
  useEffect(() => {
    // Run after the lazy-loaded guide has mounted, so section targets exist.
    const scrollToSection = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#guide/")) {
        document.getElementById(hash.slice(7))?.scrollIntoView({ block: "start" });
      }
    };
    scrollToSection();
    window.addEventListener("hashchange", scrollToSection);
    return () => window.removeEventListener("hashchange", scrollToSection);
  }, []);
  const t = computeToy();
  const b = backtestToy();
  const dayFive = WALKTHROUGH_DAYS + 1;
  const ret5 = (c: (typeof COINS)[number]) =>
    PRICES[c][dayFive - 1] / PRICES[c][dayFive - 2] - 1;
  // Day n is weighted from the three returns spanning days n-4 to n-1, then
  // held into day n. Spelled out once here so section 4 can show the window
  // sliding rather than assert that it does.
  const volWindow = (day: number) => `${day - WALKTHROUGH_DAYS}–${day - 1}`;
  // Built from the computed results, so the formula can never disagree with
  // the chart above it.
  // The pieces of the best-of-N expression, computed rather than transcribed.
  const N = 44;
  const p1 = 1 - 1 / N;
  const p2 = 1 - 1 / (N * Math.E);
  const z1 = invNorm(p1);
  const z2 = invNorm(p2);
  const bestOf44 = expectedBestOfN(N);
  const exactBest = exactBestOfN(N);
  const exampleSpread = 0.5;   // an illustrative dispersion of trial Sharpes

  const pnlSum = b.days
    .map((d) => `${d.pnl >= 0 ? "+" : "-"}${Math.abs(d.pnl * 100).toFixed(3)}`)
    .join("");

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <p className="note" style={{ margin: 0 }}>
        This guide follows a small example from prices to positions, returns
        and an audit of the winning rule. The app applies the same steps to
        hourly data, a larger coin universe and multiple trial configurations.
      </p>

      <Toc />
      <GuideNotation />

      {/* ---------------------------------------------------------------- 1 */}
      <section id="setup" className="guide-section">
        <h2>1. A toy universe</h2>
        <p>
          Four coins, four days of closing prices. In the real app this is ~50
          coins and thousands of hourly bars; the arithmetic is identical.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>day</th>{COINS.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {Array.from({ length: WALKTHROUGH_DAYS }, (_, d) => (
                <tr key={d}>
                  <td>{d + 1}</td>
                  {COINS.map((c) => <td key={c}>{PRICES[c][d]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Figure caption="D has the largest price increase. Sections 2 and 3 use only these first four days.">
          <div className="row" style={{ gap: 22, justifyContent: "center", flexWrap: "wrap" }}>
            {COINS.map((c) => (
              <Sparkline key={c} label={c}
                         prices={PRICES[c].slice(0, WALKTHROUGH_DAYS)} />
            ))}
          </div>
        </Figure>
      </section>

      {/* ---------------------------------------------------------------- 2 */}
      <section id="ranking" className="guide-section">
        <h2>2. From price to a ranking</h2>
        <p>
          The signal is <strong>volatility, negated</strong>: buy coins with
          lower volatility and short those with higher volatility. First,
          calculate each day’s return:
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>coin</th><th>day1→2</th><th>day2→3</th><th>day3→4</th></tr>
            </thead>
            <tbody>
              {COINS.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  {returns(PRICES[c].slice(0, WALKTHROUGH_DAYS))
                    .map((r, i) => <td key={i}>{pct(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Volatility is the standard deviation of those three returns — how
          much they scatter around their own average, not how far the price
          travelled overall.
        </p>
        <Figure caption={
          `A's mean return is ${pct(t.rets.A.reduce((a,b)=>a+b,0)/3)}. `
          + `Its returns vary the most around their mean, giving it the highest volatility.`
        }>
          <CategoryBars fmt={pct as (v: number) => string}
                        items={COINS.map((c) => ({ label: c, value: t.vol[c] }))} />
        </Figure>
        <Callout>
          D rises from {PRICES.D[0]} to {PRICES.D[WALKTHROUGH_DAYS - 1]}, yet
          has the second-lowest volatility: its daily returns are similar.
          C finishes below its starting price, but its daily returns vary more than
          D’s. Volatility measures variation in returns, which can be small
          even when the total price change is large.
        </Callout>

        <p style={{ marginTop: 18 }}>
          Raw volatility isn't comparable across days — a quiet week makes
          every coin's volatility read low. What matters is each coin{" "}
          <em>relative to the others on that same day</em>: subtract the
          average of the four, divide by their spread. That's a{" "}
          <strong>z-score</strong>.
        </p>
        <Figure caption={
          `Mean volatility across the four coins is ${pct(t.volMean)}, spread ${pct(t.volStd)}. `
          + "Each dot is (that coin's volatility − mean) ÷ spread."
        }>
          <NumberLine values={COINS.map((c) => ({ coin: c, v: t.z[c] }))} />
        </Figure>
      </section>

      {/* ---------------------------------------------------------------- 3 */}
      <section id="weighting" className="guide-section">
        <h2>3. From ranking to a position</h2>
        <p>
          The rule was volatility <strong>negated</strong> — flip every sign.
          A had the highest volatility (most positive z), so negating makes it
          the most negative: the biggest short.
        </p>
        <Figure caption="Same axis, every dot mirrored through zero.">
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div className="help" style={{ marginBottom: 4 }}>before negation</div>
              <NumberLine values={COINS.map((c) => ({ coin: c, v: t.z[c] }))} />
            </div>
            <div>
              <div className="help" style={{ marginBottom: 4 }}>after negation</div>
              <NumberLine values={COINS.map((c) => ({ coin: c, v: t.negZ[c] }))} />
            </div>
          </div>
        </Figure>
        <p>
          Last step: turn four signed numbers into positions that are{" "}
          <strong>dollar-neutral</strong> (longs exactly offset shorts) and{" "}
          <strong>unit-gross</strong> (fully invested, not levered). Divide
          each by the sum of all four's absolute values:
        </p>
        <Figure caption={
          `Sum of |negated z-scores| = ${COINS.map(c=>Math.abs(t.negZ[c]).toFixed(2)).join(" + ")} `
          + `≈ ${COINS.reduce((a,c)=>a+Math.abs(t.negZ[c]),0).toFixed(2)}. Each weight = its share of that sum, `
          + `signed by long (blue) or short (red).`
        }>
          <DivergingBars items={COINS.map((c) => ({ coin: c, weight: t.weight[c] }))} />
        </Figure>
        <p className="sub" style={{ marginTop: -6 }}>
          Check: weights sum to {signed(COINS.reduce((a, c) => a + t.weight[c], 0), 3)} (dollar-neutral)
          and their absolute values sum to{" "}
          {COINS.reduce((a, c) => a + Math.abs(t.weight[c]), 0).toFixed(3)} (unit-gross).
        </p>
        <Callout>
          Going into the next day: <strong>short A {pct(Math.abs(t.weight.A), 1)}</strong>, long
          the rest. A receives the largest short position because it has the
          highest measured volatility.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 4 */}
      <section id="scoring" className="guide-section">
        <h2>4. From a position to a score</h2>
        <p>
          Sections 1-3 stopped at day {WALKTHROUGH_DAYS}, which is where the
          first position could be formed. Here are the three days it is held
          into — the rest of the toy's prices:
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>day</th>{COINS.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {PRICES.A.slice(WALKTHROUGH_DAYS).map((_, i) => (
                <tr key={i}>
                  <td>day {WALKTHROUGH_DAYS + 1 + i}</td>
                  {COINS.map((c) => (
                    <td key={c}>{PRICES[c][WALKTHROUGH_DAYS + i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          C rises to {PRICES.C[WALKTHROUGH_DAYS]} and then falls. The following
          calculations show how those returns change its volatility and position.
        </p>
        <p>
          Hold the positions through the next day to calculate their returns.
          Use a portfolio with{" "}
          <strong>{usd(GROSS_USD, 0)} of gross exposure</strong>: the weights
          say {usd(Math.abs(t.weight.A) * GROSS_USD, 0)} short A and the other{" "}
          {usd((1 - Math.abs(t.weight.A)) * GROSS_USD, 0)} spread long across
          B, C and D. Each position earns its coin's return.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>coin</th><th>weight held</th><th>position</th>
                <th>day {WALKTHROUGH_DAYS}→{dayFive} return</th>
                <th>contribution</th><th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {COINS.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{signed(t.weight[c] * 100, 1)}%</td>
                  <td>{usd(t.weight[c] * GROSS_USD)}</td>
                  <td>{pct(ret5(c), 2)}</td>
                  <td>{signed(t.weight[c] * ret5(c) * 100, 3)}%</td>
                  <td>{usd(t.weight[c] * ret5(c) * GROSS_USD)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>day {dayFive} P&amp;L</strong></td>
                <td /><td /><td />
                <td><strong>{signed(b.days[0].pnl * 100, 3)}%</strong></td>
                <td><strong>{usd(b.days[0].pnl * GROSS_USD)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          A short position earns the negative of its coin's return: A rose{" "}
          {pct(ret5("A"), 2)}, and being short it cost{" "}
          {usd(Math.abs(t.weight.A * ret5("A") * GROSS_USD))}, which is most of
          the day's loss. Notice C, though: it jumped {pct(ret5("C"), 2)} after
          three days of barely moving. You only had{" "}
          {usd(t.weight.C * GROSS_USD)} allocated to it, so its contribution was
          small. Its price increase will affect the next day’s weights.
        </p>

        <h3>Day {dayFive + 1}, step by step</h3>
        <p>
          The next day is the same four steps with the window slid forward one
          day. Nothing from day {dayFive} is carried into it except the price
          history everyone can see:
        </p>
        <ol className="guide-list">
          <li>
            <strong>Re-measure.</strong> Volatility over days{" "}
            {volWindow(dayFive + 1)} instead of days {volWindow(dayFive)} — the
            day {WALKTHROUGH_DAYS}→{dayFive} return you just traded through is
            now the newest number in the window, and the oldest one drops out.
            C's jump enters here, and it triples C's volatility.
          </li>
          <li><strong>Re-rank.</strong> Z-score those four volatilities, negate.</li>
          <li>
            <strong>Re-weight.</strong> Back to {usd(GROSS_USD, 0)} gross — not{" "}
            {usd(GROSS_USD + b.days[0].pnl * GROSS_USD)}.
          </li>
          <li>
            <strong>Re-hold.</strong> Into day {dayFive + 1}, and collect
            whatever it pays.
          </li>
        </ol>
        <Callout>
          This example keeps gross exposure at {usd(GROSS_USD, 0)} each day.
          Profits are not reinvested, so dollar P&amp;L is measured against the
          same amount throughout. The app’s equity curve compounds the daily
          returns to show portfolio growth.
        </Callout>

        <p>
          Repeat for day {dayFive + 2}. Three windows, three different rankings,
          three results:
        </p>
        <Figure caption={
          "One frame per day: the ring is the whole $1,000 of gross, split into "
          + "what each coin holds. The shorts always fill exactly half of it, so "
          + "the only thing that moves is which coins are in that half."
        }>
          <BookWheel days={b.days} coins={COINS} windowLabel={volWindow} />
        </Figure>
        <p>
          The short side changed hands. On day {dayFive} A carried it alone at{" "}
          {signed(b.days[0].weights.A * 100, 1)}%; once C's jump entered the
          window, C became the bigger short and A's share fell to{" "}
          {signed(b.days[1].weights.A * 100, 1)}%. That is the rule reacting to
          new information, and it is the whole reason the weights are
          recomputed every day rather than set once. Three days,{" "}
          {usd(GROSS_USD, 0)} risked on each, and you finish{" "}
          {usd(Math.abs(b.days[b.days.length - 1].cum * GROSS_USD))}{" "}
          {b.days[b.days.length - 1].cum < 0 ? "down" : "up"}.
        </p>
        <Figure caption={
          `The average sits ${pct(Math.abs(b.avg), 3)} from zero. The days scatter `
          + `${pct(b.sd, 3)} around it. The score is the first length measured in `
          + `units of the second; a negative score means the average return is below zero.`
        }>
          <SharpeScale days={b.days} avg={b.avg} sd={b.sd} />
        </Figure>
        <p>
          That ratio — <strong>average return divided by how much it varies</strong> —
          is the <strong>Sharpe ratio</strong>, the single number a trial is
          judged on. Writing π<sub>t</sub> for the P&amp;L on day t:
        </p>
        <Tex tex={String.raw`S \;=\; \frac{\operatorname{mean}_t\left(\pi_t\right)}
                             {\operatorname{sd}_t\left(\pi_t\right)}
                             \;=\; \frac{\dfrac{1}{T}\sum_{t=1}^{T}\pi_t}
                             {\sqrt{\dfrac{1}{T-1}\sum_{t=1}^{T}\left(\pi_t-\bar\pi\right)^{2}}}`} />
        <p>Substituting the {b.days.length} daily results from the chart above:</p>
        <Tex tex={String.raw`S \;=\; \frac{\dfrac{1}{${b.days.length}}\left(${pnlSum}\right)\%}
                             {${(b.sd * 100).toFixed(3)}\%}
                             \;=\; \frac{${(b.avg * 100).toFixed(3)}\%}{${(b.sd * 100).toFixed(3)}\%}
                             \;=\; ${b.sharpe.toFixed(3)}`} />
        <p className="sub">
          The denominator is the spread of those same {b.days.length} numbers
          around their average: {(b.sd * 100).toFixed(3)}%, using the same sample
          standard deviation as the app. The app
          multiplies the result by the square root of the number of bars in a
          year to annualise it. This {b.days.length}-day example shows the raw
          ratio; the sample is too short for a useful annual estimate.
        </p>
        <Callout>
          This rule’s score is {b.sharpe.toFixed(2)}. If we test {N} rules and
          select the highest score, <strong>that score can be positive even
          when every rule has a true average return of zero.</strong> The next
          two sections explain how to account for that selection.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 5 */}
      <section id="trial-grid" className="guide-section">
        <h2>5. One trial among many</h2>
        <p>
          That was <strong>one trial</strong>: one measurement, one window, one
          sign, one rebalance frequency. The full search tests several choices
          of each, producing the following trial count.
        </p>
        <SearchBreakdown />
        <p>
          Suppose all {N} rules have a true average return of zero. Their
          measured scores still vary because the sample is finite. Selecting
          the highest score raises the expected result. We need to calculate{" "}
          <strong>the average maximum of {N} scores produced by noise.</strong>
        </p>
        <p>
          <strong>Start with the level one score in {N} should reach.</strong>{" "}
          Treat the {N} scores as independent draws from one bell curve and
          write <Tex display={false} tex="M" /> for the largest of them.
          Call <Tex display={false} tex="q" /> the level a single score has
          a 1 in {N} chance of beating; on a normal curve that is{" "}
          <Tex display={false} tex={String.raw`${z1.toFixed(2)}\sigma`} />,
          because {(normCdf(2) * 100).toFixed(2)}% of the
          curve lies below 2. Across {N} scores, the number expected to beat <Tex display={false} tex="q" />
          is then exactly one:
        </p>
        <Tex tex={String.raw`P(Z_i > q) = \frac{1}{${N}} = ${(1 / N).toFixed(4)}
          \quad\Longrightarrow\quad q = \Phi^{-1}(${p1.toFixed(4)}) = ${z1.toFixed(2)}\sigma
          \qquad ${N} \times \frac{1}{${N}} = 1`} />

        <p>
          <strong>Expecting one is not the same as getting one.</strong> Some
          runs produce two or three scores above <Tex display={false} tex="q" />,
          others none at all. The winner is below <Tex display={false} tex="q" /> only when <em>every</em> score is — one score above
          is enough to carry the largest above too — and each score falls below
          with probability <Tex display={false} tex={String.raw`\frac{${N - 1}}{${N}}`} />.
          Multiplied together, that is the chance
          the whole batch stays under:
        </p>
        <Tex tex={String.raw`P(M \le q) = \left(1-\frac{1}{${N}}\right)^{${N}}
          = ${Math.pow(1 - 1 / N, N).toFixed(2)}
          \qquad\Longrightarrow\qquad
          P(M > q) = ${(1 - Math.pow(1 - 1 / N, N)).toFixed(2)}`} />
        <p>
          So the winner beats <Tex display={false} tex="q" /> about{" "}
          {((1 - Math.pow(1 - 1 / N, N)) * 100).toFixed(0)}% of the time, and
          not only for {N}: since <Tex display={false} tex={String.raw`(1-1/N)^N \to 1/e`} />,
          that figure approaches <Tex display={false} tex={String.raw`1-1/e \approx ${((1 - 1 / Math.E) * 100).toFixed(0)}\%`} /> for any <Tex display={false} tex="N" />
          of moderate size.
        </p>

        <div className="winner-explanation">
        <div className="winner-copy">
        <p>
          <strong>Average the winners across repeated searches.</strong>{" "}
          Repeat the {N}-rule search with fresh noise and keep each winner.
          To average them, we need the chance of winning at every score.
          If <Tex display={false} tex={String.raw`\Phi(x)`} /> is the chance
          one score falls below <Tex display={false} tex="x" />, all {N} independent
          scores fall below it with probability:
        </p>
        <Tex tex={String.raw`P(M \le x) = \Phi(x)^N`} />
        <p>
          With scores measured in <Tex display={false} tex={String.raw`\sigma`} /> units,
          the band from <Tex display={false} tex="2.0" /> to <Tex display={false} tex="2.1" /> is just one example:
        </p>
        <Tex tex={String.raw`P(2.0 < M \le 2.1)
          = \Phi(2.1)^{${N}} - \Phi(2.0)^{${N}}`} />
        <p>
          Average over all bands, including winners below <Tex display={false} tex="2.0" />,
          weighting each score by its probability. Here <Tex display={false} tex={String.raw`\Delta x`} /> is
          the band width and <Tex display={false} tex={String.raw`k\in\mathbb{Z}`} /> runs over
          all integer band labels:
        </p>
        <Tex tex={String.raw`\begin{aligned}
          \mathbb{E}[M]
          &= \lim_{\Delta x\to 0}\sum_{k\in\mathbb{Z}} k\Delta x\,
            \underbrace{\left[\Phi((k+1)\Delta x)^N-\Phi(k\Delta x)^N\right]}
            _{\text{probability in this band}} \\
          &= \int_{-\infty}^{\infty} x\,N\phi(x)\Phi(x)^{N-1}\,dx
          \;\approx\; ${exactBest.toFixed(4)}\,\sigma
          \end{aligned}`} />
        <p className="sub">
          Here <Tex display={false} tex={String.raw`\phi`} /> is the normal bell-curve density;{" "}
          <Tex display={false} tex={String.raw`N\phi(x)\Phi(x)^{N-1}`} />
          {" "}is the derivative of <Tex display={false} tex={String.raw`\Phi(x)^N`} />, the winner's cumulative
          probability above. The integral is the sum as the bands become
          arbitrarily narrow.
        </p>
        </div>
        <WinnerDemo count={N} threshold={z1} expected={exactBest} />
        </div>
        <div className="winner-explanation">
        <div className="winner-copy">
        <p>
          <strong>There is a shortcut to this averaging.</strong>{" "}
          Start at <Tex display={false} tex="q" />, where one score per batch
          is expected to beat the threshold. Raise it until that count falls
          to <Tex display={false} tex={String.raw`1/e\approx0.368`} />.
          The distance between these two levels measures how quickly the
          upper tail thins:
        </p>
        <Tex tex={String.raw`\begin{aligned}
          N[1-\Phi(q)]&=1 & q&=${z1.toFixed(4)}\sigma \\
          N[1-\Phi(\text{next level})]&=1/e
          &\text{next level}&=\Phi^{-1}(1-1/(Ne))=${z2.toFixed(4)}\sigma
          \end{aligned}`} />
        <p>
          Here <Tex display={false} tex={String.raw`\Phi^{-1}`} /> looks up
          a score from the fraction below it. The shortcut assumes that each
          further step of this size divides the expected count by{" "}
          <Tex display={false} tex={String.raw`e\approx2.718`} /> again.
          Combining that exponential approximation with the “all scores below”
          calculation gives the large-batch{" "}
          <a href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda366g.htm">
            Gumbel distribution
          </a> approximation for winners. Its average, counting winners on
          both sides of <Tex display={false} tex="q" />, sits 57.72% of a step
          above it. This fraction is the Euler–Mascheroni constant,
          <Tex display={false} tex={String.raw`\gamma\approx0.5772`} />.
          So add that fraction of the gap to the starting score:
        </p>
        <Tex tex={String.raw`\begin{aligned}
          \mathbb{E}[M] &\approx ${z1.toFixed(4)} + ${EULER_GAMMA.toFixed(4)}
            \times (${z2.toFixed(4)}-${z1.toFixed(4)})
            = ${bestOf44.toFixed(4)}\,\sigma \\
          &= (1-\gamma)\,\Phi^{-1}\!\left(1-\frac{1}{N}\right)
            + \gamma\,\Phi^{-1}\!\left(1-\frac{1}{N e}\right)
          \end{aligned}`} />
        <p className="sub">
          The trial-count chart below uses this <Tex display={false} tex={String.raw`${bestOf44.toFixed(2)}\sigma`} /> estimate,
          about <Tex display={false} tex={String.raw`${(bestOf44 - exactBest).toFixed(3)}\sigma`} /> above
          numerical averaging. Both assume independent normal scores.
        </p>
        </div>
        <ShortcutDemo count={N} lower={z1} upper={z2} />
        </div>

        <h3>Now translate it into Sharpe units</h3>
        <p>
          So far, <Tex display={false} tex={String.raw`${bestOf44.toFixed(2)}\sigma`} /> means
          the winner sits about {bestOf44.toFixed(2)} standard deviations above
          zero. To turn that into a Sharpe ratio, we need the spread of the
          noisy Sharpe estimates. Suppose every rule has a true Sharpe of zero,
          and its measured Sharpe is normally distributed with standard
          deviation {exampleSpread}. This is an illustrative assumption about
          estimation noise, not the volatility of daily returns.
        </p>
        <p>
          Each measured Sharpe is then <Tex display={false} tex={String.raw`S_i=${exampleSpread}Z_i`} />,
          where <Tex display={false} tex="Z_i" /> is its score in standard-deviation
          units. Multiplying all scores by the same positive number also
          multiplies their maximum by that number. For {N} independent rules:
        </p>
        <Tex tex={String.raw`\mathbb E\!\left[\max_{1\le i\le ${N}} S_i\right]
          = ${exampleSpread}\,\mathbb E[M]
          \approx ${exampleSpread}\times${bestOf44.toFixed(2)}
          \approx ${(bestOf44 * exampleSpread).toFixed(1)}`} />
        <p>
          In this example, a search through {N} rules with no real edge produces
          a best measured Sharpe of about {(bestOf44 * exampleSpread).toFixed(1)}
          {" "}on average. A result near that value is therefore consistent with
          selection from noisy estimates. This average is a noise benchmark, not a pass/fail
          cutoff or a guarantee about any one search.
        </p>
        <p>
          As the number of trials increases, so does the estimated average
          winner. The curve below measures that increase in standard deviations.
        </p>
        <Figure caption="Estimated average best score from independent normal trials with no real edge, in units of the trial-score standard deviation. Section 6 extends this to the app’s dependent trials.">
          <SearchCostCurve />
        </Figure>
        <Callout>
          Keep the same noise spread of {exampleSpread}, and the estimated
          average best Sharpe rises with the number of independent rules:
          {" "}{(expectedBestOfN(11) * exampleSpread).toFixed(2)} for 11,
          {" "}{(bestOf44 * exampleSpread).toFixed(2)} for {N}, and
          {" "}{(expectedBestOfN(500) * exampleSpread).toFixed(2)} for 500.
          Searching more rules raises the expected maximum even when none has an edge.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 6 */}
      <section id="four-tests" className="guide-section">
        <h2>6. Why the winner isn't enough</h2>
        <p>
          Section 5 estimated how high the best score could be without any real
          edge. That calculation assumed independent trials. Actual rules often
          use the same prices and similar windows, so their returns move together.
          Two identical rules, for example, always have the same score: testing
          both cannot raise the maximum. For jointly normal scores with
          nonnegative correlations, assuming independence overestimates the
          average maximum; negative dependence can have the opposite effect. The app
          therefore estimates the noise benchmark using the actual rules’ return
          histories.
        </p>
        <div className="bootstrap-step">
        <div className="winner-copy">
        <p>
          First create returns with no average profit: subtract each rule’s
          historical mean. Its daily rises and falls remain, but now average
          zero. For <Tex display={false} tex="T" /> observations, write{" "}
          <Tex display={false} tex="r_{t,i}" /> for rule{" "}
          <Tex display={false} tex="i" />’s net return at time{" "}
          <Tex display={false} tex="t" />:
        </p>
        <Tex tex={String.raw`\bar r_i=\frac1T\sum_{t=1}^T r_{t,i}
          \quad \tilde r_{t,i}=r_{t,i}-\bar r_i
          \quad \frac1T\sum_{t=1}^T\tilde r_{t,i}=0`} />
        <p>
          Next build new histories by sampling these returns, allowing dates
          to repeat. This is <strong>bootstrapping</strong>. Sample the same
          dates for every rule so that their returns still move together.
          Sample consecutive dates in blocks to retain short-term time patterns.
          The app uses randomly varying block lengths, a method called the{" "}
          <strong>stationary block bootstrap</strong>.
        </p>
        <p>
          Because every rule is scored in the same simulated history, the app
          measures their maximum directly. For example, it estimates
          <Tex display={false} tex={String.raw`P(M\le x)`} /> as the fraction of
          simulated histories whose maximum is at most <Tex display={false} tex="x" />;
          it does not multiply the rules’ separate probabilities. Identical
          rules remain identical in every simulation and cannot raise the maximum.
        </p>
        <p>
          In simulated history <Tex display={false} tex="b" />,{" "}
          <Tex display={false} tex="j_b(t)" /> identifies the original date
          copied into position <Tex display={false} tex="t" />. Each rule’s
          simulated return is its centered return from that date:
        </p>
        <Tex tex={String.raw`r^{*(b)}_{t,i}=\tilde r_{j_b(t),i}
          \quad\text{for every rule }i`} />
        <p>
          A resampled history can have a positive or negative mean even though
          the source returns average zero. Score each rule using its new mean
          and original return standard deviation <Tex display={false} tex="s_i" />.
          The factor <Tex display={false} tex={String.raw`\sqrt A`} /> annualises
          the score, where <Tex display={false} tex="A" /> is observations per year:
          under the usual uncorrelated-return assumption, annual mean return
          scales by <Tex display={false} tex="A" />, annual standard
          deviation by <Tex display={false} tex={String.raw`\sqrt A`} />, so their
          ratio scales by <Tex display={false} tex={String.raw`A/\sqrt A=\sqrt A`} />.
        </p>
        <Tex tex={String.raw`S_i=\sqrt A\,\frac{\bar r_i}{s_i}
          \qquad S_i^{*(b)}=\sqrt A\,
          \frac{\frac1T\sum_{t=1}^T r^{*(b)}_{t,i}}{s_i}`} />
        <p>
          These are the observed score and its simulated counterpart, using
          the Sharpe calculation from <a href="#guide/scoring">§4</a>.
          All scores in this section are annualised.
        </p>
        <p>
          Keep the best of the <Tex display={false} tex="N" /> rules in each
          history, then average those winners across <Tex display={false} tex="B" />
          {" "}histories. This gives <Tex display={false} tex="S_0" />, the app’s
          “Best the noise would give” benchmark:
        </p>
        <Tex tex={String.raw`S_0=\frac1B\sum_{b=1}^B\max_{1\le i\le N}S_i^{*(b)}`} />
        </div>
        <BootstrapExample />
        </div>

        <p>
          With the noise benchmark in hand, the audit checks the observed result
          in three ways. The app selects its winning rule by the highest average
          Sharpe across training periods; <Tex display={false} tex={String.raw`S_{\mathrm{winner}}`} />
          {" "}is that rule’s full-history Sharpe. Only the run’s recorded trials
          are included in the audit.
        </p>
        <AuditMethods />

        <h3>What the verdict means</h3>
        <p>
          The app’s <strong>“Survives the audit”</strong> verdict requires all
          three statistical conditions, evaluated on returns after the configured
          trading costs:
        </p>
        <Tex tex={String.raw`\mathrm{DSR}>0.95\qquad\mathrm{PBO}<0.30\qquad p_{\mathrm{reality\ check}}<0.05`} />
        <p className="sub">
          These checks are complementary, not independent. The cost curve is
          a separate sensitivity check; it adds no fourth pass/fail condition.
        </p>
        <Callout>
          A failed audit means the result has not met these evidence thresholds.
          A pass supports further testing on fresh data with realistic execution
          costs; it does not guarantee future returns. The app measures whether
          the winning result provides evidence beyond what the search could
          produce by chance.
        </Callout>
      </section>

      <p className="note">
        <a href="#new-run">← back to the app, to run your own search</a>
      </p>
    </div>
  );
}
