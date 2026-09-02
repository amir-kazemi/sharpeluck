import { useState } from "react";

/** Every chart ships with a table twin, so no value is reachable only by hover. */
export function Figure({
  title, sub, chart, table,
}: { title: string; sub?: string; chart: React.ReactNode; table: React.ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(["chart", "table"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
                    style={{ padding: "3px 9px", fontSize: 12 }}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {view === "chart" ? chart : <div className="scroll">{table}</div>}
      </div>
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="row" style={{ gap: 14, marginTop: 6 }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: i.color }} />
          <span className="sub">{i.label}</span>
        </span>
      ))}
    </div>
  );
}
