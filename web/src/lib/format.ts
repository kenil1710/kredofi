// Display helpers (DESIGN 7.8). Pure: unit-tested in format.test.ts.

/** Shorten in the middle: 8u8RsN…fbW (6 + 3, as in DESIGN 1). */
export function shortHash(h: string, head = 6, tail = 3): string {
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** USDC base units (6 decimals, string or bigint) -> "$1,234.50". */
export function usd(base: string | bigint | number, opts: { cents?: boolean } = {}): string {
  const v = typeof base === 'bigint' ? base : BigInt(typeof base === 'number' ? Math.round(base) : base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const dollars = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n; // truncate below a cent
  const whole = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showCents = opts.cents ?? true;
  return `${neg ? '−' : ''}$${whole}${showCents ? '.' + cents.toString().padStart(2, '0') : ''}`;
}

/** Like usd, but drops ".00": "$75", "$187.50" (never rounds a real amount away). */
export function usdShort(base: string | bigint | number): string {
  return usd(base).replace(/\.00$/, '');
}

/** Base units -> an input value, cents rounded DOWN ("6.99" for 6.999999), so it never exceeds what you hold. */
export function usdInput(base: bigint): string {
  const cents = base / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** "12.5" or "12" (dollars, as typed) -> base units, or null if not a valid amount. */
export function parseUsd(input: string): bigint | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return BigInt(w) * 1_000_000n + BigInt((f + '00').slice(0, 2)) * 10_000n;
}

/** Due dates: always absolute, with the year (DESIGN 7.8). */
export function absoluteDate(ns: string | bigint, locale = 'en-GB'): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "just now", "2 min ago", "3 h ago", "5 days ago". */
export function relativeTime(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Whole dollars in words for the note: 250 -> "Two hundred and fifty US dollars, in USDC". */
export function amountInWords(dollars: number): string {
  const n = Math.floor(dollars);
  const words = (x: number): string => {
    if (x < 20) return ONES[x];
    if (x < 100) return TENS[Math.floor(x / 10)] + (x % 10 ? '-' + ONES[x % 10] : '');
    if (x < 1000) return ONES[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' and ' + words(x % 100) : '');
    return words(Math.floor(x / 1000)) + ' thousand' + (x % 1000 ? (x % 1000 < 100 ? ' and ' : ' ') + words(x % 1000) : '');
  };
  if (n === 0) return 'Zero US dollars';
  const w = words(n), c = Math.round((dollars - n) * 100);
  return `${w[0].toUpperCase()}${w.slice(1)} US dollars${c ? ` and ${c} cents` : ''}, in USDC`;
}
