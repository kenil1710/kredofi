//! Fingerprint, sealed identity and x25519 sealing (SPEC 5 steps 5-6, release step).
//!
//! - `fingerprint` = HMAC-SHA256(SEAL_KEY, institution_id | normalized owner name | account mask).
//! - `seal_identity`: the owner name encrypted under SEAL_KEY (ChaCha20-Poly1305). SEAL_KEY is
//!   reused for every borrower, so each seal uses a fresh random 12-byte nonce:
//!   output = nonce (12) | ciphertext+tag, key = SHA-256("kredofi-identity-v1" | SEAL_KEY).
//! - `seal_to`: the prep-tested x25519 scheme. Ephemeral key, key = SHA-256("kredofi-seal-v1" |
//!   shared | eph_pub | rcpt_pub), zero nonce (the key is single-use), output = eph_pub | ct+tag.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub type Key32 = [u8; 32];

pub fn rand32() -> Result<Key32, String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|_| "no randomness")?;
    Ok(b)
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex32(s: &str) -> Result<Key32, String> {
    if s.len() != 64 {
        return Err("expected 32 bytes of hex".into());
    }
    let mut o = [0u8; 32];
    for (i, byte) in o.iter_mut().enumerate() {
        *byte = u8::from_str_radix(s.get(2 * i..2 * i + 2).ok_or("bad hex")?, 16)
            .map_err(|_| "bad hex")?;
    }
    Ok(o)
}

/// Uppercase, trimmed, single spaces: "  riya   good " -> "RIYA GOOD".
pub fn normalize_name(name: &str) -> String {
    name.split_whitespace()
        .map(|w| w.to_uppercase())
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn fingerprint(seal_key: &Key32, institution_id: &str, owner_name: &str, mask: &str) -> Key32 {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(seal_key).expect("any key length");
    mac.update(institution_id.as_bytes());
    mac.update(b"|");
    mac.update(normalize_name(owner_name).as_bytes());
    mac.update(b"|");
    mac.update(mask.as_bytes());
    mac.finalize().into_bytes().into()
}

fn identity_key(seal_key: &Key32) -> Key32 {
    let mut h = Sha256::new();
    h.update(b"kredofi-identity-v1");
    h.update(seal_key);
    h.finalize().into()
}

pub fn seal_identity(seal_key: &Key32, name: &str) -> Result<String, String> {
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|_| "no randomness")?;
    let ct = ChaCha20Poly1305::new(&identity_key(seal_key).into())
        .encrypt(Nonce::from_slice(&nonce), name.as_bytes())
        .map_err(|_| "seal failed")?;
    let mut out = nonce.to_vec();
    out.extend(ct);
    Ok(B64.encode(out))
}

pub fn open_identity(seal_key: &Key32, sealed_b64: &str) -> Result<String, String> {
    let raw = B64.decode(sealed_b64).map_err(|_| "sealed is not base64")?;
    if raw.len() < 12 + 16 {
        return Err("sealed too short".into());
    }
    let pt = ChaCha20Poly1305::new(&identity_key(seal_key).into())
        .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
        .map_err(|_| "cannot open sealed identity")?;
    String::from_utf8(pt).map_err(|_| "sealed identity is not text".into())
}

fn seal_kdf(shared: &[u8], eph: &[u8], rcpt: &[u8]) -> Key32 {
    let mut h = Sha256::new();
    h.update(b"kredofi-seal-v1");
    h.update(shared);
    h.update(eph);
    h.update(rcpt);
    h.finalize().into()
}

/// Encrypt `plaintext` so only the holder of the x25519 secret for `rcpt_pub` can read it.
pub fn seal_to(rcpt_pub: &Key32, plaintext: &[u8]) -> Result<String, String> {
    let rcpt = PublicKey::from(*rcpt_pub);
    let eph = StaticSecret::from(rand32()?);
    let eph_pub = PublicKey::from(&eph);
    let shared = eph.diffie_hellman(&rcpt);
    if !shared.was_contributory() {
        return Err("invalid recipient public key".into());
    }
    let key = seal_kdf(shared.as_bytes(), eph_pub.as_bytes(), rcpt.as_bytes());
    let ct = ChaCha20Poly1305::new(&key.into())
        .encrypt(Nonce::from_slice(&[0u8; 12]), plaintext)
        .map_err(|_| "seal failed")?;
    let mut out = eph_pub.as_bytes().to_vec();
    out.extend(ct);
    Ok(B64.encode(out))
}

/// Recipient side of `seal_to` (tests, partner tool, browser equivalent).
pub fn open_sealed(secret: &Key32, sealed_b64: &str) -> Result<Vec<u8>, String> {
    let raw = B64.decode(sealed_b64).map_err(|_| "not base64")?;
    if raw.len() < 32 + 16 {
        return Err("sealed too short".into());
    }
    let sk = StaticSecret::from(*secret);
    let eph_pub = PublicKey::from(<[u8; 32]>::try_from(&raw[..32]).unwrap());
    let rcpt = PublicKey::from(&sk);
    let key = seal_kdf(sk.diffie_hellman(&eph_pub).as_bytes(), eph_pub.as_bytes(), rcpt.as_bytes());
    ChaCha20Poly1305::new(&key.into())
        .decrypt(Nonce::from_slice(&[0u8; 12]), &raw[32..])
        .map_err(|_| "cannot open (wrong key or tampered)".into())
}

