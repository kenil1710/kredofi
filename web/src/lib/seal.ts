// Browser side of the scorer's x25519 seal (scorer/src/crypto.rs `seal_to`, scripts/lib/seal.mjs):
// key = SHA-256("kredofi-seal-v1" | shared | eph_pub | rcpt_pub), ChaCha20-Poly1305, zero nonce,
// sealed = base64(eph_pub (32) | ciphertext | tag (16)). WebCrypto has no ChaCha20, so @noble.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

const enc = new TextEncoder();
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

function kdf(shared: Uint8Array, eph: Uint8Array, rcpt: Uint8Array) {
  const m = new Uint8Array(15 + 96);
  m.set(enc.encode('kredofi-seal-v1'), 0); m.set(shared, 15); m.set(eph, 47); m.set(rcpt, 79);
  return sha256(m);
}

/** New x25519 keypair as hex. The secret stays in this browser. */
export function newKeypair(): { secret: string; public: string } {
  const sk = x25519.utils.randomSecretKey();
  return { secret: toHex(sk), public: toHex(x25519.getPublicKey(sk)) };
}

export function openSealed(secretHex: string, sealedB64: string): string {
  const raw = fromB64(sealedB64);
  const eph = raw.slice(0, 32), sk = fromHex(secretHex);
  const key = kdf(x25519.getSharedSecret(sk, eph), eph, x25519.getPublicKey(sk));
  return new TextDecoder().decode(chacha20poly1305(key, new Uint8Array(12)).decrypt(raw.slice(32)));
}

export function sealTo(pubHex: string, text: string): string {
  const rcpt = fromHex(pubHex), esk = x25519.utils.randomSecretKey(), eph = x25519.getPublicKey(esk);
  const key = kdf(x25519.getSharedSecret(esk, rcpt), eph, rcpt);
  const ct = chacha20poly1305(key, new Uint8Array(12)).encrypt(enc.encode(text));
  const out = new Uint8Array(32 + ct.length); out.set(eph); out.set(ct, 32);
  return toB64(out);
}
