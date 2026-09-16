import { useState } from "react";
import { Tex } from "./Tex";

/** The calculations behind the displayed statistics. */
const F = ({ children }: { children: string }) => <Tex tex={children} />;
const I = ({ children }: { children: string }) => <Tex tex={children} display={false} />;
const PBO_BLOCKS = [1, 2, 3, 4, 5, 6];
const PBO_TRAINING_CHOICES = PBO_BLOCKS.flatMap((first, i) =>
  PBO_BLOCKS.slice(i + 1).flatMap(second =>
    PBO_BLOCKS.filter(third => third > second).map(third => [first, second, third].join(','))
  )
);

export default function AuditMethods() {
  const [trainingBlocks, setTrainingBlocks] = useState('1,3,6');
  const training = trainingBlocks.split(',').map(Number);
  return (
    <div className="method-body audit-methods">

      <section id="deflated-sharpe">
        <h3>Deflated Sharpe Ratio (DSR)</h3>
        <p>
          Does the winner clear the noise benchmark by enough to account for uncertainty?
          DSR compares the gap with the standard error of its Sharpe:
        </p>
        <F>{String.raw`\mathrm{DSR}=\Phi\!\left(\frac{S_{\mathrm{winner}}-S_0}{\operatorname{SE}(S_{\mathrm{winner}})}\right)`}</F>
        <p>A high value supports a Sharpe above the benchmark; it is not the probability of future profit.</p>
        <div className="method-support">
          <F>{String.raw`\operatorname{SE}(S_{\mathrm{winner}})=\sqrt{\frac{A}{T-1}}\,\sqrt{1-\hat\gamma_3\frac{S_{\mathrm{winner}}}{\sqrt A}+\frac{\hat\gamma_4-1}{4}\frac{S_{\mathrm{winner}}^2}{A}}`}</F>
          <p>
            This standard error adjusts for return skew and heavy tails, but not
            separately for serial correlation. Dividing by <I>{String.raw`\sqrt A`}</I> inside
            the correction converts the annualised Sharpe back to its per-bar value.
            {" "}<a href="https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf">Bailey &amp; López de Prado (2014)</a>.
          </p>
        </div>
      </section>

      <section id="backtest-overfitting">
        <h3>Probability of Backtest Overfitting (PBO)</h3>
        <p>
          Does the selection hold up on data not used to choose it? PBO measures how
          often the rule with the highest training Sharpe ranks below the middle
          on the remaining data. It uses the observed returns, not the bootstrap simulations:
        </p>
        <ol className="method-algorithm">
          <li>Divide the history into time blocks with the same date boundaries for every rule. Use an even number of blocks so half can be used for training and half for evaluation.
            <figure className="pbo-blocks">
              <figcaption>Full return history of three rules, divided into six consecutive time blocks.</figcaption>
              <label className="pbo-block-picker">
                Choose training blocks:
                <select value={trainingBlocks} onChange={event => setTrainingBlocks(event.target.value)}>
                  {PBO_TRAINING_CHOICES.map(choice => (
                    <option key={choice} value={choice}>{choice.split(',').join(', ')}</option>
                  ))}
                </select>
              </label>
              <div className="pbo-history-range"><span>History starts</span><span>Time →</span><span>History ends</span></div>
              <div role="img" aria-label={`Full history of three rules divided into six consecutive blocks. Blocks ${training.join(', ')} are selected for training; the remaining three blocks are evaluation, for every rule.`}>
                <div className="pbo-block-grid" aria-hidden="true">
                  <span />
                  {PBO_BLOCKS.map(block => <span key={`block-${block}`}>Block {block}</span>)}
                  {[1, 2, 3].flatMap(rule => [
                    <span key={`rule-${rule}`}>Rule {rule}</span>,
                    ...PBO_BLOCKS.map(block => (
                      <span key={`${rule}-${block}`} className={`pbo-block ${training.includes(block) ? 'pbo-block-is' : 'pbo-block-oos'}`}>
                        {training.includes(block) ? 'IS' : 'OOS'}
                      </span>
                    )),
                  ])}
                </div>
              </div>
              <div>IS = selected for training; OOS = remaining blocks, used for evaluation. Each rectangle contains one rule’s returns for that period.</div>
              <div>Choosing three of six blocks gives <I>{String.raw`C=\binom{6}{3}=20`}</I> splits, numbered <I>{String.raw`\ell=1,\ldots,20`}</I>. Each number identifies one choice of training blocks and its remaining evaluation blocks.</div>
            </figure>
          </li>
          <li>Choose half the blocks for training and use the other half for evaluation:
            <ol className="method-algorithm-loop" type="a">
              <li>Calculate each rule’s Sharpe using the training blocks (IS). Select the highest-scoring rule, <I>{String.raw`i_\ell`}</I>.</li>
              <li>Calculate each rule’s Sharpe using the evaluation blocks (OOS). Rank all rules from worst to best.</li>
              <li>Count 1 if the rule selected in training ranks below the middle in evaluation, <I>{String.raw`\operatorname{rank}_{\mathrm{OOS},\ell}(i_\ell)<(N+1)/2`}</I>; otherwise 0.</li>
            </ol>
            Repeat with a different choice of training blocks until every choice has been tried.
          </li>
          <li>Divide the count by the number of splits:
            <F>{String.raw`\mathrm{PBO}=\frac{\text{counted splits}}{C}=\frac1C\sum_{\ell=1}^{C}\mathbf1[\lambda_\ell<0]`}</F>
          </li>
        </ol>
        <div className="method-support">
          <F>{String.raw`\omega_\ell=\frac{\operatorname{rank}_{\mathrm{OOS},\ell}(i_\ell)}{N+1},\qquad \lambda_\ell=\log\frac{\omega_\ell}{1-\omega_\ell},\qquad \lambda_\ell<0\iff\omega_\ell<\frac12`}</F>
          <p>
            The logit expresses a below-middle rank as a negative number, also shown in the
            trial cloud. Lower PBO means the selections hold up more often; stable rankings
            alone do not establish profitability. <a href="https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf">Bailey, Borwein, López de Prado &amp; Zhu (2015)</a>.
          </p>
        </div>
      </section>

      <section id="reality-check">
        <h3>Reality check</h3>
        <p>
          How often could a no-edge search produce a winner at least this good?
          Count the simulated maxima that reach the highest observed full-history score:
        </p>
        <F>{String.raw`p_{\mathrm{reality\ check}}=\frac1B\sum_{b=1}^{B}\mathbf1\!\left[\max_{1\le i\le N}S_i^{*(b)}\ge\max_{1\le i\le N}S_i\right]`}</F>
        <p>
          A small value is evidence against the no-edge model. This uses the same
          simulated scores that produced <I>S_0</I>. The observed maximum may come
          from a different rule than the one selected on training performance.
          {" "}<a href="https://doi.org/10.1111/1468-0262.00152">White (2000)</a>;
          {" "}<a href="https://doi.org/10.1080/01621459.1994.10476870">Politis &amp; Romano (1994)</a>.
        </p>
      </section>

      <details className="audit-diagnostic">
        <summary>Effective number of trials — a diagnostic</summary>
        <p>
          The app also reports how many independent trials would give the same
          noise benchmark. Write <I>{String.raw`S_0^{\mathrm{ind}}(N,V)`}</I> for
          the approximation in <a href="#guide/trial-grid">§5</a> with score variance <I>V</I>.
          Solve it backwards for the trial count:
        </p>
        <F>{String.raw`S_0^{\mathrm{ind}}(N_{\mathrm{eff}},V_{\mathrm{boot}})=S_0`}</F>
        <p>
          Here <I>{String.raw`V_{\mathrm{boot}}`}</I> is the variance across individual
          simulated scores, before taking maxima. The app reports 1 if the benchmark
          falls below the two-trial approximation. DSR uses <I>S_0</I> directly.
          The app’s independent comparison instead uses the observed variance,
          {" "}<I>{String.raw`S_0^{\mathrm{ind}}(N,V_{\mathrm{trials}})`}</I>.
        </p>
      </details>

      <section id="cost-sensitivity">
        <h3>Cost curve</h3>
        <p>
          How much trading cost can the winner absorb? Subtract each assumed cost
          {" "}<I>c</I>, in basis points, from its gross returns in proportion to turnover
          {" "}<I>{String.raw`\tau_t`}</I>, then recompute its Sharpe. At the break-even
          cost <I>{String.raw`c^*`}</I>, average net return reaches zero:
        </p>
        <F>{String.raw`S(c)=\sqrt A\,\frac{\operatorname{mean}_t\!\left(r_t^{\mathrm{gross}}-c\tau_t/10^4\right)}{\operatorname{sd}_t\!\left(r_t^{\mathrm{gross}}-c\tau_t/10^4\right)},\qquad c^*=10^4\frac{\overline{r^{\mathrm{gross}}}}{\bar\tau}`}</F>
        <p>
          The standard deviation is recomputed at each cost. Break-even is undefined
          if average turnover is zero. Compare the break-even cost with plausible fees,
          spread and slippage; a narrow margin leaves little room for error.
        </p>
      </section>
    </div>
  );
}
