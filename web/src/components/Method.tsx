import { Suspense, lazy, useState } from "react";

// KaTeX and its stylesheet are ~75 kB gzipped, to typeset five formulas in a
// panel that starts closed. Loading it lazily means nobody pays for the maths
// typesetter unless they actually open the maths.
const MethodBody = lazy(() => import("./MethodBody"));

export function Method() {
  const [open, setOpen] = useState(false);
  return (
    <details className="card"
             onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Method — the four statistics, written out
      </summary>
      {open && (
        <Suspense fallback={<div className="sub" style={{ marginTop: 12 }}>
          typesetting…
        </div>}>
          <MethodBody />
        </Suspense>
      )}
    </details>
  );
}
