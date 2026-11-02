// The AI summary is asked for "no numbers other than the band letter" (scorer/src/lib.rs, demo).
// Models sometimes break that and get numbers wrong (live, Nov 2: "income in one of the last six
// months" for a borrower paid in 4 of 6). The score never depends on it, but a wrong number on the
// page misleads, so a summary with any digit or number word is not shown. Pure, unit-tested.
const NUMBERS = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|once|twice|half|dozen|hundred|thousand)\b/i;

export function usableSummary(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 400 || NUMBERS.test(t)) return null;
  return t;
}
