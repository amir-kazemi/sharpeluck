import { useEffect, useRef, useState } from "react";
import { Tex } from "./Tex";

const I = ({ children }: { children: string }) => <Tex tex={children} display={false} />;

export function NotationTable() {
  return (
      <div className="method-notation-wrap">
        <table className="method-notation">
          <caption>Symbols used in the guide</caption>
          <thead><tr><th scope="col">Symbol</th><th scope="col">Meaning</th></tr></thead>
          <tbody>
            <tr><td><I>{String.raw`i,\ N;\quad t,\ T`}</I></td><td>Rule index and number of rules; time index and number of observed bars.</td></tr>
            <tr><td><I>{String.raw`\pi_t,\ \bar\pi`}</I></td><td>The toy portfolio’s return on day <I>t</I> and its average return in <a href="#guide/scoring">§4</a>.</td></tr>
            <tr><td><I>S</I></td><td>Sharpe ratio: average return divided by its sample standard deviation. Section 4 shows the per-period ratio; the app and §6 annualise it.</td></tr>
            <tr><td><I>{String.raw`Z_i,\ M,\ \sigma`}</I></td><td>In <a href="#guide/trial-grid">§5</a>, a rule’s score in standard-deviation units, the maximum of those scores, and the noise standard deviation used as the unit.</td></tr>
            <tr><td><I>q</I></td><td>The threshold that one independent normal score exceeds with probability <I>1/N</I>, used in §5.</td></tr>
            <tr><td><I>{String.raw`P,\ \mathbb E`}</I></td><td>Probability and expected value (the average over repeated outcomes).</td></tr>
            <tr><td><I>{String.raw`\Delta x,\ k\in\mathbb Z`}</I></td><td>Width of a score band and its integer index in §5’s averaging formula; the bands cover all scores.</td></tr>
            <tr><td><I>{String.raw`e,\ \gamma`}</I></td><td><I>{String.raw`e\approx2.718`}</I> is the base of natural logarithms; <I>{String.raw`\gamma\approx0.5772`}</I> is the Euler–Mascheroni constant used in §5’s approximation.</td></tr>
            <tr><td><I>A</I></td><td>Bars per year: 8,760 for the app’s hourly returns.</td></tr>
            <tr><td><I>{String.raw`r_{t,i},\ \bar r_i,\ s_i`}</I></td><td>Rule <I>i</I>’s net return at time <I>t</I>, its historical mean, and its sample standard deviation.</td></tr>
            <tr><td><I>{String.raw`\tilde r_{t,i},\ r_{t,i}^{*(b)}`}</I></td><td>The return after subtracting the rule’s historical mean, and a return sampled from that centered history in simulation <I>b</I>.</td></tr>
            <tr><td><I>{String.raw`b,\ B`}</I></td><td>Simulation index and number of simulations.</td></tr>
            <tr><td><I>{String.raw`j_b(t)`}</I></td><td>The position in the original history from which returns are copied into position <I>t</I> of simulation <I>b</I>, using the same position for every rule. For example, <I>{String.raw`j_2(5)=8`}</I> means the fifth observation in simulation 2 uses every rule’s return from the eighth original observation. See <a href="#guide/four-tests">guide §6</a>.</td></tr>
            <tr><td><I>{String.raw`S_i,\ S_i^{*(b)}`}</I></td><td>Rule <I>i</I>’s full-history observed Sharpe and its score in zero-mean simulation <I>b</I>. Superscript <I>{String.raw`*(b)`}</I> marks the simulation.</td></tr>
            <tr><td><I>{String.raw`S_{\mathrm{winner}}`}</I></td><td>Full-history Sharpe of the rule with the highest average Sharpe across the training periods.</td></tr>
            <tr><td><I>{String.raw`S_0`}</I></td><td>Average of the best scores across zero-mean simulations: the noise benchmark calculated in <a href="#guide/four-tests">guide §6</a>.</td></tr>
            <tr><td><I>{String.raw`\operatorname{SE},\ \hat\gamma_3,\ \hat\gamma_4`}</I></td><td>Standard error of the observed Sharpe; estimated skew and raw kurtosis of that rule’s returns. Normal returns have skew 0 and kurtosis 3.</td></tr>
            <tr><td><I>{String.raw`\Phi,\ \Phi^{-1},\ \phi`}</I></td><td>The standard normal cumulative probability, its inverse (the score at a given probability), and the normal bell-curve density.</td></tr>
            <tr><td><I>{String.raw`\mathbf1[\cdot]`}</I></td><td>An indicator equal to 1 when its condition holds and 0 otherwise.</td></tr>
            <tr><td><I>{String.raw`S_0^{\mathrm{ind}}(N,V)`}</I></td><td>The independent-normal benchmark from <a href="#guide/trial-grid">guide §5</a>, for <I>N</I> trials with score variance <I>V</I>.</td></tr>
            <tr><td><I>{String.raw`V_{\mathrm{trials}},\ V_{\mathrm{boot}}`}</I></td><td>Variance across observed rule Sharpes; variance across all individual simulated rule scores, before taking maxima.</td></tr>
            <tr><td><I>{String.raw`N_{\mathrm{eff}}`}</I></td><td>Number of independent trials that would produce the same noise benchmark at the simulated score variance.</td></tr>
            <tr><td>IS, OOS</td><td>In-sample: the training half used to select a rule. Out-of-sample: the held-out half used to evaluate that selection.</td></tr>
            <tr><td><I>{String.raw`\ell,\ C;\quad i_\ell`}</I></td><td>Half-history split index and number of splits; the rule selected on the training half of split <I>{String.raw`\ell`}</I>.</td></tr>
            <tr><td><I>{String.raw`\operatorname{rank}_{\mathrm{OOS},\ell}(i_\ell)`}</I></td><td>The selected rule’s position among all <I>N</I> rules, ordered by Sharpe on the held-out half of split <I>{String.raw`\ell`}</I>. Rank 1 is worst and <I>N</I> is best; ties receive the highest tied rank.</td></tr>
            <tr><td><I>{String.raw`\omega_\ell,\ \lambda_\ell`}</I></td><td>The selected rule’s normalised held-out rank and its logit, defined in the <a href="#guide/backtest-overfitting">PBO calculation</a>.</td></tr>
            <tr><td><I>{String.raw`c,\ c^*`}</I></td><td>Assumed and break-even trading costs in basis points. One basis point is 1/10,000.</td></tr>
            <tr><td><I>{String.raw`r_t^{\mathrm{gross}},\ \tau_t`}</I></td><td>The selected rule’s return before trading costs and its turnover at time <I>t</I>. Turnover is the sum of absolute changes in its portfolio weights.</td></tr>
          </tbody>
        </table>
      </div>
  );
}

export function GuideNotation() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setPinned(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (container.current?.contains(document.activeElement)) button.current?.focus();
        close();
      }
    };
    const onOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, [open]);

  return (
    <div className="guide-notation"
      ref={container}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned && !container.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setPinned(false);
        }
      }}
    >
      <button ref={button} type="button" id="guide-symbols-button"
        aria-expanded={open} aria-controls="guide-symbols-panel"
        title="Hover to view symbols; click to keep the table open"
        onClick={() => { setPinned(!pinned); setOpen(!pinned); }}
      >Symbols</button>
      <div id="guide-symbols-panel" className="guide-notation-panel"
        role="region" aria-labelledby="guide-symbols-button" hidden={!open}
      >
        {open && <NotationTable />}
      </div>
    </div>
  );
}
