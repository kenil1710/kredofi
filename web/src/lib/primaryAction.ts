// The borrower's one current primary action, shown in the phone sticky bar (DESIGN 7.8).
// Pure: unit-tested in primaryAction.test.ts.

export type PrimaryKey = 'start' | 'retry' | 'borrow' | 'repay' | 'default' | 'release';

export type PassbookState = {
  /** A score is being computed (no button to press until it ends). */
  scoringBusy: boolean;
  scoringFailed: boolean;
  /** The "pick a test borrower" cards are on screen. */
  picking: boolean;
  /** The Borrow entry is on screen (valid score, no loan, limit > 0). */
  canBorrow: boolean;
  loanActive: boolean;
  /** Past due date plus grace: anyone may mark the loan as defaulted. */
  canDefault: boolean;
  /** The demo borrower who never repays. */
  isMax: boolean;
  /** Defaulted and the name not yet released to the recovery partner. */
  releasePending: boolean;
};

export function primaryAction(s: PassbookState): PrimaryKey | null {
  if (s.scoringBusy) return null;
  if (s.scoringFailed) return 'retry';
  if (s.picking) return 'start';
  if (s.releasePending) return 'release';
  if (s.loanActive) return s.canDefault && s.isMax ? 'default' : 'repay';
  if (s.canBorrow) return 'borrow';
  return null;
}
