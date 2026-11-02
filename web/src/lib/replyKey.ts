// Reply keys: the browser's x25519 key the scorer seals the rule results (and receipt / AI summary) to.
// Demo accounts: a random key per score, kept in this browser (the account itself only exists here).
// Wallet accounts: a key DERIVED from a fixed NEP-413 message the wallet signs. Ed25519 signatures are
// deterministic, so the same wallet key gives the same reply key in any browser or device, and after
// cleared site data; the browser can always recover it with one signature. Pure: replyKey.test.ts.
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The fixed message a wallet signs to unlock its reply key (nonce and recipient are fixed too). */
export function unlockMessage(accountId: string): string {
  return `KredoFi: unlock my private score details\naccount: ${accountId}\nThis only lets this browser read your own rule results. It moves no funds.`;
}
export const UNLOCK_NONCE: Uint8Array = sha256(new TextEncoder().encode('kredofi-reply-key-nonce-v1'));

/** x25519 keypair (hex) from the wallet's signature bytes over the unlock message. */
export function replyKeyFromSignature(signature: Uint8Array): { secret: string; public: string } {
  const tag = new TextEncoder().encode('kredofi-reply-key-v1');
  const m = new Uint8Array(tag.length + signature.length); m.set(tag); m.set(signature, tag.length);
  const sk = sha256(m);
  return { secret: toHex(sk), public: toHex(x25519.getPublicKey(sk)) };
}

/** Keep the newest reply secrets per account (most recent first), so an older score still opens. */
export function rememberSecret(list: string[] | undefined, secret: string, max = 6): string[] {
  return [secret, ...(list ?? []).filter((s) => s !== secret)].slice(0, max);
}

/** First secret that opens `sealed`, using the given opener; null if none. */
export function openWithAny<T>(secrets: string[], sealed: string, open: (secret: string, sealed: string) => T): T | null {
  for (const s of secrets) { try { return open(s, sealed); } catch { /* not this one */ } }
  return null;
}
