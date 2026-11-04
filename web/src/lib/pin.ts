// Scorer re-pin time lock (contract v4, security review 2 High): the text for
// "Pending scorer change" on /mainnet and the ledger Verify panel. Pure: tested in pin.test.ts.

export type PendingScorer = { version: string; proposed_at: string; apply_at: string };
export type PinConfig = { scorer_delay_ns?: string; pending_scorer?: PendingScorer | null };

/** UTC, minute precision: "5 Nov 2026, 14:03 UTC". */
export function utcMinute(ns: string): string {
  const d = new Date(Number(BigInt(ns) / 1_000_000n));
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${day}, ${time} UTC`;
}

/** "24 h", "1 min", "90 s". */
export function delayText(ns: string): string {
  const s = Number(BigInt(ns) / 1_000_000_000n);
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

/**
 * - contract without the time lock (v3 or older): `null` delay -> "no time lock on this contract version";
 * - nothing pending -> "none";
 * - pending -> "<hash> applies at <time>" (or "can be applied now" once the lock has passed).
 */
export function pendingScorerText(cfg: PinConfig | null | undefined, nowMs: number): string {
  if (!cfg) return '…';
  if (cfg.scorer_delay_ns === undefined) return 'no time lock on this contract version (re-pins apply at once)';
  const lock = `time lock ${delayText(cfg.scorer_delay_ns)}`;
  const p = cfg.pending_scorer;
  if (!p) return `none (${lock})`;
  const due = Number(BigInt(p.apply_at) / 1_000_000n) <= nowMs;
  return `${p.version} ${due ? `can be applied now (lock ended ${utcMinute(p.apply_at)})` : `applies at ${utcMinute(p.apply_at)} at the earliest`} (${lock})`;
}
