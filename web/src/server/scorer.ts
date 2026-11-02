import 'server-only';
// Dev-mode scorer (SPEC 2), same rules as scripts/dev_scorer.mjs: run the pinned scorer WASM with
// wasmtime (keys passed by env var NAME, never on the command line) and refuse to submit unless
// the local WASM's SHA-256 equals the contract's scorer_version.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { viewPool } from './near';

// Paths come from env at runtime; turbopackIgnore stops Next from tracing the whole project.
const wasmPath = () => /* turbopackIgnore: true */ process.env.SCORER_WASM ?? '';
const outDir = () => /* turbopackIgnore: true */ process.env.SCORER_OUT_DIR ?? '';

export async function checkPinned(): Promise<string> {
  const local = createHash('sha256').update(await readFile(/* turbopackIgnore: true */ wasmPath())).digest('hex');
  const { scorer_version } = await viewPool<{ scorer_version: string }>('get_config');
  if (local !== scorer_version) throw new Error('The local scorer is not the pinned version; scoring is paused.');
  return local;
}

export function runScorer(input: object, sender?: string): Promise<Record<string, unknown>> {
  for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'SEAL_KEY']) if (!process.env[k]) throw new Error(`${k} not configured`);
  const args = ['run', '-S', 'http', '--env', 'PLAID_CLIENT_ID', '--env', 'PLAID_SECRET', '--env', 'SEAL_KEY'];
  // Optional, testnet demo build only: the sealed AI summary (SPEC 5 step 7). Passed by name.
  if (process.env.NEARAI_KEY) args.push('--env', 'NEARAI_KEY');
  if (sender) args.push('--env', `NEAR_SENDER_ID=${sender}`);
  args.push(wasmPath());
  return new Promise((resolve, reject) => {
    const p = spawn('wasmtime', args, { env: process.env, timeout: 60_000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => reject(new Error('The scorer could not start.')));
    p.on('close', () => {
      try {
        const v = JSON.parse(out.trim().split('\n').pop() ?? '');
        if (v.success === false) reject(new Error(String(v.error)));
        else resolve(v);
      } catch {
        // Server log only (wasmtime's own error text; never sent to the browser).
        console.error(`scorer produced no JSON (exit ${p.exitCode}): ${err.slice(0, 500)}`);
        reject(new Error('The scorer returned no result.'));
      }
    });
    p.stdin.end(JSON.stringify(input));
  });
}

/** Keep each submitted output: the release step needs sealed_identity, which no view returns. */
export async function saveSubmitted(borrower: string, output: object) {
  await mkdir(/* turbopackIgnore: true */ outDir(), { recursive: true });
  await writeFile(join(/* turbopackIgnore: true */ outDir(), `${borrower}.json`), JSON.stringify(output));
}
/** Testnet extras (sealed to the borrower; never on-chain), kept so a refresh can show them again. */
export async function saveExtra(borrower: string, extra: string) {
  await mkdir(/* turbopackIgnore: true */ outDir(), { recursive: true });
  await writeFile(join(/* turbopackIgnore: true */ outDir(), `${borrower}.extra.json`), JSON.stringify({ extra }));
}
export async function loadExtra(borrower: string): Promise<string | null> {
  try { return (JSON.parse(await readFile(join(/* turbopackIgnore: true */ outDir(), `${borrower}.extra.json`), 'utf8')) as { extra: string }).extra; } catch { return null; }
}
export async function loadSubmitted(borrower: string): Promise<{ sealed_identity: string } | null> {
  try { return JSON.parse(await readFile(join(/* turbopackIgnore: true */ outDir(), `${borrower}.json`), 'utf8')); } catch { return null; }
}
