// Transaction state (DESIGN 7.3): Signing -> Sent (tx link) -> Confirmed, or Failed.
// Pure reducer + error classification, unit-tested in tx.test.ts; the React hook is useTx.ts.

export type TxPhase = 'idle' | 'signing' | 'sent' | 'confirmed' | 'failed';
export type TxErrorKind = 'rejected' | 'insufficient' | 'contract' | 'network';

export type TxState = {
  phase: TxPhase;
  hash?: string;
  error?: { kind: TxErrorKind; message: string };
};

export type TxEvent =
  | { type: 'start' }
  | { type: 'sent'; hash: string }
  | { type: 'confirmed'; hash?: string }
  | { type: 'failed'; kind: TxErrorKind; message: string; hash?: string }
  | { type: 'reset' };

export const initialTx: TxState = { phase: 'idle' };

export function txReducer(s: TxState, e: TxEvent): TxState {
  switch (e.type) {
    case 'start':
      // Never submit twice: a running transaction ignores another start.
      return s.phase === 'signing' || s.phase === 'sent' ? s : { phase: 'signing' };
    case 'sent':
      return s.phase === 'signing' || s.phase === 'sent' ? { phase: 'sent', hash: e.hash } : s;
    case 'confirmed':
      return s.phase === 'signing' || s.phase === 'sent' ? { phase: 'confirmed', hash: e.hash ?? s.hash } : s;
    case 'failed':
      return { phase: 'failed', hash: e.hash ?? s.hash, error: { kind: e.kind, message: e.message } };
    case 'reset':
      return initialTx;
  }
}

export function isBusy(s: TxState): boolean {
  return s.phase === 'signing' || s.phase === 'sent';
}

/** Contract panic text without the runtime prefix: "Smart contract panicked: X" -> "X". */
export function panicMessage(raw: string): string {
  const m = raw.match(/(?:Smart contract panicked|panicked at[^:]*):\s*(.+?)(?:"\s*\}|$)/s);
  return (m ? m[1] : raw).trim();
}

/** Classify an error thrown by a wallet / relayer / RPC call (DESIGN 7.7 messages). */
/** Rejects with `message` if `p` hasn't settled within `ms` (audit Nov 7: offline left "Confirming on NEAR…" forever). */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(t));
}
export const OFFLINE_NOT_SENT = 'No connection to NEAR. Nothing was sent; check your connection and try again.';
/** A wallet that never answers (live test Nov 8: Meteor Web opened its home page, not the request) must not leave
 *  "Checking your limit" stuck: every wallet call gives up after this long. */
export const WALLET_TIMEOUT_MS = 60_000;
/** Also shown as a small hint while the wallet's own prompt (e.g. "Continue in Meteor Web") is open. */
export const POPUP_BLOCKED_HINT = 'If nothing opened, your browser blocked the wallet window — click the blocked-popup icon in the address bar, choose Always allow for kredofi.xyz, then press Check my limit again.';
export const WALLET_NO_ANSWER = `Your wallet didn’t respond. Allow popups for kredofi.xyz, close other wallet tabs, and try again — or use the no-wallet demo. ${POPUP_BLOCKED_HINT}`;
export const isWalletNoAnswer = (e: unknown) => e instanceof Error && e.message === WALLET_NO_ANSWER;
export const RELAY_NO_ANSWER ='No answer from the relayer in 45 seconds. It may still go through: reload the page before trying again.';

export function classifyError(err: unknown): { kind: TxErrorKind; message: string } {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '');
  const t = raw.toLowerCase();
  if (/(user )?(rejected|cancel+ed|denied|closed)( the)?( request| transaction| signing| window)?|user abort/.test(t)) {
    return { kind: 'rejected', message: 'You cancelled the signature. Nothing was sent.' };
  }
  if (/notenoughbalance|not enough balance|lackbalanceforstate|insufficient/.test(t)) {
    return { kind: 'insufficient', message: raw };
  }
  if (/panicked|executionerror|functioncallerror|actionerror/.test(t)) {
    return { kind: 'contract', message: panicMessage(raw) };
  }
  return { kind: 'network', message: raw || 'The network did not answer. Try again.' };
}

/** Outcome of signAndSendTransaction: did it fail on-chain? Returns the panic text if so. */
export function outcomeFailure(outcome: unknown): string | null {
  const o = outcome as { status?: { Failure?: unknown }; receipts_outcome?: Array<{ outcome?: { status?: { Failure?: unknown } } }> };
  // A relayed (meta) transaction succeeds at the top level even when the call it carries fails in a
  // later receipt (live bug, Nov 2: a refused borrow showed "Confirmed"), so check every receipt.
  const f = o?.status?.Failure ?? o?.receipts_outcome?.map((r) => r.outcome?.status?.Failure).find(Boolean);
  if (!f) return null;
  const e = (f as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } } })?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return panicMessage(e ?? JSON.stringify(f));
}

/** Transaction hash from a FinalExecutionOutcome-like object. */
export function outcomeHash(outcome: unknown): string | undefined {
  const o = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  return o?.transaction?.hash ?? o?.transaction_outcome?.id;
}
