// Limit levels (SPEC 4, rule 13), mirrored from contracts/kredofi/src/{score,loans}.rs so the passbook
// can say when a repayment raises the limit. Display only: the contract decides. Pure, unit-tested.

const USDC = 1_000_000n;
export const LEVEL_CAP = [100n * USDC, 250n * USDC, 500n * USDC, 1_000n * USDC];
export const MAX_LEVEL = 4;
const PCT_BPS: Record<string, bigint> = { A: 10_000n, B: 7_500n, C: 5_000n, D: 0n };

/** min(LEVEL_CAP[level] x BAND_PCT[band], income_cap), level 1..4. */
export function limitAt(level: number, band: string, incomeCap: bigint): bigint {
  const l = Math.min(Math.max(level, 1), MAX_LEVEL);
  const cap = (LEVEL_CAP[l - 1] * (PCT_BPS[band] ?? 0n)) / 10_000n;
  return cap < incomeCap ? cap : incomeCap;
}

export type LevelPlan =
  | { kind: 'max' }                                   // already at the top level
  | { kind: 'capped'; limit: bigint }                 // income caps the next level at the current limit
  | { kind: 'small'; half: bigint }                   // loan under half the limit at borrow
  | { kind: 'wait'; atMs: number; next: bigint; why: 'hold' | 'recent' }  // repay after atMs to level up
  | { kind: 'ready'; next: bigint };                  // repaying now levels up

export function levelPlan(p: {
  level: number; band: string; incomeCap: bigint; principal: bigint; limitAtBorrow: bigint;
  issuedMs: number; minHoldMs: number; lastLevelUpMs: number; termMs: number; nowMs: number;
}): LevelPlan {
  if (p.level >= MAX_LEVEL) return { kind: 'max' };
  const next = limitAt(p.level + 1, p.band, p.incomeCap);
  if (next <= limitAt(p.level, p.band, p.incomeCap)) return { kind: 'capped', limit: next };
  if (p.principal * 2n < p.limitAtBorrow) return { kind: 'small', half: (p.limitAtBorrow + 1n) / 2n };
  const holdEnd = p.issuedMs + p.minHoldMs;
  const recentEnd = p.lastLevelUpMs > 0 ? p.lastLevelUpMs + p.termMs : 0;
  const at = Math.max(holdEnd, recentEnd);
  if (p.nowMs < at) return { kind: 'wait', atMs: at, next, why: recentEnd > holdEnd ? 'recent' : 'hold' };
  return { kind: 'ready', next };
}

/** Why a repaid loan did not raise the limit, from what the contract checked (rule 13). */
export function noLevelUpReason(p: {
  levelBefore: number; principal: bigint; limitAtBorrow: bigint | null; heldMs: number; minHoldMs: number;
}): string {
  const mins = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 1000)} s`);
  if (p.levelBefore >= MAX_LEVEL) return 'You are already at the top level.';
  if (p.limitAtBorrow !== null && p.principal * 2n < p.limitAtBorrow) return 'The loan was under half your limit; only loans of at least half the limit raise it.';
  if (p.heldMs < p.minHoldMs) return `You repaid after ${mins(p.heldMs)}; the loan has to be held at least ${mins(p.minHoldMs)} (half the term) to raise your limit.`;
  return 'Your limit rose less than one loan term ago; it can rise once per term.';
}

/** 0:42 style countdown. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
