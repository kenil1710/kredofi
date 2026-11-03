// JS side of the scorer's x25519 seal scheme (scorer/src/crypto.rs `seal_to`):
// key = SHA-256("kredofi-seal-v1" | shared | eph_pub | rcpt_pub), ChaCha20-Poly1305, zero nonce,
// sealed = base64(eph_pub (32) | ciphertext | tag (16)). Node built-ins only.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto';

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

const privFromRaw = (raw) => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' });
const pubFromRaw = (raw) => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });
const rawPub = (key) => createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);

/** New x25519 keypair as hex: { secret, public }. */
export function keypair() {
  const { privateKey } = generateKeyPairSync('x25519');
  const secret = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return { secret: secret.toString('hex'), public: rawPub(privateKey).toString('hex') };
}

function kdf(shared, eph, rcpt) {
  return createHash('sha256').update('kredofi-seal-v1').update(shared).update(eph).update(rcpt).digest();
}

/** Open a sealed value with a 32-byte hex secret. Throws on a wrong key or tampering. */
export function openSealed(secretHex, sealedB64) {
  const raw = Buffer.from(sealedB64, 'base64');
  const eph = raw.subarray(0, 32);
  const sk = privFromRaw(Buffer.from(secretHex, 'hex'));
  const shared = diffieHellman({ privateKey: sk, publicKey: pubFromRaw(eph) });
  const key = kdf(shared, eph, rawPub(sk));
  const d = createDecipheriv('chacha20-poly1305', key, Buffer.alloc(12), { authTagLength: 16 });
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(32, raw.length - 16)), d.final()]).toString('utf8');
}

/** Seal to a 32-byte hex public key (same scheme; used by tests and the web app). */
export function sealTo(pubHex, text) {
  const rcpt = Buffer.from(pubHex, 'hex');
  const { privateKey } = generateKeyPairSync('x25519');
  const eph = rawPub(privateKey);
  const key = kdf(diffieHellman({ privateKey, publicKey: pubFromRaw(rcpt) }), eph, rcpt);
  const c = createCipheriv('chacha20-poly1305', key, Buffer.alloc(12), { authTagLength: 16 });
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([eph, ct, c.getAuthTag()]).toString('base64');
}

/** x25519 public key of a 32-byte hex secret. */
export const publicOf = (secretHex) => rawPub(privFromRaw(Buffer.from(secretHex, 'hex'))).toString('hex');

/** The scorer's token key (scorer/src/crypto.rs `token_pubkey`): x25519 public of
 *  SHA-256("kredofi-token-key-v1" | SEAL_KEY). Public; browsers seal Plaid tokens to it (audit H1). */
export const tokenPubkey = (sealKeyHex) =>
  publicOf(createHash('sha256').update('kredofi-token-key-v1').update(Buffer.from(sealKeyHex, 'hex')).digest('hex'));

/** `sealed1:` + seal(account + "\n" + public_token): only the scorer opens it, and only for `account`. */
export const sealToken = (tokenPubHex, account, publicToken) => `sealed1:${sealTo(tokenPubHex, `${account}\n${publicToken}`)}`;
