'use client';
// Account menu, top right (DESIGN 7.8). Demo accounts: "Start with a new account" forgets this
// browser's demo key after a clear warning (the key exists nowhere else, so the old account, its
// score and any loan can't be recovered). Wallets: sign out.
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '@/lib/near/account';
import { CopyButton } from './CopyButton';

export function AccountMenu() {
  const { accountId, kind, connectWallet, signOut, resetDemo, slot } = useAccount();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setConfirming(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setConfirming(false); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!accountId) return <button type="button" className="chip" onClick={connectWallet}>Connect wallet</button>;

  return (
    <div className="acctmenu" ref={box}>
      <button type="button" className="chip" aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen((o) => !o); setConfirming(false); }}>
        {kind === 'demo' ? accountId.split('.')[0] : accountId}
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Account">
          <p className="who-line">{kind === 'demo' ? (slot ? 'Scenario demo account' : 'Demo account') : 'Wallet'}</p>
          <p className="id">{accountId} <CopyButton text={accountId} label="account ID" /></p>
          {kind === 'wallet' ? (
            <button type="button" className="btn btn-line" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
          ) : !confirming ? (
            <>
              <p className="hint">Its key lives only in this browser.</p>
              <button type="button" className="btn btn-line" onClick={() => setConfirming(true)}>Sign out / start with a new account</button>
            </>
          ) : (
            <div role="alertdialog" aria-label="Start with a new account?">
              <p className="warn">This forgets <b>{accountId}</b> in this browser. Its key exists nowhere else, so the account, its score, its test USDC and any open loan <b>can&apos;t be recovered</b>. The public ledger keeps its history.</p>
              <div className="row">
                <button type="button" className="btn btn-red" onClick={() => { resetDemo(); setOpen(false); setConfirming(false); }}>Forget it and start over</button>
                <button type="button" className="btn btn-line" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
