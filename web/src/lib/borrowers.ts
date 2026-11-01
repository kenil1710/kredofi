// Test borrowers (SPEC 6 demo table), ported from scripts/gen_borrowers.py.
// Each NEAR account gets its own sandbox identity ("Riya Good 3f9a"): the fingerprint rule allows
// one bank identity per borrower, so a shared "Riya Good" would let only the first judge borrow.
// Plaid sign: negative amount = money in.

export type BorrowerKey = 'riya' | 'sam' | 'max';

export const BORROWERS: Record<BorrowerKey, { name: string; story: string; expect: string; balance: number }> = {
  riya: { name: 'Riya Good', story: '$4,000 salary on the 1st of every month. No overdraft fees. Saves about half.', expect: 'Expect band A and a $100 first loan. She repays.', balance: 6000 },
  sam: { name: 'Sam Risky', story: 'Gig income that jumps around. Two months with nothing. Four overdraft or returned-payment fees.', expect: 'Expect no loan, with the reasons and what would change them.', balance: 3000 },
  max: { name: 'Max Cheater', story: '$3,800 salary. Looks perfect on paper. He borrows and never pays back.', expect: 'Expect band A, then a default: the reserve pays and his name is released.', balance: 5000 },
};

type Tx = { date_transacted: string; date_posted: string; currency: 'USD'; amount: number; description: string };

/** First day of each of the 6 months before `now`'s month (UTC), oldest first. */
export function monthsBack(now: Date): Date[] {
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6 + i, 1)));
}

function tx(m: Date, dayOffset: number, amount: number, description: string): Tx {
  const d = new Date(m.getTime() + dayOffset * 86_400_000).toISOString().slice(0, 10);
  return { date_transacted: d, date_posted: d, currency: 'USD', amount, description };
}

const MONTHLY: Record<BorrowerKey, (i: number, m: Date) => Tx[]> = {
  riya: (_i, m) => [tx(m, 0, -4000, 'ACME CORP PAYROLL'), tx(m, 2, 1200, 'RENT PAYMENT'), tx(m, 8, 320, 'GROCERY MART'), tx(m, 12, 90, 'CITY UTILITIES'), tx(m, 20, 150, 'RESTAURANT')],
  sam: (i, m) => {
    const pay = [1500, 0, 3200, 800, 0, 2500][i];
    const out = [tx(m, 3, 1100, 'RENT PAYMENT'), tx(m, 9, 260, 'GROCERY MART')];
    if (pay) out.push(tx(m, 5, -pay, 'GIG PLATFORM PAYOUT'));
    if (i === 1 || i === 4) out.push(tx(m, 15, 35, 'OVERDRAFT FEE'), tx(m, 16, 35, 'NSF RETURNED ITEM FEE'));
    return out;
  },
  max: (_i, m) => [tx(m, 0, -3800, 'GLOBEX PAYROLL'), tx(m, 2, 1150, 'RENT PAYMENT'), tx(m, 9, 300, 'GROCERY MART'), tx(m, 14, 120, 'ONLINE SHOPPING')],
};

/** Plaid sandbox custom-user profile for `who`, with an identity name unique to `tag`. */
export function profileFor(who: BorrowerKey, tag: string, now = new Date()) {
  const b = BORROWERS[who];
  const name = `${b.name} ${tag}`;
  return {
    seed: name,
    roll_dates_forward: true,
    override_accounts: [{
      type: 'depository', subtype: 'checking', starting_balance: b.balance,
      identity: { names: [name] },
      transactions: monthsBack(now).flatMap((m, i) => MONTHLY[who](i, m)),
    }],
  };
}

// ---------------------------------------------------------------- build your own borrower (SPEC 8b)

export type CustomInputs = { salary: number; months: number; spending: number; fees: number; balance: number };
export const CUSTOM_LIMITS: Record<keyof CustomInputs, [number, number]> = {
  salary: [0, 8000], months: [0, 6], spending: [0, 8000], fees: [0, 6], balance: [0, 30000],
};

/** null if the inputs are in range (SPEC 8b), else what to fix. Checked in the browser and again here. */
export function checkCustom(x: unknown): string | null {
  const c = x as Partial<CustomInputs>;
  for (const [k, [lo, hi]] of Object.entries(CUSTOM_LIMITS) as [keyof CustomInputs, [number, number]][]) {
    const v = c?.[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return `${k} must be a whole number from ${lo} to ${hi}.`;
  }
  if ((c.salary === 0 || c.months === 0) && c.spending === 0 && c.fees === 0) return 'Give the borrower some income or some spending.';
  return null;
}

/** Plaid custom-user profile from the five inputs: salary in the most recent `months` months, one
 * spending payment every month, `fees` overdraft fees ($35) in the earliest months. */
export function customProfile(c: CustomInputs, tag: string, now = new Date()) {
  const name = `Test Borrower ${tag}`;
  const transactions = monthsBack(now).flatMap((m, i) => {
    const out: Tx[] = [];
    if (c.salary > 0 && i >= 6 - c.months) out.push(tx(m, 0, -c.salary, 'EMPLOYER PAYROLL'));
    if (c.spending > 0) out.push(tx(m, 3, c.spending, 'MONTHLY SPENDING'));
    if (i < c.fees) out.push(tx(m, 15, 35, 'OVERDRAFT FEE'));
    return out;
  });
  return {
    seed: name,
    roll_dates_forward: true,
    override_accounts: [{ type: 'depository', subtype: 'checking', starting_balance: c.balance, identity: { names: [name] }, transactions }],
  };
}
