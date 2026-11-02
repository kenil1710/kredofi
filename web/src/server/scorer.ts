import 'server-only';
// Dev-mode scorer (SPEC 2), same rules as scripts/dev_scorer.mjs: run the pinned scorer WASM with
// wasmtime (keys passed by env var NAME, never on the command line) and refuse to submit unless
// the local WASM's SHA-256 equals the contract's scorer_version.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { viewPool } from './near';

// Paths come from env at runtime; turbopackIgnore stops Next from tracing the whole project.
const wasmPath = () => /* turbopackIgnore: true */ process.env.SCORER_WASM ?? '';
const outDir = () => /* turbopackIgnore: true */ process.env.SCORER_OUT_DIR ?? '';

let pinnedCache: { at: number; version: string } | null = null;
export async function checkPinned(): Promise<string> {
  const local = createHash('sha256').update(await readFile(/* turbopackIgnore: true */ wasmPath())).digest('hex');
  // The pinned version changes only by an owner transaction; re-read it at most every 30 s.
  if (!pinnedCache || Date.now() - pinnedCache.at > 30_000) {
    const { scorer_version } = await viewPool<{ scorer_version: string }>('get_config');
    pinnedCache = { at: Date.now(), version: scorer_version };
  }
  if (local !== pinnedCache.version) { pinnedCache = null; throw new Error('The local scorer is not the pinned version; scoring is paused.'); }
  void precompile(local);
  return local;
}

// wasmtime compiles the WASM to native code on every run unless given a precompiled .cwasm. Compile
// once per scorer version (keyed by its SHA-256) and run that; fall back to the .wasm until it exists.
let compiled: { hash: string; path: string } | null = null;
let compiling: Promise<void> | null = null;
function precompile(hash: string): Promise<void> {
  if (compiled?.hash === hash || compiling) return compiling ?? Promise.resolve();
  const dir = outDir() || tmpdir();
  const path = join(/* turbopackIgnore: true */ dir, `scorer-${hash.slice(0, 16)}.cwasm`);
  compiling = (async () => {
    try {
      await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
      await new Promise<void>((res, rej) => {
        const p = spawn('wasmtime', ['compile', wasmPath(), '-o', `${path}.tmp`], { timeout: 60_000 });
        p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`compile exit ${c}`))));
      });
      await rename(/* turbopackIgnore: true */ `${path}.tmp`, path);
      compiled = { hash, path };
    } catch (e) { console.error(`scorer precompile failed, running the .wasm: ${e instanceof Error ? e.message : e}`); }
    finally { compiling = null; }
  })();
  return compiling;
}

type Out = Record<string, unknown>;
/**
 * Run the scorer. `first` resolves with the first JSON line it prints (demo builds print the on-chain
 * output as soon as the score exists, before removing the bank connection and asking for the AI
 * summary), `done` with the last line when it exits. Rejects on a scorer error.
 */
export function startScorer(input: object, sender?: string, onExtra?: (sealed: string) => void): { first: Promise<Out>; done: Promise<Out> } {
  for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'SEAL_KEY']) if (!process.env[k]) throw new Error(`${k} not configured`);
  const args = ['run', '-S', 'http', '--env', 'PLAID_CLIENT_ID', '--env', 'PLAID_SECRET', '--env', 'SEAL_KEY'];
  // The AI summary is no longer made inside the scoring run (it could delay the score): the browser
  // asks /api/summary for it after the score shows. So NEARAI_KEY is not passed to the scorer.
  if (sender) args.push('--env', `NEAR_SENDER_ID=${sender}`);
  args.push(...(compiled ? ['--allow-precompiled', compiled.path] : [wasmPath()]));
  let resolveFirst!: (v: Out) => void, rejectFirst!: (e: Error) => void;
  const first = new Promise<Out>((res, rej) => { resolveFirst = res; rejectFirst = rej; });
  const done = new Promise<Out>((resolve, reject) => {
    const p = spawn('wasmtime', args, { env: process.env, timeout: 60_000 });
    let buf = '', err = '', last: Out | null = null, gotFirst = false, stopTimer: ReturnType<typeof setTimeout> | null = null;
    const take = (line: string) => {
      if (!line.trim()) return;
      try {
        const v = JSON.parse(line) as Out;
        last = v;
        // Demo builds print the sealed receipt before the AI call (which has no response timeout):
        // keep every sealed extra as it arrives, and stop the run 15 s after the receipt. The bank
        // connection is already removed by then.
        if (typeof v.extra === 'string') {
          onExtra?.(v.extra);
          if (!('band' in v) && !stopTimer) stopTimer = setTimeout(() => p.kill(), 15_000);
        }
        if (!gotFirst) { gotFirst = true; if (v.success === false) rejectFirst(new Error(String(v.error))); else resolveFirst(v); }
      } catch { /* not a JSON line */ }
    };
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => { const e = new Error('The scorer could not start.'); rejectFirst(e); reject(e); });
    p.on('close', () => {
      if (stopTimer) clearTimeout(stopTimer);
      take(buf);
      const v = last as Out | null;
      if (!v) {
        // Server log only (wasmtime's own error text; never sent to the browser).
        console.error(`scorer produced no JSON (exit ${p.exitCode}): ${err.slice(0, 500)}`);
        const e = new Error('The scorer returned no result.'); rejectFirst(e); reject(e); return;
      }
      if (v.success === false) reject(new Error(String(v.error))); else resolve(v);
    });
    p.stdin.end(JSON.stringify(input));
  });
  first.catch(() => {}); done.catch(() => {});
  return { first, done };
}

/** Run to the end and return the last line (release steps print one line). */
export function runScorer(input: object, sender?: string): Promise<Out> {
  return startScorer(input, sender).done;
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
