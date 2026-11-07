// Abuse guards for the testnet API routes (audit Nov 3). Pure (no server-only import) so the node
// test runner can load them: guards.test.ts.

/** Sliding-window counter: at most `max` events per `ms` for each key. */
export class Quota {
  private hits = new Map<string, number[]>();
  private max: number;
  private ms: number;
  constructor(max: number, ms: number) { this.max = max; this.ms = ms; }
  /** Records one event and returns true, or returns false (nothing recorded) when the key is full. */
  take(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(now); this.hits.set(key, list);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.ms)) this.hits.delete(k);
    return true;
  }
}

/** New demo accounts per network: enough for judges sharing Wi-Fi, but one network can't use the whole daily total. */
export class DemoAccountBudget {
  private perHour = new Quota(20, 3_600_000);
  private perDay = new Quota(30, 86_400_000);
  /** Records one account for `ip`, or returns the refusal (nothing more recorded). */
  take(ip: string, now = Date.now()): string | null {
    if (!this.perHour.take(ip, now)) return 'Twenty demo accounts per hour from one network. Reuse the one you have, or try again later.';
    if (!this.perDay.take(ip, now)) return 'Thirty demo accounts per day from one network. Reuse the one you have, or try again tomorrow.';
    return null;
  }
}

/** Below this the relayer stops funding demo accounts and fee top-ups (OutLayer mode, ENCLAVE_PLAN). */
export const RELAYER_FLOOR = 3n * 10n ** 24n;
/** True when new demo accounts and top-ups must stop. An unreadable balance (null) doesn't stop them; the health
 * watch reports it instead. */
export const relayerBelowFloor = (balance: bigint | null) => balance !== null && balance < RELAYER_FLOOR;

/**
 * One-time score challenges, per account, valid 5 minutes, consumed on use. Each requester (client IP
 * key) holds at most 5 open nonces per account and evicts only its own, so nobody can flood another
 * person's account and push out the nonce their wallet is signing (audit L3). At most 50 open per
 * account in total; expired accounts are swept so the map can't grow without bound.
 */
export class ChallengeStore {
  static TTL = 5 * 60_000;
  private open = new Map<string, { nonce: string; at: number; by: string }[]>();

  issue(accountId: string, by: string, nonce: string, now = Date.now()): void {
    let list = (this.open.get(accountId) ?? []).filter((c) => now - c.at < ChallengeStore.TTL);
    const mine = list.filter((c) => c.by === by);
    if (mine.length >= 5) list = list.filter((c) => c !== mine[0]);
    list.push({ nonce, at: now, by });
    if (list.length > 50) list = list.slice(-50);
    this.open.set(accountId, list);
    if (this.open.size > 10_000) this.sweep(now);
  }

  /** True once for a nonce issued for this account in the last 5 minutes (by anyone). */
  consume(accountId: string, nonce: string, now = Date.now()): boolean {
    const list = (this.open.get(accountId) ?? []).filter((c) => now - c.at < ChallengeStore.TTL);
    const i = list.findIndex((c) => c.nonce === nonce);
    if (i >= 0) list.splice(i, 1);
    if (list.length) this.open.set(accountId, list); else this.open.delete(accountId);
    return i >= 0;
  }

  sweep(now = Date.now()): void {
    for (const [k, v] of this.open) if (!v.some((c) => now - c.at < ChallengeStore.TTL)) this.open.delete(k);
  }

  get size() { return this.open.size; }
}

/**
 * Test-USDC faucet budget (audit M2). Each call costs the relayer storage (0.00125 NEAR for a new
 * account) and gas, so: 10 calls per IP per hour, 10 lender grants ($500) per IP per hour (3 per day until Nov 7; raised for
 * judges on shared Wi-Fi), and at most
 * 300 calls and 60 lender grants a day in total. The account must also exist on chain (checked by
 * the route), so random implicit ids are refused.
 */
export class FaucetBudget {
  private perIp = new Quota(10, 3_600_000);
  private lendPerIp = new Quota(10, 3_600_000);
  private all = new Quota(300, 86_400_000);
  private lendAll = new Quota(60, 86_400_000);

  /** null when allowed (and counted), otherwise the refusal message. */
  check(ip: string, lend: boolean, now = Date.now()): string | null {
    if (!this.perIp.take(ip, now)) return 'Too many test USDC requests from this network. Try again in an hour.';
    if (lend && !this.lendPerIp.take(ip, now)) return 'Ten lender test-USDC grants per hour from one network. Try again in an hour.';
    if (!this.all.take('all', now) || (lend && !this.lendAll.take('all', now))) return 'The test USDC faucet reached its daily limit. Try again tomorrow.';
    return null;
  }
}

/** True when the contract would accept `mark_default` now: `now > due_at + grace` (loans.rs). */
export function pastDue(dueAtNs: string | undefined, graceNs: string, nowMs = Date.now()): boolean {
  if (!dueAtNs) return false;
  return BigInt(nowMs) * 1_000_000n > BigInt(dueAtNs) + BigInt(graceNs);
}

/** An error whose message was written for the visitor (e.g. the scorer's own error line). */
export class PublicError extends Error {}

/** A client-safe error message: PublicError messages pass through, internal errors (RPC, keys) do not (audit Info 4). */
export function publicError(e: unknown, fallback: string): string {
  if (e instanceof PublicError) return e.message;
  const msg = e instanceof Error ? e.message : '';
  if (/NotEnoughBalance|LackBalance/i.test(msg)) return 'The demo relayer is out of test NEAR. Try again later.';
  return fallback;
}
