'use client';
// A button that sends a transaction (DESIGN 7.3): disabled while busy, with the phase as its
// label, so nothing is submitted twice. Status line below: tx link, or what failed and what to do.
import { useEffect, useState } from 'react';
import type { TxState } from '@/lib/tx';
import { useAccount } from '@/lib/near/account';
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
  variant?: 'violet' | 'ink' | 'light' | 'line' | 'red' | 'ghost';
  disabled?: boolean;
  big?: boolean;
}) {
  // Demo accounts sign in the browser and the relayer sends: nothing for the user to sign, so say what
  // is happening ("Sending…", then "Confirming on NEAR…"). Wallets keep "Waiting for signature…".
  const relayed = useAccount().kind !== 'wallet';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (tx.phase !== 'signing') { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(t);
  }, [tx.phase]);
  const text =
    tx.phase === 'signing' ? (relayed ? (slow ? 'Confirming on NEAR…' : 'Sending…') : 'Waiting for signature…') :
    tx.phase === 'sent' ? (relayed ? 'Confirming on NEAR…' : 'Sending…') :
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
