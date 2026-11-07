'use client';
// The three test-bank steps (lib/plaidHint.ts): a large box before "Connect your bank", and the same box above
// Plaid Link while it is open. Plaid adds its window to the end of <body> at the top stacking level, so the overlay
// lives in a container that is moved to the very end of <body> each time it shows, which puts it above Link.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { OTHER_BANK_NOTE, PLATYPUS_STEPS } from '@/lib/plaidHint';

function Steps({ other }: { other?: string | null }) {
  return (
    <div className="pbsteps-box">
      <p className="pbsteps-title">Test bank in 3 steps</p>
      <ol className="pbsteps">
        {PLATYPUS_STEPS.map((s, i) => <li key={s}><b>{i + 1}</b><span>{i === 2 ? <>Log in: <code>user_good</code> / <code>pass_good</code></> : s}</span></li>)}
      </ol>
      {other && <p className="pbsteps-note">{other} {OTHER_BANK_NOTE}</p>}
    </div>
  );
}

export function PlatypusSteps() {
  return <div className="pbsteps-inline"><Steps /></div>;
}

export function PlatypusStepsOverlay({ other }: { other: string | null }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'pbsteps-overlay';
    el.setAttribute('role', 'status');
    document.body.appendChild(el); // after Plaid's iframe: drawn above it
    setHost(el);
    return () => { el.remove(); };
  }, []);
  return host ? createPortal(<Steps other={other} />, host) : null;
}
