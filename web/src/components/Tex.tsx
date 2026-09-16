import katex from "katex";
import "katex/dist/katex.min.css";

/** Render a LaTeX string. The source is authored here, never user input, so
 *  the rendered HTML is ours; `throwOnError: false` means a typo shows as a
 *  visible red fragment rather than blanking the panel. */
export function Tex({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    output: "htmlAndMathml",
    strict: false,
    // A bad expression renders in this colour rather than throwing; the build's
    // formula check greps for exactly this, so the two must agree.
    errorColor: "#cc0000",
  });
  if (!display) return <span dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <div className={display ? "formula" : undefined}
         dangerouslySetInnerHTML={{ __html: html }} />
  );
}
