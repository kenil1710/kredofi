import 'server-only';
// Server check that a request comes from the account's own key: a one-time challenge signed as a
// NEP-413 message (lib/ownership.ts) by a full-access key of the account. Used by /api/score
// (Dev mode) and /api/fund (OutLayer mode fee top-ups).
import { KREDOFI_CONTRACT } from '@/lib/config';
import { fromB64, verifyScoreSignature } from '@/lib/ownership';
import { consumeChallenge } from './challenge';
import { rpc } from './near';

/** The signed challenge is for this account and request, and the key is one of its full-access keys. */
export async function provesOwnership(accountId: string, replyPubkey: string, proof: { nonce?: unknown; publicKey?: unknown; signature?: unknown } | undefined): Promise<true | string> {
  const nonce = proof?.nonce, publicKey = proof?.publicKey, signature = proof?.signature;
  if (typeof nonce !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string') return 'Sign the score request with your account first.';
  let n: Uint8Array;
  try { n = fromB64(nonce); } catch { return 'Invalid challenge.'; }
  if (!verifyScoreSignature({ accountId, replyPubkey, recipient: KREDOFI_CONTRACT, nonce: n, publicKey, signature })) return 'The signature does not match this score request.';
  if (!consumeChallenge(accountId, nonce)) return 'This challenge expired or was already used. Try again.';
  // A demo account created a moment ago may not be visible yet: retry briefly.
  for (let i = 0; i < 4; i++) {
    const key = await rpc<{ permission?: unknown }>('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: publicKey }).catch(() => null);
    if (key?.permission === 'FullAccess') return true;
    if (key?.permission) return 'Use a full-access key of this account.';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'This key does not belong to the account.';
}

