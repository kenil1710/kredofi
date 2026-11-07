import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpretRun, resultFromResponse, type VerifyContext, type VerifyRun } from './verifyScore.ts';

// The real saved evidence of the Nov 7 mainnet score, so these tests use the verifier's actual format.
const bundle = JSON.parse(readFileSync(new URL('../../../docs/proofs/mainnet-score-2026-11-07.attestation.json', import.meta.url), 'utf8'));
const out = JSON.parse(bundle.output_raw);
const ctx = (): VerifyContext => ({
  tx: bundle.attestation.transaction_hash, account: bundle.attestation.caller_account_id, network: 'mainnet', pinned: bundle.attestation.wasm_hash,
  score: { band: out.band, score: out.score, income_cap: String(out.income_cap), fingerprint: out.fingerprint, scorer_version: bundle.attestation.wasm_hash },
});
const copy = () => JSON.parse(JSON.stringify(bundle));
const run = (b: unknown = bundle, exitCode: number | null = 0): VerifyRun => ({ exitCode, bundle: b });

test('proven only with every check: real bundle, pinned 5175182a', () => {
  const r = interpretRun(run(), ctx());
  assert.equal(r.status, 'proven');
  if (r.status !== 'proven') return;
  assert.ok(r.scorer.startsWith('5175182a'));
  assert.match(r.intel, /Intel signature chain valid/);
  assert.equal(r.approvedOn, 'worker.outlayer.near');
  assert.equal(r.outputHash, bundle.attestation.output_hash);
  assert.match(r.command, new RegExp(`^outlayer-verify tx ${r.tx} `));
});

test('the testnet command names the testnet API', () => {
  const b = copy(); b.network = 'testnet';
  const r = interpretRun(run(b), { ...ctx(), network: 'testnet' });
  assert.ok(r.status === 'proven' && r.command.includes('--network testnet --api https://testnet-api.outlayer.ai'));
});

test('exit 0 is not enough: any layer that is not "pass" means not proven', () => {
  for (const layer of ['authenticity', 'identity', 'binding', 'input', 'output']) {
    for (const verdict of ['fail', 'unproven', undefined, 'PASS']) {
      const b = copy(); b.verification[layer].verdict = verdict;
      assert.equal(interpretRun(run(b), ctx()).status, 'failed', `${layer} ${verdict}`);
    }
  }
  const noLayers = copy(); delete noLayers.verification;
  assert.equal(interpretRun(run(noLayers), ctx()).status, 'failed');
});

test('someone else\'s or an outdated proof is not proven for this score', () => {
  const change = (f: (b: ReturnType<typeof copy>) => void) => { const b = copy(); f(b); return interpretRun(run(b), ctx()); };
  assert.match(JSON.stringify(change((b) => { b.measurements_approved = false; })), /approved list/);
  assert.match(JSON.stringify(change((b) => { b.attestation.transaction_hash = 'other'; })), /different transaction/);
  assert.match(JSON.stringify(change((b) => { b.network = 'testnet'; })), /different transaction/);
  assert.match(JSON.stringify(change((b) => { b.attestation.caller_account_id = 'other.near'; })), /different account/);
  assert.match(JSON.stringify(change((b) => { b.attestation.wasm_hash = '6888c15e'.padEnd(64, '0'); })), /6888c15e/);
  for (const field of ['band', 'score', 'income_cap', 'fingerprint', 'caller']) {
    const r = change((b) => { const o = JSON.parse(b.output_raw); o[field] = 'Z'; b.output_raw = JSON.stringify(o); });
    assert.equal(r.status, 'failed', field);
  }
  // A re-pin since the score, or a score from another build: not "the build this contract pins".
  assert.equal(interpretRun(run(), { ...ctx(), pinned: 'f'.repeat(64) }).status, 'failed');
  assert.equal(interpretRun(run(), { ...ctx(), score: { ...ctx().score, scorer_version: 'f'.repeat(64) } }).status, 'failed');
});

test('a verifier failure says which layer and is not called temporary', () => {
  const b = copy(); b.verification.authenticity.verdict = 'fail';
  const r = interpretRun(run(b, 1), ctx());
  assert.ok(r.status === 'failed' && /Intel/.test(r.reason));
  assert.equal(interpretRun(run(undefined, 1), ctx()).status, 'failed');
});

test('anything unfinished is "unavailable", never a verdict', () => {
  const cases: VerifyRun[] = [
    { exitCode: 2, bundle }, { exitCode: 2 }, { exitCode: null }, { exitCode: null, timedOut: true, bundle }, { exitCode: null, busy: true },
    { exitCode: 0 }, { exitCode: 0, bundle: 'nonsense' }, { exitCode: 127, bundle },
  ];
  for (const c of cases) assert.equal(interpretRun(c, ctx()).status, 'unavailable', JSON.stringify({ ...c, bundle: !!c.bundle }));
  const garbled = copy(); garbled.output_raw = '{not json';
  assert.equal(interpretRun(run(garbled), ctx()).status, 'unavailable');
});

test('the browser never shows success for an answer it does not fully recognise', () => {
  const good = interpretRun(run(), ctx());
  assert.equal(resultFromResponse(true, good).status, 'proven');
  assert.equal(resultFromResponse(false, good).status, 'unavailable');
  assert.equal(resultFromResponse(true, { status: 'proven' }).status, 'unavailable');
  assert.equal(resultFromResponse(true, { ...good, scorer: '' }).status, 'unavailable');
  assert.equal(resultFromResponse(true, null).status, 'unavailable');
  assert.equal(resultFromResponse(true, { status: 'PROVEN' }).status, 'unavailable');
  assert.match(JSON.stringify(resultFromResponse(false, { error: 'Thirty checks per hour' })), /Thirty/);
  assert.deepEqual(resultFromResponse(true, { status: 'failed', reason: 'x' }), { status: 'failed', reason: 'x' });
});
