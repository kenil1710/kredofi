'use client';
// The tally (DESIGN 2.4): five rule rows with points, total with a double underline.
// Same component on the landing, "score yourself" and the borrower's result.
import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

export type TallyRow = { label: string; detail?: string; points: number };

export const RULE_NAMES = ['Income level', 'Steady income', 'On-time payments', 'Money left over', 'Savings buffer'] as const;

export function Tally({
  rows,
  totalLabel = 'Score',
  play = 0,
  onDone,
}: {
  rows: TallyRow[];
  totalLabel?: string;
  /** Change to count up (380 ms per row); 0 shows final values. */
  play?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState<number[]>(() => rows.map((r) => (play ? 0 : r.points)));
  const key = rows.map((r) => r.points).join(',');

  useEffect(() => {
    if (!play || prefersReducedMotion()) { setShown(rows.map((r) => r.points)); if (play) onDone?.(); return; }
    let cancelled = false, id = 0;
    setShown(rows.map(() => 0));
    const countRow = (i: number) => {
      if (cancelled) return;
      if (i >= rows.length) { onDone?.(); return; }
      // Anchor to the first frame's own timestamp: rAF times can be earlier than
      // performance.now() at scheduling, which made progress negative and stalled the count.
      const to = rows[i].points;
      let t0 = -1;
      const f = (t: number) => {
        if (cancelled) return;
        if (t0 < 0) t0 = t;
        const k = Math.min(1, Math.max(0, (t - t0) / 380));
        const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
        setShown((s) => s.map((x, j) => (j === i ? v : x)));
        if (k < 1) id = requestAnimationFrame(f); else countRow(i + 1);
      };
      id = requestAnimationFrame(f);
    };
    countRow(0);
    return () => { cancelled = true; cancelAnimationFrame(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, key]);

  const total = shown.reduce((a, b) => a + b, 0);
  return (
    <dl className="tally">
      {rows.map((r, i) => (
        <div className="r" key={r.label}>
          <dt>{r.label}{r.detail && <span>{r.detail}</span>}</dt>
          <dd>{shown[i] ?? r.points}</dd>
        </div>
      ))}
      <div className="tot">
        <span>{totalLabel}</span>
        <b aria-live="off">{total}</b>
      </div>
    </dl>
  );
}
