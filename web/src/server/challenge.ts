import 'server-only';
// One-time score challenges (nonces), per account, valid 5 minutes, consumed on use. In memory:
// enough for the single testnet server. Each requester evicts only its own nonces (guards.ts).
import { randomBytes } from 'node:crypto';
import { ChallengeStore } from './guards';

const store = new ChallengeStore();

/** A new nonce for `accountId`, issued to requester `by` (client IP key). */
export function issueChallenge(accountId: string, by: string): Uint8Array {
  const nonce = new Uint8Array(randomBytes(32));
  store.issue(accountId, by, Buffer.from(nonce).toString('base64'));
  return nonce;
}

/** True once for a nonce issued for this account in the last 5 minutes. */
export function consumeChallenge(accountId: string, nonceB64: string): boolean {
  return store.consume(accountId, nonceB64);
}
