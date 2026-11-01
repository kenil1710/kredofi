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
  connectWallet: () => Promise<void>;
  signOut: () => Promise<void>;
};

const DEMO_KEY = 'kredofi:demo-account';
const loadDemo = (): Demo | null => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null'); } catch { return null; } };
const Ctx = createContext<AccountCtx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [demo, setDemo] = useState<Demo | null>(null);
  useEffect(() => setDemo(loadDemo()), []);

  const createDemo = useCallback(async () => {
    const existing = loadDemo();
    if (existing) { setDemo(existing); return existing.accountId; }
    const { KeyPair } = await import('near-api-js');
    const kp = KeyPair.fromRandom('ed25519');
    const r = await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'Could not create a demo account.');
    const d = { accountId: j.accountId as string, secretKey: kp.toString() };
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* private mode: the account lasts this tab */ }
    setDemo(d);
    return d.accountId;
  }, []);

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
    const kind = wallet.accountId ? 'wallet' : demo ? 'demo' : null;
    return {
      accountId: wallet.accountId ?? demo?.accountId ?? null,
      kind,
      signAndSend: (receiverId, acts) => (kind === 'wallet' ? wallet.signAndSend(receiverId, acts) : demo ? relay(demo, receiverId, acts) : Promise.reject(new Error('No account yet.'))),
      createDemo,
      connectWallet: wallet.connect,
      signOut: async () => { if (kind === 'wallet') await wallet.disconnect(); },
    };
  }, [wallet, demo, createDemo, relay]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccount must be used inside <AccountProvider>');
  return v;
}
