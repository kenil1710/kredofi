import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerifier } from './verifyScore.ts';

const dir = mkdtempSync(join(tmpdir(), 'kf-fake-verifier-'));
const fake = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n# the --bundle argument is the last one\nfor a; do last=$a; done\n${body}\n`); chmodSync(p, 0o755);
  return p;
};
const BUNDLE = `{"network":"testnet","measurements_approved":true,"register_contract":"w","output_raw":"{}","input_raw":"sealed-token","collateral":"big","verification":{},"attestation":{"task_id":1,"transaction_hash":"t","tdx_quote":"q"}}`;

test('a passing run returns exit 0 and only the public fields of the bundle', async () => {
  const r = await runVerifier('tx-pass', 'testnet', { bin: fake('ok', `echo '${BUNDLE}' > "$last"`) });
  assert.equal(r.exitCode, 0);
  const b = r.bundle as Record<string, unknown>;
  assert.equal(b.network, 'testnet');
  const text = JSON.stringify(b);
  for (const hidden of ['input_raw', 'sealed-token', 'collateral', 'tdx_quote']) assert.ok(!text.includes(hidden), hidden);
});

test('a pass is cached by transaction; a later request does not re-run it', async () => {
  const count = join(dir, 'runs.txt');
  const bin = fake('count', `echo x >> ${count}\necho '${BUNDLE}' > "$last"`);
  await runVerifier('tx-cache', 'testnet', { bin, now: 1000 });
  await runVerifier('tx-cache', 'testnet', { bin, now: 2000 });
  assert.equal(readFileSync(count, 'utf8').trim().split('\n').length, 1);
  await runVerifier('tx-cache', 'testnet', { bin, now: 1000 + 3_600_001 });
  assert.equal(readFileSync(count, 'utf8').trim().split('\n').length, 2);
});

test('exit codes come through and failures are not cached', async () => {
  const bin = fake('unproven', 'exit 2');
  assert.equal((await runVerifier('tx-2', 'testnet', { bin })).exitCode, 2);
  assert.equal((await runVerifier('tx-1', 'testnet', { bin: fake('bad', 'exit 1') })).exitCode, 1);
  assert.equal((await runVerifier('tx-1', 'testnet', { bin: fake('ok2', `echo '${BUNDLE}' > "$last"`) })).exitCode, 0);
});

test('a missing binary or a hang is "no result", not a verdict', async () => {
  assert.equal((await runVerifier('tx-none', 'testnet', { bin: join(dir, 'does-not-exist') })).exitCode, null);
  const hung = await runVerifier('tx-hang', 'testnet', { bin: fake('hang', 'exec sleep 20'), timeoutMs: 150 });
  assert.equal(hung.exitCode, null);
  assert.equal(hung.timedOut, true);
});

test('at most two run at once; the third is told to wait', async () => {
  const bin = fake('slow', 'exec sleep 1');
  const a = runVerifier('b1', 'testnet', { bin, timeoutMs: 400 }), b = runVerifier('b2', 'testnet', { bin, timeoutMs: 400 });
  assert.equal((await runVerifier('b3', 'testnet', { bin })).busy, true);
  await Promise.all([a, b]);
});

test('the child gets the arguments without a shell and none of the server secrets', async () => {
  process.env.SEAL_KEY = 'secret-seal'; process.env.RELAYER_KEY = 'secret-relayer'; process.env.PLAID_SECRET = 'secret-plaid';
  const seen = join(dir, 'seen');
  const tricky = 'x; touch ' + join(dir, 'pwned');
  await runVerifier(tricky, 'testnet', { bin: fake('env', `env > ${seen}\nprintf '%s\\n' "$@" >> ${seen}`) });
  const text = readFileSync(seen, 'utf8');
  assert.ok(!text.includes('secret-'), 'secrets reached the child');
  assert.ok(text.includes('--network\ntestnet\n--api\nhttps://testnet-api.outlayer.ai'));
  assert.throws(() => readFileSync(join(dir, 'pwned')));
});

test('a failure before the run starts never leaks a slot (audit Nov 7, F3)', async () => {
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = join(dir, 'no-such-folder', 'x');
  try {
    for (let i = 0; i < 3; i++) {
      const r = await runVerifier(`tmp-fail-${i}`, 'testnet', { bin: fake('never', 'exit 0') });
      assert.equal(r.exitCode, null);
      assert.notEqual(r.busy, true, 'slots leaked');
    }
  } finally { process.env.TMPDIR = saved; }
  assert.equal((await runVerifier('tmp-ok', 'testnet', { bin: fake('ok3', `echo '${BUNDLE}' > "$last"`) })).exitCode, 0);
});
