// Network and contract accounts (public values; testnet Dev mode by default).
export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
export const KREDOFI_CONTRACT = process.env.NEXT_PUBLIC_KREDOFI_CONTRACT ?? 'kredofi.kency.testnet';
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT ?? 'musdc.kency.testnet';
export const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io/txns/' : 'https://testnet.nearblocks.io/txns/';
export const RPC = NETWORK === 'mainnet' ? 'https://rpc.mainnet.fastnear.com' : 'https://test.rpc.fastnear.com';
