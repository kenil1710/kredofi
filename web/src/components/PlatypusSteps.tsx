'use client';
// The three test-bank steps (lib/plaidHint.ts): a large box before "Connect your bank", and, while Plaid Link is
// open, ONLY a floating copy above Link with working Copy buttons (the page's own Copy buttons are behind Link then).
// Plaid adds its window to the end of <body> at the top stacking level, so the floating box lives in a container
// appended to the end of <body> when it shows, which puts it above Link and makes it clickable.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyButton } from './CopyButton';
import { OTHER_BANK_NOTE, PLATYPUS_STEPS, STEP3_COPY_NOTE } from '@/lib/plaidHint';

function Steps({ other, floating }: { other?: string | null; floating?: boolean }) {
  return (
    <div className="pbsteps-box">
      <p className="pbsteps-title">Test bank in 3 steps</p>
      <ol className="pbsteps">
        <li><b>1</b><span>{PLATYPUS_STEPS[0]}</span></li>
        <li><b>2</b><span>{PLATYPUS_STEPS[1]}</span></li>
        <li><b>3</b><span>Log in: <code>user_good</code>{floating && <CopyButton text="user_good" label="username" small />} / <code>pass_good</code>{floating && <CopyButton text="pass_good" label="password" small />}{floating && <em className="pbsteps-where"> {STEP3_COPY_NOTE}</em>}</span></li>
      </ol>
      {other && <p className="pbsteps-note">{other} {OTHER_BANK_NOTE}</p>}
    </div>
  );
}

/** The in-page box; hidden while Plaid Link is open (the floating box takes over). */
export function PlatypusSteps({ hidden }: { hidden?: boolean }) {
  return hidden ? null : <div className="pbsteps-inline"><Steps /></div>;
}

export function PlatypusStepsOverlay({ other }: { other: string | null }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'pbsteps-overlay';
    el.setAttribute('role', 'status');
    document.body.appendChild(el); // after Plaid's iframe: drawn above it, and clickable
    setHost(el);
    return () => { el.remove(); };
  }, []);
  return host ? createPortal(<Steps other={other} floating />, host) : null;
}
