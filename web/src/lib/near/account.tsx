'use client';
// One account for the app: a connected wallet, or a no-wallet demo account (SPEC 8a) whose key lives
// only in this browser. Demo actions are meta transactions: the browser signs a DelegateAction and
// /api/relay sends it, paying the gas. Both paths expose the same signAndSend.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { functionCall, useWallet } from './wallet';
import { RPC } from '../config';
import { b64, fromB64, scoreMessage, signatureBytes } from '../ownership';
import { replyKeyFromSignature, unlockMessage, UNLOCK_NONCE } from '../replyKey';
import { KREDOFI_CONTRACT } from '../config';

type Action = ReturnType<typeof functionCall>;
type Demo = { accountId: string; secretKey: string };
type AccountCtx = {
  accountId: string | null;
  kind: 'wallet' | 'demo' | null;
  signAndSend: (receiverId: string, actions: Action[]) => Promise<unknown>;
  createDemo: () => Promise<string>;
  /** Wallet accounts: the reply key derived from a fixed signed message (same in any browser). Null for demo accounts. */
  walletReplyKey: (accountId: string, opts?: { refresh?: boolean }) => Promise<{ secret: string; public: string } | null>;
  /** Proof for /api/score that this browser controls `accountId` (NEP-413 signed challenge). */
  proveScore: (accountId: string, replyPubkey: string) => Promise<{ nonce: string; publicKey: string; signature: string }>;
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
    try {
      const id = loadDemo(slot)?.accountId;
      if (id) localStorage.removeItem(`kredofi:passbook:${id}`); // its reply key and scorer output too
      localStorage.removeItem(demoKey(slot));
    } catch { /* private mode */ }
    setDemo(null);
  }, [slot]);

  const proveScore = useCallback(async (accountId: string, replyPubkey: string) => {
    const r = await fetch('/api/score/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'Could not get a score challenge.');
    const nonce = fromB64(j.nonce), message = scoreMessage(accountId, replyPubkey);
    // Read the demo key fresh: a demo account created a moment ago isn't in this render's state yet.
    const d = loadDemo(slot);
    if (d && d.accountId === accountId) {
      const { KeyPair, KeyPairSigner } = await import('near-api-js');
      const signer = new KeyPairSigner(KeyPair.fromString(d.secretKey as `ed25519:${string}`));
      const out = await signer.signNep413Message(accountId, { message, recipient: j.recipient, nonce });
      const sig = out.signature instanceof Uint8Array ? b64(out.signature) : String(out.signature);
      return { nonce: j.nonce as string, publicKey: out.publicKey.toString(), signature: sig };
    }
    if (!slot && wallet.accountId === accountId) {
      const out = await wallet.signMessage({ message, recipient: j.recipient, nonce });
      return { nonce: j.nonce as string, ...out };
    }
    throw new Error('This browser does not hold the key for this account.');
  }, [slot, wallet]);

  const walletReplyKey = useCallback(async (accountId: string, opts?: { refresh?: boolean }) => {
    if (slot || wallet.accountId !== accountId) return null;
    const cacheKey = `kredofi:replykey:${accountId}`;
    if (!opts?.refresh) { try { const c = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); if (c?.secret && c?.public) return c; } catch { /* none */ } }
    const out = await wallet.signMessage({ message: unlockMessage(accountId), recipient: KREDOFI_CONTRACT, nonce: UNLOCK_NONCE });
    const sig = signatureBytes(out.signature);
    if (!sig) throw new Error('The wallet returned an unreadable signature.');
    const kp = replyKeyFromSignature(sig);
    try { localStorage.setItem(cacheKey, JSON.stringify(kp)); } catch { /* private mode: derive again next time */ }
    return kp;
  }, [slot, wallet]);

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
      proveScore,
      walletReplyKey,
      resetDemo,
      slot,
      connectWallet: wallet.connect,
      signOut: async () => { if (kind === 'wallet') await wallet.disconnect(); },
    };
  }, [wallet, demo, createDemo, proveScore, walletReplyKey, resetDemo, relay, slot]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccount must be used inside <AccountProvider>');
  return v;
}
