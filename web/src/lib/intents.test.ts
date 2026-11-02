import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, NEAR_USDC, isChain, mainnetRecipient, parseQuote, quoteRequest } from './intents.ts';

const now = new Date('2026-11-02T05:00:00Z');
const asked = quoteRequest('base', 10_000_000n, 'kredofi.near', now);
// shape of a real dry answer (Nov 2, 10 USDC on Base)
const real = {
  quote: { amountIn: '10000000', amountInFormatted: '10.0', amountOut: '9992765', minAmountOut: '9892837', timeEstimate: 35, refundFee: '2400', withdrawFee: '5315' },
  quoteRequest: { ...asked, dry: true }, signature: 'ed25519:228P', timestamp: '2026-11-02T05:24:11.134Z', correlationId: '57d0',
};

test('the request is always a dry run into USDC on NEAR', () => {
  assert.equal(asked.dry, true);
  assert.equal(asked.destinationAsset, NEAR_USDC);
  assert.equal(asked.originAsset, CHAINS.base.asset);
  assert.equal(asked.amount, '10000000');
  assert.equal(asked.deadline, '2026-11-02T05:10:00.000Z');
});

test('a real dry answer parses to what the page shows', () => {
  const p = parseQuote(real, asked);
  assert.equal(p.quote.amountOut, '9992765');
  assert.equal(p.quote.timeEstimate, 35);
  assert.equal(p.depositAddress, null);
});

test('live quotes, mismatches and errors are refused', () => {
  assert.throws(() => parseQuote({ ...real, quote: { ...real.quote, depositAddress: '0xabc' } }, asked), /live quote/);
  assert.throws(() => parseQuote({ ...real, quoteRequest: { ...real.quoteRequest, dry: false } }, asked), /live quote/);
  assert.throws(() => parseQuote({ ...real, quoteRequest: { ...real.quoteRequest, recipient: 'evil.near' } }, asked), /other than/);
  assert.throws(() => parseQuote({ ...real, quote: { ...real.quote, amountOut: '9.99' } }, asked), /malformed/);
  assert.throws(() => parseQuote({ message: 'refundTo is not valid' }, asked), /1Click: refundTo/);
});

test('only NEAR mainnet accounts can receive; testnet accounts get the stand-in', () => {
  assert.equal(mainnetRecipient('alice.near'), 'alice.near');
  assert.equal(mainnetRecipient('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(mainnetRecipient('demo1.relayer.kency.testnet'), null);
  assert.equal(mainnetRecipient(null), null);
  assert.ok(isChain('sol') && !isChain('toString') && !isChain('doge'));
});
