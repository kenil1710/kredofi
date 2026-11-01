'use client';
// React hook over the tx reducer (DESIGN 7.3): every button that sends a transaction uses it.
import { useCallback, useReducer, useRef } from 'react';
import { classifyError, initialTx, isBusy, outcomeFailure, outcomeHash, txReducer, type TxState } from './tx';

export type TxRunner<T> = (h: { sent: (hash: string) => void }) => Promise<T>;

export function useTx() {
  const [state, dispatch] = useReducer(txReducer, initialTx);
  const busy = useRef(false);

  const run = useCallback(async <T,>(fn: TxRunner<T>): Promise<T | undefined> => {
    if (busy.current) return undefined; // never submit twice
    busy.current = true;
    dispatch({ type: 'start' });
    try {
      const out = await fn({ sent: (hash) => dispatch({ type: 'sent', hash }) });
      const hash = outcomeHash(out);
      const fail = outcomeFailure(out);
      if (fail) dispatch({ type: 'failed', kind: 'contract', message: fail, hash });
      else dispatch({ type: 'confirmed', hash });
      return out;
    } catch (e) {
      const { kind, message } = classifyError(e);
      dispatch({ type: 'failed', kind, message });
      return undefined;
    } finally {
      busy.current = false;
    }
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  return { state, run, reset, busy: isBusy(state) } as { state: TxState; run: typeof run; reset: () => void; busy: boolean };
}
