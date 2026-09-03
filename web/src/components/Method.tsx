/** The four statistics, written out.
 *
 *  Set in the page's own monospace rather than through a maths typesetter: the
 *  notation here is one-line algebra, mono renders it faithfully, and KaTeX
 *  would roughly double the bundle to typeset four formulas.
 */
const F = ({ children }: { children: string }) => (
  <div className="formula">{children}</div>
);

export function Method() {
  return (
    <details className="card">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Method — the four statistics, written out
      </summary>

      <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
        <div>
          <strong>Deflated Sharpe Ratio</strong>
          <F>{`DSR = Φ( (SR − SR₀)·√(T−1) / √(1 − γ₃·SR + ((γ₄−1)/4)·SR²) )`}</F>
          <div className="note" style={{ margin: 0 }}>
            The probability the true Sharpe exceeds SR₀ rather than zero. SR is
            the observed Sharpe per bar, T the number of bars, γ₃ the skew and γ₄
            the kurtosis of its returns — so a strategy whose profits arrive in
            rare fat-tailed bursts is discounted for it. Bailey &amp; López de
            Prado (2014).
          </div>
        </div>

        <div>
          <strong>The benchmark it deflates against</strong>
          <F>{`SR₀ = √V · [ (1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)) ]`}</F>
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
          <F>{`PBO = P(λ < 0),   λ = log( ω / (1−ω) ),   ω = rank_oos(k*) / (N+1)`}</F>
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
          <F>{`V = max_k √T·(f̄_k / σ_k)      p = (1/B)·Σ_b 1[ V*_b ≥ V ]`}</F>
          <div className="note" style={{ margin: 0 }}>
            The studentised best-of-N statistic, compared against B resampled
            histories in which every trial has been recentred to zero mean. Blocks
            are geometric with random length, so autocorrelation survives the
            resampling and the null is imposed on all N trials jointly rather
            than on the winner alone. White (2000), Hansen (2005), Politis &amp;
            Romano (1994).
          </div>
        </div>

        <div className="note" style={{ margin: 0 }}>
          Φ is the standard normal CDF and Φ⁻¹ its inverse — both from Python's
          <code> statistics.NormalDist</code>, so the worker image carries no
          scientific stack beyond numpy.
        </div>
      </div>
    </details>
  );
}
