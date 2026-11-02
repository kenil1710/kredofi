import 'server-only';
// One-time score challenges (nonces), per account, valid 5 minutes, consumed on use. In memory:
// enough for the single testnet server.
import { randomBytes } from 'node:crypto';

const TTL = 5 * 60_000;
const open = new Map<string, { nonce: string; at: number }[]>();

export function issueChallenge(accountId: string, now = Date.now()): Uint8Array {
  const nonce = new Uint8Array(randomBytes(32));
  const list = (open.get(accountId) ?? []).filter((c) => now - c.at < TTL).slice(-4); // at most 5 open
  list.push({ nonce: Buffer.from(nonce).toString('base64'), at: now });
  open.set(accountId, list);
  return nonce;
}

/** True once for a nonce issued to this account in the last 5 minutes. */
export function consumeChallenge(accountId: string, nonceB64: string, now = Date.now()): boolean {
  const list = (open.get(accountId) ?? []).filter((c) => now - c.at < TTL);
  const i = list.findIndex((c) => c.nonce === nonceB64);
  if (i < 0) { open.set(accountId, list); return false; }
  list.splice(i, 1);
  open.set(accountId, list);
  return true;
}
