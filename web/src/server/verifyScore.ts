// Runs OutLayer's open-source verifier (built into the Space image, commit-pinned: deploy/hf/Dockerfile) on one
// transaction. No shell, and the child gets none of the server's secrets. A missing binary or a timeout simply means
// "can't verify right now". The turbopackIgnore comments keep the build's file tracing from copying the
// whole source tree into the standalone server (dynamic paths look like they could read any file). Only the fields the page needs are kept: the bundle also holds the sealed bank token.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyRun } from '../lib/verifyScore.ts';

const API = { mainnet: 'https://api.outlayer.ai', testnet: 'https://testnet-api.outlayer.ai' };
const MAX_RUNNING = 2, CACHE_MS = 3_600_000, CACHE_MAX = 500;
let running = 0;
const passed = new Map<string, { at: number; run: VerifyRun }>();

function keepPublicFields(raw: Record<string, unknown>) {
  const { network, measurements_approved, register_contract, output_raw, attestation, verification } = raw;
  const a = (attestation ?? {}) as Record<string, unknown>;
  return {
    network, measurements_approved, register_contract, output_raw, verification,
    attestation: { task_id: a.task_id, transaction_hash: a.transaction_hash, caller_account_id: a.caller_account_id, wasm_hash: a.wasm_hash, input_hash: a.input_hash, output_hash: a.output_hash },
  };
}

export async function runVerifier(tx: string, network: 'testnet' | 'mainnet', opts: { bin?: string; timeoutMs?: number; now?: number } = {}): Promise<VerifyRun> {
  const now = opts.now ?? Date.now();
  const hit = passed.get(tx);
  if (hit && now - hit.at < CACHE_MS) return hit.run;
  if (running >= MAX_RUNNING) return { exitCode: null, busy: true };
  running++;
  let dir = '';
  try {
    dir = await mkdtemp(/* turbopackIgnore: true */ join(tmpdir(), 'kf-verify-'));
    const file = join(/* turbopackIgnore: true */ dir, 'bundle.json');
    const args = ['tx', tx, '--network', network, '--api', API[network], '--json', '--no-color', '--bundle', file];
    const bin = opts.bin ?? process.env.OUTLAYER_VERIFY ?? 'outlayer-verify';
    const result = await new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
      execFile(/* turbopackIgnore: true */ bin, args, { timeout: opts.timeoutMs ?? 45_000, killSignal: 'SIGKILL', maxBuffer: 4_000_000, env: { PATH: process.env.PATH ?? '', HOME: dir, NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv }, (err: Error | null) => {
        if (!err) return resolve({ exitCode: 0, timedOut: false });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        resolve({ exitCode: typeof e.code === 'number' ? e.code : null, timedOut: !!e.killed });
      });
    });
    const raw = await readFile(/* turbopackIgnore: true */ file, 'utf8').then((s) => JSON.parse(s) as Record<string, unknown>).catch(() => null);
    const run: VerifyRun = { ...result, bundle: raw ? keepPublicFields(raw) : undefined };
    if (run.exitCode === 0 && raw) {
      if (passed.size >= CACHE_MAX) passed.delete(passed.keys().next().value as string);
      passed.set(tx, { at: now, run }); // the on-chain comparison still runs on every request
    }
    return run;
  } catch {
    return { exitCode: null }; // e.g. no temp folder: "can't verify right now"
  } finally {
    running--; // always released, also when the temp folder could not be made
    if (dir) await rm(/* turbopackIgnore: true */ dir, { recursive: true, force: true }).catch(() => {});
  }
}
