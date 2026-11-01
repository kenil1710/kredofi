'use client';
// A button that sends a transaction (DESIGN 7.3): disabled while busy, with the phase as its
// label, so nothing is submitted twice. Status line below: tx link, or what failed and what to do.
import type { TxState } from '@/lib/tx';
import { HashLink } from './HashLink';

export function TxButton({
  tx,
  label,
  doneLabel,
  onClick,
  variant = 'violet',
  disabled,
  big,
}: {
  tx: TxState;
  label: string;
  doneLabel?: string;
  onClick: () => void;
  variant?: 'violet' | 'ink' | 'light' | 'line' | 'red';
  disabled?: boolean;
  big?: boolean;
}) {
  const text =
    tx.phase === 'signing' ? 'Waiting for signature…' :
    tx.phase === 'sent' ? 'Sending…' :
    tx.phase === 'confirmed' ? (doneLabel ?? label) :
    tx.phase === 'failed' && tx.error?.kind !== 'rejected' ? `Try again: ${label}` :
    label;
  const busy = tx.phase === 'signing' || tx.phase === 'sent';
  return (
    <button
      type="button"
      className={`btn btn-${variant}${big ? ' btn-big' : ''}`}
      disabled={disabled || busy || (tx.phase === 'confirmed' && !!doneLabel)}
      aria-busy={busy}
      onClick={onClick}
    >
      {text}
    </button>
  );
}

export function TxStatus({ tx }: { tx: TxState }) {
  if (tx.phase === 'idle' || tx.phase === 'signing') return null;
  return (
    <p className={tx.phase === 'failed' ? 'hint err' : 'txline'} role={tx.phase === 'failed' ? 'alert' : undefined} aria-live="polite">
      {tx.phase === 'sent' && <>Sent. Transaction {tx.hash && <HashLink hash={tx.hash} />}</>}
      {tx.phase === 'confirmed' && <>Confirmed. Transaction {tx.hash && <HashLink hash={tx.hash} />}</>}
      {tx.phase === 'failed' && <>{tx.error?.message}{tx.hash && <> Transaction <HashLink hash={tx.hash} /></>}</>}
    </p>
  );
}
