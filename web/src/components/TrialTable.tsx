import { useMemo, useState } from "react";
import type { Trial } from "../api";

type Col = { key: keyof Trial; label: string; fmt?: (v: number) => string };

const COLS: Col[] = [
  { key: "expr", label: "Expression" },
  { key: "rebalance_every_h", label: "Reb (h)", fmt: (v) => String(v) },
  { key: "is_sharpe", label: "IS SR" },
  { key: "oos_sharpe", label: "OOS SR" },
  { key: "sharpe", label: "Net SR" },
  { key: "gross_sharpe", label: "Gross SR" },
  { key: "turnover_per_rebal", label: "Turnover", fmt: (v) => v.toFixed(3) },
  { key: "max_drawdown", label: "Max DD", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "break_even_bps", label: "Break-even" },
];

const show = (v: unknown, fmt?: (n: number) => string) =>
  v === null || v === undefined ? "—" : typeof v === "number" ? (fmt ?? ((n: number) => n.toFixed(2)))(v) : String(v);

/** The trial table is also the table view for the run: every trial's numbers,
 *  sorted on whichever column the reader chooses -- in-sample by default,
 *  because that is the column selection actually happened on. */
export function TrialTable({ trials, winner }: { trials: Trial[]; winner: number }) {
  const [sort, setSort] = useState<keyof Trial>("is_sharpe");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const s = [...trials].sort((a, b) => {
      const av = a[sort], bv = b[sort];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv));
      }
      return (av ?? -Infinity) < (bv ?? -Infinity) ? -1 : 1;
    });
    return desc ? s.reverse() : s;
  }, [trials, sort, desc]);

  return (
    <table>
      <thead>
        <tr>
          {COLS.map((c) => (
            <th key={String(c.key)} onClick={() => {
              if (c.key === sort) setDesc(!desc); else { setSort(c.key); setDesc(true); }
            }}>
              {c.label}{c.key === sort ? (desc ? " ↓" : " ↑") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.trial} style={t.trial === winner
            ? { background: "var(--wash)", fontWeight: 600 } : undefined}>
            {COLS.map((c) => (
              <td key={String(c.key)}>
                {c.key === "expr" ? <code>{t.expr}</code> : show(t[c.key], c.fmt)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
