// Proof that the caller controls the account being scored (testnet Dev mode; on mainnet the contract
// already requires the borrower's own signature). One format for demo accounts and wallets: a NEP-413
// signed message. The server gives a one-time 32-byte nonce, the account signs this exact text with a
// full-access key, and the server checks the signature and that the key belongs to the account.
// Pure (isomorphic): unit-tested in ownership.test.ts.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { baseDecode } from 'near-api-js';

/** The text the account signs. It names the account and the browser's reply key for this score. */
export function scoreMessage(accountId: string, replyPubkey: string): string {
  return `KredoFi score request\naccount: ${accountId}\nreply key: ${replyPubkey}\nOnly sign this on the KredoFi testnet demo.`;
}

const NEP413_TAG = 2 ** 31 + 413;
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const str = (s: string) => { const t = new TextEncoder().encode(s); return [u32(t.length), t]; };

/** NEP-413: sha256(borsh(tag u32) || borsh({ message, nonce[32], recipient, callbackUrl: None })). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const parts = [u32(NEP413_TAG), ...str(message), nonce, ...str(recipient), new Uint8Array([0])];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return sha256(all);
}

/** "ed25519:<base58>" -> 32 bytes, or null. */
export function ed25519Key(publicKey: string): Uint8Array | null {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]{43,44})$/.exec(publicKey);
  if (!m) return null;
  try { const b = baseDecode(m[1]); return b.length === 32 ? b : null; } catch { return null; }
}

/** Wallets return the signature in base64 (NEP-413); accept base58 "ed25519:..." too. */
export function signatureBytes(sig: string): Uint8Array | null {
  try {
    const b = sig.startsWith('ed25519:') ? baseDecode(sig.slice(8)) : Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    return b.length === 64 ? b : null;
  } catch { return null; }
}

export function verifyScoreSignature(p: { accountId: string; replyPubkey: string; recipient: string; nonce: Uint8Array; publicKey: string; signature: string }): boolean {
  const pk = ed25519Key(p.publicKey), sig = signatureBytes(p.signature);
  if (!pk || !sig) return false;
  try { return ed25519.verify(sig, nep413Hash(scoreMessage(p.accountId, p.replyPubkey), p.nonce, p.recipient), pk); } catch { return false; }
}

export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
