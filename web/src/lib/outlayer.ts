// OutLayer mode (SPEC 2, 5): the browser seals the Plaid token to the scorer and signs request_score
// itself; the scorer's output comes back as the return value of an OutLayer receipt in the same
// transaction, and on_score's event says whether the contract took it. Pure: outlayer.test.ts.
import { sealTo } from './seal.ts';

/** `sealed1:` + seal(account + "\n" + public_token) to the scorer's token key (audit H1). */
export function sealToken(tokenPubHex: string, account: string, publicToken: string): string {
  return `sealed1:${sealTo(tokenPubHex, `${account}\n${publicToken}`)}`;
}

type Outcome = { executor_id?: string; logs?: string[]; status?: { SuccessValue?: string } & Record<string, unknown> };
export type ScoreResult = { output: Record<string, unknown> | null; event: 'score_issued' | 'score_failed' | null; reason?: string };

const fromB64 = (s: string) => {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Unwrap OutLayer's answer the way the contract does (raw object, JSON string, or {output}). */
function unwrap(v: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 2 || v === null || v === undefined) return null;
  if (typeof v === 'string') { try { return unwrap(JSON.parse(v), depth + 1); } catch { return null; } }
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if ('v' in o) return o;
  if ('output' in o) return unwrap(o.output, depth + 1);
  return null;
}

/** The scorer output and the contract's verdict from a request_score transaction's receipts. */
export function scoreFromReceipts(receipts: { outcome: Outcome }[], contract: string, outlayer: string, borrower: string): ScoreResult {
  let output: Record<string, unknown> | null = null, event: ScoreResult['event'] = null, reason: string | undefined;
  for (const { outcome: o } of receipts) {
    if (o.executor_id === outlayer && typeof o.status?.SuccessValue === 'string' && o.status.SuccessValue) {
      try { output = unwrap(JSON.parse(fromB64(o.status.SuccessValue))) ?? output; } catch { /* not JSON */ }
    }
    if (o.executor_id !== contract || (o.status && 'Failure' in o.status)) continue;
    for (const l of o.logs ?? []) {
      if (!l.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(l.slice(11));
        if (e.standard !== 'kredofi' || !['score_issued', 'score_failed'].includes(e.event)) continue;
        const d = (Array.isArray(e.data) ? e.data[0] : e.data) ?? {};
        if (d.borrower !== borrower) continue;
        event = e.event; reason = d.reason;
      } catch { /* not JSON */ }
    }
  }
  return { output: event === 'score_issued' ? output : null, event, reason };
}

/** Plain words for a score_failed reason from the contract or the scorer. */
export function failedReason(reason: string | undefined): string {
  const r = reason ?? '';
  if (/already used by another borrower/.test(r)) return 'This sandbox bank identity already backs another KredoFi account: one bank identity, one borrower.';
  if (/sealed for another account/.test(r)) return 'This bank login was started for another account. Connect your bank again.';
  if (/INVALID_PUBLIC_TOKEN|expired/i.test(r)) return 'The bank login expired. Connect your bank again.';
  return `The enclave could not score this bank connection${r ? ` (${r.slice(0, 160)})` : ''}. Nothing changed; you can try again.`;
}
