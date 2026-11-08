'use client';
// Wallet connection through NEAR Connect (@hot-labs/near-connect 0.11.4).
// The connector is loaded on demand, so it is not part of the first page load.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { NETWORK } from '../config';
import { POPUP_BLOCKED_HINT, WALLET_NO_ANSWER, WALLET_TIMEOUT_MS, withTimeout } from '../tx';

/** While a wallet request waits on the wallet's own prompt (NEAR Connect shows it, e.g. Meteor's "Continue in
 *  Meteor Web", when the browser needs a click to open the wallet window), a small hint about blocked popups
 *  sits above it. Appended to the end of <body>, after NEAR Connect's prompt, so it is drawn on top. */
function watchWalletPrompt(): () => void {
  let hint: HTMLElement | null = null;
  const tick = () => {
    const open = [...document.querySelectorAll<HTMLElement>('.hot-connector-popup')].some((el) => el.style.display === 'block');
    if (open && !hint) {
      hint = document.createElement('p');
      hint.className = 'wallet-popup-hint';
      hint.setAttribute('role', 'status');
      hint.textContent = POPUP_BLOCKED_HINT;
      document.body.appendChild(hint);
    } else if (!open && hint) { hint.remove(); hint = null; }
  };
  const t = setInterval(tick, 400);
  return () => { clearInterval(t); hint?.remove(); };
}

/** Every wallet request gives up after WALLET_TIMEOUT_MS, and NEAR Connect's own prompt is removed so it
 *  doesn't stay over the page. */
async function walletCall<T>(p: Promise<T>): Promise<T> {
  const stop = watchWalletPrompt();
  try { return await withTimeout(p, WALLET_TIMEOUT_MS, WALLET_NO_ANSWER); }
  catch (e) {
    if (e instanceof Error && e.message === WALLET_NO_ANSWER) document.querySelectorAll('.hot-connector-popup').forEach((el) => el.remove());
    throw e;
  }
  finally { stop(); }
}

type FunctionCall = {
  type: 'FunctionCall';
  params: { methodName: string; args: object; gas: string; deposit: string };
};

/** A FunctionCall action in NEAR Connect's format. Gas in Tgas, deposit in yoctoNEAR. */
export function functionCall(methodName: string, args: object, gasTgas = 40, depositYocto: bigint | string = 0n): FunctionCall {
  return { type: 'FunctionCall', params: { methodName, args, gas: (BigInt(gasTgas) * 10n ** 12n).toString(), deposit: depositYocto.toString() } };
}

type WalletCtx = {
  accountId: string | null;
  /** True once a previous session has been checked (restored or not). Never blocks connect(). */
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSend: (receiverId: string, actions: FunctionCall[]) => Promise<unknown>;
  /** NEP-413 signed message from the connected wallet. */
  signMessage: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ publicKey: string; signature: string }>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const connectorRef = useRef<NearConnector | null>(null);
  const loading = useRef<Promise<NearConnector> | null>(null);

  const getConnector = useCallback(async () => {
    if (connectorRef.current) return connectorRef.current;
    loading.current ??= import('@hot-labs/near-connect').then(({ NearConnector }) => {
      const c = new NearConnector({ network: NETWORK });
      c.on('wallet:signIn', (t) => setAccountId(t.accounts[0]?.accountId ?? null));
      c.on('wallet:signOut', () => setAccountId(null));
      connectorRef.current = c;
      return c;
    });
    return loading.current;
  }, []);

  // Restore an existing session without opening anything.
  useEffect(() => {
    let alive = true;
    // Session restore needs the wallet manifest from the network; never wait on it for long.
    const giveUp = setTimeout(() => alive && setReady(true), 3000);
    getConnector()
      .then((c) => c.getConnectedWallet())
      .then(({ accounts }) => alive && setAccountId(accounts[0]?.accountId ?? null))
      .catch(() => {})
      .finally(() => { clearTimeout(giveUp); if (alive) setReady(true); });
    return () => { alive = false; clearTimeout(giveUp); };
  }, [getConnector]);

  const connect = useCallback(async () => {
    const c = await getConnector();
    await c.connect();
  }, [getConnector]);

  // Never wait on a wallet that doesn't answer: "Continue without a wallet" must always work.
  const disconnect = useCallback(async () => {
    try { const c = await getConnector(); await withTimeout(c.disconnect(), 5000, 'disconnect'); } catch { /* signed out here anyway */ }
    finally { setAccountId(null); }
  }, [getConnector]);

  const signAndSend = useCallback(async (receiverId: string, actions: FunctionCall[]) => {
    const c = await getConnector();
    const wallet = await c.wallet();
    return walletCall(wallet.signAndSendTransaction({ network: NETWORK, receiverId, actions }));
  }, [getConnector]);

  const signMessage = useCallback(async (p: { message: string; recipient: string; nonce: Uint8Array }) => {
    const c = await getConnector();
    const wallet = await c.wallet();
    const out = await walletCall(wallet.signMessage({ ...p, network: NETWORK, signerId: accountId ?? undefined }));
    return { publicKey: String(out.publicKey), signature: String(out.signature) };
  }, [getConnector, accountId]);

  const value = useMemo(() => ({ accountId, ready, connect, disconnect, signAndSend, signMessage }), [accountId, ready, connect, disconnect, signAndSend, signMessage]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>');
  return v;
}
