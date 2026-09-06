import {
  backtestToy, COINS, computeToy, EULER_GAMMA, expectedBestOfN, invNorm, normCdf,
  pct, PRICES, returns, signed, WALKTHROUGH_DAYS,
} from "./toyCalc";
import {
  BellCurve, CategoryBars, DecliningLine, DivergingBars, NumberLine, PnlBars,
  SearchBreakdown, SearchCostCurve, Sparkline, SplitHalf,
} from "./GuideViz";
import { Tex } from "../components/Tex";

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
  const t = computeToy();
  const b = backtestToy();
  const dayFive = WALKTHROUGH_DAYS + 1;
  const ret5 = (c: (typeof COINS)[number]) =>
    PRICES[c][dayFive - 1] / PRICES[c][dayFive - 2] - 1;
  // Built from the computed results, so the formula can never disagree with
  // the chart above it.
  // The pieces of the best-of-N expression, computed rather than transcribed.
  const N = 44;
  const p1 = 1 - 1 / N;
  const p2 = 1 - 1 / (N * Math.E);
  const z1 = invNorm(p1);
  const z2 = invNorm(p2);
  const bestOf44 = expectedBestOfN(N);
  const exampleSpread = 0.5;   // an illustrative dispersion of trial Sharpes
  const pExceeds = 1 - Math.pow(normCdf(z1), N);   // how often the max clears z1

  const pnlSum = b.days
    .map((d) => `${d.pnl >= 0 ? "+" : "-"}${Math.abs(d.pnl * 100).toFixed(3)}`)
    .join("");

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <p className="note" style={{ margin: 0 }}>
        Everything below is computed live from the four prices in the first
        table — change nothing, just read the arithmetic through. It is a
        stand-in for the real pipeline: real bars are hourly, the real universe
        holds ~50 coins out of hundreds, and 44 real trials run at once. Small
        enough here to check by hand; the same steps, at that scale, are what
        produced the run you were just looking at.
      </p>

      <Toc />

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
        <Figure caption="D climbs the most in price. Keep an eye on it — the prices continue past day 4, but sections 2 and 3 use only these.">
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
          Say the signal is <strong>volatility, negated</strong> — buy the
          calmest coins, short the choppiest. First, each day's return:
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
          `A's mean return is only ${pct(t.rets.A.reduce((a,b)=>a+b,0)/3)}, but its three returns swing `
          + `between them the most of any coin — that scatter is what "volatility" means here.`
        }>
          <CategoryBars fmt={pct as (v: number) => string}
                        items={COINS.map((c) => ({ label: c, value: t.vol[c] }))} />
        </Figure>
        <Callout>
          <strong>The surprise:</strong> D has the biggest price move on the
          chart above — 100 → 112 — but the <em>smallest</em> volatility of the
          four. It climbs by similar amounts on all three days, so its returns
          barely deviate from their own average. A looks calmer on the chart,
          but two rises followed by a fall makes its returns scatter the most.
          Volatility measures choppiness, not the size of a trend — mixing the
          two up is an easy way to misread a real backtest.
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
          the rest. The coin that looked calmest on the very first chart is the
          biggest short — because "calm-looking" and "low-volatility" turned
          out to be different things once actually measured.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 4 */}
      <section id="scoring" className="guide-section">
        <h2>4. From a position to a score</h2>
        <p>
          Positions alone are not a result. You hold them into the next day and
          see what they earn: each coin's return, multiplied by the weight you
          were holding, added up.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>coin</th><th>weight held</th>
                <th>day {WALKTHROUGH_DAYS}→{dayFive} return</th><th>contribution</th>
              </tr>
            </thead>
            <tbody>
              {COINS.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{signed(t.weight[c] * 100, 1)}%</td>
                  <td>{pct(ret5(c), 2)}</td>
                  <td>{signed(t.weight[c] * ret5(c) * 100, 3)}%</td>
                </tr>
              ))}
              <tr>
                <td><strong>day {dayFive} P&amp;L</strong></td>
                <td /><td />
                <td><strong>{signed(b.days[0].pnl * 100, 3)}%</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Then you do it again the next day, and the next — re-ranking, re-weighting,
          re-holding. Over the toy's ten days that gives {b.days.length} daily results:
        </p>
        <Figure caption={
          `Gains right of the line, losses left. They very nearly cancel: the average `
          + `is ${pct(b.avg, 3)} a day against day-to-day swings of ${pct(b.sd, 3)}, `
          + `so the score is ${b.sharpe.toFixed(3)}.`
        }>
          <PnlBars days={b.days} avg={b.avg} />
        </Figure>
        <p>
          That ratio — <strong>average return divided by how much it varies</strong> —
          is the <strong>Sharpe ratio</strong>, the single number a trial is
          judged on. Writing π<sub>t</sub> for the P&amp;L on day t:
        </p>
        <Tex tex={String.raw`S \;=\; \frac{\operatorname{mean}_t\left(\pi_t\right)}
                             {\operatorname{sd}_t\left(\pi_t\right)}
                             \;=\; \frac{\dfrac{1}{T}\sum_{t=1}^{T}\pi_t}
                             {\sqrt{\dfrac{1}{T}\sum_{t=1}^{T}\left(\pi_t-\bar\pi\right)^{2}}}`} />
        <p>Substituting the {b.days.length} daily results from the chart above:</p>
        <Tex tex={String.raw`S \;=\; \frac{\dfrac{1}{${b.days.length}}\left(${pnlSum}\right)\%}
                             {${(b.sd * 100).toFixed(3)}\%}
                             \;=\; \frac{${(b.avg * 100).toFixed(3)}\%}{${(b.sd * 100).toFixed(3)}\%}
                             \;=\; ${b.sharpe.toFixed(3)}`} />
        <p className="sub">
          The denominator is the spread of those same six numbers around their
          average: {(b.sd * 100).toFixed(3)}%. And the real app multiplies the
          result by the square root of the number of bars in a year to annualise
          it — doing that to six observations would be theatre, so the raw ratio
          is shown here.
        </p>
        <Callout>
          A score of {b.sharpe.toFixed(2)} is essentially nothing — the strategy
          alternates gains and losses because it is shorting the one coin that
          keeps bouncing. But here is the honest problem: <strong>you cannot tell
          whether {b.sharpe.toFixed(2)} is good or bad without knowing what a
          rule with no skill at all would have scored.</strong> That is what the
          next two sections work out.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 5 */}
      <section id="trial-grid" className="guide-section">
        <h2>5. One trial among many</h2>
        <p>
          That was <strong>one trial</strong>: one measurement, one window, one
          sign, one rebalance frequency. The real run doesn't try one — a
          lookback of exactly 72 hours being &ldquo;the&rdquo; right choice
          would itself be suspicious, so it sweeps a grid.
        </p>
        <SearchBreakdown />
        <p>
          Widening that grid is <strong>not free</strong>, and this is the
          number that makes the rest of the app necessary. Run a search on data
          with <em>no real edge in it at all</em> and the best trial still comes
          back positive, purely from luck — and the more trials you run, the
          luckier the best one gets:
        </p>
        <Figure caption="The expected best-of-N Sharpe when nothing has any edge, in units of how much trial Sharpes vary. Same expression the audit layer uses as its noise benchmark — see the Method panel.">
          <SearchCostCurve />
        </Figure>
        <h3>Where {bestOf44.toFixed(2)} comes from</h3>
        <p>
          <strong>A first guess — which will turn out to be too low.</strong>{" "}
          Draw N numbers from a bell curve and the largest usually lands near
          the <strong>(1 − 1/N)</strong> percentile: with {N} draws, about one
          part in {N} of the curve sits above it. That percentile is{" "}
          {p1.toFixed(4)}, and the score sitting at it is {z1.toFixed(2)}.
        </p>
        <p>
          <strong>The answer is {bestOf44.toFixed(2)}, not {z1.toFixed(2)}.</strong>{" "}
          A maximum clears {z1.toFixed(2)} about {(pExceeds * 100).toFixed(0)}% of
          the time, so that level is nowhere near its average. The distribution of a
          maximum leans to the right — it seldom falls far below that level and
          occasionally lands well above — so its <em>average</em> sits higher
          still. The expression below blends two percentiles to land on that
          average — <strong>{bestOf44.toFixed(2)}</strong>, the value marked on
          the chart above — rather than on the first guess. Φ<sup>−1</sup> turns a percentile into a score, and γ is the
          Euler–Mascheroni constant ({EULER_GAMMA.toFixed(4)}):
        </p>
        <Tex tex={String.raw`\mathbb{E}\!\left[\max_{N}\right]
          = (1-\gamma)\,\Phi^{-1}\!\left(1-\frac{1}{N}\right)
          + \gamma\,\Phi^{-1}\!\left(1-\frac{1}{N e}\right)`} />
        <p>Substituting N = {N} gives the average, not the estimate:</p>
        <Tex tex={String.raw`\begin{aligned}
          \mathbb{E}\!\left[\max_{${N}}\right]
          &= ${(1 - EULER_GAMMA).toFixed(4)}\cdot\Phi^{-1}(${p1.toFixed(4)})
           + ${EULER_GAMMA.toFixed(4)}\cdot\Phi^{-1}(${p2.toFixed(4)}) \\[2pt]
          &= ${(1 - EULER_GAMMA).toFixed(4)}\cdot ${z1.toFixed(4)}
           + ${EULER_GAMMA.toFixed(4)}\cdot ${z2.toFixed(4)} \\[2pt]
          &= ${((1 - EULER_GAMMA) * z1).toFixed(4)} + ${(EULER_GAMMA * z2).toFixed(4)}
           \;=\; ${bestOf44.toFixed(4)}\,\sigma
          \end{aligned}`} />

        <h3>Reading σ as a Sharpe</h3>
        <p>
          σ is <strong>how spread out the {N} rules' scores are from one
          another</strong>. Multiply to convert — if those scores scatter by{" "}
          {exampleSpread} Sharpe, say:
        </p>
        <Tex tex={String.raw`\text{bar to clear}
          \;=\; \mathbb{E}\!\left[\max_{${N}}\right]\times s
          \;=\; ${bestOf44.toFixed(2)}\times ${exampleSpread}
          \;\approx\; ${(bestOf44 * exampleSpread).toFixed(1)}`} />
        <p className="sub">
          So the number on trial — the {b.sharpe.toFixed(2)} from section 4 —
          would need to clear about {(bestOf44 * exampleSpread).toFixed(1)},
          not 0. Beating zero counts for nothing.
        </p>
        <Callout>
          The bar rises with the size of the search:{" "}
          {expectedBestOfN(11).toFixed(2)}σ at 11 trials,{" "}
          {bestOf44.toFixed(2)}σ at {N}, {expectedBestOfN(500).toFixed(2)}σ at 500.
          You can always find a better-looking strategy by searching harder — but
          you raise the bar by doing so, which is why a good-looking Sharpe on its
          own is not evidence of anything.
        </Callout>
      </section>

      {/* ---------------------------------------------------------------- 6 */}
      <section id="four-tests" className="guide-section">
        <h2>6. Why the winner isn't enough</h2>
        <p>
          Backtest all 44 trials and one comes out on top. Before believing it,
          ask the question this whole app exists to ask: <strong>would a search
          this size have produced an impressive winner even with no real edge in
          the data?</strong> Four independent tests, each attacking that question
          from a different angle.
        </p>

        <h3 style={{ marginTop: 4 }}>Deflated Sharpe</h3>
        <p>
          Imagine running the same 44-trial search on <em>pure noise</em> —
          coin flips, no real pattern. Purely by chance, the best of those 44
          random trials would still show a positive Sharpe; run 500 random
          trials instead and the best of those looks even better, from luck
          alone having more chances. Deflated Sharpe asks whether your actual
          winner beats what that many looks at random data would already give
          you.
        </p>
        <Figure caption="Illustrative only — the shape of a 'best of many random trials' distribution, not this run's actual one. A winner near the peak is indistinguishable from luck; one out past the tail is not.">
          <BellCurve markerAt={0.86} markerLabel="your winner" />
        </Figure>
        <Callout>In the app: the <strong>Deflated Sharpe</strong> tile, and the &ldquo;best the noise would give&rdquo; tile beside it.</Callout>

        <h3>Overfitting probability (PBO)</h3>
        <p>
          Split the history in half. Find the best trial using only the first
          half — the one you would have picked. Check how it does on the
          second half, which it never saw. Do this many different ways of
          splitting, and count how often the first-half winner turns out to be
          only mediocre on the second half. If that happens about as often as
          not, picking the &ldquo;winner&rdquo; was a coin flip.
        </p>
        <Figure caption="One of many such splits. A trial genuinely worth picking should keep winning in the half it was not chosen on.">
          <SplitHalf />
        </Figure>
        <Callout>In the app: the <strong>trial cloud</strong> chart and the <strong>Overfitting probability</strong> tile.</Callout>

        <h3>Reality check</h3>
        <p>
          A more rigorous version of the same idea: reshuffle the actual return
          history thousands of times — preserving how returns cluster day to
          day rather than scrambling them into pure noise — and each time ask
          what the best of 44 trials would have scored on the reshuffled data.
          If the real winner beats nearly all of those reshuffles, it is not
          explained by luck plus normal market noise.
        </p>
        <Callout>In the app: the <strong>Reality check p</strong> tile — below 0.05 is the usual bar.</Callout>

        <h3>Cost curve</h3>
        <p>
          The only one of the four with no statistics in it. Buying and
          selling coins costs money — the bid/ask spread, exchange fees. Raise
          that assumed cost until the strategy's edge is completely eaten by
          it; that crossing point is the <strong>break-even cost</strong>. An
          edge that breaks even at 8 bps is fragile; one that breaks even at
          100 bps has real room for error.
        </p>
        <Figure caption="Illustrative — Sharpe falling as assumed trading cost rises, crossing zero at the break-even point.">
          <DecliningLine zeroAt={0.62} label="break-even" />
        </Figure>
        <Callout>In the app: the <strong>Cost sensitivity</strong> chart and the <strong>Break-even cost</strong> tile.</Callout>

        <p style={{ marginTop: 10 }}>
          The verdict on the page you came from requires <strong>all four</strong> to
          pass. Three passing and one failing is still a fail — which is exactly
          what happened to the low-volatility trial at 50 coins: it cleared PBO,
          the reality check and the cost bar, and the deflated Sharpe alone said
          no.
        </p>
      </section>

      <p className="note">
        <a href="#new-run">← back to the app, to run your own search</a>
      </p>
    </div>
  );
}
