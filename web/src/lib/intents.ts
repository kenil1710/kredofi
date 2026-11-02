// NEAR Intents 1Click (SPEC 4 "Cross-chain deposits"): USDC from another chain arrives as USDC on
// NEAR in the lender's own account, then the lender deposits with ft_transfer_call. Pure: unit-tested
// in intents.test.ts. Quotes are always dry runs here: 1Click returns no deposit address, so nothing
// can be sent through this page (1Click has no testnet; the testnet pool uses test USDC).

export const ONECLICK = 'https://1click.chaindefuser.com';
/** Native USDC on NEAR mainnet (what 1Click delivers). */
export const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export type ChainKey = 'base' | 'eth' | 'arb' | 'sol';
/** Stand-in refund addresses: required by 1Click even for a dry quote, never used (no deposit address is issued). */
export const CHAINS: Record<ChainKey, { name: string; asset: string; standInRefund: string }> = {
  base: { name: 'Base', asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', standInRefund: '0x0000000000000000000000000000000000000001' },
  eth: { name: 'Ethereum', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', standInRefund: '0x0000000000000000000000000000000000000001' },
  arb: { name: 'Arbitrum', asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', standInRefund: '0x0000000000000000000000000000000000000001' },
  sol: { name: 'Solana', asset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', standInRefund: 'So11111111111111111111111111111111111111112' },
};
export const isChain = (c: unknown): c is ChainKey => typeof c === 'string' && Object.hasOwn(CHAINS, c);

/** 1 to 10,000 USDC, in base units (6 decimals). */
export const MIN_QUOTE = 1_000_000n, MAX_QUOTE = 10_000_000_000n;

/** Stand-in recipient when the lender's account is not a NEAR mainnet account (all testnet accounts). */
export const STAND_IN_RECIPIENT = 'kredofi.near';
export function mainnetRecipient(account: string | null | undefined): string | null {
  if (!account) return null;
  return /^[0-9a-f]{64}$/.test(account) || /^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*\.near$/.test(account) ? account : null;
}

export function quoteRequest(chain: ChainKey, amount: bigint, recipient: string, now: Date) {
  return {
    dry: true as const,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100, // 1%
    originAsset: CHAINS[chain].asset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: NEAR_USDC,
    amount: amount.toString(),
    refundTo: CHAINS[chain].standInRefund,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

export type Quote = { amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number; withdrawFee?: string; refundFee?: string };
export type QuoteAnswer = { chain: ChainKey; recipient: string; standIn: boolean; quote: Quote; signature: string; timestamp: string; correlationId?: string; dry: true; depositAddress: null };

/** Keep only what the page shows; refuse anything that isn't a dry quote for what was asked. */
export function parseQuote(j: unknown, asked: ReturnType<typeof quoteRequest>): Omit<QuoteAnswer, 'chain' | 'recipient' | 'standIn'> {
  const r = j as { quote?: Partial<Quote> & { depositAddress?: string }; quoteRequest?: { dry?: boolean; amount?: string; originAsset?: string; destinationAsset?: string; recipient?: string }; signature?: string; timestamp?: string; correlationId?: string; message?: string };
  if (!r?.quote) throw new Error(r?.message ? `1Click: ${r.message}` : '1Click did not return a quote.');
  const q = r.quote, req = r.quoteRequest ?? {};
  if (req.dry !== true || q.depositAddress) throw new Error('1Click answered with a live quote; refusing it (this page only shows dry runs).');
  if (req.amount !== asked.amount || req.originAsset !== asked.originAsset || req.destinationAsset !== asked.destinationAsset || req.recipient !== asked.recipient) throw new Error('1Click quoted something other than what was asked.');
  const digits = (x: unknown) => typeof x === 'string' && /^\d+$/.test(x);
  if (!digits(q.amountIn) || !digits(q.amountOut) || !digits(q.minAmountOut) || typeof q.timeEstimate !== 'number') throw new Error('1Click returned a malformed quote.');
  return {
    quote: { amountIn: q.amountIn!, amountOut: q.amountOut!, minAmountOut: q.minAmountOut!, timeEstimate: q.timeEstimate, withdrawFee: digits(q.withdrawFee) ? q.withdrawFee : undefined, refundFee: digits(q.refundFee) ? q.refundFee : undefined },
    signature: String(r.signature ?? ''), timestamp: String(r.timestamp ?? ''), correlationId: r.correlationId, dry: true, depositAddress: null,
  };
}
