//! Open a value sealed with the x25519 scheme (`reply` or `released`).
//! The secret is read from the env var named in the first argument, never from argv:
//!   PARTNER_PRIVKEY=... cargo run --example open_sealed -- PARTNER_PRIVKEY < sealed.b64
use kredofi_scorer::crypto::{open_sealed, unhex32};
use std::io::Read;

fn main() {
    let var = std::env::args().nth(1).expect("usage: open_sealed <ENV_VAR_WITH_SECRET_HEX> < sealed_b64");
    let secret = unhex32(std::env::var(&var).expect("secret env var missing").trim()).expect("secret must be 32 bytes hex");
    let mut b64 = String::new();
    std::io::stdin().read_to_string(&mut b64).unwrap();
    match open_sealed(&secret, b64.trim()) {
        Ok(p) => println!("{}", String::from_utf8_lossy(&p)),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
