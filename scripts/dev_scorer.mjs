// Dev-mode scorer (SPEC 2): runs the scorer WASM locally with wasmtime and submits the output
// to the contract as `dev_submit_score` / `dev_submit_release`, signed by scorer.kency.testnet.
//
//   set -a; source .env; set +a      # PLAID_CLIENT_ID, PLAID_SECRET, SEAL_KEY (never printed)
//   node scripts/dev_scorer.mjs score <borrower> <input.json> [reply_pubkey_hex]
//   node scripts/dev_scorer.mjs release <borrower>
//
// Integrity: refuses to run unless the local WASM's SHA-256 equals the contract's pinned
// scorer_version, so Dev mode also only accepts output from the pinned build.
// Keys go to wasmtime by env var NAME only, never on the command line.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, POOL, SCORER, account, call, view, EXPLORER } from './lib/near.mjs';

export const WASM = process.env.SCORER_WASM || join(ROOT, 'scorer', 'out', 'kredofi_scorer_demo.wasm');
// Submitted outputs (needed later for the release step; sealed_identity is never returned by a view).
const SUBMITTED = join(ROOT, 'scorer', 'out', 'submitted');

export function wasmHash() {
  return createHash('sha256').update(readFileSync(WASM)).digest('hex');
}

export async function checkPinned() {
  const pinned = (await view(POOL, 'get_config')).scorer_version;
  const local = wasmHash();
  if (pinned !== local) {
    throw new Error(`local scorer ${local.slice(0, 12)}… is not the pinned version ${pinned.slice(0, 12)}…; refusing to submit`);
  }
  return local;
}

function runWasm(input, sender) {
  for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'SEAL_KEY']) {
    if (!process.env[k]) throw new Error(`${k} not set (run: set -a; source .env; set +a)`);
  }
  const envArgs = ['--env', 'PLAID_CLIENT_ID', '--env', 'PLAID_SECRET', '--env', 'SEAL_KEY'];
  if (sender) envArgs.push('--env', `NEAR_SENDER_ID=${sender}`);
  const r = spawnSync('wasmtime', ['run', '-S', 'http', ...envArgs, WASM], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`wasmtime failed: ${(r.stderr || '').slice(0, 300)}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  if (out.success === false) throw new Error(`scorer error: ${out.error}`);
  return out;
}

/** Score `borrower` from a scorer input file and submit it. Returns { output, result }. */
export async function score(borrower, inputFile, replyPubkey) {
  await checkPinned();
  const input = JSON.parse(readFileSync(inputFile, 'utf8'));
  if (replyPubkey) input.reply_pubkey = replyPubkey;
  const t0 = Date.now();
  const output = runWasm(input, borrower); // NEAR_SENDER_ID = borrower, as on OutLayer
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const result = await call(account(SCORER), POOL, 'dev_submit_score', { borrower, output }, { gas: 30n });
  if (result.ok) {
    mkdirSync(SUBMITTED, { recursive: true });
    writeFileSync(join(SUBMITTED, `${borrower}.json`), JSON.stringify(output));
  }
  return { output, result, secs };
}

/** Release step: re-seal the borrower's name to the partner key and submit it. */
export async function release(borrower) {
  await checkPinned();
  const file = join(SUBMITTED, `${borrower}.json`);
  if (!existsSync(file)) throw new Error(`no submitted score for ${borrower} in ${file}`);
  const { sealed_identity } = JSON.parse(readFileSync(file, 'utf8'));
  const { partner_pubkey } = await view(POOL, 'get_config');
  const output = runWasm({ op: 'release', sealed: sealed_identity, partner_pubkey });
  const result = await call(account(SCORER), POOL, 'dev_submit_release', { borrower, output }, { gas: 30n });
  return { output, result };
}

// ---------------------------------------------------------------- CLI
const [, script, cmd, borrower, file, reply] = process.argv;
if (script.endsWith('dev_scorer.mjs') && cmd) {
  try {
    if (cmd === 'score' && borrower && file) {
      const { output, result, secs } = await score(borrower, file, reply);
      console.log(`scored ${borrower} in ${secs}s: band ${output.band}, score ${output.score}`);
      console.log(result.ok ? `submitted: ${EXPLORER}${result.hash}` : `rejected by contract: ${result.error}`);
      process.exit(result.ok ? 0 : 1);
    } else if (cmd === 'release' && borrower) {
      const { result } = await release(borrower);
      console.log(result.ok ? `released: ${EXPLORER}${result.hash}` : `rejected by contract: ${result.error}`);
      process.exit(result.ok ? 0 : 1);
    } else {
      console.error('usage: dev_scorer.mjs score <borrower> <input.json> [reply_pubkey] | release <borrower>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
