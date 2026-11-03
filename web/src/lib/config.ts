// Network and contract accounts (public values; testnet Dev mode by default).
export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
/** The public address (Cloudflare Worker in front of the Hugging Face Space). */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kredofi.xyz';
/** How this deployment scores: 'outlayer' = inside the enclave (OutLayer), 'dev' = the same scorer on our
 *  server (testnet Dev mode). Privacy claims in the copy follow this, not the network name. */
export const SCORER_MODE = (process.env.NEXT_PUBLIC_SCORER_MODE ?? (NETWORK === 'mainnet' ? 'outlayer' : 'dev')) as 'outlayer' | 'dev';
export const IN_ENCLAVE = SCORER_MODE === 'outlayer';
/** OutLayer contract on this network (OutLayer mode). */
export const OUTLAYER_CONTRACT = NETWORK === 'mainnet' ? 'outlayer.near' : 'outlayer.testnet';
/** The scorer's token key: browsers seal the Plaid token to it with their account (audit H1, SPEC
 *  "Sealed token"). x25519 public of SHA-256("kredofi-token-key-v1" | SEAL_KEY), per network. */
export const TOKEN_PUBKEY = process.env.NEXT_PUBLIC_SCORER_TOKEN_PUBKEY
  ?? (NETWORK === 'mainnet' ? 'ddd29784c75beca2e6fcd4656e98b118dbdadf9d859092f5cf4048f66306795e' : '86658adaeb78fb559a0c3da3d7daa075cea6f3df23b6d8bd868610656ffc4078');
export const KREDOFI_CONTRACT = process.env.NEXT_PUBLIC_KREDOFI_CONTRACT ?? 'kredofi.kency.testnet';
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT ?? 'musdc.kency.testnet';
export const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io/txns/' : 'https://testnet.nearblocks.io/txns/';
export const RPC = NETWORK === 'mainnet' ? 'https://rpc.mainnet.fastnear.com' : 'https://test.rpc.fastnear.com';
