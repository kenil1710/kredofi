// The test-bank steps around Plaid Link (testnet demo). Link can't open straight to the sandbox bank:
// /link/token/create has no institution field that skips the picker (institution_data only highlights a bank), and
// Link lists real banks first. Picking one of those (Chase, Bank of America, ...) still works in Plaid's sandbox and
// scores the same (checked Nov 7 in the testnet enclave), but goes through about six extra test screens of a mock
// OAuth window. Pure, unit-tested.

export const PLATYPUS_ID = 'ins_109508';
export const PLATYPUS_STEPS = ['Type Platypus', 'Pick First Platypus Bank (not OAuth)', 'user_good / pass_good'] as const;
export const OTHER_BANK_NOTE = 'also works in this test sandbox, but adds a few test screens: sign in with user_good / pass_good and use code 1234. Quicker: go back and pick First Platypus Bank.';

type Hint = { other: string | null } | null;
type Meta = { institution_id?: string | null; institution_name?: string | null };

/** Next state of the steps box after a Plaid Link event: a note after another bank, hidden once the sandbox bank is picked. */
export function plaidHintAfter(cur: Hint, event: string, meta: Meta): Hint {
  if (cur === null) return null; // Link is closed
  if (event === 'SELECT_INSTITUTION') {
    return meta.institution_id === PLATYPUS_ID ? null : { other: meta.institution_name || 'That bank' };
  }
  return cur;
}
