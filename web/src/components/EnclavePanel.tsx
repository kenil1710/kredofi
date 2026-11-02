'use client';
// The scoring box on the passbook (passbook reference + DESIGN 7.3, "waiting honestly").
// Four real phases, each confirmed by something real; elapsed seconds while the enclave reads;
// after 30 s a note that it is safe to leave. Never a bare spinner or a fake percentage.
// The blurred rows are abstract bars (aria-hidden, no text or numbers): no bank data, real or
// realistic, ever reaches the browser.
import { HashLink } from './HashLink';

export type EnclaveStep = 'signing' | 'sent' | 'reading' | 'sealed' | 'failed';

export const PHASES = ['Waiting for your signature', 'Request sent', 'Enclave reading your transactions', 'Sealed'] as const;
/** Testnet Dev mode: no user signature, and the pinned scorer runs outside the enclave (SPEC 2). */
export const DEV_PHASES = ['Request sent', 'Scorer reading your transactions', 'Result submitted on-chain', 'Sealed'] as const;
const INDEX: Record<EnclaveStep, number> = { signing: 0, sent: 1, reading: 2, sealed: 4, failed: -1 };

/** Decoration only: abstract bar widths (%, label and amount), no text or numbers at all, so
 * nothing that looks like bank data reaches the page, screen readers or copy-paste. A third value
 * of 1 tints the bar like money in. */
export const DECOR_ROWS: Record<'steady' | 'irregular', [number, number, number?][]> = {
  steady: [[46, 34, 1], [22, 30], [34, 24], [40, 20], [30, 28], [24, 16], [36, 26], [28, 18]],
  irregular: [[38, 34, 1], [22, 30], [44, 12], [34, 26], [52, 12], [38, 30, 1], [24, 16], [44, 12]],
};

export function EnclavePanel({
  step,
  elapsed = 0,
  failedAt = 2,
  failure,
  txHash,
  rows = DECOR_ROWS.steady,
  labels = PHASES,
  timerAt = 2,
  note,
}: {
  step: EnclaveStep;
  /** Seconds since the request was included (phase 3). */
  elapsed?: number;
  /** Which phase failed, when step = 'failed'. */
  failedAt?: number;
  failure?: string;
  txHash?: string;
  rows?: [number, number, number?][];
  /** Phase labels (4). */
  labels?: readonly string[];
  /** Which phase shows the elapsed seconds. */
  timerAt?: number;
  /** A plain note under the phases (e.g. the testnet Dev-mode disclosure). */
  note?: string;
}) {
  const now = step === 'failed' ? failedAt : INDEX[step];
  const live = step === 'failed' ? `Scoring failed. ${failure ?? ''}` : step === 'sealed' ? labels[3] : labels[now];
  const list = [...rows, ...rows];
  return (
    <div>
      <div className={`enc${step === 'sealed' || step === 'failed' ? ' sealed' : ''}`}>
        <div className="rows" aria-hidden="true">
          <ul>{list.map(([a, b, inc], i) => <li key={i} className={inc ? 'in' : undefined}><i style={{ width: `${a}%` }} /><i style={{ width: `${b}%` }} /></li>)}</ul>
        </div>
        <div className="cube" aria-hidden="true">
          <div className="cube3"><i /><i /><i /><i /><i /><i /></div>
          <div className="core" />
        </div>
        <ol className="phases">
          {labels.map((p, i) => {
            const cls = step === 'failed' && i === failedAt ? 'failed' : i < now ? 'done' : i === now ? 'now' : '';
            return (
              <li key={p} className={cls}>
                <b aria-hidden="true" />
                <span>
                  {p}
                  {i === timerAt && i === now && step !== 'sealed' && <small className="num">{elapsed} s</small>}
                </span>
              </li>
            );
          })}
        </ol>
        {note && <p className="note-long" style={{ color: 'var(--muted)' }}>{note}</p>}
        {step !== 'sealed' && step !== 'failed' && elapsed >= 30 && (
          <p className="note-long">Taking longer than usual. You can leave this page; the result will be here when you come back.</p>
        )}
        {step === 'failed' && failure && <p className="note-long" style={{ color: 'var(--red-night)' }}>{failure}</p>}
      </div>
      <p className="sr-only" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{live}</p>
      {txHash && <p className="txline" style={{ marginTop: 10 }}>Scoring request <HashLink hash={txHash} /></p>}
    </div>
  );
}
