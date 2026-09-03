import { Tex } from "./Tex";

/** The four statistics, typeset. */
const F = ({ children }: { children: string }) => <Tex tex={children} />;

export default function MethodBody() {
  return (
    <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
      <div className="note" style={{ margin: 0 }}>
        There are <strong>four independent tests</strong> — the deflated Sharpe,
        the overfitting probability, the reality check, and the cost curve. The
        verdict requires all four. The other numbers on this page are not tests:
        the net Sharpe is the observation being judged, and the noise benchmark
        and effective trial count are quantities the deflated Sharpe is built
        from, shown because they are where its verdict actually comes from.
      </div>
        <div>
          <strong>Deflated Sharpe Ratio</strong>
          <F>{String.raw`\widehat{\mathrm{DSR}} \;=\; \Phi\!\left[\frac{\left(\widehat{SR}-SR_0\right)\sqrt{T-1}}{\sqrt{\,1-\hat\gamma_3\,\widehat{SR}+\dfrac{\hat\gamma_4-1}{4}\,\widehat{SR}^{\,2}}}\right]`}</F>
          <div className="note" style={{ margin: 0 }}>
            The probability the true Sharpe exceeds SR₀ rather than zero. SR is
            the observed Sharpe per bar, T the number of bars, γ₃ the skew and γ₄
            the kurtosis of its returns — so a strategy whose profits arrive in
            rare fat-tailed bursts is discounted for it. Bailey &amp; López de
            Prado (2014).
          </div>
        </div>

        <div>
          <strong>The benchmark it deflates against</strong>{" "}
          <span className="muted">(an input to the test above, not a test)</span>
          <F>{String.raw`SR_0 \;=\; \sqrt{V}\left[(1-\gamma)\,\Phi^{-1}\!\left(1-\frac{1}{N}\right)\;+\;\gamma\,\Phi^{-1}\!\left(1-\frac{1}{N e}\right)\right]`}</F>
          <div className="note" style={{ margin: 0 }}>
            The expected best of N independent trials whose Sharpes have variance
            V, with γ the Euler–Mascheroni constant. Look N times at nothing and
            this is the Sharpe you take home. Because our trials are nested
            windows and exact negations rather than independent draws, this page
            reports SR₀ <em>measured</em> from a bootstrap of the real trial
            family, and inverts this expression against it to get the effective
            number of independent trials.
          </div>
        </div>

        <div>
          <strong>Probability of Backtest Overfitting</strong>
          <F>{String.raw`\mathrm{PBO}=P\!\left(\lambda_c<0\right),\qquad \lambda_c=\log\frac{\omega_c}{1-\omega_c},\qquad \omega_c=\frac{\mathrm{rank}_{\text{oos}}\!\left(k^{*}_{c}\right)}{N+1}`}</F>
          <div className="note" style={{ margin: 0 }}>
            Combinatorially symmetric cross-validation: split the sample into
            blocks, take every half-and-half combination, let k* be the trial
            that wins in sample, and record where it ranks out of sample. If it
            lands below the median as often as not, selection carries no
            information. Bailey, Borwein, López de Prado &amp; Zhu (2015).
          </div>
        </div>

        <div>
          <strong>Reality check on a stationary bootstrap</strong>
          <F>{String.raw`V=\max_{k}\;\sqrt{T}\,\frac{\bar f_k}{\hat\sigma_k},\qquad p=\frac{1}{B}\sum_{b=1}^{B}\mathbf{1}\!\left[V^{*}_{b}\ge V\right]`}</F>
          <div className="note" style={{ margin: 0 }}>
            The studentised best-of-N statistic, compared against B resampled
            histories in which every trial has been recentred to zero mean. Blocks
            are geometric with random length, so autocorrelation survives the
            resampling and the null is imposed on all N trials jointly rather
            than on the winner alone. White (2000), Hansen (2005), Politis &amp;
            Romano (1994).
          </div>
        </div>

        <div>
          <strong>Effective number of trials</strong>{" "}
          <span className="muted">(also an input, not a test)</span>
          <F>{String.raw`N_{\text{eff}}:\quad \mathbb{E}\!\left[\max_{N_{\text{eff}}}\right] \;=\; SR_0^{\text{boot}}`}</F>
          <div className="note" style={{ margin: 0 }}>
            The second expression above, inverted numerically against the
            bootstrap benchmark: how many genuinely independent trials would
            produce the expected-best Sharpe actually measured. This is what lets
            the deflation stop pretending 44 nested, sign-paired trials were 44
            independent looks.
          </div>
        </div>

        <div>
          <strong>Cost curve</strong>
          <F>{String.raw`c^{*} \;=\; 10^{4}\cdot\frac{\overline{r^{\text{gross}}}}{\overline{\tau}}
             \qquad SR(c)=\sqrt{A}\;\frac{\overline{r^{\text{gross}}-c\,\tau/10^{4}}}
             {\hat\sigma\!\left(r^{\text{gross}}-c\,\tau/10^{4}\right)}`}</F>
          <div className="note" style={{ margin: 0 }}>
            The break-even cost is the level at which the gross edge is exactly
            consumed by turnover τ, and the curve is the Sharpe recomputed at
            each assumed cost, annualised by A bars per year. The only one of the
            four tests with no statistical content — and often the one that kills
            a signal.
          </div>
        </div>

        <div className="note" style={{ margin: 0 }}>
          Φ is the standard normal CDF and Φ⁻¹ its inverse — both from Python's
          <code> statistics.NormalDist</code>, so the worker image carries no
          scientific stack beyond numpy.
        </div>
    </div>
  );
}
