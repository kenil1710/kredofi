import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_PROOF, MAINNET_RUN, MAINNET_SCORER_DELAY_HOURS, RECEIPT_RAW, SANDBOX_COUNT } from './proofFacts.ts';
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

test('the hero line reads as agreed, and /mainnet backs both of its claims', () => {
  assert.equal(HERO_PROOF, 'TDX attestation: PROVEN · 8.5 s mainnet score · Verify →');
  const page = readFileSync(repo('web/src/app/mainnet/page.tsx'), 'utf8');
  assert.match(page, /<b>PROVEN<\/b>/);
  assert.ok(page.includes(MAINNET_RUN.tx));
  assert.match(page, /8\.5 s in the enclave/);
});

test('the lower proof block repeats nothing the strip already shows', () => {
  const landing = readFileSync(repo('web/src/components/Landing.tsx'), 'utf8');
  const block = landing.slice(landing.indexOf('<section id="proof"'), landing.indexOf('<section id="cta"'));
  assert.ok(block.length > 100);
  assert.ok(!block.includes('8.5') && !block.includes('472'));
  assert.match(block, /PROVEN/);
});
