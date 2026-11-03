// Print the scorer's token public key for a SEAL_KEY held in an env var (the key itself is never
// printed). Browsers seal Plaid tokens to this key (audit Nov 3, H1; SPEC "Sealed token").
//   set -a; source .env; set +a; node scripts/token_pubkey.mjs SEAL_KEY_TESTNET
import { tokenPubkey } from './lib/seal.mjs';
const name = process.argv[2] ?? 'SEAL_KEY';
const v = process.env[name];
if (!/^[0-9a-f]{64}$/i.test(v ?? '')) { console.error(`${name} is not set or not 32 bytes of hex`); process.exit(1); }
console.log(tokenPubkey(v));
