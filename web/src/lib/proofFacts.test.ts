import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAINNET_RUN, MAINNET_SCORER_DELAY_HOURS, RECEIPT_RAW, SANDBOX_COUNT } from './proofFacts.ts';
import { DOC_PAGES } from './docs/pages.ts';

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);

test('the mainnet numbers match the attestation evidence for that transaction', () => {
  const b = JSON.parse(readFileSync(repo('docs/proofs/mainnet-score-2026-11-03.attestation.json'), 'utf8'));
  assert.equal(b.attestation.transaction_hash, MAINNET_RUN.tx);
  const raw = typeof b.output_raw === 'string' ? b.output_raw : JSON.stringify(b.output_raw);
  assert.equal(Buffer.byteLength(raw), MAINNET_RUN.outputBytes);
});

test('the receipt is one line with exactly the eight output fields', () => {
  assert.ok(!RECEIPT_RAW.includes('\n'));
  assert.deepEqual(Object.keys(JSON.parse(RECEIPT_RAW)), ['band', 'caller', 'fingerprint', 'income_cap', 'reply', 'score', 'sealed_identity', 'v']);
  assert.equal(Buffer.byteLength(RECEIPT_RAW), 458); // OutLayer's log for that run: Json(458 bytes)
  assert.ok(Buffer.byteLength(RECEIPT_RAW) < 900); // the scorer's own limit
});

test('the docs agree: 24 h on mainnet, and the count is dated', () => {
  assert.equal(MAINNET_SCORER_DELAY_HOURS, 24);
  const all = DOC_PAGES.map((p) => p.body).join('\n');
  assert.match(all, /24 hours|24 h/);
  assert.match(SANDBOX_COUNT.countedOn, /November/);
});
