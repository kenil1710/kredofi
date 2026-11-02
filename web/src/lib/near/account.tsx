'use client';
// One account for the app: a connected wallet, or a no-wallet demo account (SPEC 8a) whose key lives
// only in this browser. Demo actions are meta transactions: the browser signs a DelegateAction and
// /api/relay sends it, paying the gas. Both paths expose the same signAndSend.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { functionCall, useWallet } from './wallet';
import { RPC } from '../config';

type Action = ReturnType<typeof functionCall>;
type Demo = { accountId: string; secretKey: string };
type AccountCtx = {
  accountId: string | null;
  kind: 'wallet' | 'demo' | null;
  signAndSend: (receiverId: string, actions: Action[]) => Promise<unknown>;
  createDemo: () => Promise<string>;
  /** Forget this slot's demo account (its key stays nowhere), so the next start creates a fresh one. */
  resetDemo: () => void;
  /** 'scenarios' = the separate demo account used by /scenarios (prepared borrowers). */
  slot: string | null;
  connectWallet: () => Promise<void>;
  signOut: () => Promise<void>;
};

const demoKey = (slot: string | null) => (slot ? `kredofi:demo-account:${slot}` : 'kredofi:demo-account');
const loadDemo = (slot: string | null): Demo | null => { try { return JSON.parse(localStorage.getItem(demoKey(slot)) ?? 'null'); } catch { return null; } };
const Ctx = createContext<AccountCtx | null>(null);

// `slot` keeps a second, independent demo account (the /scenarios page), so a prepared borrower
// (e.g. Max, who defaults and is blocked for good) never touches the visitor's own passbook.
export function AccountProvider({ children, slot = null }: { children: React.ReactNode; slot?: string | null }) {
  const wallet = useWallet();
  const [demo, setDemo] = useState<Demo | null>(null);
  useEffect(() => setDemo(loadDemo(slot)), [slot]);

  const createDemo = useCallback(async () => {
    const existing = loadDemo(slot);
    if (existing) { setDemo(existing); return existing.accountId; }
    const { KeyPair } = await import('near-api-js');
    const kp = KeyPair.fromRandom('ed25519');
    const r = await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'Could not create a demo account.');
    const d = { accountId: j.accountId as string, secretKey: kp.toString() };
    try { localStorage.setItem(demoKey(slot), JSON.stringify(d)); } catch { /* private mode: the account lasts this tab */ }
    setDemo(d);
    return d.accountId;
  }, [slot]);
  const resetDemo = useCallback(() => {
    try { localStorage.removeItem(demoKey(slot)); } catch { /* private mode */ }
    setDemo(null);
  }, [slot]);

  const relay = useCallback(async (d: Demo, receiverId: string, acts: Action[]) => {
    const { Account, JsonRpcProvider, actions, encodeSignedDelegate } = await import('near-api-js');
    const account = new Account(d.accountId, new JsonRpcProvider({ url: RPC }), d.secretKey as `ed25519:${string}`);
    const { signedDelegate } = await account.createSignedMetaTransaction({
      receiverId,
      actions: acts.map((a) => actions.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))),
    });
    const bytes = encodeSignedDelegate(signedDelegate);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    const r = await fetch('/api/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedDelegate: btoa(bin) }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'The relayer refused this action.');
    return j;
  }, []);

  const value = useMemo<AccountCtx>(() => {
    // The scenarios slot always uses its own demo account, even when a wallet is connected.
    const walletId = slot ? null : wallet.accountId;
    const kind = walletId ? 'wallet' : demo ? 'demo' : null;
    return {
      accountId: walletId ?? demo?.accountId ?? null,
      kind,
      signAndSend: async (receiverId, acts) => {
        if (kind !== 'wallet') return demo ? relay(demo, receiverId, acts) : Promise.reject(new Error('No account yet.'));
        const out = await wallet.signAndSend(receiverId, acts);
        // The relayer records its own transactions; a wallet's go to the public ledger here.
        const hash = (out as { transaction?: { hash?: string } })?.transaction?.hash;
        if (hash) fetch('/api/ledger/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash, signer: wallet.accountId }) }).catch(() => {});
        return out;
      },
      createDemo,
      resetDemo,
      slot,
      connectWallet: wallet.connect,
      signOut: async () => { if (kind === 'wallet') await wallet.disconnect(); },
    };
  }, [wallet, demo, createDemo, resetDemo, relay, slot]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccount must be used inside <AccountProvider>');
  return v;
}
