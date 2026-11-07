import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_PROOF, ONE_LINE_HEADING, MAINNET_RUN, MAINNET_SCORER_DELAY_HOURS, RECEIPT_NOTE, RECEIPT_RAW } from './proofFacts.ts';
import { DOC_PAGES } from './docs/pages.ts';

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);

test('the mainnet numbers match the attestation evidence for that transaction', () => {
  const b = JSON.parse(readFileSync(repo('docs/proofs/mainnet-score-2026-11-07.attestation.json'), 'utf8'));
  assert.equal(b.attestation.transaction_hash, MAINNET_RUN.tx);
  assert.ok(b.attestation.wasm_hash.startsWith(MAINNET_RUN.scorer));
  const raw = typeof b.output_raw === 'string' ? b.output_raw : JSON.stringify(b.output_raw);
  assert.equal(Buffer.byteLength(raw), MAINNET_RUN.outputBytes);
});

test('the receipt is one line with exactly the eight output fields', () => {
  assert.ok(!RECEIPT_RAW.includes('\n'));
  assert.deepEqual(Object.keys(JSON.parse(RECEIPT_RAW)), ['band', 'caller', 'fingerprint', 'income_cap', 'reply', 'score', 'sealed_identity', 'v']);
  assert.equal(Buffer.byteLength(RECEIPT_RAW), 458); // OutLayer's log for that run: Json(458 bytes)
  assert.ok(Buffer.byteLength(RECEIPT_RAW) < 900); // the scorer's own limit
});

test('the docs agree: 24 h on mainnet', () => {
  assert.equal(MAINNET_SCORER_DELAY_HOURS, 24);
  const all = DOC_PAGES.map((p) => p.body).join('\n');
  assert.match(all, /24 hours|24 h/);
});

test('the hero line reads as agreed, and /mainnet backs both of its claims', () => {
  assert.equal(HERO_PROOF, 'TDX attestation: PROVEN · mainnet run · sandbox data · 7.7 s · Verify →');
  const page = readFileSync(repo('web/src/app/mainnet/page.tsx'), 'utf8');
  assert.match(page, /<b>PROVEN<\/b>/);
  assert.ok(page.includes(MAINNET_RUN.tx));
  assert.match(page, /7\.7 s in the enclave/);
});

test('the lower proof block repeats nothing the strip already shows', () => {
  const landing = readFileSync(repo('web/src/components/Landing.tsx'), 'utf8');
  const block = landing.slice(landing.indexOf('<section id="proof"'), landing.indexOf('<section id="cta"'));
  assert.ok(block.length > 100);
  assert.ok(!block.includes('7.7') && !block.includes('472'));
  assert.match(block, /PROVEN/);
});

test('the headline, receipt note, /trust and scripts name no transaction count', () => {
  assert.equal(ONE_LINE_HEADING, 'Every transaction in. One line out.');
  const proof = readFileSync(repo('web/src/components/LandingProof.tsx'), 'utf8');
  assert.match(proof, /<h2 id="oneline-h">\{ONE_LINE_HEADING\}/);
  assert.equal(RECEIPT_NOTE, 'Inside the enclave the scorer reads your test bank. Only this line is written to NEAR.');
  assert.match(proof, /\{RECEIPT_NOTE\}/);
  assert.doesNotMatch(proof, /we counted/);
  // Dev mode scores outside an enclave, so /trust must not carry the enclave sentence or a fixed count.
  assert.doesNotMatch(readFileSync(repo('web/src/app/trust/page.tsx'), 'utf8'), /trust-receipt|\b38\d transactions/);
  for (const f of ['docs/VIDEO.md', 'docs/X_POST.md']) assert.doesNotMatch(readFileSync(repo(f), 'utf8'), /\b38\d transactions/, f);
  assert.match(readFileSync(repo('docs/VIDEO.md'), 'utf8'), /every transaction/i);
  // Nothing in the receipt's on-chain output can state a count: only rule points fit in that reply.
  const sealed = Buffer.from(JSON.parse(RECEIPT_RAW).reply, 'base64');
  assert.ok(sealed.length - 32 - 16 < 100);
});

test('reduced motion keeps the hero in the page flow, above the enclave (audit Nov 7)', () => {
  const css = readFileSync(new URL('../app/landing.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\.lp \.hero-copy\{position:relative;min-height:100vh/);
  assert.match(block, /\.lp \.enclave\{position:relative/);
  const landing = readFileSync(new URL('../components/Landing.tsx', import.meta.url), 'utf8');
  assert.match(landing, /const heroOut = REDUCE \? 0 :/, 'the scroll loop must not fade the hero out under reduced motion');
});
