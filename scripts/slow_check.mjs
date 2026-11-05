// Health watch: fails when a page takes too long, measured to the last byte through kredofi.xyz.
//   node scripts/slow_check.mjs
// SLOW_LIMIT_S (default 10), SLOW_ROUNDS (3), SLOW_GAP_S (20). Hangs are rare, so one read of each page would miss most.
import { pathToFileURL } from 'node:url';

export const PAGES = ['/', '/borrow', '/trust'];

export async function timePage(url, { fetchImpl = fetch, now = Date.now, capMs = 45000 } = {}) {
  const t0 = now();
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(capMs), headers: { 'user-agent': 'kredofi-health-watch', 'cache-control': 'no-cache' } });
    await r.text();
    return { status: r.status, ms: now() - t0, attempts: r.headers.get('x-kredofi-attempts') };
  } catch (e) {
    return { status: 0, ms: now() - t0, attempts: null, error: e?.name ?? 'error' };
  }
}

/** Every reason this sample should turn the watch red. */
export function problems(path, s, limitS) {
  const out = [];
  if (s.status !== 200) out.push(`${path}: status ${s.status}${s.error ? ` (${s.error})` : ''} after ${(s.ms / 1000).toFixed(1)} s`);
  if (s.ms > limitS * 1000) out.push(`${path}: ${(s.ms / 1000).toFixed(1)} s, limit ${limitS} s (Worker attempts: ${s.attempts ?? 'unknown'})`);
  return out;
}

export async function run({ base = 'https://kredofi.xyz', limitS = 10, rounds = 3, gapS = 20, time = timePage, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)), print = console.log } = {}) {
  const bad = [];
  for (let i = 0; i < rounds; i++) {
    if (i) await sleep(gapS);
    for (const path of PAGES) {
      const s = await time(base + path);
      print(`round ${i + 1} ${path} ${s.status} ${(s.ms / 1000).toFixed(2)} s attempts=${s.attempts ?? '-'}`);
      bad.push(...problems(path, s, limitS));
    }
  }
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const num = (name, d) => { const v = Number(process.env[name]); return process.env[name] && Number.isFinite(v) ? v : d; };
  const bad = await run({ limitS: num('SLOW_LIMIT_S', 10), rounds: num('SLOW_ROUNDS', 3), gapS: num('SLOW_GAP_S', 20) });
  for (const b of bad) console.log(`::error::slow page ${b}`);
  if (bad.length) process.exit(1);
  console.log('all pages within the limit');
}
