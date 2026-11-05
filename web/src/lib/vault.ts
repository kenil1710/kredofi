// The partner vault's terms (SPEC 8e), the same table as contracts/partner-vault terms_for/credit_for.
// Pure and unit-tested (vault.test.ts); the on-chain position is always what the page finally shows.
import type { BorrowerView } from './chain';

export type VaultBasis = 'A' | 'B' | 'C' | 'D' | 'no_score' | 'expired' | 'blocked';
export type VaultPosition = { collateral: string; credit: string; ratio_bps: number; basis: VaultBasis; opened_at: string; closing: boolean };

export const STANDARD_RATIO_BPS = 15_000;
export const MIN_COLLATERAL = 1_000_000n; // $1

export const RATIO_BPS: Record<VaultBasis, number> = {
  A: 11_000, B: 12_500, C: 14_000, D: STANDARD_RATIO_BPS, no_score: STANDARD_RATIO_BPS, expired: STANDARD_RATIO_BPS, blocked: STANDARD_RATIO_BPS,
};

/** Rows of the page's table: which KredoFi answers lead to which terms. */
export const TERM_ROWS: { label: string; bases: VaultBasis[]; ratioBps: number }[] = [
  { label: 'Band A', bases: ['A'], ratioBps: RATIO_BPS.A },
  { label: 'Band B', bases: ['B'], ratioBps: RATIO_BPS.B },
  { label: 'Band C', bases: ['C'], ratioBps: RATIO_BPS.C },
  { label: 'Band D, no score, expired or defaulted', bases: ['D', 'no_score', 'expired', 'blocked'], ratioBps: STANDARD_RATIO_BPS },
];

export function basisFor(b: BorrowerView | null | undefined): VaultBasis {
  if (!b) return 'no_score';
  if (b.blocked) return 'blocked';
  if (!b.score) return 'no_score';
  if (b.score.expired) return 'expired';
  return b.score.band;
}

export const basisText: Record<VaultBasis, string> = {
  A: 'Band A', B: 'Band B', C: 'Band C', D: 'Band D',
  no_score: 'No KredoFi score', expired: 'Score expired', blocked: 'Defaulted on KredoFi',
};

/** Collateral / ratio, rounded down. */
export const creditFor = (collateral: bigint, ratioBps: number) => (collateral * 10_000n) / BigInt(ratioBps);
/** Collateral needed for this much credit, rounded up. */
export const collateralFor = (credit: bigint, ratioBps: number) => (credit * BigInt(ratioBps) + 9_999n) / 10_000n;
export const ratioText = (ratioBps: number) => `${ratioBps / 100}%`;
