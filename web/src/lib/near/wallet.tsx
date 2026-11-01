'use client';
// Wallet connection through NEAR Connect (@hot-labs/near-connect 0.11.4).
// The connector is loaded on demand, so it is not part of the first page load.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { NETWORK } from '../config';

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

  const disconnect = useCallback(async () => {
    const c = await getConnector();
    await c.disconnect();
    setAccountId(null);
  }, [getConnector]);

  const signAndSend = useCallback(async (receiverId: string, actions: FunctionCall[]) => {
    const c = await getConnector();
    const wallet = await c.wallet();
    return wallet.signAndSendTransaction({ network: NETWORK, receiverId, actions });
  }, [getConnector]);

  const value = useMemo(() => ({ accountId, ready, connect, disconnect, signAndSend }), [accountId, ready, connect, disconnect, signAndSend]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>');
  return v;
}