pub fn public_of(secret: &Key32) -> Key32 {
    *PublicKey::from(&StaticSecret::from(*secret)).as_bytes()
}

/// Prefix of a Plaid `public_token` sealed to the scorer (audit Nov 3, H1).
pub const SEALED_TOKEN_PREFIX: &str = "sealed1:";

/// x25519 secret the browser seals Plaid tokens to, derived from `SEAL_KEY` (so it exists where
/// `SEAL_KEY` does: OutLayer's secrets for the pinned build, and the developer who made it).
pub fn token_secret(seal_key: &Key32) -> Key32 {
    let mut h = Sha256::new();
    h.update(b"kredofi-token-key-v1");
    h.update(seal_key);
    h.finalize().into()
}

/// The public key browsers seal tokens to (published in the web config and the docs).
pub fn token_pubkey(seal_key: &Key32) -> Key32 {
    public_of(&token_secret(seal_key))
}

/// Opens `sealed1:<base64>` = seal_to(token_pubkey, "<account>\n<public_token>") and returns the
/// token only if `<account>` is the caller (`NEAR_SENDER_ID`). A token copied from someone else's
/// transaction names their account, so it is refused before it is ever exchanged at Plaid.
pub fn open_token(seal_key: &Key32, sealed: &str, caller: &str) -> Result<String, String> {
    let b64 = sealed.strip_prefix(SEALED_TOKEN_PREFIX).ok_or("token is not sealed")?;
    let pt = open_sealed(&token_secret(seal_key), b64).map_err(|_| "cannot open the sealed token")?;
    let pt = String::from_utf8(pt).map_err(|_| "sealed token is not text")?;
    let (account, token) = pt.split_once('\n').ok_or("sealed token has no account")?;
    if account != caller {
        return Err("this token was sealed for another account".into());
    }
    if token.is_empty() || token.len() > 128 || !token.starts_with("public-") {
        return Err("invalid public_token".into());
    }
    Ok(token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: Key32 = [7u8; 32];

    #[test]
    fn fingerprint_is_stable_and_normalized() {
        let a = fingerprint(&KEY, "ins_109508", "Riya Good", "0000");
        assert_eq!(a, fingerprint(&KEY, "ins_109508", "  riya   GOOD ", "0000"));
        assert_ne!(a, fingerprint(&KEY, "ins_109508", "Max Cheater", "0000"));
        assert_ne!(a, fingerprint(&KEY, "ins_109508", "Riya Good", "1111"));
        assert_ne!(a, fingerprint(&KEY, "ins_3", "Riya Good", "0000"));
        assert_ne!(a, fingerprint(&[8u8; 32], "ins_109508", "Riya Good", "0000"), "keyed");
        // Field boundaries are kept: "ab|c" != "a|bc".
        assert_ne!(fingerprint(&KEY, "ab", "c", ""), fingerprint(&KEY, "a", "bc", ""));
    }

    #[test]
    fn identity_round_trip_with_fresh_nonce() {
        let a = seal_identity(&KEY, "Riya Good").unwrap();
        let b = seal_identity(&KEY, "Riya Good").unwrap();
        assert_ne!(a, b, "random nonce per seal");
        assert_eq!(open_identity(&KEY, &a).unwrap(), "Riya Good");
        assert!(open_identity(&[9u8; 32], &a).is_err(), "wrong key fails");
        // 12 nonce + 9 name + 16 tag = 37 bytes.
        assert_eq!(B64.decode(&a).unwrap().len(), 37);
    }

    #[test]
    fn x25519_seal_right_key_opens_wrong_key_fails() {
        let partner = rand32().unwrap();
        let other = rand32().unwrap();
        let s = seal_to(&public_of(&partner), b"Alberta Bobbeth Charleson").unwrap();
        assert_eq!(open_sealed(&partner, &s).unwrap(), b"Alberta Bobbeth Charleson");
        assert!(open_sealed(&other, &s).is_err());
        // 32 eph + 25 name + 16 tag = 73 bytes -> 100 base64 chars (SPEC 5 prep result).
        assert_eq!(s.len(), 100);
        let mut raw = B64.decode(&s).unwrap();
        raw[40] ^= 1;
        assert!(open_sealed(&partner, &B64.encode(raw)).is_err(), "tamper detected");
    }

    #[test]
    fn low_order_recipient_key_rejected() {
        assert!(seal_to(&[0u8; 32], b"x").is_err());
    }

    #[test]
    fn hex_helpers() {
        assert_eq!(unhex32(&hex(&KEY)).unwrap(), KEY);
        assert!(unhex32("abcd").is_err());
        assert!(unhex32(&"zz".repeat(32)).is_err());
    }
}
