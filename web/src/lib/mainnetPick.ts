// Which values /mainnet shows: a complete live read, else the last complete read, else the dated record.
// Pure: tested in mainnetPick.test.ts.
export type Timed<T> = T & { readAt: number };
export type Picked<T> = Timed<T> & { source: 'live' | 'last-read' | 'record' };

export function pickFacts<T extends object>(read: T | null, nowMs: number, lastGood: Timed<T> | null, record: Timed<T>): Picked<T> {
  if (read) return { ...read, readAt: nowMs, source: 'live' };
  return lastGood ? { ...lastGood, source: 'last-read' } : { ...record, source: 'record' };
}
