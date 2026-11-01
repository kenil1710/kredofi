// Plain reasons from the five published rules (SPEC 6; DESIGN 7.6: "reasons come from the rules,
// not from AI"). Input is only the points the scorer sealed to the borrower; no bank data.

export type Parts = { income: number; stability: number; payment: number; cash_flow: number; buffer: number };
export const PART_KEYS: (keyof Parts)[] = ['income', 'stability', 'payment', 'cash_flow', 'buffer'];
export const PART_NAMES: Record<keyof Parts, string> = {
  income: 'Income level', stability: 'Steady income', payment: 'On-time payments', cash_flow: 'Money left over', buffer: 'Savings buffer',
};

export function reason(k: keyof Parts, p: number): string {
  switch (k) {
    case 'income': return p >= 250 ? '$3,000 or more a month on average' : p >= 180 ? '$2,000 to $3,000 a month on average' : p >= 100 ? '$1,000 to $2,000 a month on average' : 'Under $1,000 a month on average';
    // 25 points per month with income + up to 100 for steady amounts; months can't be told apart
    // from evenness from the total alone, so the wording stays at what the points prove.
    case 'stability': return p >= 250 ? 'Paid every month, in steady amounts' : p >= 200 ? 'Paid most months, fairly steady amounts' : p >= 100 ? 'Income missing in some months, or uneven amounts' : 'Income missing in most months';
    case 'payment': {
      const fees = p >= 250 ? 0 : Math.ceil((250 - p) / 60);
      return fees === 0 ? 'No overdraft or returned-payment fees' : `${fees}${p === 0 ? ' or more' : ''} overdraft or returned-payment fee${fees > 1 ? 's' : ''}`;
    }
    case 'cash_flow': return p >= 150 ? 'Keeps 30% or more of income' : p >= 100 ? 'Keeps 10% to 30% of income' : p >= 50 ? 'Spends nearly all of income' : 'Spends more than earned';
    case 'buffer': return p >= 100 ? 'Savings cover 3 months or more' : p >= 60 ? 'Savings cover 1 to 3 months' : p >= 30 ? 'Savings cover under a month' : 'Little or no savings';
  }
}

/** What would change a band D (or low) result, from the rules that scored below their maximum. */
export function whatWouldChange(parts: Parts): string[] {
  const out: string[] = [];
  if (parts.stability < 250) out.push('Income in all of the last 6 months, in similar amounts');
  if (parts.payment < 250) out.push('No overdraft or returned-payment fees for six months');
  if (parts.cash_flow < 150) out.push('Spending well below income (keep 30% or more)');
  if (parts.income < 250) out.push('A higher average monthly income');
  if (parts.buffer < 100) out.push('Savings that cover three months of spending');
  return out.slice(0, 3);
}
