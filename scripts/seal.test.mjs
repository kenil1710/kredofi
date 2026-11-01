// node --test scripts/seal.test.mjs : the JS seal scheme matches the Rust scorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { keypair, openSealed, sealTo } from './lib/seal.mjs';

test('round trip, wrong key fails, tamper fails', () => {
  const a = keypair(), b = keypair();
  const s = sealTo(a.public, 'Alberta Bobbeth Charleson');
  assert.equal(Buffer.from(s, 'base64').length, 32 + 25 + 16);
  assert.equal(openSealed(a.secret, s), 'Alberta Bobbeth Charleson');
  assert.throws(() => openSealed(b.secret, s));
  const raw = Buffer.from(s, 'base64'); raw[40] ^= 1;
  assert.throws(() => openSealed(a.secret, raw.toString('base64')));
});

const ROOT = new URL('..', import.meta.url).pathname;
const releaseFile = `${ROOT}scorer/out/max_release.json`;

test('Rust -> JS: open the partner release made by the production scorer wasm', (t) => {
  if (!existsSync(releaseFile) || !process.env.PARTNER_PRIVKEY) return t.skip('needs scorer/out/max_release.json and PARTNER_PRIVKEY');
  const { released } = JSON.parse(readFileSync(releaseFile, 'utf8'));
  assert.equal(openSealed(process.env.PARTNER_PRIVKEY, released), 'Max Cheater');
});

test('JS -> Rust: the scorer crate opens what JS sealed', () => {
  const kp = keypair();
  const sealed = sealTo(kp.public, 'Riya Good');
  const r = spawnSync('cargo', ['run', '-q', '--example', 'open_sealed', '--', 'JS_TEST_SECRET'], {
    cwd: `${ROOT}scorer`, input: sealed, encoding: 'utf8', env: { ...process.env, JS_TEST_SECRET: kp.secret },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'Riya Good');
});
