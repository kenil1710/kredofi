import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newKeypair, openSealed, sealTo } from './seal.ts';
// The Node-crypto implementation that was cross-checked against the Rust scorer (scripts/seal.test.mjs).
// @ts-expect-error plain JS module shared with scripts/ (tested there against Rust)
import { keypair as nodeKeypair, openSealed as nodeOpen, sealTo as nodeSeal } from '../../../scripts/lib/seal.mjs';

test('browser seal round trip, wrong key fails', () => {
  const a = newKeypair(), b = newKeypair();
  const s = sealTo(a.public, 'Riya Good');
  assert.equal(openSealed(a.secret, s), 'Riya Good');
  assert.throws(() => openSealed(b.secret, s));
});

test('browser <-> node (<-> Rust) compatibility, both ways', () => {
  const n = nodeKeypair(), w = newKeypair();
  assert.equal(openSealed(n.secret, nodeSeal(n.public, '{"parts":{"income":250}}')), '{"parts":{"income":250}}');
  assert.equal(nodeOpen(w.secret, sealTo(w.public, 'Max Cheater')), 'Max Cheater');
});
